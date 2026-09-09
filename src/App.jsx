import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChalkDefs from './components/ChalkDefs.jsx';
import CodeEntry from './components/CodeEntry.jsx';
import Lobby from './components/Lobby.jsx';
import Admin from './components/Admin.jsx';
import Welcome from './components/Welcome.jsx';
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

export default function App() {
  const [me, setMe] = useState(() => (P[readMe()] ? readMe() : null));
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
            // Adopt the remote board unless we are strictly ahead, which means
            // our own optimistic move has not round-tripped yet.
            if (m.game.moves.length < prev.game.moves.length) return prev;
            const last = m.game.moves[m.game.moves.length - 1];
            return {
              ...prev,
              game: m.game,
              lastMove: last === undefined ? null : last,
              id: m.game.moves.length === 0 ? nextId() : prev.id
            };
          }
          return {
            id: nextId(), kind: 'online', matchId, host: m.host, guest: m.guest,
            bots: {}, game: m.game, lastMove: null, queue: emptyQueue(), starterFlip: 0
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
        const game = createGame({ mode: prev.game.mode, order: prev.game.order, starterFlip: 1 });
        matchApi.pushGame(prev.matchId, game);
        return { ...prev, id: nextId(), game, lastMove: null };
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

  function signOut() {
    writeMe(null);
    setMe(null);
    setSession(null);
    setOutgoing(null);
  }

  if (!me) {
    return <CodeEntry onEnter={(id) => { writeMe(id); setMe(id); }} />;
  }

  const source = store ? store.source : 'local';
  const footNote = source === 'cloud'
    ? 'Shared table · 3 points for a win · 1 for a draw'
    : source === 'local'
      ? 'This device only · 3 points for a win · 1 for a draw'
      : 'Scores last until you close this tab — they aren’t saving here';

  return (
    <div className="wrap">
      <ChalkDefs />
      <header className={'masthead' + (session ? ' compact' : '')}>
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

      {!session && <Welcome me={me} ledger={ledger} onSwitch={signOut} />}

      <div className="cols">
        <section>
          {session ? (
            <GameView session={session} me={me} onPlay={doMove} onNext={nextGame}
                      onLeave={leaveGame} onUndo={undo} />
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

function GameView({ session, me, onPlay, onNext, onLeave, onUndo }) {
  const { game, kind, bots } = session;
  const current = game.over ? null : game.order[game.turn];
  const myTurn = kind !== 'online' || current === me;
  const waiting = kind === 'online' && !game.over && !myTurn;

  let headline;
  let sub;
  if (session.ended) {
    headline = P[session.ended].name + ' left';
    sub = 'The game ended early';
  } else if (game.over && game.winner) {
    headline = P[game.winner].name + ' wins';
    sub = kind === 'local' && game.mode === 'duel'
      ? 'Holds the board · next up ' + P[session.queue[0]].name + ' v ' + P[session.queue[1]].name
      : 'Added to the ledger';
  } else if (game.over) {
    headline = 'Drawn';
    sub = kind === 'local' && game.mode === 'duel'
      ? 'A point each · next up ' + P[session.queue[0]].name + ' v ' + P[session.queue[1]].name
      : 'A point each';
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
        {game.over
          ? <button className="act" id="primary" onClick={onNext}>Next game</button>
          : <button className="act ghost" id="primary" onClick={onNext}>Restart</button>}
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
