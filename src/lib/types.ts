// Shared data model for the build scripts (Node) and the web app (browser).
// Keep this file free of runtime imports so both sides can use it.

export type LayerId = 'energy' | 'chips' | 'infrastructure' | 'models' | 'applications';
export const LAYER_IDS: LayerId[] = ['energy', 'chips', 'infrastructure', 'models', 'applications'];
export type Position = 'upstream' | 'midstream' | 'downstream';
export type Tier = 'core' | 'focus' | 'watch';
export type Listing = 'listed' | 'private' | 'acquired';
export type Visibility = 'public' | 'private';

export interface SiteConfig {
  site: {
    name: string;
    tagline: string;
    owner: string;
    ownerUrl?: string;
    timezone: string;
    baseCurrency: string;
    upColor: 'green' | 'red';
    experimental?: boolean;
    showExamples?: boolean; // false leaves records marked example out of the build
    url?: string; // public address, for link previews
    disclaimer: string;
  };
  repos: {
    public: RepoRef;
    vault: RepoRef;
  };
  defaults: {
    thesisHorizonMonths: number;
    newRecordVisibility: Visibility;
    claudeReportVisibility: Visibility;
    publicHiddenFields: string[];
    reviewEveryDays: number;
    reportsShownCollapsed: number;
  };
}

export interface RepoRef {
  owner: string;
  repo: string;
  branch: string;
}

export interface Ticker {
  symbol: string;
  exchange?: string;
  currency?: string;
}

export interface PrivateInfo {
  valuation?: { usd?: number; date?: string; round?: string };
  proxies?: string[];
  note?: string;
}

export interface Company {
  id: string;
  name: string;
  nameZh?: string;
  aliases?: string[];
  listing: Listing;
  tickers: Ticker[];
  country?: string;
  tier: Tier;
  primary: string;
  ecosystems?: string[];
  website?: string;
  description?: string;
  private?: PrivateInfo;
  acquiredBy?: string;
  // Derived at build time
  placements: string[];
  layers: LayerId[];
  primaryLayer: LayerId;
  symbol?: string;
  market?: Market;
}

export type Market = 'US' | 'TW' | 'KR' | 'JP' | 'HK' | 'CN' | 'EU' | 'UK' | 'CH' | 'AU' | 'CA' | 'NORDIC' | 'OTHER';

export interface Segment {
  id: string;
  path: string; // layer/industry/segment
  name: string;
  nameZh?: string;
  position: Position;
  companies: string[];
  ref?: string; // points to another node instead of listing companies
  description?: string;
}

export interface Industry {
  id: string;
  path: string; // layer/industry
  layer: LayerId;
  name: string;
  nameZh?: string;
  description?: string;
  drivers?: string[];
  metrics?: string[];
  segments: Segment[];
}

export interface Layer {
  id: LayerId;
  order: number;
  name: string;
  nameZh?: string;
  color: string;
  tagline: string;
  description: string;
  watch: string[];
  featured: string[];
  industries: Industry[];
}

export interface Theme {
  id: string;
  name: string;
  nameZh?: string;
  description?: string;
  companies: string[];
}

export interface Ecosystem {
  id: string;
  name: string;
  nameZh?: string;
  description?: string;
}

export interface Benchmark {
  id: string;
  symbol: string;
  name: string;
  currency?: string;
}

export interface EventItem {
  id: string;
  name: string;
  start: string;
  end?: string;
  kind: 'conference' | 'earnings' | 'policy' | 'product' | 'macro' | string;
  location?: string;
  nodes?: string[];
  companies?: string[];
  url?: string;
  tentative?: boolean;
  note?: string;
}

export interface NewsItem {
  id: string;
  date: string;
  title: string;
  summary?: string;
  source?: { name?: string; url?: string };
  companies: string[];
  nodes: string[];
  themes?: string[];
  impact?: 'positive' | 'negative' | 'mixed' | 'neutral';
  importance?: 1 | 2 | 3;
}

