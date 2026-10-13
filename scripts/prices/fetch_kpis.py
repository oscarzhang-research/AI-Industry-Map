#!/usr/bin/env python3
"""Fetch industry indicators for the AI Industry Map: quarterly revenue and capital expenditure of US
filers from SEC XBRL company facts, and monthly revenue of Taiwan-listed companies.

Runs in GitHub Actions after fetch_prices.py (see .github/workflows/market-data.yml). Writes, under
data/kpis/:
  sec/<SAFE_SYMBOL>.json  {symbol, cik, name, company, updatedAt, revenue: [...], capex: [...]}
                          quarterly USD values sorted by end date, at most the last 40 quarters
  sec/_tickers.json       ticker -> CIK map from sec.gov for the symbols we use, refreshed weekly
  tw/<code>.csv           month,revenue,yoy,mom  (revenue in NT$ thousand; yoy and mom in percent)
  tw/_absent.json         months a code was missing from a full MOPS page, so they are not fetched
                          again (a recent listing has no older months)
  status.json             run summary

Sources:
  SEC   https://www.sec.gov/files/company_tickers.json            ticker -> CIK
        https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
  TWSE  https://openapi.twse.com.tw/v1/opendata/t187ap05_L          latest month, listed companies
  TPEx  https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O       latest month, OTC companies
  MOPS  https://mopsov.twse.com.tw/nas/t21/{sii|otc}/t21sc03_{rocYear}_{month}_{0|1}.html
        Big5 monthly summary pages used to backfill history (_0 domestic, _1 foreign "-KY" issuers)

A company file is rewritten only when its data changes, so its updatedAt is the time of the last
change and git diffs stay small; status.json records every run. One company failing never stops the
run, and the script exits 0 unless every source it ran failed outright.

Usage:
  python scripts/prices/fetch_kpis.py                           # SEC and Taiwan
  python scripts/prices/fetch_kpis.py --sec --only NVDA,MSFT
  python scripts/prices/fetch_kpis.py --tw --tw-backfill-months 12
Environment: SEC_USER_AGENT and TW_USER_AGENT override the User-Agent headers. The SEC asks automated
clients to name themselves and give a contact address ("Name contact@example.com").
"""
from __future__ import annotations

import argparse
import csv
import glob
import gzip
import http.client
import json
import math
import os
import re
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import zlib
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from typing import Callable, NamedTuple

import yaml

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
KPIS = os.path.join(ROOT, "data", "kpis")

SEC_USER_AGENT = "AI Industry Map research site github.com/oscarzhang-research/AI-Industry-Map"
TW_USER_AGENT = (
    "Mozilla/5.0 (compatible; AI-Industry-Map/1.0; +https://github.com/oscarzhang-research/AI-Industry-Map)"
)
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
TWSE_REVENUE_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap05_L"
TPEX_REVENUE_URL = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O"
# The legacy archive moved to mopsov; the old host is kept as a fallback.
MOPS_HOSTS = ("https://mopsov.twse.com.tw", "https://mops.twse.com.tw")
MOPS_HEADERS = {"Referer": "https://mopsov.twse.com.tw/", "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"}

# Minimum seconds between request starts, per rate group. The SEC allows 10 requests/second.
GAPS = {"sec": 1 / 8, "mops": 2.5, "default": 0.5}
MOPS_MAX_FAILURES = 5  # consecutive failed MOPS pages in one market before its backfill stops
MOPS_MIN_ROWS = 100  # a summary page lists hundreds of companies; only a full page proves an absence
SEC_MAX_FORBIDDEN = 3  # consecutive HTTP 403s before the SEC run stops (User-Agent refused)

# ---- SEC -----------------------------------------------------------------------------------------
US_EXCHANGES = {"NASDAQ", "NYSE", "NYSE AMERICAN"}
TIER_ORDER = {"core": 0, "focus": 1, "watch": 2}
SEC_CAP = 120  # companies fetched when content/kpis.yaml has no `sec:` allow-list
SEC_FORMS = {"10-Q", "10-K", "10-Q/A", "10-K/A"}  # 20-F and 40-F are annual-only and skipped
# us-gaap concepts in priority order: for each quarter the first concept with a value wins, so a
# company that switched tags (e.g. SalesRevenueNet before ASC 606) still gets one series.
REVENUE_CONCEPTS = (
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "SalesRevenueNet",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
)
# Plain PP&E purchases first; the broader tags only fill periods it lacks. NVIDIA and Broadcom, for
# example, report capex as PaymentsToAcquireProductiveAssets (PP&E plus intangibles). Utilities and
# REITs often use PaymentsForCapitalImprovements.
CAPEX_CONCEPTS = (
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
    "PaymentsForCapitalImprovements",
    "PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets",
)
MAX_QUARTERS = 40
# Duration in days (end - start) of a fact by the number of quarters it covers; the bounds allow
# 52/53-week years and 13/14-week quarters.
SPAN_DAYS = {1: (80, 100), 2: (170, 190), 3: (260, 285), 4: (350, 380)}
FP_QUARTER = {"Q1": 1, "Q2": 2, "Q3": 3, "Q4": 4, "FY": 4}
TICKERS_MAX_AGE = timedelta(days=7)
TICKERS_RETRY_AGE = timedelta(days=1)  # refresh early when a wanted symbol is missing

# ---- Taiwan --------------------------------------------------------------------------------------
MONTH_RE = re.compile(r"\d{4}-\d{2}")
CODE_RE = re.compile(r"\d{4}[0-9A-Z]{0,2}")
TW_CSV_HEADER = "month,revenue,yoy,mom"
# OpenAPI field -> alternatives of (substrings that must appear, substrings that must not), matched
# against keys with whitespace removed. TWSE and TPEx use the same Chinese keys, for example
# 營業收入-當月營收 and 營業收入-去年同月增減(%); the English names are fallbacks.
OPENAPI_FIELDS = {
    "month": [(("資料年月",), ()), (("YearMonth",), ())],
    "code": [(("公司代號",), ()), (("CompanyCode",), ())],
    "revenue": [(("當月營收",), ("去年", "累計"))],
    "prev": [(("上月營收",), ("累計",))],
    "lastYear": [(("去年當月營收",), ("累計",))],
    "yoy": [(("去年同月增減",), ("累計",)), (("YearOverYear",), ("Cumulative",))],
    "mom": [(("上月比較增減",), ("累計",)), (("MonthOverMonth",), ("Cumulative",))],
}
# MOPS summary columns after 公司代號 and 公司名稱. Positions are read from the header row when it is
# present; these are the defaults.
MOPS_COLUMNS = {
    "revenue": "當月營收",
    "prev": "上月營收",
    "lastYear": "去年當月營收",
    "mom": "上月比較增減(%)",
    "yoy": "去年同月增減(%)",
}
MOPS_DEFAULT_COLUMNS = {"revenue": 2, "prev": 3, "lastYear": 4, "mom": 5, "yoy": 6}

