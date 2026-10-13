// Alerts on the owner's views: price checks, reviews due, reports around earnings and catalysts.
// Run after `npm run build-data` (it reads public/generated/):
//   node scripts/alerts.ts [--vault <dir>] [--today YYYY-MM-DD] [--json out.json]
// Prints a Markdown report for the private vault's "view-alerts" issue (.github/workflows/alerts.yml in the
// vault opens, updates or closes it; GitHub emails the owner). Exit code 1 means there is something to see.
// The report lists facts about the owner's own records; it never suggests what to do with a view.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { daysBetween, thesisPerformance } from '../src/lib/finance.ts';
import { earningsFlag, fmtEps } from '../src/lib/earnings.ts';
import { thesisSeriesFrom } from '../src/lib/thesisSeries.ts';
import { display, subjectLabel } from '../src/lib/views.ts';
import { fmtDate, fmtPct, fmtPrice, STATUS_LABEL, todayISO } from '../src/lib/format.ts';
import type { ThesisRecord } from '../src/lib/types.ts';
import { loadGenerated } from './lib/generated.ts';
import { arg, readRecords, siteConfig, vaultDir } from './lib/vaultfs.ts';

export type AlertKind = 'price-check' | 'near-level' | 'review-due' | 'earnings-soon' | 'earnings-out' | 'catalyst' | 'token';
export interface Alert {
  kind: AlertKind;
  key: string; // stable identity, so the issue only changes when the set of alerts changes
  view?: string; // thesis id
  title: string;
  detail: string;
}

const KIND_ORDER: AlertKind[] = ['price-check', 'review-due', 'earnings-out', 'near-level', 'earnings-soon', 'catalyst', 'token'];
const KIND_HEADING: Record<AlertKind, string> = {
  'price-check': 'Price checks to confirm',
  'review-due': 'Reviews due',
  'earnings-out': 'Results just published',
  'near-level': 'Close to a target or stop',
  'earnings-soon': 'Reporting in the next three days',
  catalyst: 'Catalysts due',
  token: 'Sign-in token',
};
const NEAR = 0.03; // within 3% of a target or stop
const SITE = 'https://oscarzhang-research.github.io/AI-Industry-Map/';

if (import.meta.url === `file://${process.argv[1]}`) main();

function main() {
  const config = siteConfig();
  const today = arg('today') ?? todayISO(config.site.timezone);
  const vault = vaultDir()!;
  const g = loadGenerated();
  const theses = readRecords(join(vault, 'vault'))
    .map((x) => x.rec)
    .filter((r): r is ThesisRecord => r.type === 'thesis' && r.status === 'active' && !r.example);
  const alerts = [...viewAlerts(theses, g, today), ...tokenAlerts(vault, today)];
  const site = (config.site.url ?? SITE).replace(/\/?$/, '/');
  const md = report(alerts, today, site);
  const out = arg('json');
  if (out) writeFileSync(out, JSON.stringify(alerts, null, 1));
  console.log(md);
  process.exit(alerts.length ? 1 : 0);
}

