#!/usr/bin/env python3
"""Fetch daily market data for every listed company in the AI Industry Map.

Runs in GitHub Actions (see .github/workflows/market-data.yml). Writes, under data/:
  prices/<SAFE_SYMBOL>.csv   date,close,high,low  (split-adjusted closes, full history since START)
  splits.json                {symbol: [[date, ratio], ...]}
  fundamentals.json          {symbol: {...}}  market cap, valuation, consensus targets, next earnings
  valuation/<SAFE>.csv       one row per day of the valuation snapshot (P/E, EV/EBITDA, targets...), so
                             the history survives; Yahoo only serves today's values
  earnings.json              {symbol: {next, history}}  report dates, consensus EPS and revenue, results
  fx.json                    {asOf, rates: {CCY: units per 1 USD}}
  status.json                run summary

The full history is re-downloaded on every run. That keeps split adjustments consistent, and because
past rows do not change, git diffs stay small (one new line per symbol per day).

Usage:
  python scripts/prices/fetch_prices.py                 # all symbols + fundamentals
  python scripts/prices/fetch_prices.py --markets asia  # only Asia-Pacific listings (morning run)
  python scripts/prices/fetch_prices.py --no-fundamentals --only NVDA,MU
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone

import yaml

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA = os.path.join(ROOT, "data")
PRICES = os.path.join(DATA, "prices")
VALUATION = os.path.join(DATA, "valuation")
# Valuation history columns -> keys of the cleaned fundamentals record.
VAL_COLUMNS = {
    "pe": "trailingPE",
    "fpe": "forwardPE",
    "ev_ebitda": "evToEbitda",
    "ps": "priceToSales",
    "mcap": "marketCap",
    "tgt": "targetMean",
    "tgt_hi": "targetHigh",
    "tgt_lo": "targetLow",
    "analysts": "analysts",
    "rec": "recommendation",
}
# Earnings: only names reporting within this window get the extra (slower) Yahoo calls.
EARN_DAYS_BACK = 10
EARN_DAYS_AHEAD = 21
EARN_MAX_SYMBOLS = 160
EARN_HISTORY = 8
EARN_REFRESH_HOURS = 8  # several runs a day: refresh a name at most this often unless it reports around now
START = "2022-10-01"  # a few weeks before ChatGPT's launch: covers the whole AI cycle
ASIA_SUFFIXES = (".T", ".KS", ".KQ", ".HK", ".SS", ".SZ", ".TW", ".TWO", ".AX")
ASIA_INDICES = {"^TWII", "^KS11", "^N225", "^HSI", "000300.SS", "000688.SS"}
BATCH = 40
INFO_FIELDS = {
    "marketCap": "marketCap",
    "currency": "currency",
    "financialCurrency": "financialCurrency",
    "trailingPE": "trailingPE",
    "forwardPE": "forwardPE",
    "priceToSalesTrailing12Months": "priceToSales",
    "enterpriseToEbitda": "evToEbitda",
    "targetMeanPrice": "targetMean",
    "targetHighPrice": "targetHigh",
    "targetLowPrice": "targetLow",
    "numberOfAnalystOpinions": "analysts",
    "recommendationKey": "recommendation",
    "sharesOutstanding": "sharesOutstanding",
    "fiftyTwoWeekHigh": "high52",
    "fiftyTwoWeekLow": "low52",
    "dividendYield": "dividendYield",
}


def safe_symbol(symbol: str) -> str:
    """File-system safe name; must match safeSymbol() in src/lib/symbols.ts."""
    return re.sub(r"[^A-Za-z0-9.\-]", "_", symbol)


def load_yaml(path: str):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_universe() -> tuple[list[str], set[str], list[str], list[str]]:
    """Return (all symbols, default symbols that get fundamentals, benchmark symbols, fx currencies)."""
    symbols: list[str] = []
    defaults: set[str] = set()
    for path in sorted(glob.glob(os.path.join(ROOT, "content", "companies", "*.yaml"))):
        doc = load_yaml(path)
        for cid, rec in (doc.get("companies") or {}).items():
            if not isinstance(rec, dict) or rec.get("listing") != "listed":
                continue
            for i, t in enumerate(rec.get("tickers") or []):
                sym = (t or {}).get("symbol")
                if not sym:
                    continue
                if sym not in symbols:
                    symbols.append(sym)
                if i == 0:
                    defaults.add(sym)
    bench = load_yaml(os.path.join(ROOT, "content", "benchmarks.yaml"))
    bench_syms = [b["symbol"] for b in bench.get("benchmarks", []) if b.get("symbol")]
    extra = [s for s in bench.get("extraSymbols", []) or []]
    for s in bench_syms + extra:
        if s not in symbols:
            symbols.append(s)
    fx = [c for c in bench.get("fx", []) if c and c != "USD"]
    return symbols, defaults, bench_syms, fx


def is_asia(symbol: str) -> bool:
    return symbol.endswith(ASIA_SUFFIXES) or symbol in ASIA_INDICES


def fmt(x: float) -> str:
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return ""
    s = f"{float(x):.4f}".rstrip("0").rstrip(".")
    return s if s not in ("", "-0") else "0"


def frame_for(df, symbol: str, multi: bool):
    """Pull one symbol's OHLC frame out of a yf.download result."""
    import pandas as pd

    if df is None or len(df) == 0:
        return None
    if multi:
        if isinstance(df.columns, pd.MultiIndex):
            lv0 = df.columns.get_level_values(0)
            lv1 = df.columns.get_level_values(1)
            if symbol in set(lv0):
                sub = df[symbol]
            elif symbol in set(lv1):
                sub = df.xs(symbol, axis=1, level=1)
            else:
                return None
        else:
            return None
    else:
        sub = df
        if isinstance(sub.columns, pd.MultiIndex):
            sub = sub.droplevel(1 if symbol in set(sub.columns.get_level_values(1)) else 0, axis=1)
    if "Close" not in sub.columns:
        return None
    sub = sub.dropna(subset=["Close"])
    return sub if len(sub) else None


