#!/usr/bin/env python3
"""Fetch daily market data for every listed company in the AI Industry Map.

Runs in GitHub Actions (see .github/workflows/market-data.yml). Writes, under data/:
  prices/<SAFE_SYMBOL>.csv   date,close,high,low  (split-adjusted closes, full history since START)
  splits.json                {symbol: [[date, ratio], ...]}
  fundamentals.json          {symbol: {...}}  market cap, valuation, consensus targets, next earnings
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
from datetime import datetime, timezone

import yaml

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA = os.path.join(ROOT, "data")
PRICES = os.path.join(DATA, "prices")
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
    """File-system safe name; must match scripts/lib/symbols.ts."""
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
    if not args.no_fundamentals and args.markets == "all":
        fpath = os.path.join(DATA, "fundamentals.json")
        targets = [s for s in symbols if s in defaults]
        fund, fund_failed = fetch_fundamentals(targets, load_json(fpath, {}))
        save_json(fpath, fund)

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
