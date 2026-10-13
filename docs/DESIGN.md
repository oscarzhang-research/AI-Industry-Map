# Design notes

## Goals

A public, English-first map of the AI economy that also works as the owner's research system. Visitors browse the map, the research and the public views. The owner writes views, notes and reviews from the site, keeps private material private, and has every view scored against market prices without manual bookkeeping. The site has to run with no server and no ongoing cost, and be maintainable by someone who does not code, with Claude doing the technical work.

## Architecture

```
content/ (YAML, Markdown, HTML)  ─┐
data/ (daily prices from Actions) ─┼─ scripts/build-data.ts ─→ public/generated/*.json ─→ Vite build ─→ GitHub Pages
site.config.yaml                  ─┘

Owner's browser ── fine-grained token ──→ GitHub API
   ├─ private vault repo: full records, PDFs, private report metadata
   └─ public repo: sanitized copies (content/views/**), public reports (content/reports/**)
```

- **Static single-page app**: React, TypeScript and Vite, hash routing and a relative base so one build runs on GitHub Pages, in a preview and from a folder. ECharts (modular) for charts, MiniSearch for search (with CJK bigrams), TipTap for the Markdown editor, `marked` + DOMPurify for rendering.
- **Build step** (`scripts/build-data.ts`): loads and cross-checks all content, derives company placements and layers, computes quotes and returns from `data/`, builds a market-cap-weighted index for every layer (each company once, in its primary layer; weights from current US-dollar market caps along the price path) plus equal-weight baskets for layers, industries and themes, writes per-symbol price files, shims reports for the reader, and indexes report text for search.
- **Two repositories**: the public repository holds code, the map, market data and anything public; the private vault holds everything else under `vault/`. Visitors never touch the vault.
- **Owner mode**: the owner pastes a fine-grained GitHub token (Contents read/write on both repositories) on the Settings page. The token stays in that browser's storage and is sent only to `api.github.com`. Saves are atomic multi-file commits through the Git Data API, retried on a moving head. The vault is read as one recursive tree; parsed files are cached in the browser by blob SHA, so edits Claude makes in a session are picked up on the next load.
- **Public projection**: saving a public record writes a sanitized copy to `content/views/` in the same action; switching a record to private deletes the copy. Hidden fields (`target`, `stop`, `scenarios`, `plan`, `position` by default) are removed, along with their revisions and translations.
- **Demo mode** lets anyone try the editors; records stay in that browser.
- **Example content**: placeholder records (`example: true`) ship while `site.showExamples` is on. The owner flips it from Settings, which commits `site.config.yaml` and rebuilds the site for everyone.
- **Link previews**: Open Graph and Twitter tags with absolute URLs from `site.url`, and a 1200×630 `public/og.png`. The site uses hash routing, so every page shares one card.
- **Workflows**: `market-data.yml` (after the Asian and US closes with backup slots, on the morning routine's news commit, and on branch pushes that change the universe or the fetchers), `deploy.yml` (on pushes to `main` and after each data update), `ci.yml` (validate, typecheck, test, build and the fetchers' offline tests on every branch), `health.yml` (a daily check that opens a `site-health` issue when something stalls), `news-feed.yml` (every two hours: the RSS and Atom feeds in `content/news-sources.yaml`, from company newsrooms, regulators, SEC 8-K and 6-K filings and trade media, tagged with company ids and layers and published as `news-candidates.json` on the orphan `feeds` branch; branch pushes upload the result as an artifact instead). A Claude routine also runs every morning at about 6:48 New York time: it adds sourced news for all five layers, translates new Chinese writing, runs the checks and commits only those changes to `main`.
- **Site health** (`scripts/health.ts`): checks the age of the market data, failed series, stale tickers, the newest news item, the feeds branch, the indicators and any workflow on `main` still failing after its last run. A problem opens an issue labelled `site-health` (GitHub emails the owner), a changed set of problems adds a comment, and the issue closes itself once everything passes.

## Market data

`scripts/prices/fetch_prices.py` uses `yfinance` to download the full daily history since 2022-10-01 for every ticker, benchmark and ETF proxy on each run (so split adjustments stay consistent), plus splits, a fundamentals snapshot (market cap, P/E, consensus target, next earnings date) and FX rates for converting market caps to US dollars. Asian-only runs refresh Asian listings early. A run fails if fewer than half the symbols succeed. Yahoo is not reachable from Claude's sandbox, so the workflow is the only fetcher.

