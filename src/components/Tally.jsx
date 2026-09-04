/** Chalk gate marks: four uprights and a diagonal through each group of five. */
export default function Tally({ n, color }) {
  if (!n) return <span className="none">no wins yet</span>;
  const groups = [];
  for (let left = n; left > 0;) {
    const g = Math.min(5, left);
    left -= g;
    groups.push(g);
  }
  return groups.map((g, k) => {
    const bars = Math.min(g, 4);
    return (
      <svg key={k} viewBox="0 0 32 28" width={g === 5 ? 32 : bars * 6.5 + 6} height="24"
           fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
        {Array.from({ length: bars }, (_, i) => {
          const x = 4 + i * 6.5;
          return <path key={i} d={`M${x + 1.2},3 L${x},25`} />;
        })}
        {g === 5 && <path d="M1,25 L30,3" />}
      </svg>
    );
  });
}
