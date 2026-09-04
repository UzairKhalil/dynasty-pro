import { useMemo } from 'react';
import { gridPaths } from '../game/rules.js';

// INVARIANT 3 — the wobble comes from gridPaths()'s seeded PRNG and is cached
// per board size, so re-rendering never re-rolls it and the grid stays still.
export default function Grid({ size }) {
  const paths = useMemo(() => gridPaths(size), [size]);
  return (
    <svg className="layer" id="grid" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <g filter="url(#chalk)">
        {paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="rgba(239,237,227,.3)"
                strokeWidth="1.1" strokeLinecap="round" />
        ))}
      </g>
    </svg>
  );
}
