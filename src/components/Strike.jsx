import { useMemo } from 'react';
import { rng } from '../game/rules.js';
import { P } from '../data/players.js';

/**
 * The line through the winning run, plus chalk dust. Geometry runs from the
 * first and last cell CENTRES — not their edges — which is what keeps the
 * strike through the marks instead of along the grid lines. The soak test
 * asserts the perpendicular offset from every winning cell centre stays under
 * 0.02 board units.
 */
export default function Strike({ line, winner, size }) {
  const svg = useMemo(() => {
    if (!line || !line.length || !winner) return null;
    const n = size;
    const step = 100 / n;
    const a = line[0];
    const b = line[line.length - 1];
    const x1 = ((a % n) + 0.5) * step;
    const y1 = (Math.floor(a / n) + 0.5) * step;
    const x2 = ((b % n) + 0.5) * step;
    const y2 = (Math.floor(b / n) + 0.5) * step;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const pad = step * 0.32;
    const sx = x1 - (dx / len) * pad;
    const sy = y1 - (dy / len) * pad;
    const ex = x2 + (dx / len) * pad;
    const ey = y2 + (dy / len) * pad;

    const rand = rng(a * 7919 + b * 104729 + line.length);
    const dust = Array.from({ length: 14 }, (_, k) => {
      const t = rand();
      return {
        key: k,
        cx: (sx + (ex - sx) * t).toFixed(2),
        cy: (sy + (ey - sy) * t).toFixed(2),
        r: (0.4 + rand() * 0.7).toFixed(2),
        dx: `${((rand() * 2 - 1) * 5).toFixed(2)}px`,
        dy: `${(3 + rand() * 9).toFixed(2)}px`,
        delay: `${(0.3 + t * 0.35).toFixed(2)}s`
      };
    });

    return { d: `M${sx.toFixed(2)},${sy.toFixed(2)} L${ex.toFixed(2)},${ey.toFixed(2)}`, dust };
  }, [line, winner, size]);

  return (
    <svg className="layer" id="strike" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {svg && (
        <>
          <path key={line.join("-")} className="strike" pathLength="1"
                stroke={P[winner].color} d={svg.d} />
          {svg.dust.map((p) => (
            <circle key={p.key} className="dust" cx={p.cx} cy={p.cy} r={p.r} fill={P[winner].color}
                    style={{ '--dx': p.dx, '--dy': p.dy, animationDelay: p.delay }} />
          ))}
        </>
      )}
    </svg>
  );
}