Log = Callable[[str], None]


# ---- Small helpers -------------------------------------------------------------------------------
def safe_symbol(symbol: str) -> str:
    """File-system safe name; must match src/lib/symbols.ts."""
    return re.sub(r"[^A-Za-z0-9.\-]", "_", symbol)


def load_yaml(path: str):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_json(path: str, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path: str, obj) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")


def write_text_if_changed(path: str, text: str) -> bool:
    """Write text unless the file already holds exactly that; True when the file changed."""
    try:
        with open(path, encoding="utf-8") as f:
            if f.read() == text:
                return False
    except OSError:
        pass
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return True


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds")


def parse_time(value) -> datetime | None:
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def parse_date(value) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def parse_number(value) -> float | None:
    """Number from an API or HTML cell: drops thousands separators, spaces and %; '-' means blank."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    text = re.sub(r"[\s,%]", "", str(value))
    if text in ("", "-", "--", "—", "N/A", "NA", "不適用"):
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def plain_number(value: float):
    """An int when the value is whole (USD facts are), otherwise a float."""
    return int(value) if float(value).is_integer() else round(float(value), 4)


# ---- HTTP ----------------------------------------------------------------------------------------
class HttpError(Exception):
    """A request that failed for good. status is the HTTP code, or 0 for a network error."""

    def __init__(self, url: str, status: int, detail: str = ""):
        message = f"HTTP {status}" if status else "network error"
        super().__init__(f"{url}: {message}" + (f" ({detail})" if detail else ""))
        self.url = url
        self.status = status


def retry_after(headers) -> float | None:
    try:
        value = float((headers or {}).get("Retry-After"))
    except (TypeError, ValueError):
        return None
    return value if value >= 0 else None


class Http:
    """Minimal urllib client: one User-Agent, a minimum gap between requests in the same rate group,
    gzip responses, and retries with exponential backoff on 429, 5xx and network errors. urlopen,
    sleep and clock are injectable for tests."""

    def __init__(
        self,
        user_agent: str,
        gaps: dict[str, float] | None = None,
        attempts: int = 4,
        backoff: float = 2.0,
        timeout: float = 60.0,
        urlopen=None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.user_agent = user_agent
        self.gaps = dict(GAPS if gaps is None else gaps)
        self.attempts = attempts
        self.backoff = backoff
        self.timeout = timeout
        self.urlopen = urlopen or urllib.request.urlopen
        self.sleep = sleep
        self.clock = clock
        self._last: dict[str, float] = {}

    def _wait(self, group: str) -> None:
        gap = self.gaps.get(group, self.gaps.get("default", 0.0))
        last = self._last.get(group)
        if last is not None:
            delay = last + gap - self.clock()
            if delay > 0:
                self.sleep(delay)
        self._last[group] = self.clock()

    def get(self, url: str, headers: dict[str, str] | None = None, group: str | None = None) -> bytes:
        group = group or urllib.parse.urlsplit(url).hostname or "default"
        request_headers = {"User-Agent": self.user_agent, "Accept-Encoding": "gzip", **(headers or {})}
        delay = self.backoff
        error = HttpError(url, 0, "no attempt made")
        for attempt in range(1, self.attempts + 1):
            self._wait(group)
            wait = delay
            try:
                request = urllib.request.Request(url, headers=request_headers)
                with self.urlopen(request, timeout=self.timeout) as response:
                    body = response.read()
                    if (response.headers.get("Content-Encoding") or "").lower() == "gzip":
                        body = gzip.decompress(body)
                    return body
            except urllib.error.HTTPError as exc:
                if exc.code != 429 and exc.code < 500:
                    raise HttpError(url, exc.code) from None
                error = HttpError(url, exc.code)
                wait = retry_after(exc.headers) or delay
            except (OSError, EOFError, zlib.error, http.client.HTTPException) as exc:
                error = HttpError(url, 0, str(exc) or type(exc).__name__)
            if attempt < self.attempts:
                self.sleep(min(wait, 60.0))
                delay *= 2
        raise error


# ---- Universe ------------------------------------------------------------------------------------
class SecTarget(NamedTuple):
    symbol: str
    company: str | None = None


class TwTarget(NamedTuple):
    code: str
    market: str  # "sii" (TWSE listed) or "otc" (TPEx)
    symbol: str
    company: str | None = None


def load_companies(root: str = ROOT) -> list[tuple[str, dict]]:
    """Listed companies as (id, record), in file order (files sorted by name)."""
    out = []
    for path in sorted(glob.glob(os.path.join(root, "content", "companies", "*.yaml"))):
        for cid, rec in (load_yaml(path).get("companies") or {}).items():
            if isinstance(rec, dict) and rec.get("listing") == "listed":
                out.append((str(cid), rec))
    return out


def tickers_of(rec: dict) -> list[dict]:
    return [t for t in rec.get("tickers") or [] if isinstance(t, dict) and t.get("symbol")]


def load_allow_list(root: str = ROOT) -> list[str] | None:
    """Symbols under `sec:` in content/kpis.yaml, or None when the file or the key is absent."""
    path = os.path.join(root, "content", "kpis.yaml")
    if not os.path.exists(path):
        return None
    symbols = load_yaml(path).get("sec")
    if not isinstance(symbols, list):
        return None
    return [str(s).strip() for s in symbols if str(s).strip()]


def load_market_caps(root: str = ROOT) -> dict[str, float]:
    fundamentals = load_json(os.path.join(root, "data", "fundamentals.json"), {})
    caps = {}
    for symbol, rec in (fundamentals.items() if isinstance(fundamentals, dict) else []):
        cap = (rec or {}).get("marketCap") if isinstance(rec, dict) else None
        if isinstance(cap, (int, float)) and not isinstance(cap, bool) and math.isfinite(cap):
            caps[symbol] = float(cap)
    return caps


def sec_universe(
    companies: list[tuple[str, dict]],
    allow: list[str] | None = None,
    market_caps: dict[str, float] | None = None,
    cap: int = SEC_CAP,
) -> list[SecTarget]:
    """US filers to fetch. With an allow-list, exactly those symbols (any 10-K/10-Q filer works).
    Otherwise companies with country US whose first ticker trades on NASDAQ, NYSE or NYSE American,
    ordered core, focus, watch and then by market cap, capped at `cap`."""
    owner = {}
    for cid, rec in companies:
        for t in tickers_of(rec):
            owner.setdefault(str(t["symbol"]), cid)
    if allow is not None:
        seen: set[str] = set()
        out = []
        for symbol in allow:
            if symbol not in seen:
                seen.add(symbol)
                out.append(SecTarget(symbol, owner.get(symbol)))
        return out
    caps = market_caps or {}
    picks = []
    for order, (cid, rec) in enumerate(companies):
        tickers = tickers_of(rec)
        if rec.get("country") != "US" or not tickers:
            continue
        symbol = str(tickers[0]["symbol"])
        if "." in symbol or str(tickers[0].get("exchange") or "").upper() not in US_EXCHANGES:
            continue
        rank = TIER_ORDER.get(str(rec.get("tier")), len(TIER_ORDER))
        picks.append((rank, -caps.get(symbol, 0.0), order, SecTarget(symbol, cid)))
    picks.sort(key=lambda p: p[:3])
    return [p[3] for p in picks[:cap]]


def sec_cache_symbols(companies: list[tuple[str, dict]], allow: list[str] | None) -> list[str]:
    """Every symbol worth keeping in the ticker -> CIK cache: US-exchange tickers plus the allow-list."""
    out = list(allow or [])
    for _, rec in companies:
        for t in tickers_of(rec):
            symbol = str(t["symbol"])
            if "." not in symbol and str(t.get("exchange") or "").upper() in US_EXCHANGES:
                out.append(symbol)
    return sorted(set(out))


def tw_universe(companies: list[tuple[str, dict]]) -> list[TwTarget]:
    """Every .TW (TWSE) and .TWO (TPEx) ticker, including second listings such as TSMC's 2330.TW."""
    out, seen = [], set()
    for cid, rec in companies:
        for t in tickers_of(rec):
            m = re.fullmatch(r"([0-9A-Z]+)\.(TWO|TW)", str(t["symbol"]))
            if m and m.group(1) not in seen:
                seen.add(m.group(1))
                out.append(TwTarget(m.group(1), "otc" if m.group(2) == "TWO" else "sii", m.group(0), cid))
    return out