export interface ReportMeta {
  id: string;
  kind: 'claude' | 'sell-side' | 'other';
  visibility: Visibility;
  format: 'html' | 'pdf';
  file: string;
  title: string;
  titleZh?: string;
  subtitle?: string;
  date: string;
  asOf?: string;
  reportType?: string;
  languages?: string[];
  companies: string[];
  nodes: string[];
  tags: string[];
  summary?: { en?: string[]; zh?: string[] };
  stance?: string;
  priceRef?: { symbol?: string; price?: number; currency?: string; date?: string };
  sections?: number;
  interactive?: boolean;
  pinned?: boolean;
  // Sell-side fields
  broker?: string;
  analysts?: string[];
  rating?: string;
  targetPrice?: { value: number; currency: string };
  priceAtReport?: { value: number; currency: string; date?: string };
  // Owner fields
  myRating?: number;
  read?: boolean;
  // Derived
  size?: number;
  url?: string; // where the browser loads it from (public) or vault path (private)
  origin?: 'public' | 'vault' | 'demo';
}

export interface SiteData {
  generatedAt: string;
  config: SiteConfig;
  layers: Layer[];
  companies: Record<string, Company>;
  themes: Theme[];
  ecosystems: Ecosystem[];
  benchmarks: Benchmark[];
  benchmarkDefaults: Record<string, string>;
  events: EventItem[];
}

export interface Returns {
  d1?: number;
  w1?: number;
  m1?: number;
  m3?: number;
  ytd?: number;
  y1?: number;
  ai?: number; // since 2022-12-30, the start of the AI trade
}

export interface Quote {
  s: string;
  d: string; // last trading date
  c: number; // last close
  ccy?: string;
  r: Returns;
  hi52?: number;
  lo52?: number;
  mcap?: number;
  mcapUsd?: number;
  pe?: number;
  fpe?: number;
  ps?: number;
  tgt?: number; // consensus target (mean)
  tgtN?: number;
  rec?: string;
  earn?: string;
  earnEst?: boolean;
}

export interface QuotesFile {
  updatedAt: string | null;
  asOf: string | null;
  quotes: Record<string, Quote>;
  fx: Record<string, number>;
}

export interface PriceSeries {
  s: string;
  d: string[];
  c: number[];
  h: number[];
  l: number[];
  splits?: [string, number][];
  val?: ValuationSeries; // daily valuation snapshots, when recorded
  fin?: Financials; // reported revenue (and capex), when available
}

/** Daily valuation snapshots (data/valuation/<symbol>.csv), oldest first; null where Yahoo had no value. */
export interface ValuationSeries {
  d: string[];
  pe: (number | null)[]; // trailing P/E
  fpe: (number | null)[]; // forward P/E
  ev: (number | null)[]; // EV/EBITDA
  ps: (number | null)[]; // price/sales
  tgt: (number | null)[]; // consensus target price (mean), trading currency
  hi: (number | null)[];
  lo: (number | null)[];
  n: (number | null)[]; // analysts behind the target
  rec: (string | null)[];
}

/** The next scheduled report and the consensus for it (data/earnings.json). EPS and revenue are in the reporting currency. */
export interface EarningsNext {
  date: string;
  time?: 'bmo' | 'amc'; // before the US open / after the close
  estimated?: boolean; // date projected, not confirmed by the company
  epsEst?: number;
  epsN?: number;
  revEst?: number;
  revN?: number;
  asOf?: string; // when the consensus was read
}

export interface EarningsReport {
  date: string;
  time?: 'bmo' | 'amc';
  period?: string; // end of the quarter reported
  epsEst?: number;
  epsActual?: number;
  surprise?: number; // EPS surprise, percent
  revEst?: number; // revenue consensus read before the report
  revActual?: number;
  revSurprise?: number; // fraction, added at build time
  move?: number; // share price move from the last close before the report to one session after it
}

export interface EarningsRecord {
  updatedAt: string;
  checkedAt?: string; // last fetch (UTC), used to space out refreshes
  ccy?: string; // reporting currency
  next?: EarningsNext;
  history: EarningsReport[];
}

