# feeds (machine-written branch)

This branch is rewritten about every two hours by `.github/workflows/news-feed.yml` running on `main`
(`scripts/news/fetch_feeds.py`). It always holds a single commit; do not edit it by hand.

- `news-candidates.json`: entries from the feeds in `content/news-sources.yaml` published in the last
  4 days, newest first (at most 500). Each item has `companies` (ids from `content/companies`)
  and `layers`. Primary sources (company newsrooms, regulators, SEC filings) also carry `excerpt`, the
  opening text of the linked page or of the filing's press-release exhibit (`excerptUrl`). Media items
  carry only the summary from their feed.
- `sources-status.json`: the last run's result for each source (`ok`, HTTP status or error, entries in
  the feed, entries kept).

A Claude routine reads `news-candidates.json` each morning to pick news items and verify them against
the primary source before adding them to `content/news/`. Candidates are unverified leads, not site
content.
