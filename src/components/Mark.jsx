import { useState } from 'react';
import { SHAPES } from '../game/rules.js';
import { P } from '../data/players.js';

/**
 * INVARIANT 2 — a mark's draw animation fires once, at mount, and never again.
 * `animated` is frozen into state on the first render: any later re-render of
 * the board (a class toggle, a sibling's move, an online sync) leaves this
 * mark's `fresh` class exactly as it was, so nothing restarts. In the old
 * imperative build the equivalent bug was rebuilding #cells.innerHTML on every
 * move, which made the whole board flicker each turn.
 */
export default function Mark({ id, animated = false, className = 'mark' }) {
  const [fresh] = useState(animated);
  const player = P[id];
  if (!player) return null;
  return (
    <svg className={fresh ? `${className} fresh` : className} viewBox="0 0 100 100"
         aria-hidden="true" focusable="false">
      {SHAPES[player.mark].map((d, i) => (
        <path key={i} d={d} pathLength="1" stroke={player.color}
              style={fresh ? undefined : { strokeDasharray: 'none', strokeDashoffset: 0 }} />
      ))}
    </svg>
  );
}