export type EarningsFile = Record<string, EarningsRecord>;

export interface IndexSeries {
  id: string; // layer id, industry path or theme id
  kind: 'layer' | 'layer-equal' | 'industry' | 'theme'; // 'layer' is the market-cap-weighted layer index
  weighting: 'cap' | 'equal';
  name: string;
  members: number;
  d: string[];
  v: number[];
  top?: { s: string; w: number }[]; // largest current weights (cap-weighted only)
}

export interface IndicesFile {
  base: string;
  series: IndexSeries[];
}

// ---------------------------------------------------------------------------
// Industry indicators (content/kpis.yaml + data/kpis/), compiled to generated/kpis.json.
// ---------------------------------------------------------------------------

export interface KpiSource {
  name: string;
  url?: string;
}

interface KpiBase {
  id: string;
  name: string;
  layer: LayerId;
  nodes?: string[];
  description: string;
  note?: string;
  unit?: string; // currency code for money, or a label such as "% QoQ"
  sources: KpiSource[];
  asOf?: string; // latest period end or month covered
}

/** One measure summed across companies, by calendar quarter ('2026Q3'). */
export interface KpiStack extends KpiBase {
  kind: 'stack';
  metric: 'revenue' | 'capex';
  periods: string[];
  parts: { company: string; label: string; values: (number | null)[] }[];
  total: (number | null)[];
  complete: boolean[]; // every company has reported the quarter
}

/** One Taiwan listing's monthly revenue ('2026-09'), local currency. */
export interface KpiMonthly extends KpiBase {
  kind: 'monthly';
  company: string;
  months: string[];
  values: number[];
  yoy: (number | null)[];
}

/** Year-on-year growth by company, newest period last. */
export interface KpiGrowthTable extends KpiBase {
  kind: 'growth-table';
  frequency: 'month' | 'quarter';
  periods: string[];
  rows: { company: string; label: string; values: (number | null)[] }[];
}

export interface KpiRangePoint {
  period: string; // '1Q26'
  low: number;
  high: number;
  basis: 'forecast' | 'actual';
  published?: string;
  url?: string;
  note?: string;
}

export interface KpiRanges extends KpiBase {
  kind: 'ranges';
  series: { id: string; label: string; points: KpiRangePoint[] }[];
}

export interface KpiValuations extends KpiBase {
  kind: 'valuations';
  items: { company: string; label: string; usd: number; date?: string; round?: string }[];
}

export type Kpi = KpiStack | KpiMonthly | KpiGrowthTable | KpiRanges | KpiValuations;

export interface KpisFile {
  updatedAt: string | null;
  indicators: Kpi[];
}

/** Reported figures for one listing (added to its price series file). */
export interface Financials {
  ccy?: string;
  quarters?: { period: string; end: string; revenue?: number; capex?: number }[]; // from SEC filings, oldest first
  months?: { month: string; revenue: number; yoy?: number }[]; // Taiwan monthly revenue, oldest first
}

// ---------------------------------------------------------------------------
// Records written by the owner: theses, notes, journal entries, outlook.
// Stored as Markdown with YAML front matter (vault = full; public repo = sanitized copy).
// ---------------------------------------------------------------------------

export type RecordType = 'thesis' | 'note' | 'journal' | 'outlook';
export type Direction = 'long' | 'short' | 'neutral' | 'watch';
export type ThesisStatus = 'active' | 'target-hit' | 'stopped' | 'invalidated' | 'expired' | 'closed' | 'withdrawn';
export type SignalStatus = 'pending' | 'confirmed' | 'partial' | 'falsified';
export type RiskStatus = 'watching' | 'triggered' | 'cleared';

export interface Subject {
  kind: 'company' | 'node' | 'theme';
  company?: string;
  symbol?: string; // which listing the thesis tracks (defaults to the company's first ticker)
  node?: string;
  theme?: string;
  proxy?: string; // optional ETF/basket symbol for node/theme views
}

