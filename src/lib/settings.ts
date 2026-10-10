// Per-viewer preferences kept in this browser only (theme, up/down colors, report language).
export interface Prefs {
  theme: 'system' | 'light' | 'dark';
  updown: 'green' | 'red';
  reportLang: 'en' | 'zh';
  heatPeriod: 'd1' | 'w1' | 'm1' | 'ytd' | 'y1' | 'ai';
  mapColor: 'none' | 'd1' | 'ytd' | 'view';
}

const KEY = 'aim.prefs.v1';

export function defaultPrefs(updown: 'green' | 'red' = 'green'): Prefs {
  return { theme: 'system', updown, reportLang: 'en', heatPeriod: 'd1', mapColor: 'none' };
}

export function loadPrefs(updownDefault: 'green' | 'red'): Prefs {
  const base = defaultPrefs(updownDefault);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    return { ...base, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return base;
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: preferences last for this visit only */
  }
}

export function applyPrefs(p: Prefs): void {
  const root = document.documentElement;
  if (p.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', p.theme);
  if (p.updown === 'red') root.setAttribute('data-updown', 'red');
  else root.removeAttribute('data-updown');
}

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
