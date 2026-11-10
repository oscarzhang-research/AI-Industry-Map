// The privacy scanner lives in src/lib/privacy.ts so the upload dialog and these scripts share one copy.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { privateTermsFrom } from '../../src/lib/privacy.ts';

export { htmlText, looksLikeBrokerResearch, privacyHits, reportConcerns, scannableText } from '../../src/lib/privacy.ts';

/** The owner's private terms (names, a school, an employer) from the vault clone's settings; [] without a clone. */
export function privateTerms(vault: string | undefined): string[] {
  const file = vault ? join(vault, 'vault', 'settings.yaml') : '';
  return file && existsSync(file) ? privateTermsFrom(readFileSync(file, 'utf8')) : [];
}