def download_batch(symbols: list[str], attempts: int = 4):
    import yfinance as yf

    delay = 5.0
    for attempt in range(1, attempts + 1):
        try:
            return yf.download(
                tickers=symbols,
                start=START,
                interval="1d",
                auto_adjust=False,
                actions=True,
                group_by="ticker",
                threads=True,
                progress=False,
                multi_level_index=True,
            )
        except Exception as exc:  # rate limits and transient network errors
            print(f"  batch attempt {attempt} failed: {exc}", file=sys.stderr)
            if attempt == attempts:
                return None
            time.sleep(delay)
            delay *= 2
    return None


def write_csv(symbol: str, frame) -> int:
    rows = ["date,close,high,low"]
    for idx, r in frame.iterrows():
        d = idx.strftime("%Y-%m-%d")
        rows.append(f"{d},{fmt(r.get('Close'))},{fmt(r.get('High'))},{fmt(r.get('Low'))}")
    path = os.path.join(PRICES, safe_symbol(symbol) + ".csv")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(rows) + "\n")
    return len(rows) - 1


def splits_from(frame) -> list[list]:
    if "Stock Splits" not in frame.columns:
        return []
    s = frame["Stock Splits"]
    out = []
    for idx, v in s.items():
        try:
            ratio = float(v)
        except (TypeError, ValueError):
            continue
        if ratio and ratio != 0 and ratio != 1:
            out.append([idx.strftime("%Y-%m-%d"), round(ratio, 6)])
    return out


def clean_info(info: dict) -> dict:
    out = {}
    for src, dst in INFO_FIELDS.items():
        v = info.get(src)
        if v is None:
            continue
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            continue
        out[dst] = v
    # Upcoming earnings: Yahoo exposes epoch seconds.
    for key in ("earningsTimestampStart", "earningsTimestamp", "earningsTimestampEnd"):
        ts = info.get(key)
        if isinstance(ts, (int, float)) and ts > 0:
            day = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
            if day >= datetime.now(timezone.utc).strftime("%Y-%m-%d"):
                out["nextEarnings"] = day
                out["earningsEstimated"] = bool(info.get("isEarningsDateEstimate", False))
                break
    return out


def fetch_fundamentals(symbols: list[str], previous: dict) -> tuple[dict, list[str]]:
    import yfinance as yf

    result = dict(previous)
    failed = []
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for i, sym in enumerate(symbols):
        info = None
        for attempt in range(3):
            try:
                info = yf.Ticker(sym).info or {}
                break
            except Exception as exc:
                print(f"  info {sym} attempt {attempt + 1}: {exc}", file=sys.stderr)
                time.sleep(3 * (attempt + 1))
        if info:
            rec = clean_info(info)
            if rec:
                rec["asOf"] = today
                result[sym] = rec
            else:
                failed.append(sym)
        else:
            failed.append(sym)
        time.sleep(0.4)
        if (i + 1) % 50 == 0:
            print(f"  fundamentals {i + 1}/{len(symbols)}")
    return result, failed


