// Signs that a report must not be published: personal details, or a broker's research.
// One scanner for the browser (upload dialog) and the maintenance scripts (ingest, inbox, validate).
// It errs on the side of "keep it private": a flagged report can still be published after a person has
// looked at it (npm run ingest -- <file> --force-public).

/** Visible text of an HTML document (scripts, styles, comments and tags removed). */
export function htmlText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->|<[^>]+>/gi, ' ');
}

/**
 * Everything in an HTML report a reader could end up seeing, as one string: the visible text, attribute
 * values (mailto: links, data-zh="…" translations), string literals in scripts (bilingual reports keep
 * one language there) and comments.
 */
export function scannableText(html: string): string {
  const parts = [htmlText(html)];
  for (const m of html.matchAll(/\s[\w:-]+\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) parts.push(m[1] ?? m[2] ?? '');
  for (const s of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const m of s[1].matchAll(/"((?:\\.|[^"\\\n])*)"|'((?:\\.|[^'\\\n])*)'|`((?:\\.|[^`\\])*)`/g)) parts.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  for (const m of html.matchAll(/<!--([\s\S]*?)-->/g)) parts.push(m[1]);
  return parts.join('\n');
}

const NOT_AN_ADDRESS = /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|json|map|woff2?|ttf|otf)$/i;

/**
 * Kinds of personal detail found in a text. `privateTerms` are words the owner never wants published
 * (names, a school, an employer); they live in the private vault's settings, never in this repository.
 */
export function privacyHits(text: string, privateTerms: string[] = []): string[] {
  const hits = new Set<string>();
  // "name@2x.png" and "chart.js@4.4.1" are not addresses.
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) {
    if (!NOT_AN_ADDRESS.test(m[0])) hits.add('an email address');
  }
  const checks: [RegExp, string][] = [
    [/\(\d{3}\)\s?\d{3}[-.\s]\d{4}|\+\d{1,3}[\s-]\d{1,4}[\s-]\d{3,4}[\s-]\d{3,4}|(?<![\d.-])\d{3}[-.]\d{3}[-.]\d{4}(?![\d.-])/, 'a phone number'],
    [/(手机|电话|電話|微信|tel|phone|mobile|cell|wechat|whatsapp)\s*(号码?|號碼?|number|no\.?)?\s*[:：]?\s*\+?\d[\d\s-]{6,}\d/i, 'a phone number'],
    // SEC "Form F-1" filings are common in research, so only bare visa terms count.
    [/(?<!Form\s)\b(F-1|OPT|CPT|H-1B|H1B)\b(?!\s+(registration|filing|statement))|\b(SSN|ITIN|USCIS|I-20|I-94)\b/, 'visa or ID terms'],
    [/green card|passport|visa (status|sponsorship)|(student|work) visa|immigration status|work authori[sz]ation|social security number|date of birth|home address/i, 'visa or ID terms'],
    [/签证|簽證|绿卡|綠卡|护照|護照|身份证|身分證|居留|工签|学签|移民局|移民身份|社保号|出生日期|家庭住址/, 'visa or ID terms in Chinese'],
    [/女朋友|男朋友|老婆|老公|写给|寫給/, 'personal terms in Chinese'],
  ];
  for (const [re, label] of checks) if (re.test(text)) hits.add(label);
  const lower = text.toLowerCase();
  for (const raw of privateTerms) {
    const term = String(raw ?? '').trim().toLowerCase();
    if (term.length < 2) continue;
    // Latin terms match whole words ("Lee" must not match "sleek"); Chinese has no word breaks.
    const found = /^[\x20-\x7e]+$/.test(term) ? new RegExp(`(?<![a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`).test(lower) : lower.includes(term);
    if (found) hits.add('a term from your private list');
  }
  return [...hits];
}

/**
 * A word that points at someone's private life, if a news text has one. News items say what a company or a
 * regulator did; relationships, family and health stay out even when the source reports them.
 */
export function privateLifeWord(text: string): string | undefined {
  return /\b(an affair|extramarital|mistress|girlfriend|boyfriend|romantic(?:ally)?|divorc\w+|pregnan\w+)\b/i.exec(text)?.[0];
}

// Boilerplate that broker research carries and research written for this site does not.
const BROKER_SIGNS: RegExp[] = [
  /analyst certification/i,
  /important disclosures?/i,
  /disclosure appendix/i,
  /\breg(ulation)? ac\b/i,
  /for institutional (investors|clients) only/i,
  /not registered\/qualified as research analysts?|registered with finra/i,
  /seeks? to do business with (the )?compan(y|ies) covered/i,
  /distribution of (ratings|recommendations)/i,
  /investment banking (services|relationships?|revenues?|compensation)/i,
  /price objective/i,
  /本报告(仅供|由).{0,20}(客户|证券|研究所)/,
  /证券研究报告/,
  /分析师(声明|承诺)/,
  /投资评级说明/,
];

/** True when a text carries at least two pieces of sell-side boilerplate: third-party research stays private. */
export function looksLikeBrokerResearch(text: string): boolean {
  return BROKER_SIGNS.filter((re) => re.test(text)).length >= 2;
}

/** Reasons not to publish an HTML report (and its metadata, if given). An empty list means none was found. */
export function reportConcerns(html: string, opts: { meta?: string; privateTerms?: string[] } = {}): string[] {
  const text = `${scannableText(html)}\n${opts.meta ?? ''}`;
  const out = privacyHits(text, opts.privateTerms);
  if (looksLikeBrokerResearch(text)) out.push("a broker's disclosures (third-party research)");
  return out;
}

/** The owner's private terms from the text of the vault's settings file (`privateTerms: [a, b]` or a YAML list). */
export function privateTermsFrom(settingsYaml: string | undefined): string[] {
  if (!settingsYaml) return [];
  const inline = /^privateTerms:\s*\[(.*)\]\s*(#.*)?$/m.exec(settingsYaml);
  if (inline) return inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const block = /^privateTerms:\s*(#.*)?\n((?:[ \t]+-[ \t]*.*\n?)+)/m.exec(settingsYaml);
  if (!block) return [];
  return block[2].split('\n').map((l) => l.replace(/^[ \t]+-[ \t]*/, '').replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}
