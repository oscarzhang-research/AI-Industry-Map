// When the owner's GitHub token expires: from GitHub's response header when the browser may read it,
// otherwise the date the owner entered in Settings (also saved to vault/settings.yaml, so the vault's
// alerts workflow can email a reminder two weeks ahead).
import { tokenExpiryHeader } from './github.ts';

const KEY = 'aim.tokenExpires';
export const SETTINGS_PATH = 'vault/settings.yaml';
export const WARN_DAYS = 14;

export function savedExpiry(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberExpiry(day: string | undefined): void {
  try {
    if (day) localStorage.setItem(KEY, day);
    else localStorage.removeItem(KEY);
  } catch {
    // private window: the banner simply does not show
  }
}

export function knownExpiry(): string | undefined {
  return tokenExpiryHeader() ?? savedExpiry();
}

/** Days until the token expires (negative once it has), or undefined when unknown. */
export function daysToExpiry(today = new Date().toISOString().slice(0, 10)): number | undefined {
  const d = knownExpiry();
  if (!d) return undefined;
  return Math.round((Date.parse(d) - Date.parse(today)) / 86400000);
}

/** vault/settings.yaml with tokenExpires set, keeping any other keys and comments. */
export function withTokenExpiry(yamlText: string | undefined, day: string): string {
  const text = yamlText ?? '# Owner settings read by the vault workflows.\n';
  if (/^tokenExpires:.*$/m.test(text)) return text.replace(/^tokenExpires:.*$/m, `tokenExpires: ${day}`);
  return `${text.replace(/\n*$/, '\n')}tokenExpires: ${day}   # the site's sign-in token; the alerts workflow reminds two weeks ahead\n`;
}
