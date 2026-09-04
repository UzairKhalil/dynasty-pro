import Tally from './Tally.jsx';
import { P, PAIRS } from '../data/players.js';
import { standings, hasPlayed, points } from '../game/ledger.js';

const ordinal = (n) => ['1st', '2nd', '3rd', '4th', '5th', '6th'][n - 1] || `${n}th`;

export function Standings({ ledger }) {
  const played = hasPlayed(ledger);
  return (
    <div className="rows" id="standings">
      {standings(ledger).map((s, i) => {
        const p = P[s.id];
        return (
          <div className="row" key={s.id}>
            <div>
              <div className="who">
                <span className="name" style={{ color: p.color }}>{p.name}</span>
                {played && <span className="rank">{ordinal(i + 1)}</span>}
                {s.streak > 1 && <span className="rank">{s.streak} in a row</span>}
              </div>
              <div className="tally"><Tally n={s.w} color={p.color} /></div>
            </div>
            <div className="figures">
              <b>{points(ledger, s.id)}</b><i>points</i><br />
              {s.p} played<br />
              {s.w}W · {s.d}D · {s.l}L
              {s.best > 1 && <><br />best run {s.best}</>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function HeadToHead({ ledger }) {
  return (
    <div id="h2h">
      {PAIRS.map((pr) => {
        const h = ledger.h2h[pr.join('|')];
        const total = h.a + h.b + h.d;
        return (
          <div className="h2h-row" key={pr.join('|')}>
            <span>
              <span style={{ color: P[pr[0]].color }}>{P[pr[0]].name}</span> {h.a} — {h.b}{' '}
              <span style={{ color: P[pr[1]].color }}>{P[pr[1]].name}</span>
            </span>
            <span className="res">{total ? `${h.d} drawn` : 'not played'}</span>
          </div>
        );
      })}
    </div>
  );
}

const KIND = { online: 'online', solo: 'vs computer', local: '' };

export function GameLog({ ledger, canStrike = false, onStrike }) {
  if (!ledger.log.length) {
    return (
      <ul className="log" id="log">
        <li className="empty">Nothing played yet. Pick an opponent and take the first turn.</li>
      </ul>
    );
  }
  return (
    <ul className="log" id="log">
      {ledger.log.map((g, i) => {
        const who = g.players.length > 2
          ? 'All four'
          : `${P[g.players[0]].name} v ${P[g.players[1]].name}`;
        const tags = [g.mode === 'free' ? '6×6' : null, KIND[g.kind]].filter(Boolean);
        return (
          <li key={`${g.at}-${i}`}>
            <span>{who}</span>
            <span>
              <b>{g.winner ? P[g.winner].name : 'drawn'}</b>
              {tags.length > 0 && ` · ${tags.join(' · ')}`}
              {canStrike && g.id && (
                <button className="strike-game" onClick={() => onStrike(g.id)}
                        title="Strike this game from the record"
                        aria-label={`Strike ${who} from the record`}>&times;</button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