export function viewAlerts(theses: ThesisRecord[], g: ReturnType<typeof loadGenerated>, today: string): Alert[] {
  const out: Alert[] = [];
  const nodeName = (p: string) => {
    const [l, i] = p.split('/');
    const layer = g.site.layers.find((x) => x.id === l);
    return (i ? layer?.industries.find((x) => x.id === i)?.name : layer?.name) ?? p;
  };
  for (const raw of theses) {
    const t = display(raw);
    const { series, bench, symbol } = thesisSeriesFrom(t, g.site, g.indices, g.series);
    const perf = thesisPerformance(t, series, bench, today);
    const label = `${subjectLabel(t, g.site, nodeName)}${symbol ? ` (${symbol})` : ''}`;
    const ccy = t.basePrice?.currency;
    if (perf.suggested) {
      out.push({
        kind: 'price-check',
        key: `price:${t.id}:${perf.suggested}:${perf.suggestedOn}`,
        view: t.id,
        title: label,
        detail:
          perf.suggested === 'target-hit'
            ? `The close on ${fmtDate(perf.suggestedOn)} reached the target (${fmtPrice(perf.target, ccy)}). Nothing changes until you confirm it on the view page.`
            : perf.suggested === 'stopped'
              ? `The close on ${fmtDate(perf.suggestedOn)} crossed the stop (${fmtPrice(perf.stop, ccy)}). Nothing changes until you confirm it on the view page.`
              : `The horizon ended on ${fmtDate(perf.suggestedOn)}. Close it or extend the horizon on the view page.`,
      });
    } else if (perf.last) {
      const sign = t.direction === 'short' ? -1 : 1;
      for (const [level, name] of [
        [perf.target, 'target'],
        [perf.stop, 'stop'],
      ] as const) {
        if (!level) continue;
        const gap = sign * (level / perf.last - 1) * (name === 'stop' ? -1 : 1); // distance still to go, as a fraction
        if (gap >= 0 && gap <= NEAR) {
          out.push({
            kind: 'near-level',
            key: `near:${t.id}:${name}`,
            view: t.id,
            title: label,
            detail: `Last close ${fmtPrice(perf.last, ccy)} on ${fmtDate(perf.lastDate)} is ${(gap * 100).toFixed(1)}% from the ${name} (${fmtPrice(level, ccy)}).`,
          });
        }
      }
    }
    if (t.reviewOn && t.reviewOn <= today) {
      out.push({ kind: 'review-due', key: `review:${t.id}:${t.reviewOn}`, view: t.id, title: label, detail: `You planned to review this view on ${fmtDate(t.reviewOn)}.` });
    }
    if (t.subject?.kind === 'company' && symbol) {
      const flag = earningsFlag(symbol, g.quotes.quotes[symbol], g.earnings, today, 2, 3);
      if (flag?.kind === 'reported' && flag.report) {
        const r = flag.report;
        const parts = [
          r.epsActual !== undefined ? `EPS ${fmtEps(r.epsActual)}${r.epsEst !== undefined ? ` vs ${fmtEps(r.epsEst)} expected` : ''}${r.surprise !== undefined ? ` (${fmtPct(r.surprise / 100)})` : ''}` : '',
          r.revSurprise !== undefined ? `revenue ${fmtPct(r.revSurprise)} vs expected` : '',
          r.move !== undefined ? `shares ${fmtPct(r.move)} over two sessions` : '',
        ].filter(Boolean);
        out.push({ kind: 'earnings-out', key: `earn-out:${t.id}:${flag.date}`, view: t.id, title: label, detail: `Reported ${fmtDate(flag.date)}${parts.length ? `: ${parts.join(', ')}` : ''}.` });
      } else if (flag?.kind === 'upcoming') {
        const next = g.earnings[symbol]?.next;
        out.push({
          kind: 'earnings-soon',
          key: `earn-soon:${t.id}:${flag.date}`,
          view: t.id,
          title: label,
          detail: `Reports ${flag.days === 0 ? 'today' : flag.days === 1 ? 'tomorrow' : `on ${fmtDate(flag.date)}`}${next?.epsEst !== undefined ? `; consensus EPS ${fmtEps(next.epsEst)}` : ''}.`,
        });
      }
    }
    for (const c of t.catalysts ?? []) {
      if (!c.date || c.status === 'happened' || c.status === 'missed') continue;
      const d = daysBetween(today, c.date);
      if (d <= 2 && d >= -7) {
        out.push({
          kind: 'catalyst',
          key: `catalyst:${t.id}:${c.id}:${c.date}`,
          view: t.id,
          title: label,
          detail: `${c.label}: ${d < 0 ? `was due ${fmtDate(c.date)}; mark it happened or missed` : d === 0 ? 'due today' : `due ${fmtDate(c.date)}`}.`,
        });
      }
    }
  }
  return out;
}

/** The owner can record the token's expiry in vault/settings.yaml (`tokenExpires: 2027-10-10`); remind two weeks ahead. */
export function tokenAlerts(vault: string, today: string): Alert[] {
  const file = join(vault, 'vault', 'settings.yaml');
  if (!existsSync(file)) return [];
  let doc: { tokenExpires?: string | Date } = {};
  try {
    doc = (parseYaml(readFileSync(file, 'utf8')) ?? {}) as typeof doc;
  } catch {
    return [];
  }
  const exp = doc.tokenExpires instanceof Date ? doc.tokenExpires.toISOString().slice(0, 10) : doc.tokenExpires?.slice(0, 10);
  if (!exp) return [];
  const days = daysBetween(today, exp);
  if (days > 14) return [];
  return [
    {
      kind: 'token',
      key: `token:${exp}`,
      title: 'Owner sign-in token',
      detail:
        days < 0
          ? `Expired on ${fmtDate(exp)}. Create a new one (owner guide, step 4) and sign in again; until then the site cannot save.`
          : `Expires on ${fmtDate(exp)}, in ${days} day${days === 1 ? '' : 's'}. Create a new one (owner guide, step 4) and sign in again with it.`,
    },
  ];
}

export function report(alerts: Alert[], today: string, site: string): string {
  const sig = createHash('sha1')
    .update(alerts.map((a) => a.key).sort().join('\n'))
    .digest('hex')
    .slice(0, 12);
  const lines = [`## View alerts · ${fmtDate(today)}`, ''];
  if (!alerts.length) lines.push('Nothing needs your attention.');
  for (const kind of KIND_ORDER) {
    const list = alerts.filter((a) => a.kind === kind);
    if (!list.length) continue;
    lines.push(`### ${KIND_HEADING[kind]}`, '');
    for (const a of list) lines.push(`- **${a.view ? `[${a.title}](${site}#/thesis/${a.view})` : a.title}**: ${a.detail}`);
    lines.push('');
  }
  lines.push(`<sub>From your private records and the site's market data. ${STATUS_LABEL['target-hit']}, stopped and expired are only suggestions until you confirm them.</sub>`, '', `<!-- signature: ${sig} -->`);
  return lines.join('\n');
}