export interface Translation {
  lang: 'en';
  fields: Record<string, string>; // key -> translated text, e.g. 'summary', 'logic', 'signals.s1.text', 'updates.3.text'
  sourceHash: string;
  translatedAt: string;
  by?: string;
}

export interface BaseRecord {
  id: string;
  type: RecordType;
  title?: string;
  visibility: Visibility;
  example?: boolean;
  lang?: 'en' | 'zh';
  createdAt: string; // ISO
  updatedAt?: string;
  tags?: string[];
  translation?: Translation;
  body?: string; // free-form Markdown after the front matter
  origin?: 'public' | 'vault' | 'demo';
  path?: string; // file path inside its repo
}

export interface PricePoint {
  price: number;
  currency?: string;
  date?: string;
  note?: string;
}

export interface Scenario {
  name: 'bull' | 'base' | 'bear' | string;
  price: number;
  prob?: number; // 0..1
  note?: string;
}

export interface Catalyst {
  id: string;
  date?: string;
  label: string;
  status?: 'upcoming' | 'happened' | 'missed';
  note?: string;
}

export interface Signal {
  id: string;
  text: string;
  due?: string;
  status: SignalStatus;
  note?: string;
  updatedAt?: string;
}

export interface Risk {
  id: string;
  text: string;
  trigger?: string;
  status: RiskStatus;
  note?: string;
}

export interface TrackingUpdate {
  date: string;
  text: string;
}

export interface Related {
  company: string;
  relation: 'beneficiary' | 'loser' | 'hedge' | 'peer' | 'supplier' | 'customer' | string;
  note?: string;
}

export interface ThesisVersion {
  at: string;
  direction?: Direction;
  conviction?: number;
  target?: number;
  stop?: number;
  horizonMonths?: number;
  reason: string;
}

export interface ThesisRecord extends BaseRecord {
  type: 'thesis';
  subject: Subject;
  direction: Direction;
  conviction?: number; // 1..5
  horizonMonths?: number;
  targetDate?: string;
  basePrice?: PricePoint;
  refClose?: PricePoint; // market close at creation (objective benchmark for the track record)
  target?: PricePoint & { marketCap?: number; method?: string };
  stop?: PricePoint;
  scenarios?: Scenario[];
  summary: string;
  logic?: string;
  variant?: string;
  bearCase?: string;
  valuation?: string;
  consensus?: string;
  plan?: string;
  position?: string;
  catalysts?: Catalyst[];
  signals?: Signal[];
  risks?: Risk[];
  updates?: TrackingUpdate[];
  related?: Related[];
  reports?: string[];
  benchmark?: string;
  reviewOn?: string;
  status: ThesisStatus;
  closed?: { date: string; price?: number; outcome?: 'right' | 'wrong' | 'mixed'; reason?: string };
  review?: string;
  versions?: ThesisVersion[];
  backfilled?: boolean;
  publicShow?: Partial<Record<'target' | 'stop' | 'scenarios' | 'plan' | 'position', boolean>>;
}

export interface NoteRecord extends BaseRecord {
  type: 'note';
  subjects: Subject[];
  source?: { kind?: 'news' | 'report' | 'call' | 'meeting' | 'other'; url?: string; reportId?: string; newsId?: string; label?: string };
}

export interface JournalRecord extends BaseRecord {
  type: 'journal';
  period: { kind: 'week' | 'fortnight' | 'month' | 'quarter'; start: string; end: string };
  links?: string[]; // record ids
}

export interface OutlookRecord extends BaseRecord {
  type: 'outlook';
  bottleneck?: { node: string; label: string; note?: string };
  layerStances?: Partial<Record<LayerId, { direction: Direction; conviction?: number; note?: string }>>;
  cycleView?: string;
  history?: { date: string; node: string; label: string; note?: string }[];
}

export type AnyRecord = ThesisRecord | NoteRecord | JournalRecord | OutlookRecord;

export interface RecordsFile {
  records: AnyRecord[];
}