def select_only(sec: list[SecTarget], tw: list[TwTarget], only: list[str]) -> tuple[list, list]:
    """Apply --only. Symbols outside the universe are still fetched when their form fits a source
    (a plain US ticker, or a code with .TW/.TWO), as fetch_prices.py does."""
    if not only:
        return sec, tw
    wanted = set(only)
    sec_out = [t for t in sec if t.symbol in wanted]
    tw_out = [t for t in tw if t.symbol in wanted or t.code in wanted]
    known = {t.symbol for t in sec_out} | {t.symbol for t in tw_out} | {t.code for t in tw_out}
    for symbol in only:
        if symbol in known:
            continue
        m = re.fullmatch(r"([0-9A-Z]+)\.(TWO|TW)", symbol)
        if m:
            tw_out.append(TwTarget(m.group(1), "otc" if m.group(2) == "TWO" else "sii", symbol))
        elif re.fullmatch(r"[A-Za-z][A-Za-z0-9\-]*", symbol):
            sec_out.append(SecTarget(symbol))
    return sec_out, tw_out


# ---- SEC company facts -> quarterly series -------------------------------------------------------
class Fact(NamedTuple):
    start: date
    end: date
    val: float
    fy: int | None
    fp: str
    form: str
    filed: str
    accn: str

    @property
    def days(self) -> int:
        return (self.end - self.start).days


@dataclass
class Quarter:
    start: date
    end: date
    value: float
    form: str
    filed: str
    derived: bool
    concept: str = ""
    rank: int = 0  # position of the concept in its priority list
    fy: int | None = None
    fp: str | None = None

    def to_json(self) -> dict:
        return {
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "value": plain_number(self.value),
            "fy": self.fy,
            "fp": self.fp,
            "form": self.form,
            "filed": self.filed,
            "derived": self.derived,
            "concept": self.concept,
        }


def concept_facts(doc: dict, concept: str) -> list[Fact]:
    """USD duration facts for one us-gaap concept, from 10-Q and 10-K filings (and amendments).
    companyfacts already leaves out dimensional (segment) facts."""
    node = ((doc.get("facts") or {}).get("us-gaap") or {}).get(concept) or {}
    out = []
    for f in (node.get("units") or {}).get("USD") or []:
        if not isinstance(f, dict) or f.get("form") not in SEC_FORMS:
            continue
        start, end, val = parse_date(f.get("start")), parse_date(f.get("end")), f.get("val")
        if start is None or end is None or end <= start:
            continue
        if isinstance(val, bool) or not isinstance(val, (int, float)) or not math.isfinite(val):
            continue
        fy = f.get("fy") if isinstance(f.get("fy"), int) and not isinstance(f.get("fy"), bool) else None
        out.append(Fact(start, end, val, fy, str(f.get("fp") or ""), f["form"], str(f.get("filed") or ""),
                        str(f.get("accn") or "")))
    return out


def span_quarters(days: int) -> int | None:
    """Number of quarters a duration covers (1-4), or None when it fits none of them."""
    for n, (low, high) in SPAN_DAYS.items():
        if low <= days <= high:
            return n
    return None


def newer(a: Fact, b: Fact | None) -> bool:
    """True when a was filed after b; on the same day an amendment, then the later accession, wins."""
    if b is None:
        return True
    return (a.filed, a.form.endswith("/A"), a.accn) > (b.filed, b.form.endswith("/A"), b.accn)


