import { describe, it, expect } from 'vitest';
import { BUILD_ID, isNewBuildAvailable } from '../src/net/version.js';

const reply = (body, ok = true) => async () => ({ ok, json: async () => body });

describe('isNewBuildAvailable', () => {
  it('knows which build it is', () => {
    expect(typeof BUILD_ID).toBe('string');
    expect(BUILD_ID.length).toBeGreaterThan(0);
  });

  it('says no while the deployed build is this one', async () => {
    expect(await isNewBuildAvailable(reply({ build: BUILD_ID }))).toBe(false);
  });

  it('says yes once a different build has been deployed', async () => {
    expect(await isNewBuildAvailable(reply({ build: 'something-newer' }))).toBe(true);
  });

  it('never reloads on a failed, missing or malformed answer', async () => {
    expect(await isNewBuildAvailable(reply({}, false))).toBe(false);
    expect(await isNewBuildAvailable(reply({}))).toBe(false);
    expect(await isNewBuildAvailable(reply({ build: '' }))).toBe(false);
    expect(await isNewBuildAvailable(async () => { throw new Error('offline'); })).toBe(false);
    expect(await isNewBuildAvailable(null)).toBe(false);
  });

  it('asks past the CDN cache', async () => {
    let asked = '';
    let opts = null;
    await isNewBuildAvailable(async (url, o) => { asked = url; opts = o; return { ok: true, json: async () => ({}) }; });
    expect(asked).toMatch(/^\.\/version\.json\?t=\d+$/);
    expect(opts.cache).toBe('no-store');
  });
});
