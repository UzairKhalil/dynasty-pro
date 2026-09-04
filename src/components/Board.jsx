import { useLayoutEffect, useRef } from 'react';
import Mark from './Mark.jsx';
import Grid from './Grid.jsx';
import Strike from './Strike.jsx';
import { P } from '../data/players.js';

export default function Board({ game, lastMove, onPlay, locked = false }) {
  const { size, cells, over, line, winner } = game;
  const wrapRef = useRef(null);
  const cellRefs = useRef([]);

  /**
   * INVARIANT 5 — the flare must replay on consecutive wins, not fire only the
   * first time. The `won` class is applied here rather than declaratively so
   * the remove -> forced reflow -> add sequence survives; without the
   * getBoundingClientRect() the browser coalesces the two class changes and
   * the animation never restarts.
   */
  useLayoutEffect(() => {
    const nodes = cellRefs.current.filter(Boolean);
    nodes.forEach((n) => n.classList.remove('won'));
    if (!line || !winner) return;
    void wrapRef.current?.getBoundingClientRect();
    line.forEach((i) => cellRefs.current[i]?.classList.add('won'));
  }, [line, winner]);

  function onKeyDown(e) {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: size, ArrowUp: -size };
    if (!(e.key in step)) return;
    const i = Number(e.currentTarget.dataset.i);
    const r = Math.floor(i / size);
    const c = i % size;
    if ((e.key === 'ArrowRight' && c === size - 1) || (e.key === 'ArrowLeft' && c === 0) ||
        (e.key === 'ArrowDown' && r === size - 1) || (e.key === 'ArrowUp' && r === 0)) return;
    e.preventDefault();
    cellRefs.current[i + step[e.key]]?.focus();
  }

  const won = new Set(line || []);

  return (
    <div className="board-shell" ref={wrapRef}>
      <Grid size={size} />
      <Strike line={line} winner={winner} size={size} />
      {/* INVARIANT 1 — BOTH axes are declared. grid-template-columns alone
          leaves the rows as implicit `auto` tracks; an auto row has no definite
          height, the mark falls back to the SVG's intrinsic size, and the rows
          grow to fit it. The marks then drift off the chalk lines and the
          strike lands on the lines instead of through the marks. */}
      <div className="cells" id="cells" role="group" aria-label="Game board"
           style={{
             gridTemplateColumns: `repeat(${size},1fr)`,
             gridTemplateRows: `repeat(${size},1fr)`
           }}>
        {cells.map((id, i) => {
          const open = !over && !locked && id == null;
          return (
            <button
              key={i}
              ref={(n) => { cellRefs.current[i] = n; }}
              type="button"
              data-i={i}
              disabled={!open}
              onClick={() => open && onPlay(i)}
              onKeyDown={onKeyDown}
              style={won.has(i) && winner ? { color: P[winner].raw } : undefined}
              className={
                'cell' + (open ? ' open' : '') +
                (line && id && !won.has(i) ? ' faded' : '')
              }
              aria-label={`Row ${Math.floor(i / size) + 1}, column ${(i % size) + 1}, ${id ? P[id].name : 'empty'}`}
            >
              {id && <Mark id={id} animated={i === lastMove} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
