import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChalkDefs from './components/ChalkDefs.jsx';
import CodeEntry from './components/CodeEntry.jsx';
import Lobby from './components/Lobby.jsx';
import Admin from './components/Admin.jsx';
import Welcome from './components/Welcome.jsx';
import History from './components/History.jsx';
import useIdle from './hooks/useIdle.js';
import { isExpired, readActive, writeActive } from './net/idle.js';
import { recordLogin } from './net/logins.js';
import Board from './components/Board.jsx';
import Seats from './components/Seats.jsx';
import { Standings, HeadToHead, GameLog } from './components/Panels.jsx';
import { PLAYERS, P, IDS, isAdmin } from './data/players.js';
import { createGame, applyMove, undoMove, advanceQueue, emptyQueue } from './game/rules.js';
import { chooseMove } from './game/ai.js';
import { blankLedger, foldGames } from './game/ledger.js';
import { open as openStore } from './net/store.js';
import { isConfigured } from './net/firebase.js';
import * as presenceApi from './net/presence.js';
import * as matchApi from './net/match.js';

const ME_KEY = 'dynasty:me';
const readMe = () => { try { return window.localStorage.getItem(ME_KEY); } catch { return null; } };
const writeMe = (v) => {
  try {
    if (v) window.localStorage.setItem(ME_KEY, v);
    else window.localStorage.removeItem(ME_KEY);
  } catch { /* private mode: the seat just won't be remembered */ }
};

let seq = 0;
const nextId = () => ++seq;

// A remembered seat is only honoured if it was used in the last 30 minutes.
// Checked here, before the first render, so a stale seat never flashes the
// lobby before bouncing to the code screen.
function initialSeat() {
  const id = readMe();
  if (!P[id]) return { me: null, idle: false };
  if (isExpired(readActive())) {
    writeMe(null);
    writeActive(0);
    return { me: null, idle: true };
  }
  return { me: id, idle: false };
}

const onHistoryHash = () =>
  typeof window !== 'undefined' && window.location.hash === '#history';