def quarterly_series(facts: list[Fact], concept: str = "", rank: int = 0) -> list[Quarter]:
    """Quarterly values from one concept's facts.

    When several filings report the same (start, end), the latest filed wins (restatements). A
    three-month fact is a quarter as it is. Year-to-date facts that share a fiscal-year start S and
    cover 1, 2, 3 and 4 quarters are differenced: Q2 = 6M - 3M, Q3 = 9M - 6M, Q4 = FY - 9M. Cash-flow
    items such as capex are only reported year-to-date, and Q4 revenue only through the annual total.
    A direct three-month fact beats a derived value for the same quarter. Derived values that come
    out negative are dropped: the two facts were not reported on the same basis.
    """
    latest: dict[tuple[date, date], Fact] = {}
    for f in facts:
        if newer(f, latest.get((f.start, f.end))):
            latest[(f.start, f.end)] = f
    direct: dict[date, Fact] = {}
    by_start: dict[date, dict[int, Fact]] = defaultdict(dict)
    for f in latest.values():
        n = span_quarters(f.days)
        if n is None:
            continue
        if n == 1 and newer(f, direct.get(f.end)):
            direct[f.end] = f
        if newer(f, by_start[f.start].get(n)):
            by_start[f.start][n] = f
    quarters: dict[date, Quarter] = {}
    for spans in by_start.values():
        for n in (2, 3, 4):
            longer, shorter = spans.get(n), spans.get(n - 1)
            if longer is None or shorter is None:
                continue  # facts with a different start never pair up
            start = shorter.end + timedelta(days=1)
            value = longer.val - shorter.val
            if span_quarters((longer.end - start).days) != 1 or value < 0:
                continue
            source = longer if newer(longer, shorter) else shorter
            quarters[longer.end] = Quarter(
                start, longer.end, value, source.form, source.filed, True, concept, rank)
    for end, f in direct.items():
        quarters[end] = Quarter(f.start, f.end, f.val, f.form, f.filed, False, concept, rank)
    return sorted(quarters.values(), key=lambda q: q.end)


def drop_overlaps(quarters: list[Quarter]) -> list[Quarter]:
    """Keep one of two quarters that overlap by more than two weeks (inconsistent tagging): the
    higher-priority concept, then a direct fact over a derived value, then the later filing."""
    kept: list[Quarter] = []
    for q in sorted(quarters, key=lambda q: q.end):
        if kept and (kept[-1].end - q.start).days >= 14:
            prev = kept[-1]
            if (-q.rank, not q.derived, q.filed) > (-prev.rank, not prev.derived, prev.filed):
                kept[-1] = q
            continue
        kept.append(q)
    return kept


def period_labels(facts: list[Fact]) -> dict[date, tuple[int, int]]:
    """Fiscal year and quarter number by period end date.

    fy and fp in companyfacts describe the filing, not the fact: the prior-year comparative in a
    10-Q carries the newer filing's fy. So each period takes its label from the earliest filing whose
    own period ends on that date (the latest end date among the filing's facts); fp FY becomes Q4.
    """
    period_end: dict[str, date] = {}
    for f in facts:
        if f.accn and (f.accn not in period_end or f.end > period_end[f.accn]):
            period_end[f.accn] = f.end
    first: dict[date, Fact] = {}
    for f in facts:
        if f.fy is None or f.fp not in FP_QUARTER or period_end.get(f.accn) != f.end:
            continue
        if f.end not in first or f.filed < first[f.end].filed:
            first[f.end] = f
    return {end: (f.fy, FP_QUARTER[f.fp]) for end, f in first.items()}


def apply_labels(quarters: list[Quarter], labels: dict[date, tuple[int, int]]) -> None:
    """Set fy/fp from the filing labels. A quarter seen only as a comparative (for example before an
    IPO) counts quarters from the nearest labelled one."""
    known = []
    for q in quarters:
        if q.end in labels:
            fy, n = labels[q.end]
            q.fy, q.fp = fy, f"Q{n}"
            known.append((q.end, fy, n))
    if not known:
        return
    for q in quarters:
        if q.fy is not None:
            continue
        end, fy, n = min(known, key=lambda k: abs((k[0] - q.end).days))
        index = fy * 4 + (n - 1) - round((end - q.end).days / 91.3125)
        q.fy, q.fp = index // 4, f"Q{index % 4 + 1}"


def merged_series(facts_by_concept: dict[str, list[Fact]], concepts, labels) -> list[Quarter]:
    """One quarterly series from concepts in priority order (first concept with a quarter wins)."""
    by_end: dict[date, Quarter] = {}
    for rank, concept in enumerate(concepts):
        for q in quarterly_series(facts_by_concept.get(concept) or [], concept, rank):
            by_end.setdefault(q.end, q)
    quarters = drop_overlaps(list(by_end.values()))
    apply_labels(quarters, labels)
    return quarters[-MAX_QUARTERS:]


def build_sec_doc(doc: dict, symbol: str, cik: int, company: str | None, now: datetime) -> dict | None:
    """The data/kpis/sec file for one company, or None when it has neither series."""
    facts = {c: concept_facts(doc, c) for c in REVENUE_CONCEPTS + CAPEX_CONCEPTS}
    labels = period_labels([f for fs in facts.values() for f in fs])
    revenue = [q.to_json() for q in merged_series(facts, REVENUE_CONCEPTS, labels)]
    capex = [q.to_json() for q in merged_series(facts, CAPEX_CONCEPTS, labels)]
    if not revenue and not capex:
        return None
    out = {"symbol": symbol, "cik": f"{int(cik):010d}", "name": str(doc.get("entityName") or "")}
    if company:
        out["company"] = company
    out.update({"updatedAt": iso(now), "revenue": revenue, "capex": capex})
    return out


def dump_sec_doc(doc: dict) -> str:
    """JSON with one quarter per line, so a new quarter shows up as one added line in git."""
    keys = list(doc)
    lines = ["{"]
    for i, key in enumerate(keys):
        comma = "," if i < len(keys) - 1 else ""
        value = doc[key]
        if isinstance(value, list) and value:
            lines.append(f" {json.dumps(key)}: [")
            for j, item in enumerate(value):
                last = j == len(value) - 1
                lines.append(f"  {json.dumps(item, ensure_ascii=False)}" + ("" if last else ","))
            lines.append(f" ]{comma}")
        else:
            lines.append(f" {json.dumps(key)}: {json.dumps(value, ensure_ascii=False)}{comma}")
    return "\n".join(lines + ["}"]) + "\n"


def write_sec_doc(path: str, doc: dict) -> bool:
    """Write unless only updatedAt would change; True when the file changed."""
    old = load_json(path, None)
    if isinstance(old, dict):
        strip = lambda d: {k: v for k, v in d.items() if k != "updatedAt"}  # noqa: E731
        if strip(old) == strip(doc):
            return False
    return write_text_if_changed(path, dump_sec_doc(doc))


