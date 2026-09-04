import { connect } from './firebase.js';
import { normaliseGame } from '../game/ledger.js';

export const KEY = 'dynasty:games:v4';
export const CAP = 500;

/**
 * Three backends, decided at runtime:
 *   cloud  — Firebase, shared by all four players across every device
 *   local  — localStorage, this device only (the pre-2.0 behaviour)
 *   none   — private browsing with storage blocked; say so rather than
 *            silently dropping games
 *
 * The cloud path still mirrors to localStorage so a dropped connection shows
 * the last known table instead of an empty one.
 *
 * Every game carries a stable `id`, which is what lets an admin strike one
 * game from the record without touching the rest.
 */

function localAvailable() {
  try {
    window.localStorage.setItem(`${KEY}:probe`, '1');
    window.localStorage.removeItem(`${KEY}:probe`);
    return true;
  } catch {
    return false;
  }
}

let localSeq = 0;
const localId = (g) => g.id || `l${g.at}-${(localSeq += 1)}`;
const withId = (g) => ({ ...normaliseGame(g), id: localId(g) });

function readLocal() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(withId) : [];
  } catch {
    return [];
  }
}

function writeLocal(games) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(games.slice(-CAP)));
    return true;
  } catch {
    return false;
  }
}

export async function open() {
  const fb = await connect();
  const local = localAvailable();

  if (fb) {
    const { db, api } = fb;
    const node = api.ref(db, 'games');
    return {
      source: 'cloud',
      append: async (entry) => {
        const game = normaliseGame(entry);
        await api.set(api.push(node), game);
      },
      remove: async (id) => { await api.remove(api.ref(db, `games/${id}`)); },
      watch: (cb) => api.onValue(node, (snap) => {
        const raw = snap.val() || {};
        const games = Object.entries(raw).map(([id, g]) => ({ ...normaliseGame(g), id }));
        if (local) writeLocal(games);
        cb(games);
      }),
      seed: local ? readLocal() : [],
      clear: async () => {
        await api.remove(node);
        if (local) writeLocal([]);
      }
    };
  }

  const emitTo = { listener: null };
  let games = local ? readLocal() : [];
  const emit = () => emitTo.listener && emitTo.listener(games.slice());
  const persist = () => { if (local) writeLocal(games); };

  return {
    source: local ? 'local' : 'none',
    append: async (entry) => {
      games = games.concat(withId(entry)).slice(-CAP);
      persist();
      emit();
    },
    remove: async (id) => {
      games = games.filter((g) => g.id !== id);
      persist();
      emit();
    },
    watch: (cb) => {
      emitTo.listener = cb;
      cb(games.slice());
      return () => { emitTo.listener = null; };
    },
    seed: games.slice(),
    clear: async () => { games = []; persist(); emit(); }
  };
}
