import { useState } from 'react';
import Mark from './Mark.jsx';
import { PLAYERS, P, IDS } from '../data/players.js';
import { LEVELS } from '../game/ai.js';

function Dot({ on }) {
  return <i className={on ? 'dot on' : 'dot'} aria-hidden="true" />;
}

export default function Lobby({
  me, presence, online, invite, outgoing,
  onChallenge, onRespond, onCancel, onLocal, onSolo, notice = null
}) {
  const [level, setLevel] = useState('steady');
  const [soloMode, setSoloMode] = useState('duel');
  const others = IDS.filter((id) => id !== me);

  const hostAway = Boolean(invite && online && presence[invite.from] && !presence[invite.from].online);

  return (
    <>
      {notice && (
        <div className="banner banner-note" role="status">
          <span className="banner-text">{notice}</span>
        </div>
      )}

      {invite && (
        <div className="banner">
          <span className="banner-text">
            <b>{P[invite.from].name}</b> wants a game
            {invite.mode === 'free' ? ' · free-for-all' : ' · duel'}
            {hostAway && (
              // Still worth accepting: their page picks the game up the moment
              // they come back to it.
              <span className="banner-sub">They look away right now — the game starts when they're back.</span>
            )}
          </span>
          <span className="choices">
            <button className="act" onClick={() => onRespond(invite, true)}>Accept</button>
            <button className="act ghost" onClick={() => onRespond(invite, false)}>Decline</button>
          </span>
        </div>
      )}

      {outgoing && (
        <div className="banner">
          <span className="banner-text">
            Waiting for <b>{P[outgoing.guest].name}</b><i className="waiting" />
          </span>
          <button className="act ghost" onClick={onCancel}>Cancel</button>
        </div>
      )}

      <div className="card">
        <h3>At the board</h3>
        <div className="lobby-grid">
          {PLAYERS.map((p) => {
            const state = presence[p.id] || { online: false };
            const isMe = p.id === me;
            const busy = Boolean(state.busy);
            const reachable = online && state.online && !isMe && !busy && !outgoing;
            const status = isMe ? 'you'
              : busy ? 'in a game'
              : state.online ? 'online' : 'away';

            // Three columns, always: mark | name over status | action. The row
            // used to be one big button with the action as a fourth child,
            // which on a phone wrapped onto its own line under the name and
            // read as a bug. A real button is also a clearer tap target than
            // a list row that happens to be clickable.
            return (
              <div key={p.id} className={'who-row' + (isMe ? ' me' : '')}>
                <Mark id={p.id} className="who-mark" />
                <span className="who-id">
                  <span className="who-name" style={{ color: p.color }}>{p.name}</span>
                  <span className="who-state">
                    <Dot on={isMe || state.online} />{status}
                  </span>
                </span>
                {reachable && (
                  <button type="button" className="who-go" onClick={() => onChallenge(p.id)}>
                    Challenge
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {!online && (
          <p className="notice">
            Online play is off — this build has no realtime service configured, so only the
            games on this device are available.
          </p>
        )}
      </div>

      <div className="card">
        <h3>On this device</h3>
        <div className="choices">
          {others.map((id) => (
            <button key={id} className="chip" onClick={() => onLocal('duel', [me, id])}>
              {P[me].name} v {P[id].name}
            </button>
          ))}
          <span className="divider" />
          <button className="chip" onClick={() => onLocal('free', IDS.slice())}>
            All four · 6×6
          </button>
        </div>
        <p className="notice">
          Pass the phone around. Duels run winner-stays: the winner holds the board and the
          next player in the queue steps in.
        </p>
      </div>

      <div className="card">
        <h3>Against the computer</h3>
        <div className="choices">
          {Object.entries(LEVELS).map(([key, l]) => (
            <button key={key} className="chip" aria-pressed={level === key}
                    onClick={() => setLevel(key)}>{l.label}</button>
          ))}
          <span className="divider" />
          {['duel', 'free'].map((m) => (
            <button key={m} className="chip" aria-pressed={soloMode === m}
                    onClick={() => setSoloMode(m)}>{m === 'duel' ? '3×3' : '6×6'}</button>
          ))}
        </div>
        <div className="choices" style={{ marginTop: 12 }}>
          <button className="act" onClick={() => onSolo(soloMode, level)}>Start solo game</button>
        </div>
        <p className="notice">
          {soloMode === 'duel'
            ? 'One bot opponent on the 3×3 board. Ruthless solves the board and cannot be beaten.'
            : 'Three bot opponents on the 6×6 board. Four in a row wins.'}
        </p>
      </div>
    </>
  );
}