def ticker_key(symbol: str) -> str:
    """SEC ticker spelling: upper case, class shares with a dash (BRK-B)."""
    return symbol.strip().upper().replace(".", "-")


def parse_company_tickers(payload) -> dict[str, dict]:
    """company_tickers.json ({"0": {"cik_str", "ticker", "title"}, ...}) -> {TICKER: {cik, name}}."""
    rows = payload.values() if isinstance(payload, dict) else payload if isinstance(payload, list) else []
    out: dict[str, dict] = {}
    for r in rows:
        if not isinstance(r, dict) or not r.get("ticker"):
            continue
        try:
            cik = int(r.get("cik_str"))
        except (TypeError, ValueError):
            continue
        out.setdefault(ticker_key(str(r["ticker"])), {"cik": cik, "name": str(r.get("title") or "")})
    return out


def load_ticker_map(http: Http, path: str, now: datetime, keep: list[str], log: Log) -> dict[str, dict]:
    """Ticker -> CIK from the cache, refreshed from sec.gov weekly, or after a day when a wanted
    symbol is missing. Only the symbols in `keep` are stored."""
    cache = load_json(path, {})
    cache = cache if isinstance(cache, dict) else {}
    tickers = cache.get("tickers") if isinstance(cache.get("tickers"), dict) else {}
    # The cache lives in git, so keep only entries with an integer CIK.
    tickers = {k: v for k, v in tickers.items() if isinstance(v, dict) and type(v.get("cik")) is int}
    fetched = parse_time(cache.get("fetchedAt"))
    age = now - fetched if fetched else None
    keys = sorted({ticker_key(s) for s in keep})
    missing = [k for k in keys if k not in tickers]
    if age is None or age > TICKERS_MAX_AGE or (missing and age > TICKERS_RETRY_AGE):
        try:
            full = parse_company_tickers(json.loads(http.get(SEC_TICKERS_URL, group="sec")))
            if not full:
                raise ValueError("the ticker list is empty")
            tickers = {k: full[k] for k in keys if k in full}
            save_json(path, {"fetchedAt": iso(now), "source": SEC_TICKERS_URL, "tickers": tickers})
            log(f"  SEC ticker list refreshed: {len(tickers)} of {len(keys)} symbols mapped")
        except (HttpError, ValueError) as exc:
            hint = " The SEC may want SEC_USER_AGENT set to '<name> <contact email>'." \
                if getattr(exc, "status", 0) == 403 else ""
            log(f"  ! SEC ticker list refresh failed ({exc}); using the cached copy.{hint}")
    return tickers


def run_sec(
    targets: list[SecTarget],
    http: Http,
    out_dir: str,
    now: datetime,
    keep: list[str] | None = None,
    log: Log = print,
) -> tuple[dict, bool]:
    """Fetch company facts for each target and write data/kpis/sec/<SAFE>.json.
    Returns (status, healthy); healthy is False when there were targets and none succeeded."""
    sec_dir = os.path.join(out_dir, "sec")
    log(f"SEC: {len(targets)} companies")
    keep_symbols = sorted({t.symbol for t in targets} | set(keep or []))
    tickers_path = os.path.join(sec_dir, "_tickers.json")
    tickers = load_ticker_map(http, tickers_path, now, keep_symbols, log) if targets else {}
    ok, changed, failed, skipped = 0, 0, [], []
    forbidden = 0
    for i, target in enumerate(targets):
        if (i + 1) % 20 == 0:
            log(f"  sec {i + 1}/{len(targets)}")
        entry = tickers.get(ticker_key(target.symbol))
        if not entry:
            skipped.append(target.symbol)
            log(f"  {target.symbol}: not in the SEC ticker list")
            continue
        try:
            doc = json.loads(http.get(SEC_FACTS_URL.format(cik=f"{int(entry['cik']):010d}"), group="sec"))
            if not isinstance(doc, dict):
                raise ValueError("company facts are not a JSON object")
        except HttpError as exc:
            if exc.status == 404:  # no XBRL financial data for this CIK
                skipped.append(target.symbol)
                log(f"  {target.symbol}: no company facts (404)")
                continue
            failed.append(target.symbol)
            log(f"  ! {target.symbol}: {exc}")
            forbidden = forbidden + 1 if exc.status == 403 else 0
            if forbidden >= SEC_MAX_FORBIDDEN:
                failed.extend(t.symbol for t in targets[i + 1 :])
                log("  ! the SEC refused several requests in a row (HTTP 403); stopping. Set "
                    "SEC_USER_AGENT to '<name> <contact email>' (for example as a repository variable).")
                break
            continue
        except ValueError as exc:
            failed.append(target.symbol)
            log(f"  ! {target.symbol}: unreadable company facts ({exc})")
            continue
        forbidden = 0
        try:
            out = build_sec_doc(doc, target.symbol, entry["cik"], target.company, now)
        except Exception as exc:  # malformed facts must not stop the run
            failed.append(target.symbol)
            log(f"  ! {target.symbol}: could not build series ({type(exc).__name__}: {exc})")
            continue
        if out is None:
            skipped.append(target.symbol)
            log(f"  {target.symbol}: no quarterly revenue or capex facts")
            continue
        ok += 1
        if write_sec_doc(os.path.join(sec_dir, safe_symbol(target.symbol) + ".json"), out):
            changed += 1
    log(f"  sec done: {ok} ok ({changed} changed), {len(failed)} failed, {len(skipped)} skipped")
    status = {"targets": len(targets), "ok": ok, "failed": sorted(failed), "skipped": len(skipped)}
    return status, ok > 0 or not targets


# ---- Taiwan monthly revenue ----------------------------------------------------------------------
def month_index(month: str) -> int:
    return int(month[:4]) * 12 + int(month[5:7]) - 1


def month_add(month: str, delta: int) -> str:
    i = month_index(month) + delta
    return f"{i // 12:04d}-{i % 12 + 1:02d}"