GitHub starts scheduled runs late when its queue is busy (five to nine hours in October 2026), so each market has an off-peak slot plus backups, and the morning routine's news commit on `main` triggers a full refresh that arrives before the New York open. A run with nothing new commits nothing.

- **Valuation history**: every full run appends the day's snapshot (trailing and forward P/E, EV/EBITDA, price/sales, market cap, mean, high and low targets, analyst count, rating) to `data/valuation/<symbol>.csv`, dated by the listing's last trading day. Yahoo serves only current values, so this file is the only history. The build drops implausible multiples, and price/sales and EV/EBITDA for listings whose trading and reporting currencies differ.
- **Earnings**: for names reporting within ten days back to three weeks ahead (core tier first, at most 160 per run, each refreshed at most every eight hours unless it reports within a day), the fetcher reads Yahoo's earnings calendar (dates, EPS consensus and results), the quarter's EPS and revenue consensus and the latest quarterly revenue. Yahoo rolls the consensus forward after a report, so the revenue consensus is frozen from the last run before the report date. The build adds the two-session share price reaction and the revenue surprise, and drops revenue figures that look like a different currency from the estimate.
- **Indicators**: `scripts/prices/fetch_kpis.py` reads quarterly revenue and capital spending from SEC company facts for the listings in `content/kpis.yaml → sec`, and monthly revenue of Taiwan listings from the TWSE and TPEx open data (with the MOPS monthly pages for history). The build assigns each fiscal quarter to the calendar quarter holding its midpoint and compiles the indicators defined in `content/kpis.yaml` into `generated/kpis.json`; each company's figures also go into its price file for the company page.

## Content model

- **Taxonomy**: 5 layers → 32 industries → segments with a value-chain `position` (upstream, midstream, downstream). A segment lists company ids or points (`ref`) to a node elsewhere in the map, so supply chains cross layers without duplicating companies.
- **Companies**: one record per company with tickers in yfinance form (the first is the default price series), tier (core, focus, watch), primary placement, ecosystems, and private valuations with listed proxies for unlisted companies. Placements are derived from the taxonomy.
- **Reports**: `meta.yaml` with English title, summary points, companies, nodes, tags, stance, the price the report anchors on, and broker fields for sell-side notes.
- **Records**: Markdown with YAML front matter for theses, notes, journal entries and outlooks (`src/lib/types.ts`). Theses carry structured fields and free text side by side, and an append-only revision list.

## Scoring views

Implemented in `src/lib/finance.ts` and documented on the About page: base price set by the owner (with the day's close stored as an objective reference), split adjustment for prices written before a split, direction-signed returns, excess return against a market benchmark, progress to target, best and worst moves, scenario-weighted return and payoff ratio. The site suggests target hit, stopped or expired from daily closes; the owner confirms. Layer views use the market-cap-weighted layer index; industry and theme views use the equal-weight basket of the node, or an ETF the view names.

## Translation

The owner writes in Chinese. Every translatable field has a stable key (`summary`, `signals.<id>.text`, `updates.<index>.text`, …). `translation.fields` stores English per key with an FNV-1a hash of the source text, so the site knows whether a translation is missing, current or stale. Visitors see English when it exists and the original otherwise, marked "EN pending"; a toggle shows the Chinese original. Translations are produced by Claude (`npm run translate-queue`), and the morning routine runs it daily.

## Security and privacy

- No analytics, no third-party scripts beyond Google Fonts; the preview is `noindex`.
- Reports render in a sandboxed `srcdoc` frame without same-origin access; a small shim gives them in-memory storage, a fixed language and working in-page anchors.
- Sell-side research never enters the public repository; validation and ingestion both refuse it. Public ingestion also scans for personal details.
- The token needs only Contents (and optionally Actions) on two repositories. Signing out clears it and the vault cache.

## Visual design

The concept is a geological survey sheet: five pastel strata on paper, with ink-coloured text and hairline rules. The cake on the home page is a cylinder slice whose bands are the layers, bottom to top. Each layer has a fill, edge, ink and line colour, chosen so the line colours pass colour-vision-deficiency separation checks against both surfaces. Type: Newsreader for display, IBM Plex Sans for text, IBM Plex Sans Condensed for labels, IBM Plex Mono for tickers. Light theme by default with a dark theme that follows the system or a toggle. Price colours default to green up / red down for US readers, with a red-up option. All tokens live in `src/styles/tokens.css`.

## Roadmap

- Public track record once enough views have closed.
- Model portfolio (positions, sizing, P&L against benchmarks).
- More indicators: backlog (remaining performance obligations), utility load forecasts, chip equipment orders.
- More companies and segments; confirm the tickers marked `# verify`.
