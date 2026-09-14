// What this browser is willing to say about the device it runs on.
//
// The limits are the browser's, not ours: Android Chrome will name the model
// (e.g. "SM-S918B") when asked through User-Agent Client Hints; Safari on an
// iPhone only ever says "iPhone"; and no browser exposes the name the owner
// gave the device ("Uzair's iPhone") or its IP address. An IP would need a
// third-party lookup service, which this app deliberately does not call.

const DEVICE_KEY = 'dynasty:device';

/** Pure: turns a user-agent string (plus optional client hints) into labels. */
export function parseUA(ua = '', uaData = null, high = {}, touchPoints = 0) {
  const s = String(ua);
  const hintsPlatform = uaData && uaData.platform ? String(uaData.platform) : '';

  // ---- operating system ----
  let os = '';
  let m;
  if ((m = /(iPhone|iPad|iPod).*? OS (\d+)[_.](\d+)/.exec(s))) os = `iOS ${m[2]}.${m[3]}`;
  else if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
  else if ((m = /Android (\d+(?:\.\d+)?)/.exec(s))) os = `Android ${m[1]}`;
  else if (/Windows NT 10\.0/.test(s)) os = 'Windows 10/11';
  else if ((m = /Windows NT (\d+\.\d+)/.exec(s))) os = `Windows NT ${m[1]}`;
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Mac OS X/.test(s)) os = 'macOS';
  else if (/Linux/.test(s)) os = 'Linux';
  else if (hintsPlatform) os = hintsPlatform;
  // Client hints carry the real Android/Windows version when available.
  if (high.platformVersion && /^(Android|Windows)/.test(os)) {
    const major = String(high.platformVersion).split('.')[0];
    if (/^Android/.test(os)) os = `Android ${major}`;
    else os = Number(major) >= 13 ? 'Windows 11' : 'Windows 10';
  }

  // ---- browser (order matters: most UAs claim to be Chrome and Safari) ----
  let browser = '';
  const pick = (name, re) => {
    const r = re.exec(s);
    if (r && !browser) browser = `${name} ${r[1]}`;
  };
  pick('Edge', /Edg(?:A|iOS)?\/(\d+)/);
  pick('Opera', /OPR\/(\d+)/);
  pick('Samsung Internet', /SamsungBrowser\/(\d+)/);
  pick('Chrome', /CriOS\/(\d+)/);
  pick('Firefox', /FxiOS\/(\d+)/);
  pick('Firefox', /Firefox\/(\d+)/);
  pick('Chrome', /Chrome\/(\d+)/);
  if (!browser && /Safari\//.test(s)) pick('Safari', /Version\/(\d+(?:\.\d+)?)/);
  if (!browser && /Safari\//.test(s)) browser = 'Safari';

  // ---- model ----
  let model = high.model ? String(high.model) : '';
  if (!model) {
    const a = /Android [\d.]+; ([^;)]+?)(?: Build\/|\))/.exec(s);
    // Chrome's reduced UA replaces the model with a literal "K".
    if (a && a[1].trim() !== 'K') model = a[1].trim();
  }
  if (!model && /iPhone/.test(s)) model = 'iPhone';
  if (!model && /iPad/.test(s)) model = 'iPad';

  // ---- form factor ----
  // iPadOS 13+ Safari reports a Mac user agent; a touch screen gives it away.
  const ipadAsMac = /Macintosh/.test(s) && touchPoints > 1;
  if (ipadAsMac && !model) model = 'iPad';
  let type = 'desktop';
  if (/iPad/.test(s) || ipadAsMac || (/Android/.test(s) && !/Mobile/.test(s))) type = 'tablet';
  else if ((uaData && uaData.mobile) || /Mobi|iPhone|iPod|Android/.test(s)) type = 'mobile';
  if (ipadAsMac && os === 'macOS') os = 'iPadOS';

  const label = [model, os, browser].filter(Boolean).join(' · ') || 'Unknown device';
  return { os, browser, model, type, label };
}

/** A random id kept on this device, so the admin can tell devices apart. */
export function deviceId() {
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'private';
  }
}

async function highEntropy(uaData) {
  if (!uaData || typeof uaData.getHighEntropyValues !== 'function') return {};
  try {
    // A slow or hung hint lookup must never hold up signing in.
    return await Promise.race([
      uaData.getHighEntropyValues(['model', 'platformVersion']),
      new Promise((resolve) => setTimeout(() => resolve({}), 800))
    ]);
  } catch {
    return {};
  }
}

/** Everything worth recording about this device, as a flat plain object. */
export async function describeDevice() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const ua = String(nav.userAgent || '');
  const uaData = nav.userAgentData || null;
  const high = await highEntropy(uaData);
  const touch = Number(nav.maxTouchPoints) || 0;
  const parsed = parseUA(ua, uaData, high, touch);

  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* old engines */ }

  const scr = typeof screen !== 'undefined' ? screen : {};
  const win = typeof window !== 'undefined' ? window : {};
  return {
    ...parsed,
    screen: scr.width ? `${scr.width}×${scr.height}` : '',
    dpr: Number(win.devicePixelRatio) || 1,
    viewport: win.innerWidth ? `${win.innerWidth}×${win.innerHeight}` : '',
    lang: String(nav.language || ''),
    tz,
    touch,
    cores: Number(nav.hardwareConcurrency) || 0,
    memory: Number(nav.deviceMemory) || 0,
    net: (nav.connection && nav.connection.effectiveType) || '',
    installed: Boolean(win.matchMedia && win.matchMedia('(display-mode: standalone)').matches),
    ua: ua.slice(0, 400)
  };
}