def roc_to_month(value) -> str | None:
    """ROC year-month (資料年月) to YYYY-MM: 11509 -> 2026-09 (ROC year + 1911). Also accepts
    115/09, 115年9月 and a Gregorian 202609."""
    text = str(value if value is not None else "").strip()
    m = re.fullmatch(r"(\d{2,3})\D+(\d{1,2})\D*", text)
    if m:
        year, month = int(m.group(1)) + 1911, int(m.group(2))
    else:
        digits = re.sub(r"\D", "", text)
        if len(digits) == 6 and digits[:2] in ("19", "20"):
            year, month = int(digits[:4]), int(digits[4:])
        elif len(digits) in (4, 5):
            year, month = int(digits[:-2]) + 1911, int(digits[-2:])
        else:
            return None
    return f"{year:04d}-{month:02d}" if 1 <= month <= 12 and year > 1911 else None


def month_to_roc(month: str) -> tuple[int, int]:
    """YYYY-MM -> (ROC year, month): 2026-09 -> (115, 9)."""
    return int(month[:4]) - 1911, int(month[5:7])


def expected_latest_month(now: datetime) -> str:
    """Latest month every company should have reported: revenue is due by the 10th of the next month
    (Taipei time)."""
    taipei = now.astimezone(timezone(timedelta(hours=8)))
    current = f"{taipei.year:04d}-{taipei.month:02d}"
    return month_add(current, -1 if taipei.day > 10 else -2)


def pct_change(value: float | None, base: float | None) -> float | None:
    if value is None or not base or base <= 0:
        return None
    return (value / base - 1) * 100


def revenue_row(month, revenue, prev=None, last_year=None, yoy=None, mom=None) -> dict:
    """One month of revenue; a change the source left blank is computed from its own figures."""
    return {
        "month": month,
        "revenue": int(round(revenue)),
        "yoy": yoy if yoy is not None else pct_change(revenue, last_year),
        "mom": mom if mom is not None else pct_change(revenue, prev),
    }


def norm_key(key) -> str:
    return re.sub(r"\s+", "", str(key)).replace("（", "(").replace("）", ")")


def pick_key(keys: list[str], include, exclude=()) -> str | None:
    for key in keys:
        k = norm_key(key)
        if all(s in k for s in include) and not any(s in k for s in exclude):
            return key
    return None


def parse_openapi_rows(payload) -> dict[str, dict]:
    """Rows of a TWSE/TPEx monthly revenue feed keyed by company code (latest month per code).
    Raises ValueError, naming the keys it saw, when the layout is not recognized."""
    if not isinstance(payload, list) or not payload:
        raise ValueError(f"expected a non-empty JSON array, got {type(payload).__name__}")
    keys: list[str] = []
    for row in payload[:50]:
        for key in row if isinstance(row, dict) else []:
            if key not in keys:
                keys.append(key)
    cols = {}
    for field, options in OPENAPI_FIELDS.items():
        for include, exclude in options:
            key = pick_key(keys, include, exclude)
            if key:
                cols[field] = key
                break
    missing = [f for f in ("month", "code", "revenue") if f not in cols]
    if missing:
        raise ValueError(f"no {'/'.join(missing)} column; keys seen: {', '.join(map(str, keys))}")
    get = lambda row, field: parse_number(row.get(cols[field])) if field in cols else None  # noqa: E731
    out: dict[str, dict] = {}
    for row in payload:
        if not isinstance(row, dict):
            continue
        code = str(row.get(cols["code"]) or "").strip()
        month = roc_to_month(row.get(cols["month"]))
        revenue = get(row, "revenue")
        if not code or not month or revenue is None:
            continue
        if code in out and out[code]["month"] >= month:
            continue
        out[code] = revenue_row(month, revenue, get(row, "prev"), get(row, "lastYear"), get(row, "yoy"),
                                get(row, "mom"))
    if not out:
        raise ValueError(f"no usable rows; keys seen: {', '.join(map(str, keys))}")
    return out


