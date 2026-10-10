# Working on AI Industry Map

A static, English-first site that maps the AI economy by Jensen Huang's five layers (energy, chips, infrastructure, models, applications), prices ~300 listed companies daily, and tracks the owner's views against those prices. The owner (Oscar Zhang) does not write code: they use the site's editors and ask Claude for everything else. They write mostly in Chinese; everything shown publicly must read in English.

## Hard rules

1. **Never put private material in this public repository.** That means sell-side / broker PDFs and their text, anything with `visibility: private`, and reports containing personal details (names of people around the owner, visa or immigration status, school or employer details, contact data). Those belong in the private vault repository `oscarzhang-research/AI-Industry-Map-private` under `vault/`. `npm run validate` fails on private or sell-side records here; `npm run ingest` runs a privacy check before anything public.
2. **Never invent the owner's views.** Theses, notes, journal entries and outlooks are the owner's. Claude may translate them, fix formatting, or draft text the owner asked for, but must not create views on their behalf. The preview's placeholder records carry `example: true` and must keep it.
3. **Facts need sources.** Company facts, valuations, news and event dates must come from recent, authoritative sources (company releases, filings, regulators, major outlets). Mark anything unconfirmed with a `# verify` comment (companies) or `tentative: true` (events). Do not fabricate figures.
4. **Branches.** The site deploys from `main` through GitHub Actions. Work on a feature branch, run the checks, and merge only when the owner agrees.
5. **Do not edit `data/`.** The market-data workflow writes it.

## Checks before every commit

```bash
npm run validate     # content files and cross-references (0 errors required)
npm run typecheck
npm test
npm run build        # also regenerates public/generated/ (git-ignored)
```

## Where things live

| Path | Contents |
| --- | --- |
| `site.config.yaml` | Site name, owner, repositories, privacy defaults (`publicHiddenFields`, `newRecordVisibility`) |
| `content/taxonomy/layers.yaml` | The five layers: tagline, description, what to watch, featured companies |
| `content/taxonomy/<layer>.yaml` | Industries → segments (`position: upstream|midstream|downstream`, `companies: [ids]` or `ref: <node path>`) |
| `content/companies/<layer>.yaml` | Company records keyed by id (schema below); the file is the company's primary layer |
| `content/reports/<id>/` | Public research: `report.html` + `meta.yaml` |
| `content/views/{theses,notes,journal,outlook}/` | Public copies of records (sanitized projections of vault originals, or examples) |
| `content/news/YYYY-MM.yaml` | News items; `content/events.yaml` upcoming events; `themes.yaml`; `ecosystems.yaml`; `benchmarks.yaml` |
| `data/` | Daily prices (`prices/<symbol>.csv`), `fundamentals.json`, `splits.json`, `fx.json`, `status.json` |
| `scripts/` | `build-data.ts`, `validate.ts`, `ingest-report.ts`, `translate-queue.ts`, `sync-vault.ts`, `prices/fetch_prices.py` |
| `src/lib/` | Types, finance math (`finance.ts`), records and translation (`records.ts`), GitHub client, vault sync |
| `src/pages/`, `src/components/`, `src/editor/` | The React app; editors are lazy-loaded |

Node paths: a node is `layer`, `layer/industry` or `layer/industry/segment` (for example `chips/memory/dram-hbm`).

## Common tasks

### Add or fix a company
Edit the record in `content/companies/<primary layer>.yaml` and list the id in the right segment(s) of the taxonomy.

```yaml
  credo:
    name: Credo
    nameZh: Credo
    aliases: [CRDO, Credo Technology Group]
    listing: listed                    # listed | private | acquired
    tickers:                           # yfinance symbols; the first one is the default price series
      - { symbol: CRDO, exchange: NASDAQ, currency: USD }
    country: US
    tier: core                         # core | focus | watch
    primary: infrastructure/networking/copper-interconnect
    ecosystems: [aws-trainium]         # only documented relationships
    website: credosemi.com
    description: >-
      One or two factual sentences, at most ~40 words.
```

