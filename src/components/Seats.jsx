import Mark from './Mark.jsx';
import { PLAYERS } from '../data/players.js';

/**
 * INVARIANT 6 — seats are patched, never rebuilt. React gives this for free
 * as long as the rows keep stable keys off the roster: only className and text
 * change between turns, so there is no layout shift each move.
 */
export default function Seats({ game, bots = {}, me = null }) {
  const current = game.over ? null : game.order[game.turn];
  const playing = new Set(game.order);

  return (
    <div className="seats" id="seats">
      {PLAYERS.map((p) => {
        const inGame = playing.has(p.id);
        let state;
        if (!inGame) state = 'sitting out';
        else if (!game.over) state = p.id === current ? 'to play' : 'waiting';
        else if (!game.winner) state = 'drawn';
        else state = game.winner === p.id ? 'winner' : 'beaten';

        return (
          <div key={p.id}
               className={'seat' + (!inGame ? ' out' : '') +
                 (p.id === current ? ' active' : '') +
                 (game.over && game.winner === p.id ? ' winner' : '')}>
            <Mark id={p.id} className="seat-mark" />
            <span className="seat-name" style={{ color: p.color }}>
              {p.name}
              {me === p.id && <span className="seat-bot">you</span>}
              {bots[p.id] && <span className="seat-bot">bot</span>}
            </span>
            <span className="seat-state">{state}</span>
          </div>
        );
      })}
    </div>
  );
}
