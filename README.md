# AI Industry Map

An investor's map of the AI economy, organized by the five-layer framework NVIDIA's Jensen Huang uses to describe AI: **energy, chips, infrastructure, models and applications**. Each layer breaks down into industries and upstream, midstream and downstream segments, with 342 companies placed in them and priced every trading day. On top of the map sit a research library, notes, periodic reviews, and explicit, dated views that are scored against market prices.

The site is static (GitHub Pages). Content is plain YAML and Markdown in this repository. The owner writes from the site itself, signed in with a GitHub token; private material lives in a separate private repository.

## What is on the site

| Page | What it shows |
| --- | --- |
| Map (home) | The five-layer cake, the full company map, a market-cap heatmap, layer baskets since 2023, active views, catalysts, news and the latest research |
| Layer and industry pages | Value chain from upstream to downstream, company tables, baskets, and the views, research, news and notes filed there |
| Company pages | Daily price chart with view overlays (base, target, stop, revisions), valuation strip, where the company sits in the chain, peers and a timeline |
| Views | Every thesis with its return since the base price, return against a benchmark, distance to target, and a conviction-versus-upside chart |
| View page | The call, performance, a relative chart against the benchmark, core logic, variant perception, signals, risks and falsification, scenarios, catalysts, revisions and post-mortem |
| Research | Reports filed by month, company or industry, with long lists folded; a sandboxed reader with an English / Chinese switch |
| News, Calendar | Sourced news tagged by layer and industry; earnings, conferences and the catalysts written into views |
| Journal | Weekly to quarterly reviews and the outlook: where the bottleneck sits and a stance for each layer |

## How views are scored

- **Base price**: the price the view was written against, entered by the author (the day's close is stored too).
- **Daily prices**: split-adjusted closes from Yahoo Finance (via `yfinance`), fetched by GitHub Actions after the Asian and US closes. Prices entered before a split are divided by the split ratio.
- **Returns** run from the base price to the latest close and are signed by direction, so a correct short is a gain. Dividends are excluded. Excess return subtracts a benchmark over the same days (Nasdaq-100 for US listings, PHLX Semiconductor for US chip names, the local index elsewhere).
- **Industry, layer and theme views** use an equal-weight basket of the listed companies in that node, or an ETF the view names.
- **Closing**: the site flags when a close crosses the target or stop or the horizon ends; nothing closes until the owner confirms. Changes to direction, conviction, target, stop or horizon are kept as dated revisions.

## Privacy model

- New views, notes and journal entries are **private** by default and live only in the private vault repository.
- A view made public gets a sanitized copy in `content/views/`; target, stop, scenarios, trading plan and position stay hidden unless switched on for that view.
- Third-party (sell-side) research is copyrighted and is **never** stored in this repository. It goes to the vault and is shown only to the signed-in owner.
- Reports open in a sandboxed frame, so their scripts cannot reach the site's storage or the owner's token.

## Repository layout

```
content/
  taxonomy/        layers.yaml + one file per layer: industries and segments
  companies/       company records (tickers, tier, placements, private valuations)
  reports/<id>/    public research: report.html + meta.yaml
  views/           public copies of views, notes, journal entries and outlooks (Markdown + YAML)
  news/            sourced news, one file per month
  events.yaml, themes.yaml, ecosystems.yaml, benchmarks.yaml
data/              written by the market-data workflow: prices, splits, fundamentals, FX (do not edit)
scripts/           build-data, validate, ingest-report, translate-queue, sync-vault, prices/ (Python)
src/               the React app (Vite, TypeScript); src/lib holds the data model and finance math
tests/             unit tests (Vitest)
docs/              design notes and the owner guide (Chinese)
site.config.yaml   site name, owner, repositories and privacy defaults
```

## Running it

```bash
npm install
npm run dev        # builds public/generated/ from content/ and data/, then starts Vite
npm run validate   # checks every content file and cross-reference
npm test           # unit tests
npm run build      # production build in dist/
```

Node 22.18 or later (TypeScript scripts run natively). Prices come from `data/`; to refresh them locally, `pip install -r scripts/prices/requirements.txt && python scripts/prices/fetch_prices.py`.

To build your own map, fork the repository, edit `site.config.yaml`, the taxonomy and the company files, and enable GitHub Pages with "GitHub Actions" as the source.

## Credits and disclaimer

Framework after Jensen Huang's five-layer description of AI. Market data from Yahoo Finance through the open-source `yfinance` library, for personal, non-commercial use. Research reports were written with Claude (Anthropic) as a research assistant.

Personal research notes by Oscar Zhang. Nothing here is investment advice or a recommendation to buy or sell any security.

Code is released under the MIT License (see `LICENSE`). Research, views and notes in `content/reports` and `content/views` are © their author; please link rather than republish.