Private companies: `listing: private`, no tickers, `private: { valuation: { usd, date, round }, proxies: [listed ids], note }`. Acquired: `listing: acquired`, `acquiredBy`. Symbol suffixes: `.TW`/`.TWO`, `.T`, `.KS`/`.KQ`, `.HK` (4 digits), `.SS`/`.SZ`, `.AS`, `.PA`, `.DE`, `.SW`, `.L`. A new ticker gets prices on the next market-data run (on a `claude/**` branch push touching `content/companies/**`, or the daily schedule on `main`).

### File a research report ("把这份报告归档")
`npm run ingest -- <file.html>` for a public Claude report (`--private` for a private one; PDFs and `--broker` always go to the vault clone at `../AI-Industry-Map-private`). Then complete `meta.yaml`: English `title`, `titleZh`, `date`, `reportType`, `languages`, `companies`, `nodes`, `tags`, 3–5 plain-English `summary.en` points (and `summary.zh` if the report is bilingual), a one-line `stance`, and `priceRef` when the report anchors on a price. For sell-side: `broker`, `analysts`, `rating`, `targetPrice`, `priceAtReport`. Summarize in your own words; never copy broker text into the public repo.

### Translate the owner's Chinese writing ("翻译待翻译的笔记")
1. Clone the vault next to this repository (`../AI-Industry-Map-private`).
2. `npm run translate-queue` lists pending records; `npm run translate-queue -- --json /tmp/q.json` writes the source text per field.
3. Translate each field into plain, concise English that keeps the owner's meaning, numbers and hedges. Do not add claims.
4. Save `{ "<record id>": { "<field key>": "English…" } }` and run `npm run translate-queue -- --apply /tmp/a.json`. It stores the translation with a hash of the source (a later edit marks it stale) and refreshes public copies.
5. Commit and push both repositories.

### Edit vault records directly
After changing files under the vault's `vault/`, run `npm run sync-vault` to rewrite the public copies (`--check` to preview). Public copies drop `target`, `stop`, `scenarios`, `plan` and `position` unless the record's `publicShow` turns them on.

### Add news
Append to `content/news/YYYY-MM.yaml`:

```yaml
  - id: 2026-10-08-samsung-q3-preliminary-record-profit   # date + slug, unique
    date: 2026-10-08
    title: "Plain English headline"
    summary: "Two factual sentences with the key numbers."
    source: { name: "Samsung Newsroom", url: "https://…" }   # primary source when possible
    companies: [samsung-electronics]
    nodes: [chips/memory/dram-hbm]
    themes: [memory-cycle]
    impact: positive            # positive | negative | mixed | neutral
    importance: 3               # 3 = key item (dot + brief), 2 = notable, 1 = minor
```

Cover all five layers; energy and infrastructure are easy to under-cover. Prefer items from the last two weeks.

### Events
`content/events.yaml`: `id`, `name`, `start`, optional `end`, `kind` (conference | earnings | policy | product | macro), `nodes`, `companies`, `url`, `tentative`, `note`. Earnings dates also come from market data; add an event only when it adds context.

## Records (owner content)

Markdown files with YAML front matter; keys are typed in `src/lib/types.ts` (`ThesisRecord`, `NoteRecord`, `JournalRecord`, `OutlookRecord`). Ids look like `th-2026-10-02-mu-long`, `nt-…`, `jr-…`, `ol-…`. A thesis keeps `versions` (append-only revisions); a status change to target-hit, stopped or expired is the owner's decision; the site only suggests it. Translations live in `translation.fields` keyed by field path (`summary`, `signals.<id>.text`, `updates.<index>.text`…).

## Writing style for public copy

Plain, specific English. Short sentences, active voice, real numbers with units and dates. No hype, no investment advice, no em-dash chains. Product text stays in English; Chinese appears only in `nameZh`, `titleZh` and the owner's untranslated originals.

## Market data

`.github/workflows/market-data.yml` runs `scripts/prices/fetch_prices.py` (yfinance) at 10:30 UTC (Asian close) and 21:35 UTC (US close) on weekdays, and on `claude/**` pushes that change companies or benchmarks. It rewrites `data/` and commits it; `deploy.yml` rebuilds the site afterwards. Yahoo is not reachable from Claude's sandbox, so price checks happen through the workflow.