def fmt_cell(v) -> str:
    """A CSV cell for the valuation history: numbers trimmed, text kept, missing left blank."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return fmt(v)
    return re.sub(r"[,\n\r]", " ", str(v)).strip()


def append_valuation(symbol: str, rec: dict, day: str) -> None:
    """Add today's valuation snapshot to data/valuation/<SAFE>.csv (a rerun on the same day replaces the row)."""
    os.makedirs(VALUATION, exist_ok=True)
    path = os.path.join(VALUATION, safe_symbol(symbol) + ".csv")
    header = "date," + ",".join(VAL_COLUMNS)
    rows: list[str] = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            lines = [ln.rstrip("\n") for ln in f if ln.strip()]
        if lines and lines[0] == header:
            rows = [ln for ln in lines[1:] if not ln.startswith(day + ",")]
    rows.append(",".join([day] + [fmt_cell(rec.get(key)) for key in VAL_COLUMNS.values()]))
    rows.sort()
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(header + "\n" + "\n".join(rows) + "\n")


def last_price_date(symbol: str) -> str | None:
    """Date of the newest row in data/prices/<SAFE>.csv."""
    path = os.path.join(PRICES, safe_symbol(symbol) + ".csv")
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 200))
            tail = f.read().decode("utf-8", "ignore").strip().splitlines()
    except OSError:
        return None
    day = tail[-1].split(",")[0] if tail else ""
    return day if re.match(r"^\d{4}-\d{2}-\d{2}$", day) else None


def load_tiers() -> dict[str, str]:
    """Default ticker -> company tier (core, focus, watch), used to order the earnings calls."""
    tiers: dict[str, str] = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "content", "companies", "*.yaml"))):
        for rec in (load_yaml(path).get("companies") or {}).values():
            if isinstance(rec, dict) and rec.get("listing") == "listed" and rec.get("tickers"):
                sym = (rec["tickers"][0] or {}).get("symbol")
                if sym:
                    tiers[sym] = rec.get("tier", "watch")
    return tiers


def num(v):
    """A finite float, or None for NaN, missing or non-numeric values."""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(x) or math.isinf(x) else x


def report_time(ts) -> str | None:
    """'bmo' (before the US open) or 'amc' (after the close) from a report timestamp, when the hour says so."""
    try:
        et = ts.tz_convert("America/New_York") if getattr(ts, "tzinfo", None) else None
    except Exception:
        et = None
    if et is None or (et.hour == 0 and et.minute == 0):
        return None  # date only
    if et.hour < 9 or (et.hour == 9 and et.minute < 30):
        return "bmo"
    if et.hour >= 16:
        return "amc"
    return None


def earnings_rows(ticker) -> list[dict]:
    """Report dates with consensus and reported EPS (Yahoo's earnings calendar), newest first."""
    df = ticker.get_earnings_dates(limit=12)
    out = []
    if df is None or len(df) == 0:
        return out
    for ts, r in df.iterrows():
        out.append(
            {
                "date": ts.strftime("%Y-%m-%d"),
                "time": report_time(ts),
                "epsEst": num(r.get("EPS Estimate")),
                "epsActual": num(r.get("Reported EPS")),
                "surprise": num(r.get("Surprise(%)")),
            }
        )
    out.sort(key=lambda x: x["date"], reverse=True)
    return out


def quarter_estimate(frame) -> tuple[float | None, int | None]:
    """Average estimate and analyst count for the current quarter ('0q') from an estimate table."""
    try:
        row = frame.loc["0q"]
    except Exception:
        return None, None
    n = num(row.get("numberOfAnalysts"))
    return num(row.get("avg")), int(n) if n is not None else None


def latest_revenue(ticker, report_day: str) -> tuple[float | None, str | None]:
    """Total revenue of the quarter a report covers: the latest quarter ending 0-120 days before the report."""
    try:
        q = ticker.quarterly_income_stmt
    except Exception:
        return None, None
    if q is None or len(q) == 0 or "Total Revenue" not in q.index:
        return None, None
    rd = date.fromisoformat(report_day)
    best = None
    for col in q.columns:
        try:
            end = col.date()
        except AttributeError:
            continue
        lag = (rd - end).days
        if 0 <= lag <= 120 and (best is None or end > best[0]):
            v = num(q.loc["Total Revenue", col])
            if v is not None:
                best = (end, v)
    return (best[1], best[0].isoformat()) if best else (None, None)