class TableRows(HTMLParser):
    """Text of every table row as a list of cell strings. Copes with nested tables and with <td> and
    <tr> tags left unclosed, as in the MOPS pages."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._tables: list[dict] = []  # per open table: the current row and cell

    def _table(self) -> dict:
        if not self._tables:
            self._tables.append({"row": None, "cell": None})
        return self._tables[-1]

    @staticmethod
    def _close_cell(t: dict) -> None:
        if t["cell"] is not None:
            t["row"] = (t["row"] or []) + [" ".join("".join(t["cell"]).split())]
            t["cell"] = None

    def _close_row(self, t: dict) -> None:
        self._close_cell(t)
        if t["row"]:
            self.rows.append(t["row"])
        t["row"] = None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._tables.append({"row": None, "cell": None})
        elif tag == "tr":
            t = self._table()
            self._close_row(t)
            t["row"] = []
        elif tag in ("td", "th"):
            t = self._table()
            self._close_cell(t)
            t["cell"] = []

    def handle_endtag(self, tag):
        if tag == "table":
            if self._tables:
                self._close_row(self._tables.pop())
        elif tag == "tr":
            self._close_row(self._table())
        elif tag in ("td", "th"):
            self._close_cell(self._table())

    def handle_data(self, data):
        if self._tables and self._tables[-1]["cell"] is not None:
            self._tables[-1]["cell"].append(data)

    def close(self):
        super().close()
        while self._tables:
            self._close_row(self._tables.pop())


def decode_html(raw: bytes) -> str:
    """Decode a MOPS page: the declared charset (Big5 pages decode as cp950, its superset), else
    UTF-8, else cp950."""
    head = raw[:4096].decode("ascii", "ignore").lower()
    m = re.search(r"charset\s*=\s*['\"]?([a-z0-9_\-]+)", head)
    charset = m.group(1) if m else ""
    if charset in ("big5", "big-5", "x-big5", "cp950", "ms950", "big5-hkscs"):
        charset = "cp950"
    if charset:
        try:
            return raw.decode(charset, errors="replace")
        except LookupError:
            pass
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp950", errors="replace")


def parse_mops_html(text: str, month: str) -> dict[str, dict]:
    """Rows of a MOPS monthly summary page (t21sc03) keyed by company code. Each industry has its own
    table with the columns 公司代號, 公司名稱, 當月營收, 上月營收, 去年當月營收, 上月比較增減(%),
    去年同月增減(%), then cumulative figures; 合計 (total) rows have no code and are skipped."""
    parser = TableRows()
    parser.feed(text)
    parser.close()
    cols = dict(MOPS_DEFAULT_COLUMNS)
    out: dict[str, dict] = {}
    for cells in parser.rows:
        flat = [norm_key(c) for c in cells]
        if MOPS_COLUMNS["revenue"] in flat:
            # Header row. In the usual two-row header the second row starts at 當月營收 (the code and
            # name headers span both rows); a one-row header starts at 公司代號.
            base = 0 if any("代號" in c for c in flat) else 2
            for field, label in MOPS_COLUMNS.items():
                if label in flat:
                    cols[field] = base + flat.index(label)
            continue
        if len(cells) < 3 or not CODE_RE.fullmatch(flat[0]):
            continue
        values = {f: parse_number(cells[i]) if i < len(cells) else None for f, i in cols.items()}
        if values["revenue"] is not None:
            out[flat[0]] = revenue_row(month, values["revenue"], values["prev"], values["lastYear"],
                                       values["yoy"], values["mom"])
    return out


def mops_url(host: str, market: str, month: str, kind: int) -> str:
    roc_year, mm = month_to_roc(month)
    return f"{host}/nas/t21/{market}/t21sc03_{roc_year}_{mm}_{kind}.html"


def fetch_mops_month(http: Http, hosts: list[str], market: str, month: str, kind: int) -> dict[str, dict]:
    """Rows of one MOPS summary page (kind 0 domestic, 1 foreign issuers). Tries each host; the one
    that answers moves to the front of `hosts`. Raises HttpError, or ValueError when a page loads but
    has no revenue rows (layout change, or a block page)."""
    errors: list[Exception] = []
    for host in list(hosts):
        url = mops_url(host, market, month, kind)
        try:
            raw = http.get(url, headers={**MOPS_HEADERS, "Accept": "text/html"}, group="mops")
        except HttpError as exc:
            errors.append(exc)
            continue
        rows = parse_mops_html(decode_html(raw), month)
        if rows:
            hosts.remove(host)
            hosts.insert(0, host)
            return rows
        errors.append(ValueError(f"{url}: no revenue rows in {len(raw)} bytes"))
    # A 404 from every host means the page does not exist; otherwise report the first real problem.
    real = [e for e in errors if not (isinstance(e, HttpError) and e.status == 404)]
    raise (real or errors or [ValueError("no MOPS hosts")])[0]


def merge_row(old: dict | None, new: dict) -> dict:
    """New data wins. A change the new row leaves blank keeps the stored one if revenue is unchanged."""
    fields = ("revenue", "yoy", "mom")
    if old and old.get("revenue") == new.get("revenue"):
        return {k: new.get(k) if new.get(k) is not None else old.get(k) for k in fields}
    return {k: new.get(k) for k in fields}


def fill_changes(rows: dict[str, dict]) -> None:
    """Compute yoy/mom still blank from the stored months 12 and 1 back."""
    for month, row in rows.items():
        for field, back in (("yoy", 12), ("mom", 1)):
            base = rows.get(month_add(month, -back)) or {}
            if row.get(field) is None:
                row[field] = pct_change(row.get("revenue"), base.get("revenue"))


def read_tw_csv(path: str) -> dict[str, dict]:
    rows: dict[str, dict] = {}
    try:
        with open(path, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                month = (r.get("month") or "").strip()
                revenue = parse_number(r.get("revenue"))
                if MONTH_RE.fullmatch(month) and revenue is not None:
                    rows[month] = {"revenue": int(round(revenue)), "yoy": parse_number(r.get("yoy")),
                                   "mom": parse_number(r.get("mom"))}
    except OSError:
        pass
    return rows


def fmt_pct(value: float | None) -> str:
    if value is None or not math.isfinite(value):
        return ""
    text = f"{value:.2f}"
    return "0.00" if text == "-0.00" else text


def format_tw_csv(rows: dict[str, dict]) -> str:
    lines = [TW_CSV_HEADER]
    for month in sorted(rows):
        r = rows[month]
        lines.append(f"{month},{int(r['revenue'])},{fmt_pct(r.get('yoy'))},{fmt_pct(r.get('mom'))}")
    return "\n".join(lines) + "\n"


def run_tw(
    targets: list[TwTarget],
    http: Http,
    out_dir: str,
    now: datetime,
    backfill_months: int = 36,
    log: Log = print,
) -> tuple[dict, bool]:
    """Latest month from the TWSE and TPEx OpenAPI feeds, then backfill of months missing locally
    from MOPS, then data/kpis/tw/<code>.csv. Returns (status, healthy); healthy is False when there
    were targets and every request failed."""
    tw_dir = os.path.join(out_dir, "tw")
    log(f"Taiwan: {len(targets)} companies")
    series = {t.code: read_tw_csv(os.path.join(tw_dir, f"{t.code}.csv")) for t in targets}
    absent_path = os.path.join(tw_dir, "_absent.json")
    stored = load_json(absent_path, {})
    stored = stored if isinstance(stored, dict) else {}
    absent = {str(code): set(months) for code, months in stored.items() if isinstance(months, list)}
    absent_before = {k: set(v) for k, v in absent.items()}
    successes = 0

    # 1. Latest month for every company in each market.
    latest: dict[str, dict] = {}
    for market, url in (("sii", TWSE_REVENUE_URL), ("otc", TPEX_REVENUE_URL)):
        codes = [t.code for t in targets if t.market == market]
        if not codes:
            continue
        try:
            payload = json.loads(http.get(url, headers={"Accept": "application/json"}).decode("utf-8-sig"))
            rows = parse_openapi_rows(payload)
        except (HttpError, ValueError) as exc:
            log(f"  ! {market} OpenAPI feed failed: {exc}")
            continue
        successes += 1
        found = {c: rows[c] for c in codes if c in rows}
        latest.update(found)
        log(f"  {market} feed: {len(rows)} companies, {len(found)} of ours")
    for code, row in latest.items():
        series[code][row["month"]] = merge_row(series[code].get(row["month"]), row)
    latest_month = max((r["month"] for r in latest.values()), default=None)

    # 2. Backfill months missing locally, newest first. Each market stops after MOPS_MAX_FAILURES
    # failed pages in a row, so a broken OTC archive does not cost a request per month every run.
    end_month = latest_month or expected_latest_month(now)
    settled = month_add(end_month, -2)  # older months are final: a code missing there is absent
    hosts = list(MOPS_HOSTS)
    backfilled = 0
    failures = {"sii": 0, "otc": 0}
    for k in range(max(0, backfill_months)):
        month = month_add(end_month, -k)
        for market in ("sii", "otc"):
            wanted = [t.code for t in targets if t.market == market
                      and month not in series[t.code] and month not in absent.get(t.code, set())]
            if not wanted or failures[market] >= MOPS_MAX_FAILURES:
                continue
            try:
                rows = fetch_mops_month(http, hosts, market, month, 0)
            except (HttpError, ValueError) as exc:
                failures[market] += 1
                log(f"  ! MOPS {market} {month}: {exc}")
                if failures[market] >= MOPS_MAX_FAILURES:
                    log(f"  ! {MOPS_MAX_FAILURES} {market} pages failed in a row; "
                        "its backfill stops for this run")
                continue
            failures[market] = 0
            successes += 1
            full_page = len(rows) >= MOPS_MIN_ROWS
            foreign_checked = True
            if any(c not in rows for c in wanted):
                # Foreign issuers (-KY companies such as Alchip) are listed on a separate page.
                try:
                    rows = {**fetch_mops_month(http, hosts, market, month, 1), **rows}
                    successes += 1
                except HttpError as exc:
                    foreign_checked = exc.status == 404  # no such page: nothing more to look at
                except ValueError:
                    foreign_checked = False  # an empty page may be a block page; look again next run
            for code in wanted:
                if code in rows:
                    series[code][month] = merge_row(None, rows[code])
                    backfilled += 1
                elif foreign_checked and full_page and month <= settled:
                    absent.setdefault(code, set()).add(month)

    # 3. Write the CSVs.
    changed = 0
    for t in targets:
        if not series[t.code]:
            continue
        fill_changes(series[t.code])
        changed += write_text_if_changed(os.path.join(tw_dir, f"{t.code}.csv"), format_tw_csv(series[t.code]))
    if absent != absent_before:
        save_json(absent_path, {k: sorted(v) for k, v in sorted(absent.items()) if v})

    reported = latest_month or max((m for rows in series.values() for m in rows), default=None)
    ok = [t.code for t in targets if reported and reported in series[t.code]]
    log(f"  tw done: latest month {reported}, {len(ok)} up to date, {backfilled} months backfilled, "
        f"{changed} files changed")
    status = {
        "targets": len(targets),
        "latestMonth": reported,
        "ok": len(ok),
        "failed": sorted(t.code for t in targets if t.code not in ok),
        "backfilled": backfilled,
    }
    return status, successes > 0 or not targets


# ---- Main ----------------------------------------------------------------------------------------
def run_guarded(name: str, fn: Callable[[], tuple[dict, bool]], log: Log) -> tuple[dict, bool]:
    """Run one source; an unexpected error is logged and recorded instead of ending the script."""
    try:
        return fn()
    except Exception as exc:  # keep the other source and status.json going
        traceback.print_exc()
        log(f"  ! {name} stopped: {type(exc).__name__}: {exc}")
        return {"error": f"{type(exc).__name__}: {exc}"}, False


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Fetch SEC quarterly revenue/capex and Taiwan monthly revenue into data/kpis/.")
    ap.add_argument("--sec", action="store_true",
                    help="SEC XBRL quarterly revenue and capex (default: both sources)")
    ap.add_argument("--tw", action="store_true", help="Taiwan monthly revenue from TWSE, TPEx and MOPS")
    ap.add_argument("--tw-backfill-months", type=int, default=36, metavar="N",
                    help="months of Taiwan history to backfill from MOPS when missing locally (0 = none)")
    ap.add_argument("--only", default="", help="comma-separated symbols or Taiwan codes")
    ap.add_argument("--require-sec-agent", action="store_true",
                    help="skip the SEC part unless SEC_USER_AGENT is set (the SEC refuses clients without a contact)")
    ap.add_argument("--sec-every-hours", type=float, default=0, metavar="H",
                    help="skip the SEC part if it ran less than H hours ago (0 = always run)")
    args = ap.parse_args(argv)
    do_sec = args.sec or not args.tw
    do_tw = args.tw or not args.sec

    started = time.time()
    now = datetime.now(timezone.utc).replace(microsecond=0)
    companies = load_companies(ROOT)
    allow = load_allow_list(ROOT)
    only = [s.strip() for s in args.only.split(",") if s.strip()]
    sec_targets, tw_targets = select_only(
        sec_universe(companies, allow, load_market_caps(ROOT)), tw_universe(companies), only)
    if only:  # a source with nothing selected keeps its previous status
        do_sec, do_tw = do_sec and bool(sec_targets), do_tw and bool(tw_targets)
        if not (do_sec or do_tw):
            print(f"--only {args.only}: no matching SEC or Taiwan symbols", file=sys.stderr)
            return 1

    status_path = os.path.join(KPIS, "status.json")
    status = load_json(status_path, {})
    status = status if isinstance(status, dict) else {}
    health = []
    prev_sec = status.get("sec") if isinstance(status.get("sec"), dict) else {}
    last_sec = None if prev_sec.get("skipped") else parse_time(prev_sec.get("at"))  # a skipped run does not count
    if do_sec and args.require_sec_agent and not os.environ.get("SEC_USER_AGENT"):
        print("SEC: skipped; set the repository variable SEC_USER_AGENT to '<name> <contact email>'")
        status["sec"] = {"skipped": "needs SEC_USER_AGENT", "at": iso(now)}
        do_sec = False
    if do_sec and not only and args.sec_every_hours > 0 and last_sec and now - last_sec < timedelta(hours=args.sec_every_hours):
        print(f"SEC: last run {iso(last_sec)}, less than {args.sec_every_hours:g} hours ago; skipped")
        do_sec = False
    if do_sec:
        http = Http(os.environ.get("SEC_USER_AGENT") or SEC_USER_AGENT)
        keep = sec_cache_symbols(companies, allow)
        status["sec"], healthy = run_guarded(
            "SEC", lambda: run_sec(sec_targets, http, KPIS, now, keep), print)
        status["sec"]["at"] = iso(now)
        health.append(healthy)
    if do_tw:
        http = Http(os.environ.get("TW_USER_AGENT") or TW_USER_AGENT)
        status["tw"], healthy = run_guarded(
            "Taiwan", lambda: run_tw(tw_targets, http, KPIS, now, args.tw_backfill_months), print)
        health.append(healthy)
    status["updatedAt"] = iso(now)
    status["seconds"] = round(time.time() - started, 1)
    save_json(status_path, status)
    print(json.dumps(status, indent=2, ensure_ascii=False))
    return 0 if any(health) or not health else 1


if __name__ == "__main__":
    sys.exit(main())
