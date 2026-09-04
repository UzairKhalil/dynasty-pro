// The roster. Adding a fifth player here is the only edit needed — pairings,
// head-to-head buckets and the seat list are all derived from this array.
//
// `code` is a profile switcher, NOT authentication, and `role` is a UI
// permission, NOT a security boundary. A static site ships its source to every
// visitor, so all four codes and the admin flag are readable in devtools by
// anyone who looks, and a determined visitor can set either. That is fine for
// four people sharing a board: it stops accidents, not attackers. Don't put
// anything behind these that you would mind a stranger seeing or changing.
export const PLAYERS = [
  { id: 'uzair',  name: 'Uzair',  mark: 'x', color: 'var(--uzair)',  raw: '#F5B944', code: '24680', role: 'admin' },
  { id: 'maryam', name: 'Maryam', mark: 'd', color: 'var(--maryam)', raw: '#BBA3F5', code: '13579', role: 'player' },
  { id: 'zahra',  name: 'Zahra',  mark: 'o', color: 'var(--zahra)',  raw: '#6FD3E8', code: '11223', role: 'player' },
  { id: 'zain',   name: 'Zain',   mark: 't', color: 'var(--zain)',   raw: '#FF8065', code: '90210', role: 'player' }
];

export const P = Object.fromEntries(PLAYERS.map((p) => [p.id, p]));
export const IDS = PLAYERS.map((p) => p.id);

// All six pairings, generated rather than hardcoded.
export const PAIRS = IDS.flatMap((a, i) => IDS.slice(i + 1).map((b) => [a, b]));

export const pairKey = (a, b) => {
  const found = PAIRS.find((pr) => pr.includes(a) && pr.includes(b));
  return found ? found.join('|') : null;
};

/** True for seats allowed to wipe the ledger, delete a game, or end a match. */
export const isAdmin = (id) => P[id]?.role === 'admin';

export const admins = () => PLAYERS.filter((p) => p.role === 'admin').map((p) => p.id);

export function playerByCode(code) {
  const trimmed = String(code || '').trim();
  return PLAYERS.find((p) => p.code === trimmed) || null;
}

export function listNames(ids) {
  const n = ids.map((id) => P[id].name);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0] || '';
}