export default function App() {
  const [start] = useState(initialSeat);
  const [me, setMe] = useState(start.me);
  const [signedOutBy, setSignedOutBy] = useState(start.idle ? 'idle' : null);
  const [view, setView] = useState(() => (onHistoryHash() ? 'history' : 'lobby'));
  const [store, setStore] = useState(null);
  const [games, setGames] = useState([]);
  const [presence, setPresence] = useState(presenceApi.offlineState());
  const [invite, setInvite] = useState(null);
  const [outgoing, setOutgoing] = useState(null);
  const [session, setSession] = useState(null);

  const online = isConfigured();
  const admin = isAdmin(me);
  const ledger = useMemo(() => (games.length ? foldGames(games) : blankLedger()), [games]);
  const recorded = useRef(new Set());

  /* ---------------- storage ---------------- */

  useEffect(() => {
    let stop = null;
    let dead = false;
    openStore().then((s) => {
      if (dead) return;
      setStore(s);
      if (s.seed.length) setGames(s.seed);
      stop = s.watch(setGames);
    });
    return () => { dead = true; if (typeof stop === 'function') stop(); };
  }, []);

  /* ---------------- presence and invites ---------------- */

  useEffect(() => {
    if (!me || !online) return undefined;
    let cleanups = [];
    let dead = false;
    const add = (p) => p.then((fn) => { if (dead) { if (fn) fn(); } else cleanups.push(fn); });
    add(presenceApi.claim(me));
    add(presenceApi.watchAll(setPresence));
    add(matchApi.watchInvite(me, setInvite));
    return () => { dead = true; cleanups.forEach((fn) => fn && fn()); cleanups = []; };
  }, [me, online]);

  /* ---------------- online match sync ---------------- */

  const matchId = (session && session.matchId) || (outgoing && outgoing.matchId) || null;

  useEffect(() => {
    if (!matchId || !online) return undefined;
    let stop = null;
    let dead = false;
    matchApi.watchMatch(matchId, (m) => {
      if (dead || !m) return;
      if (m.status === 'active') {
        setOutgoing(null);
        setSession((prev) => {
          if (prev && prev.matchId === matchId) {
            // A NEW round always wins. Only within the same round does the
            // move count decide, and there it guards our own optimistic move
            // against a stale echo. Comparing move counts alone used to reject
            // the next game outright: a fresh board has 0 moves against a
            // finished one's 5, so the player who did not press the button
            // stayed staring at the old result.
            const fresh = m.round > prev.round;
            if (!matchApi.adopt({ round: prev.round, moves: prev.game.moves.length },
                                { round: m.round, moves: m.game.moves.length })) {
              return { ...prev, rematch: m.rematch };
            }
            const last = m.game.moves[m.game.moves.length - 1];
            return {
              ...prev,
              game: m.game,
              round: m.round,
              rematch: m.rematch,
              lastMove: fresh ? null : (last === undefined ? null : last),
              id: fresh ? nextId() : prev.id
            };
          }
          return {
            id: nextId(), kind: 'online', matchId, host: m.host, guest: m.guest,
            bots: {}, game: m.game, round: m.round, rematch: m.rematch,
            lastMove: null, queue: emptyQueue(), starterFlip: 0
          };
        });
      } else if (m.status === 'declined' || m.status === 'cancelled') {
        setOutgoing(null);
        setSession((prev) => (prev && prev.matchId === matchId ? null : prev));
      } else if (m.status === 'done') {
        setSession((prev) => (prev && prev.matchId === matchId
          ? { ...prev, ended: m.leftBy } : prev));
      }
    }).then((fn) => { if (dead) { if (fn) fn(); } else stop = fn; });
    return () => { dead = true; if (typeof stop === 'function') stop(); };
  }, [matchId, online]);

  const busyId = session ? session.matchId : null;
  useEffect(() => {
    if (!me || !online) return;
    presenceApi.setBusy(me, busyId || null);
  }, [me, online, busyId]);

  /* ---------------- moves ---------------- */

  const doMove = useCallback((idx) => {
    setSession((prev) => {
      if (!prev || prev.game.over) return prev;
      if (prev.kind === 'online' && prev.game.order[prev.game.turn] !== me) return prev;
      const game = applyMove(prev.game, idx);
      if (game === prev.game) return prev;
      if (prev.kind === 'online') matchApi.pushGame(prev.matchId, game);
      return { ...prev, game, lastMove: idx };
    });
  }, [me]);

  // Bots move on a short delay so the board reads as a turn taken, not a jump.
  // Three bots in a row would stack that into 1.26s of dead time between a
  // human's turns, so the pause shrinks as the number of bot seats grows.
  // (The thinking itself is well under a millisecond; this is all pacing.)
  useEffect(() => {
    const s = session;
    if (!s || s.game.over) return undefined;
    const seat = s.game.order[s.game.turn];
    if (!s.bots[seat]) return undefined;
    const pause = Math.round(420 / Math.max(1, Object.keys(s.bots).length * 0.7));
    const t = setTimeout(() => {
      const idx = chooseMove(s.game, s.bots[seat]);
      if (idx >= 0) doMove(idx);
    }, pause);
    return () => clearTimeout(t);
  }, [session, doMove]);

  /* ---------------- rematch ---------------- */

  // Once BOTH players have asked, exactly one of them creates the next board.
  // The host is chosen arbitrarily but consistently, so the two clients cannot
  // push two different boards in the same instant.
  useEffect(() => {
    const s = session;
    if (!s || s.kind !== 'online' || !s.game.over || s.ended) return;
    if (s.host !== me) return;
    const agreed = s.game.order.every((id) => s.rematch && s.rematch[id]);
    if (!agreed) return;
    const round = (s.round || 0) + 1;
    matchApi.startRound(s.matchId, createGame({
      mode: s.game.mode, order: s.game.order, starterFlip: round
    }), round);
  }, [session, me]);

  const withdrawRematch = useCallback(() => {
    setSession((prev) => {
      if (prev && prev.kind === 'online') matchApi.withdrawRematch(prev.matchId, me);
      return prev;
    });
  }, [me]);

  /* ---------------- recording a finished game ---------------- */

  useEffect(() => {
    const s = session;
    if (!s || !s.game.over || !store) return;
    const sig = s.kind + ':' + (s.matchId || 'local') + ':' + s.id;
    if (recorded.current.has(sig)) return;
    recorded.current.add(sig);

    // Exactly one device writes an online result, or the game lands twice.
    if (s.kind !== 'online' || s.host === me) {
      store.append({
        players: s.game.order.slice(),
        winner: s.game.winner,
        mode: s.game.mode,
        kind: s.kind,
        at: Date.now()
      });
    }
    if (s.kind === 'local' && s.game.mode === 'duel') {
      setSession((prev) => (prev && prev.id === s.id
        ? {
            ...prev,
            queue: advanceQueue(prev.queue, s.game.winner),
            starterFlip: prev.starterFlip + 1
          }
        : prev));
    }
  }, [session, store, me]);

  /* ---------------- starting games ---------------- */

  const startLocal = useCallback((mode, order) => {
    const queue = mode === 'duel'
      ? order.concat(IDS.filter((id) => order.indexOf(id) < 0))
      : emptyQueue();
    setSession({
      id: nextId(), kind: 'local', bots: {}, queue, starterFlip: 0, lastMove: null,
      game: createGame({ mode, order: mode === 'duel' ? queue.slice(0, 2) : order })
    });
  }, []);

  const startSolo = useCallback((mode, level) => {
    const order = mode === 'duel'
      ? [me, IDS.find((id) => id !== me)]
      : [me].concat(IDS.filter((id) => id !== me));
    const bots = {};
    order.forEach((id) => { if (id !== me) bots[id] = level; });
    setSession({
      id: nextId(), kind: 'solo', bots, queue: emptyQueue(), starterFlip: 0, lastMove: null,
      game: createGame({ mode, order })
    });
  }, [me]);

  const nextGame = useCallback(() => {
    setSession((prev) => {
      if (!prev) return prev;
      if (prev.kind === 'online') {
        // Ask, don't restart. The board only resets once the other player has
        // asked too, so nobody has the result yanked away mid-read.
        if (prev.game.over) matchApi.askRematch(prev.matchId, me);
        return prev;
      }
      const order = prev.game.mode === 'duel' ? prev.queue.slice(0, 2) : prev.game.order;
      return {
        ...prev, id: nextId(), lastMove: null,
        game: createGame({ mode: prev.game.mode, order, starterFlip: prev.starterFlip })
      };
    });
  }, []);

  const leaveGame = useCallback(() => {
    setSession((prev) => {
      if (prev && prev.kind === 'online') matchApi.leave(prev.matchId, me);
      return null;
    });
  }, [me]);

  const undo = useCallback(() => {
    setSession((prev) => (prev ? { ...prev, game: undoMove(prev.game), lastMove: null } : prev));
  }, []);

  /* ---------------- lobby actions ---------------- */

  const challenge = useCallback(async (guest) => {
    const id = await matchApi.invite(me, guest, 'duel');
    if (id) setOutgoing({ matchId: id, guest });
  }, [me]);

  const respond = useCallback(async (inv, accept) => {
    setInvite(null);
    await matchApi.respond(inv.matchId, me, accept);
    if (accept) setOutgoing({ matchId: inv.matchId, guest: me });
  }, [me]);

  const cancelInvite = useCallback(async () => {
    if (outgoing) await matchApi.cancel(outgoing.matchId, outgoing.guest);
    setOutgoing(null);
  }, [outgoing]);

  const wipeLedger = useCallback(() => {
    if (!isAdmin(me)) return;
    recorded.current.clear();
    if (store) store.clear();
    setGames([]);
  }, [me, store]);

  const strikeGame = useCallback((id) => {
    if (!isAdmin(me) || !store) return;
    store.remove(id);
    setGames((prev) => prev.filter((g) => g.id !== id));
  }, [me, store]);

  const clearPresence = useCallback(() => {
    if (!isAdmin(me)) return;
    presenceApi.clearAll();
  }, [me]);

  const signIn = useCallback((id) => {
    writeMe(id);
    writeActive(Date.now());
    setSignedOutBy(null);
    setMe(id);
    recordLogin(id, 'in');
  }, []);

  // `reason` arrives as a click event when this is wired straight to a button,
  // so it is normalised rather than trusted — an event object must never reach
  // the database.
  const signOut = useCallback((reason) => {
    const why = reason === 'idle' ? 'idle' : 'manual';
    const who = me;
    // Signing out must not strand an online opponent or leave a challenge ringing.
    if (session && session.kind === 'online') matchApi.leave(session.matchId, who);
    if (outgoing) matchApi.cancel(outgoing.matchId, outgoing.guest);
    setSession(null);
    setOutgoing(null);
    writeMe(null);
    writeActive(0);
    setMe(null);
    setView('lobby');
    if (onHistoryHash()) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    setSignedOutBy(why === 'idle' ? 'idle' : null);
    if (who) recordLogin(who, 'out', why);
  }, [me, session, outgoing]);

  useIdle({ enabled: Boolean(me), onExpire: () => signOut('idle') });

  // The history page has no button anywhere in the app: the admin reaches it
  // by typing .../#history. A hash rather than a path, because base './' only
  // holds while the app has no path router. The admin check below still
  // applies, so the URL shows anyone else the ordinary lobby.
  useEffect(() => {
    const sync = () => setView(onHistoryHash() ? 'history' : 'lobby');
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const closeHistory = useCallback(() => {
    setView('lobby');
    if (onHistoryHash()) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  if (!me) {
    return <CodeEntry onEnter={signIn} notice={signedOutBy} />;
  }

  const showHistory = admin && view === 'history' && !session;

  const source = store ? store.source : 'local';
  const footNote = source === 'cloud'
    ? 'Shared table · 3 points for a win · 1 for a draw'
    : source === 'local'
      ? 'This device only · 3 points for a win · 1 for a draw'
      : 'Scores last until you close this tab — they aren’t saving here';

  return (
    <div className="wrap">
      <ChalkDefs />
      <header className={'masthead' + (session || showHistory ? ' compact' : '')}>
        <p className="eyebrow">Tic tac toe</p>
        <h1>Dynasty</h1>
        <p className="tagline">Four claimants. Nine squares. The throne changes hands weekly.</p>
        <div className="names">
          {PLAYERS.map((p) => (
            <span key={p.id}>
              <i className="swatch" style={{ background: p.color }} />{p.name}
            </span>
          ))}
        </div>
      </header>

      {!session && !showHistory && <Welcome me={me} ledger={ledger} onSwitch={signOut} />}

      {showHistory ? <History onBack={closeHistory} /> : (
      <div className="cols">
        <section>
          {session ? (
            <GameView session={session} me={me} onPlay={doMove} onNext={nextGame}
                      onLeave={leaveGame} onUndo={undo}
                      onWithdrawRematch={withdrawRematch} />
          ) : (
            <>
              <h2 className="panel-title">Choose a game</h2>
              <Lobby me={me} presence={presence} online={online} invite={invite}
                     outgoing={outgoing} onChallenge={challenge} onRespond={respond}
                     onCancel={cancelInvite} onLocal={startLocal} onSolo={startSolo} />
              {admin && (
                <Admin me={me} source={source} gameCount={games.length} online={online}
                       onWipe={wipeLedger} onClearPresence={clearPresence} />
              )}
            </>
          )}
        </section>

        <section>
          <div className="block" style={{ marginTop: 0 }}>
            <h2 className="panel-title">Series standings</h2>
            <Standings ledger={ledger} />
          </div>
          <div className="block">
            <h2 className="panel-title">Head to head</h2>
            <HeadToHead ledger={ledger} />
          </div>
          <div className="block">
            <h2 className="panel-title">Recent games</h2>
            <GameLog ledger={ledger} canStrike={admin} onStrike={strikeGame} />
          </div>
        </section>
      </div>
      )}

      <div className="foot">
        <span id="note">{footNote}</span>
        <span className="choices">
          {admin && <span className="admin-tag">admin</span>}
        </span>
      </div>
    </div>
  );
}

/* ---------------- the game screen ---------------- */

function GameView({ session, me, onPlay, onNext, onLeave, onUndo, onWithdrawRematch }) {
  const { game, kind, bots } = session;
  const opponent = game.order.find((id) => id !== me);
  const rematch = session.rematch || {};
  const iAsked = Boolean(rematch[me]);
  const theyAsked = Boolean(opponent && rematch[opponent]);
  const current = game.over ? null : game.order[game.turn];
  const myTurn = kind !== 'online' || current === me;
  const waiting = kind === 'online' && !game.over && !myTurn;

  // Both players have to agree before the board resets, so say where that
  // stands rather than leaving one of them wondering why nothing happened.
  const rematchNote = kind !== 'online' || !opponent ? null
    : theyAsked && !iAsked ? P[opponent].name + ' wants to play again'
    : iAsked && !theyAsked ? 'Waiting for ' + P[opponent].name + ' to agree'
    : null;

  let headline;
  let sub;
  if (session.ended) {
    headline = P[session.ended].name + ' left';
    sub = 'The game ended early';
  } else if (game.over && game.winner) {
    headline = P[game.winner].name + ' wins';
    sub = kind === 'local' && game.mode === 'duel'
      ? 'Holds the board · next up ' + P[session.queue[0]].name + ' v ' + P[session.queue[1]].name
      : rematchNote || 'Added to the ledger';
  } else if (game.over) {
    headline = 'Drawn';
    sub = kind === 'local' && game.mode === 'duel'
      ? 'A point each · next up ' + P[session.queue[0]].name + ' v ' + P[session.queue[1]].name
      : rematchNote || 'A point each';
  } else if (waiting) {
    headline = P[current].name + '’s turn';
    sub = 'Waiting for their move';
  } else {
    headline = kind === 'online' ? 'Your turn' : P[current].name + '’s turn';
    sub = game.need + ' in a row wins';
  }

  // Short enough that the crumb row stays on one line at 360px. The seat bar
  // right below already says who is playing, so these only need to say what
  // KIND of game it is.
  const label = { online: 'Online', solo: 'Computer', local: 'This device' }[kind];
  const headColor = game.over
    ? (game.winner ? P[game.winner].color : undefined)
    : (current ? P[current].color : undefined);

  return (
    <div className="play">
      <div className="play-top">
        <button className="play-back" onClick={onLeave}>&larr; Lobby</button>
        <span className="pill">{label}</span>
        <span className="pill">{game.size}&times;{game.size}</span>
      </div>

      {/* Names first, then the turn, then the board. On a phone these have to
          share one screen — the turn indicator used to sit below the board,
          where you could never see it and the squares at the same time. */}
      <Seats game={game} bots={bots} me={me} />

      <div className={'turnline' + (waiting ? ' waiting' : '')}>
        <div className="headline" id="headline" style={{ color: headColor }}>{headline}</div>
        <div className="headline-sub" id="headline-sub">{sub}</div>
      </div>

      <div className={waiting ? 'turn-lock' : undefined}>
        <Board game={game} lastMove={session.lastMove} onPlay={onPlay}
               locked={!myTurn || Boolean(current && bots[current])} />
      </div>

      <div className="play-actions">
        {kind === 'online' && game.over && !session.ended ? (
          iAsked
            ? (
              <button className="act ghost waiting-act" id="primary" onClick={onWithdrawRematch}>
                Waiting for {P[opponent].name}<i className="waiting" />
              </button>
            )
            : (
              <button className="act" id="primary" onClick={onNext}>
                {theyAsked ? 'Accept rematch' : 'Play again'}
              </button>
            )
        ) : game.over ? (
          <button className="act" id="primary" onClick={onNext}>Next game</button>
        ) : (
          <button className="act ghost" id="primary" onClick={onNext}>Restart</button>
        )}
        {!game.over && kind !== 'online' && (
          <button className="act ghost" id="undo" onClick={onUndo}
                  disabled={game.moves.length === 0}>Undo</button>
        )}
        <button className="act ghost" onClick={onLeave}>Leave</button>
      </div>

      <p className="sr" role="status" aria-live="polite">
        {game.over
          ? (game.winner ? P[game.winner].name + ' wins.' : 'Game drawn.')
          : P[current].name + ' to play.'}
      </p>
    </div>
  );
}
