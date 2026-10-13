// Signs of personal details that must not reach the public site. Used by ingest-report.ts and inbox.ts.
export function privacyHits(text: string): string[] {
  const checks: [RegExp, string][] = [
    [/[\w.+-]+@[\w-]+\.[a-z]{2,}/i, 'an email address'],
    [/\(\d{3}\)\s?\d{3}-\d{4}|\+\d{1,3}[\s-]\d{1,4}[\s-]\d{3,4}[\s-]\d{3,4}/, 'a phone number'],
    // SEC "Form F-1" filings are common in research, so only bare visa terms count.
    [/(?<!Form\s)\b(F-1|OPT|CPT|H-1B)\b(?!\s+(registration|filing|statement))|\bSSN\b/, 'visa or ID terms'],
    [/green card|passport|visa status/i, 'visa or ID terms'],
    [/签证|绿卡|护照|女朋友|男朋友|写给/, 'personal terms in Chinese'],
  ];
  return [...new Set(checks.filter(([re]) => re.test(text)).map(([, label]) => label))];
}

/** Visible text of an HTML document (scripts and styles removed). */
export function htmlText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ');
}