def fetch_earnings(symbols: list[str], fundamentals: dict, previous: dict, tiers: dict[str, str]) -> tuple[dict, list[str]]:
    """Consensus before each report and results after it, for names reporting within the window.

    Yahoo's quarter estimates roll forward once a company reports, so the consensus is frozen from the
    last run before the report date and paired with the reported figures afterwards.
    """
    import yfinance as yf

    today = datetime.now(timezone.utc).date()
    lo, hi = today - timedelta(days=EARN_DAYS_BACK), today + timedelta(days=EARN_DAYS_AHEAD)

    def in_window(day: str | None) -> bool:
        try:
            return day is not None and lo <= date.fromisoformat(day) <= hi
        except ValueError:
            return False

    result = {s: v for s, v in previous.items() if s in symbols}
    rank = {"core": 0, "focus": 1, "watch": 2}
    now = datetime.now(timezone.utc)

    def recent(prev: dict) -> bool:
        """Refreshed in the last EARN_REFRESH_HOURS, with no report due within a day either side."""
        try:
            at = datetime.fromisoformat(prev.get("checkedAt", ""))
        except ValueError:
            return False
        nxt = (prev.get("next") or {}).get("date")
        around = False
        if nxt:
            try:
                around = abs((date.fromisoformat(nxt) - today).days) <= 1
            except ValueError:
                pass
        return not around and now - at < timedelta(hours=EARN_REFRESH_HOURS)

    due = [
        s
        for s in symbols
        if in_window((fundamentals.get(s) or {}).get("nextEarnings")) or in_window(((previous.get(s) or {}).get("next") or {}).get("date"))
    ]
    due.sort(key=lambda s: (rank.get(tiers.get(s, "watch"), 3), s))
    failed = []
    for sym in due[:EARN_MAX_SYMBOLS]:
        prev = previous.get(sym) or {}
        prev_next = prev.get("next") or {}
        if recent(prev):
            continue
        try:
            t = yf.Ticker(sym)
            rows = earnings_rows(t)
            rev_est, rev_n = quarter_estimate(t.revenue_estimate)
            eps_est0, eps_n = quarter_estimate(t.earnings_estimate)
        except Exception as exc:
            print(f"  earnings {sym}: {exc}", file=sys.stderr)
            failed.append(sym)
            time.sleep(1.0)
            continue
        today_s = today.isoformat()
        future = sorted((r for r in rows if r["date"] >= today_s and r["epsActual"] is None), key=lambda r: r["date"])
        past = [r for r in rows if r["epsActual"] is not None]
        rec: dict = {"updatedAt": today_s, "checkedAt": now.isoformat(timespec="minutes")}
        if future:
            nxt = dict(future[0])
            nxt.pop("epsActual", None)
            nxt.pop("surprise", None)
            if nxt.get("epsEst") is None:
                nxt["epsEst"] = eps_est0
            nxt.update({"epsN": eps_n, "revEst": rev_est, "revN": rev_n, "asOf": today_s})
            nxt["estimated"] = bool((fundamentals.get(sym) or {}).get("earningsEstimated", False))
            rec["next"] = {k: v for k, v in nxt.items() if v is not None}
        history = {h["date"]: h for h in prev.get("history") or []}
        for r in past[:EARN_HISTORY]:
            h = dict(history.get(r["date"]) or {})
            h.update({k: v for k, v in r.items() if v is not None})
            # The revenue consensus Yahoo showed before this report, frozen on the last run before it.
            if prev_next.get("date") == r["date"] and prev_next.get("revEst") is not None and "revEst" not in h:
                h["revEst"] = prev_next["revEst"]
            if "revActual" not in h:
                rev, period = latest_revenue(t, r["date"])
                if rev is not None:
                    h["revActual"], h["period"] = rev, period
            history[r["date"]] = h
        rec["history"] = sorted(history.values(), key=lambda h: h["date"], reverse=True)[:EARN_HISTORY]
        result[sym] = rec
        time.sleep(0.6)
    return result, failed


