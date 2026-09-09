import Mark from './Mark.jsx';
import { P } from '../data/players.js';

/**
 * Who is playing this game, and who is on move.
 *
 * INVARIANT 6 — seats are patched, never rebuilt. Stable keys off the player id
 * mean only class names and text change between turns, so nothing shifts under
 * a thumb that is already reaching for a square.
 *
 * Only the players actually IN the game are listed. Earlier this rendered all
 * four with two marked "sitting out", which on a phone pushed the board and the
 * turn indicator onto separate screens — the two things you most need to see
 * together. The lobby is where the full roster belongs.
 */
export default function Seats({ game, bots = {}, me = null }) {
  const current = game.over ? null : game.order[game.turn];
  const duel = game.order.length === 2;

  const seat = (id) => {
    let state;
    if (!game.over) state = id === current ? 'to play' : 'waiting';
    else if (!game.winner) state = 'drawn';
    else state = game.winner === id ? 'winner' : 'beaten';

    return (
      <div
        key={id}
        className={
          'seat' +
          (id === current ? ' active' : '') +
          (game.over && game.winner === id ? ' winner' : '') +
          (game.over && game.winner && game.winner !== id ? ' beaten' : '')
        }
        style={{ '--seat-color': P[id].color }}
      >
        <Mark id={id} className="seat-mark" />
        <span className="seat-name">{P[id].name}</span>
        <span className="seat-tags">
          {me === id && <span className="seat-tag">you</span>}
          {bots[id] && <span className="seat-tag">bot</span>}
        </span>
        <span className="seat-state">{state}</span>
      </div>
    );
  };

  return (
    <div className={'seats' + (duel ? ' seats-duel' : ' seats-many')} id="seats">
      {duel
        ? [seat(game.order[0]), <span className="seats-vs" key="vs" aria-hidden="true">vs</span>, seat(game.order[1])]
        : game.order.map(seat)}
    </div>
  );
}