def fetch_fx(currencies: list[str], previous: dict) -> dict:
    pairs = [f"{c}=X" for c in currencies]
    df = download_batch(pairs)
    rates = dict((previous or {}).get("rates", {}))
    for c, p in zip(currencies, pairs):
        fr = frame_for(df, p, multi=True)
        if fr is not None and len(fr):
            rates[c] = round(float(fr["Close"].iloc[-1]), 6)
    rates["USD"] = 1.0
    return {"asOf": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "rates": rates}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--markets", choices=["all", "asia"], default="all")
    ap.add_argument("--no-fundamentals", action="store_true")
    ap.add_argument("--only", default="", help="comma-separated symbols")
    args = ap.parse_args()

    os.makedirs(PRICES, exist_ok=True)
    started = time.time()
    symbols, defaults, bench_syms, fx = load_universe()
    if args.only:
        wanted = [s.strip() for s in args.only.split(",") if s.strip()]
        symbols = [s for s in symbols if s in wanted] or wanted
    if args.markets == "asia":
        symbols = [s for s in symbols if is_asia(s)]
    print(f"{len(symbols)} symbols to fetch ({args.markets})")

    splits_path = os.path.join(DATA, "splits.json")
    splits = load_json(splits_path, {})
    ok, failed = [], []
    for start in range(0, len(symbols), BATCH):
        batch = symbols[start : start + BATCH]
        df = download_batch(batch)
        for sym in batch:
            fr = frame_for(df, sym, multi=True)
            if fr is None:
                failed.append(sym)
                continue
            n = write_csv(sym, fr)
            sp = splits_from(fr)
            if sp:
                splits[sym] = sp
            elif sym in splits and not sp:
                pass  # keep previously recorded splits
            ok.append(sym)
        print(f"  prices {min(start + BATCH, len(symbols))}/{len(symbols)}")
        time.sleep(1.5)

    # Retry failures one by one (batch downloads occasionally drop a symbol).
    retry = list(failed)
    failed = []
    for sym in retry:
        df = download_batch([sym], attempts=2)
        fr = frame_for(df, sym, multi=True) if df is not None else None
        if fr is None and df is not None:
            fr = frame_for(df, sym, multi=False)
        if fr is None:
            failed.append(sym)
            continue
        write_csv(sym, fr)
        sp = splits_from(fr)
        if sp:
            splits[sym] = sp
        ok.append(sym)
        time.sleep(1.0)

    save_json(splits_path, splits)

    fund_failed: list[str] = []
    earn_failed: list[str] = []
    if not args.no_fundamentals and args.markets == "all":
        fpath = os.path.join(DATA, "fundamentals.json")
        targets = [s for s in symbols if s in defaults]
        fund, fund_failed = fetch_fundamentals(targets, load_json(fpath, {}))
        save_json(fpath, fund)
        # Valuation history: only snapshots refreshed in this run (failed names keep yesterday's values),
        # dated by the listing's latest trading day so weekend and early-morning runs do not add rows.
        # Neither this nor the earnings step may stop the run: prices and fundamentals are already saved.
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        try:
            for sym in targets:
                rec = fund.get(sym)
                if rec and rec.get("asOf") == today:
                    append_valuation(sym, rec, last_price_date(sym) or today)
        except Exception as exc:
            print(f"  valuation history: {exc}", file=sys.stderr)
        epath = os.path.join(DATA, "earnings.json")
        try:
            earnings, earn_failed = fetch_earnings(targets, fund, load_json(epath, {}), load_tiers())
            save_json(epath, earnings)
        except Exception as exc:
            print(f"  earnings: {exc}", file=sys.stderr)
            earn_failed = ["(all)"]

    if fx and args.markets == "all":
        fxpath = os.path.join(DATA, "fx.json")
        save_json(fxpath, fetch_fx(fx, load_json(fxpath, {})))

    status = {
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "markets": args.markets,
        "symbols": len(symbols),
        "ok": len(ok),
        "failed": sorted(failed),
        "fundamentalsFailed": sorted(fund_failed),
        "earningsFailed": sorted(earn_failed),
        "seconds": round(time.time() - started, 1),
    }
    save_json(os.path.join(DATA, "status.json"), status)
    print(json.dumps(status, indent=2))
    # Fail the job only if almost nothing came back (e.g. Yahoo blocked the runner).
    return 0 if len(ok) >= max(1, int(0.5 * len(symbols))) else 1


def load_json(path: str, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path: str, obj) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")


if __name__ == "__main__":
    sys.exit(main())
