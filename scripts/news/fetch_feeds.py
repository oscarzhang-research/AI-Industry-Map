#!/usr/bin/env python3
"""Collect news candidates from RSS/Atom feeds for the AI Industry Map.

Runs in GitHub Actions every two hours (see .github/workflows/news-feed.yml). Reads the feeds in
content/news-sources.yaml, keeps entries published in the last few days, tags each entry with the
site's company ids (content/companies/*.yaml) and layers, and for primary sources (excerpt: true)
keeps the opening text of the linked page. For SEC EDGAR 8-K/6-K feeds the excerpt comes from the
filing's EX-99.1 press-release exhibit. A Claude routine reads the result each morning to pick and
verify news items; nothing here is shown on the site.

Writes, under --out:
  news-candidates.json   {"generatedAt", "days", "sources", "items": [...]}  newest first, at most 500
  sources-status.json    {source_id: {"ok", "status", "entries", "kept", "at"}}
  README.md              what the machine-written feeds branch is

--previous merges an earlier news-candidates.json: its items stay while they are inside the window,
so a source that is down for one run keeps its items, and each page is fetched for an excerpt once.

Usage:
  python scripts/news/fetch_feeds.py --out out --previous /tmp/prev.json
  python scripts/news/fetch_feeds.py --out /tmp/feeds --only nvidia-newsroom,sec-nvda-8k --no-excerpts

Standard library plus PyYAML only. SEC_USER_AGENT in the environment overrides the User-Agent sent to
sec.gov (SEC asks automated clients to identify themselves).
"""
from __future__ import annotations

import argparse
import concurrent.futures
import email.utils
import glob
import gzip
import hashlib
import html.entities
import http.client
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit

import yaml

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SOURCES_FILE = os.path.join(ROOT, "content", "news-sources.yaml")
COMPANIES_GLOB = os.path.join(ROOT, "content", "companies", "*.yaml")

KINDS = ("company", "regulator", "filing", "media")

USER_AGENT = "AI-Industry-Map-feeds/1.0 (+https://github.com/oscarzhang-research/AI-Industry-Map)"
SEC_USER_AGENT = (
    os.environ.get("SEC_USER_AGENT")
    or "AI Industry Map research site github.com/oscarzhang-research/AI-Industry-Map"
)
TIMEOUT = 20            # seconds per request
RETRY_DELAY = 3         # seconds before the single retry
MAX_BYTES = 10_000_000  # larger responses are cut off
WORKERS = 8             # concurrent requests overall
PER_HOST = 2            # concurrent requests per host
SEC_INTERVAL = 0.2      # seconds between sec.gov requests: at most 5 per second

DEFAULT_DAYS = 4
MAX_ITEMS = 500
MAX_EXCERPT_FETCHES = 80     # pages (or SEC filings) opened per run, newest items first
HOST_FAILURE_LIMIT = 3       # after this many failed excerpt fetches from one host, skip it this run
SUMMARY_CHARS = 600
EXCERPT_CHARS = 1500
SEC_EXCERPT_CHARS = 2000
FEED_BODY_MIN = 500          # a feed entry with this much body text is its own excerpt (no page fetch)

# ---- Layer keywords ---------------------------------------------------------------------------------
# Matched case-insensitively on word boundaries in an entry's title and summary (and the excerpt for
# primary sources). A plural "s"/"es" is accepted after each keyword; spaces and hyphens inside a phrase
# are interchangeable. Media entries are kept only if they hit a keyword or a company. The lists stay
# specific on purpose: bare "switch", "assistant" or "rack" would match everyday prose.
LAYER_KEYWORDS: dict[str, list[str]] = {
    "energy": [
        "nuclear", "reactor", "smr", "uranium", "power purchase agreement", "ppa", "gigawatt",
        "megawatt", "grid", "power transmission", "transmission line", "transformer", "substation",
        "utility", "utilities", "natural gas", "gas turbine", "power plant", "battery storage",
        "energy storage", "fuel cell", "geothermal", "electricity", "ferc", "pjm", "ercot",
        "nuclear regulatory commission",
    ],
    "chips": [
        "semiconductor", "chip", "chipmaker", "chipmaking", "gpu", "asic", "tpu", "npu", "cpu",
        "ai accelerator", "hbm", "dram", "nand", "memory chip", "foundry", "foundries", "wafer", "fab",
        "lithography", "euv", "advanced packaging", "cowos", "export control",
    ],
    "infrastructure": [
        "data center", "data centre", "datacenter", "datacentre", "hyperscale", "hyperscaler",
        "colocation", "liquid cooling", "server", "server rack", "rack-scale", "optical", "transceiver",
        "network switch", "ethernet switch", "infiniband", "interconnect", "networking", "neocloud",
        "gpu cloud", "ai factory", "ai factories", "supercomputer",
    ],
    "models": [
        "large language model", "language model", "llm", "foundation model", "frontier model",
        "open-weight", "open-source model", "reasoning model", "ai model", "inference", "training run",
        "pretraining", "pre-training", "fine-tuning", "multimodal", "superintelligence", "agi",
    ],
    "applications": [
        "ai agent", "agentic", "copilot", "chatbot", "ai assistant", "voice assistant",
        "coding assistant", "coding agent", "enterprise ai", "ai software", "robotaxi", "humanoid",
        "self-driving", "autonomous driving", "robotics", "smart glasses",
    ],
}
# Regular expressions used next to the keywords: "1.2 GW" and "300MW" are power capacity; "HBM4",
# "LPDDR5X" and "2nm" are memory generations and process nodes.
LAYER_PATTERNS: dict[str, list[str]] = {
    "energy": [r"\d+(?:\.\d+)?\s?(?:gw|mw)"],
    "chips": [r"hbm\d[a-z]?", r"(?:lp|g)?ddr\d[a-z]?", r"\d{1,2}\s?nm"],
}
# Phrases blanked out before keyword matching so they do not count ("blue-chip stocks" is not
# chips news, a "transformer model" is not grid equipment).
IGNORED_PHRASES = [
    r"blue[\s-]+chips?", r"chips?\s+in", r"chipped\s+in", r"(?:bargaining|poker|potato|chocolate)\s+chips?",
    r"transformers?[\s-]+(?:model|architecture|based|library)s?", r"(?:vision|diffusion)\s+transformers?",
    r"assistant\s+(?:secretary|professor|director|attorney|general)",
]


def _phrase(text: str) -> str:
    """Regex for a phrase: escaped words joined by any run of spaces or hyphens."""
    return r"[\s\-]+".join(re.escape(p) for p in re.split(r"[\s\-]+", text.strip()))


def _keyword_regex(words: list[str], patterns: list[str]) -> re.Pattern:
    parts = [_phrase(w) + r"(?:s|es)?" for w in sorted(words, key=len, reverse=True)] + patterns
    return re.compile(r"(?<!\w)(?:" + "|".join(parts) + r")(?!\w)", re.IGNORECASE)


_LAYER_RES = {layer: _keyword_regex(words, LAYER_PATTERNS.get(layer, [])) for layer, words in LAYER_KEYWORDS.items()}
_IGNORED_RE = re.compile(r"(?<!\w)(?:" + "|".join(IGNORED_PHRASES) + r")(?!\w)", re.IGNORECASE)


def keyword_layers(text: str) -> set[str]:
    """Layers whose keywords occur in the text."""
    text = _IGNORED_RE.sub(" ", text or "")
    return {layer for layer, rx in _LAYER_RES.items() if rx.search(text)}


# ---- Text helpers -----------------------------------------------------------------------------------
_WS = re.compile(r"\s+")


def collapse(text: str) -> str:
    return _WS.sub(" ", (text or "").replace("\u200b", "").replace("\ufeff", "")).strip()


def clip(text: str, limit: int) -> str:
    """Shorten to at most `limit` characters, cutting at a word and ending with an ellipsis."""
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    space = max(cut.rfind(" "), cut.rfind("\n"))
    if space >= limit // 2:
        cut = cut[:space]
    return cut.rstrip(" \n,;:-\u2013\u2014") + "\u2026"


BLOCK_TAGS = {
    "address", "article", "aside", "blockquote", "body", "center", "dd", "div", "dl", "dt", "fieldset",
    "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "html", "li",
    "main", "nav", "ol", "p", "pre", "section", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
}
# Elements whose text never belongs in an excerpt. Not <form>: ASP.NET sites (many IR pages) wrap
# the whole page in one.
SKIP_TAGS = {
    "aside", "button", "canvas", "figcaption", "footer", "head", "header", "iframe", "nav",
    "noscript", "object", "script", "select", "style", "svg", "template", "textarea",
}
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
# Starting one of these closes an open <p>, as browsers do.
P_CLOSERS = {
    "address", "article", "aside", "blockquote", "div", "dl", "fieldset", "figure", "footer", "form",
    "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section",
    "table", "ul",
}
SKIP_ROLES = {"navigation", "banner", "contentinfo", "dialog", "complementary", "search"}
# class/id words of page chrome: cookie banners, share bars, newsletter boxes, related links...
_SKIP_CLASS = re.compile(
    r"(?:^|[-_])(?:cookie|consent|onetrust|gdpr|newsletter|subscribe|signup|share|sharing|social|"
    r"breadcrumb|related|recommended|promo|advert|advertisement|ads?|sponsor|modal|popup|skip|nav|"
    r"navbar|navigation|menu|footer|sr-only|visually-hidden|screen-reader-text)s?(?:[-_]|$)",
    re.IGNORECASE,
)


def _is_chrome(tag: str, attrs: list[tuple[str, str | None]]) -> bool:
    if tag in SKIP_TAGS:
        return True
    a = {k.lower(): (v or "") for k, v in attrs}
    if "hidden" in a or a.get("aria-hidden", "").lower() == "true" or a.get("role", "").lower() in SKIP_ROLES:
        return True
    style = a.get("style", "").replace(" ", "").lower()
    if "display:none" in style or "visibility:hidden" in style:
        return True
    tokens = a.get("class", "").split() + a.get("id", "").split()
    return any(_SKIP_CLASS.search(t) for t in tokens)


class _Blocks(HTMLParser):
    """Splits HTML into text blocks and drops scripts, navigation and similar page chrome.

    Each block is (text, in_p, in_main): whether its nearest block element is a <p>, and whether it sits
    inside <article> or <main>. Tolerates unclosed tags the way pages in the wild need."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, bool]] = []  # (tag, inside chrome)
        self.buf: list[str] = []
        self.blocks: list[tuple[str, bool, bool]] = []

    def _skipping(self) -> bool:
        return bool(self.stack) and self.stack[-1][1]

    def _flush(self) -> None:
        text = collapse("".join(self.buf))
        self.buf = []
        if not text:
            return
        in_p = False
        for tag, _ in reversed(self.stack):
            if tag in BLOCK_TAGS:
                in_p = tag == "p"
                break
        in_main = any(tag in ("article", "main") for tag, _ in self.stack)
        self.blocks.append((text, in_p, in_main))

    def handle_starttag(self, tag, attrs):
        if tag in VOID_TAGS:
            if tag == "br":
                self.buf.append(" ")
            elif tag == "hr":
                self._flush()
            return
        if tag in BLOCK_TAGS:
            self._flush()
        if tag in P_CLOSERS and self.stack and self.stack[-1][0] == "p":
            self.stack.pop()
        self.stack.append((tag, self._skipping() or _is_chrome(tag, attrs)))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        idx = next((i for i in range(len(self.stack) - 1, -1, -1) if self.stack[i][0] == tag), None)
        if idx is None:
            return  # stray end tag
        if any(t in BLOCK_TAGS for t, _ in self.stack[idx:]):
            self._flush()  # a block ends; inline tags such as </a> keep the paragraph together
        del self.stack[idx:]

    def handle_data(self, data):
        if not self._skipping():
            self.buf.append(data)

    def close(self):
        super().close()
        self._flush()


def html_blocks(markup: str) -> list[tuple[str, bool, bool]]:
    parser = _Blocks()
    try:
        parser.feed(markup or "")
        parser.close()
    except Exception:  # html.parser rarely fails; keep whatever was read
        parser._flush()
    return parser.blocks


def html_to_text(markup: str) -> str:
    """Plain text of an HTML fragment (feed titles and summaries): tags stripped, entities decoded."""
    return collapse(" ".join(text for text, _, _ in html_blocks(markup)))


def _dedupe(texts: list[str]) -> list[str]:
    out: list[str] = []
    for t in texts:
        if not out or out[-1] != t:
            out.append(t)
    return out


def page_excerpt(markup: str, limit: int = EXCERPT_CHARS) -> str:
    """Opening text of an article page: its <p> paragraphs, preferring those inside <article>/<main>."""
    blocks = html_blocks(markup)
    paras = [b for b in blocks if b[1]]
    chosen = [b for b in paras if b[2]] or paras or [b for b in blocks if b[2]] or blocks
    texts = [t for t, _, _ in chosen if len(t) >= 40] or [t for t, _, _ in chosen]
    out: list[str] = []
    size = 0
    for t in _dedupe(texts):
        out.append(t)
        size += len(t) + 2
        if size > limit:
            break
    return clip("\n\n".join(out), limit)


_ITEM_HEADING = re.compile(r"\bItem\s+\d{1,2}\.\d{2}\b", re.IGNORECASE)


def document_text(markup: str, limit: int = SEC_EXCERPT_CHARS, from_item: bool = False) -> str:
    """All visible text of a document such as an SEC exhibit. from_item=True starts at the first
    "Item N.NN" heading, which skips the cover page of an 8-K."""
    text = "\n\n".join(_dedupe([t for t, _, _ in html_blocks(markup) if len(t) > 1]))
    if from_item:
        m = _ITEM_HEADING.search(text)
        if m:
            text = text[m.start():]
    return clip(text, limit)


_FEED_TAIL = re.compile(
    r"\s*(?:The post\b.{0,300}?\bappeared first on\b.{0,200}?|\[(?:\u2026|\.\.\.)\]|"
    r"(?:Continue|Keep) reading\b.{0,120}?|Read more\b.{0,120}?)\s*$",
    re.IGNORECASE | re.DOTALL,
)


def strip_feed_tail(text: str) -> str:
    """Drop feed boilerplate such as WordPress's "The post X appeared first on Y." and "Read more"."""
    for _ in range(3):
        new = _FEED_TAIL.sub("", text)
        if new == text:
            break
        text = new
    return text.strip()


# ---- Dates and URLs ---------------------------------------------------------------------------------
def parse_date(value: str | None) -> datetime | None:
    """RSS (RFC 822) or Atom/ISO 8601 date as an aware UTC datetime; None if missing or unreadable.
    Dates without a time zone are taken as UTC."""
    s = (value or "").strip()
    if not s:
        return None
    try:
        dt = email.utils.parsedate_to_datetime(s)
    except (TypeError, ValueError, IndexError, OverflowError):
        dt = None
    if dt is None:
        iso_text = re.sub(r"[Zz]$", "+00:00", s)
        iso_text = re.sub(r"(\.\d{6})\d+", r"\1", iso_text)  # at most microseconds
        try:
            dt = datetime.fromisoformat(iso_text)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def canonical_url(url: str) -> str:
    """Lower-case scheme and host, default port, utm_* parameters and the fragment removed."""
    parts = urlsplit((url or "").strip())
    scheme = parts.scheme.lower()
    host = parts.netloc.lower()
    if (scheme == "http" and host.endswith(":80")) or (scheme == "https" and host.endswith(":443")):
        host = host.rsplit(":", 1)[0]
    query = "&".join(
        p for p in parts.query.split("&") if p and not p.split("=", 1)[0].lower().startswith("utm_")
    )
    return urlunsplit((scheme, host, parts.path or "/", query, ""))


def item_id(url: str) -> str:
    """First 12 hex digits of the SHA-1 of the canonical URL."""
    return hashlib.sha1(canonical_url(url).encode("utf-8")).hexdigest()[:12]


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower()


def _is_sec(host: str) -> bool:
    return host == "sec.gov" or host.endswith(".sec.gov")


# ---- Feed parsing -----------------------------------------------------------------------------------
_XML_ENTITIES = {"amp", "lt", "gt", "quot", "apos"}


def _local(tag) -> str:
    """Element name without its namespace, lower case ("" for comments)."""
    return tag.rsplit("}", 1)[-1].lower() if isinstance(tag, str) else ""


def _child(el, *names):
    """First child with one of the names, trying the names in order of preference."""
    for name in names:
        for c in el:
            if _local(c.tag) == name:
                return c
    return None


def _text(el) -> str:
    return "".join(el.itertext()).strip() if el is not None else ""


def _decode_xml(data: bytes) -> str:
    m = re.match(rb"\s*<\?xml[^>]*encoding=[\"']([A-Za-z0-9._-]+)", data)
    enc = m.group(1).decode("ascii") if m else "utf-8"
    try:
        return data.decode(enc, errors="replace")
    except LookupError:
        return data.decode("utf-8", errors="replace")


def _fix_entity(m: re.Match) -> str:
    name = m.group(1)
    if name in _XML_ENTITIES:
        return m.group(0)
    cp = html.entities.name2codepoint.get(name)
    return f"&#{cp};" if cp else f"&amp;{name};"


def parse_xml(data: bytes) -> ET.Element:
    """Parse a feed; on failure retry once after fixing common breakage (HTML entities such as &nbsp;,
    bare ampersands, control characters)."""
    data = data.lstrip(b"\xef\xbb\xbf \t\r\n")
    try:
        return ET.fromstring(data)
    except ET.ParseError as first:
        text = _decode_xml(data)
        text = re.sub(r"&([A-Za-z][A-Za-z0-9]*);", _fix_entity, text)
        text = re.sub(r"&(?!#\d+;|#x[0-9A-Fa-f]+;|[A-Za-z][A-Za-z0-9]*;)", "&amp;", text)
        text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
        text = re.sub(r"^(<\?xml[^>]*?encoding=)([\"'])[^\"']*\2", r"\1\2utf-8\2", text)
        try:
            return ET.fromstring(text.encode("utf-8"))
        except ET.ParseError:
            raise first from None


def _entry_link(entry, base: str) -> str:
    fallback = ""
    for el in entry:
        name = _local(el.tag)
        if name not in ("link", "origlink"):
            continue
        href = (el.get("href") or el.text or "").strip()
        if not href:
            continue
        if name == "origlink" or (el.get("rel") or "alternate").lower() == "alternate":
            return urljoin(base, href)
        fallback = fallback or href
    if not fallback:
        guid = _child(entry, "guid", "id")
        text = _text(guid)
        if text.startswith(("http://", "https://")):
            fallback = text
    return urljoin(base, fallback) if fallback else ""


def parse_feed(data: bytes, base_url: str = "") -> list[dict]:
    """Entries of an RSS 2.0/1.0 or Atom feed: title, url, published (datetime or None), summary and
    content (HTML strings), extra (child fields of a structured <content>, as in SEC feeds), category."""
    root = parse_xml(data)
    kind = _local(root.tag)
    if kind == "feed":
        nodes = [e for e in root if _local(e.tag) == "entry"]
        date_names = ("published", "updated", "issued", "modified", "date")
    elif kind in ("rss", "rdf"):
        nodes = [e for e in root.iter() if _local(e.tag) == "item"]
        date_names = ("pubdate", "date", "published", "updated", "issued", "modified")
    else:
        raise ValueError(f"not an RSS or Atom feed (root element <{kind}>)")
    entries = []
    for e in nodes:
        content_el = _child(e, "encoded", "content")
        extra: dict[str, str] = {}
        content = ""
        if content_el is not None and len(content_el) and content_el.get("type", "").lower() in ("text/xml", "application/xml"):
            extra = {_local(c.tag): _text(c) for c in content_el}  # SEC: accession-number, items-desc...
        else:
            content = _text(content_el)
        category = _child(e, "category")
        entries.append({
            "title": _text(_child(e, "title")),
            "url": _entry_link(e, base_url),
            "published": parse_date(_text(_child(e, *date_names))),
            "summary": _text(_child(e, "summary", "description")),
            "content": content,
            "extra": extra,
            "category": (category.get("term") or _text(category)) if category is not None else "",
        })
    return entries


# ---- Company matching -------------------------------------------------------------------------------
_CJK = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]")
_TICKER_LIKE = re.compile(r"[A-Z0-9]{1,5}(?:\.[A-Z]{1,2})?")  # NVDA, 2330, SAP.DE
_SUFFIX = re.compile(r"\.[A-Z]{1,3}$")                           # 2330.TW, SHOP.TO
US_EXCHANGES = {"NASDAQ", "NYSE", "NYSE American", "OTC"}
_US_LABEL = r"NASDAQ(?:[\s-]?(?:GS|GM|CM))?|NYSE(?:\s+(?:American|Arca|MKT))?|AMEX|Cboe(?:\s+BZX)?|OTC(?:QX|QB|\s+Markets)?"
_INTL_LABEL = (
    r"Nasdaq\s+(?:Helsinki|Copenhagen|Stockholm)|Euronext(?:\s+(?:Paris|Amsterdam|Milan|Brussels))?|"
    r"TSXV?|TSX-V|ASX|LSE|AIM|EPA|AMS|XETRA|ETR|FWB|SIX|SWX|TSE|TYO|TWSE|TPEx|KRX|KOSPI|KOSDAQ|"
    r"HKEX|HKSE|SEHK|SSE|SZSE"
)
# "(NASDAQ: NVDA)", "NYSE: VRT", "(TWSE: 2330)": the label is case-insensitive, the ticker is not.
_EXCHANGE_TICKER = re.compile(
    rf"(?<!\w)(?i:({_US_LABEL})|({_INTL_LABEL}))\s*:\s*([A-Z0-9]{{1,6}}(?:[.\-][A-Z]{{1,2}})?)(?![\w])"
)
_CASHTAG = re.compile(r"(?<![\w$])\$([A-Z]{1,5})(?![\w])")


class Matcher:
    """Finds company ids in text using each company's name and aliases.

    Rules: Chinese, Japanese and Korean aliases are skipped. Aliases that look like bare tickers (all
    caps or digits, up to 5 characters, or starting with a digit) only count inside exchange patterns
    such as "(NASDAQ: NVDA)", "NYSE: VRT" or "$NVDA". Names of 4 characters or fewer ("Arm", "AMD")
    match case-sensitively as whole words; longer names match case-insensitively on word boundaries,
    so "Intel" never matches "intelligence". The match block of content/news-sources.yaml adds extra
    short names (matched exactly as written), names to ignore, and names that must keep their
    capitalisation. When matches overlap, the longest wins ("Siemens Energy" is not also "Siemens")."""

    def __init__(self, companies: dict, extra: dict | None = None, ignore=(), exact_case=()):
        self.companies = companies
        ignored = {t.lower() for t in ignore}
        exact = {t.lower() for t in exact_case}
        terms: dict[tuple[str, bool], tuple[str, set[str]]] = {}
        alias_tickers: list[tuple[str, str]] = []
        self._tickers: dict[str, set[tuple[str, str]]] = {}

        def add(term: str, cid: str, case_sensitive: bool) -> None:
            key = (term if case_sensitive else term.lower(), case_sensitive)
            terms.setdefault(key, (term, set()))[1].add(cid)

        for cid, rec in companies.items():
            for term, is_alias in self._names(rec):
                if not term or _CJK.search(term) or term.lower() in ignored:
                    continue
                if is_alias and (_TICKER_LIKE.fullmatch(term) or term[0].isdigit()):
                    alias_tickers.append((term, cid))
                    continue
                add(term, cid, len(term) <= 4 or term.lower() in exact)
            for t in rec.get("tickers") or []:
                symbol = str(t.get("symbol") or "")
                family = "us" if t.get("exchange") in US_EXCHANGES and not _SUFFIX.search(symbol) else "intl"
                self._add_ticker(_SUFFIX.sub("", symbol), cid, family)
        for cid, words in (extra or {}).items():
            for term in words:
                add(collapse(str(term)), cid, True)
        actual = set(self._tickers)
        for term, cid in alias_tickers:  # e.g. ADR symbols listed as aliases; real tickers win
            base = _SUFFIX.sub("", term)
            if base not in actual:
                self._add_ticker(base, cid, "any")

        self._terms = []
        for (_, case_sensitive), (term, cids) in terms.items():
            words = re.split(r"[\s\-]+", term)
            rx = re.compile(r"(?<!\w)" + _phrase(term) + r"(?!\w)", 0 if case_sensitive else re.IGNORECASE)
            self._terms.append((max(words, key=len).lower(), rx, tuple(sorted(cids))))

    @staticmethod
    def _names(rec: dict):
        """(term, is_alias) pairs. A name like "Hon Hai (Foxconn)" gives "Hon Hai" plus alias "Foxconn"."""
        name = collapse(str(rec.get("name") or ""))
        m = re.fullmatch(r"(.+?)\s*\((.+)\)", name)
        if m:
            yield m.group(1), False
            yield m.group(2), True
        else:
            yield name, False
        for a in rec.get("aliases") or []:
            yield collapse(str(a)), True

    def _add_ticker(self, symbol: str, cid: str, family: str) -> None:
        if not symbol:
            return
        self._tickers.setdefault(symbol, set()).add((cid, family))
        if symbol.isdigit() and symbol.lstrip("0") and symbol.lstrip("0") != symbol:
            self._tickers.setdefault(symbol.lstrip("0"), set()).add((cid, family))  # HK 0700 = 700

    def _lookup(self, symbol: str, family: str) -> set[str]:
        cands = self._tickers.get(symbol) or (self._tickers.get(symbol.lstrip("0")) if symbol.isdigit() else None)
        return {cid for cid, fam in cands or () if fam in (family, "any")}

    def companies_in(self, text: str) -> set[str]:
        if not text:
            return set()
        low = text.lower()
        spans = []
        for needle, rx, cids in self._terms:
            if needle in low:  # cheap pre-check before the regex
                for m in rx.finditer(text):
                    spans.append((m.start(), m.end(), cids))
        spans.sort(key=lambda s: (s[0] - s[1], s[0]))  # longest first
        taken: list[tuple[int, int]] = []
        found: set[str] = set()
        for start, end, cids in spans:
            if any(start < e and s < end for s, e in taken) and (start, end) not in taken:
                continue  # inside a longer match
            taken.append((start, end))
            found.update(cids)
        for m in _EXCHANGE_TICKER.finditer(text):
            found |= self._lookup(m.group(3), "us" if m.group(1) else "intl")
        for m in _CASHTAG.finditer(text):
            found |= self._lookup(m.group(1), "us")
        return found

    def layer_of(self, cid: str) -> str | None:
        return (self.companies.get(cid) or {}).get("layer")

    def name_of(self, cid: str) -> str:
        return (self.companies.get(cid) or {}).get("name") or cid


def tag_item(item: dict, matcher: Matcher, texts: list[str], source_companies=()) -> tuple[set[str], set[str]]:
    """Add companies and layers found in the texts to the item. Returns (companies found in the text,
    keyword layers found); a company's layer is the first segment of its primary path."""
    text = "\n".join(t for t in texts if t)
    found = matcher.companies_in(text)
    keywords = keyword_layers(text)
    companies = set(item.get("companies") or []) | found | set(source_companies)
    layers = set(item.get("layers") or []) | keywords | {matcher.layer_of(c) for c in companies}
    item["companies"] = sorted(companies)
    item["layers"] = sorted(layer for layer in layers if layer)
    return found, keywords


# ---- SEC EDGAR --------------------------------------------------------------------------------------
_SEC_ITEM = re.compile(r"\bItem\s+(\d{1,2}\.\d{2})\s*:?\s*(.*)", re.IGNORECASE)


def sec_items(summary: str, extra: dict) -> list[tuple[str, str]]:
    """8-K item numbers and titles from an EDGAR entry summary ("Item 2.02: Results of Operations...")."""
    out: list[tuple[str, str]] = []
    for part in re.split(r"<br\s*/?>|\n", summary or "", flags=re.IGNORECASE):
        m = _SEC_ITEM.search(html_to_text(part))
        if m and m.group(1) not in {n for n, _ in out}:
            out.append((m.group(1), m.group(2).strip()))
    if not out:  # fall back to <items-desc>items 2.02 and 9.01</items-desc>
        for n in re.findall(r"\d{1,2}\.\d{2}", extra.get("items-desc", "")):
            if n not in {x for x, _ in out}:
                out.append((n, ""))
    return out


def sec_title(company: str, entry: dict, items: list[tuple[str, str]]) -> str:
    """A readable title in place of EDGAR's "8-K - Current report": company, form and item titles."""
    form = entry["extra"].get("filing-type") or entry["category"] or collapse(entry["title"]).split(" ")[0]
    if items:
        detail = "; ".join(f"{desc} ({num})" if desc else f"Item {num}" for num, desc in items)
    else:
        detail = entry["extra"].get("form-name") or re.sub(r"^\S+\s*-\s*", "", collapse(entry["title"]))
    return f"{company} {form}: {detail}".strip()


class _IndexTable(HTMLParser):
    """Table rows of an EDGAR filing index page: cell texts plus (cell index, href) for each link."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[dict] = []
        self._row: dict | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._row = {"cells": [], "links": []}
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []
        elif tag == "a" and self._row is not None:
            href = dict(attrs).get("href")
            if href:
                self._row["links"].append((len(self._row["cells"]), href))

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._row is not None and self._cell is not None:
            self._row["cells"].append(collapse("".join(self._cell)))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def sec_document_url(index_html: str, index_url: str) -> tuple[str, str] | None:
    """(url, type) of the document to excerpt from a filing index: the first EX-99.1, else any EX-99
    exhibit, else the main 8-K/6-K document."""
    parser = _IndexTable()
    parser.feed(index_html or "")
    parser.close()
    columns = None
    docs: list[tuple[str, str]] = []
    for row in parser.rows:
        cells = [c.lower() for c in row["cells"]]
        if "type" in cells and "document" in cells:
            columns = (cells.index("document"), cells.index("type"))
            continue
        if columns is None or len(row["cells"]) <= max(columns):
            continue
        href = next((h for i, h in row["links"] if i == columns[0]), None)
        if href:
            docs.append((row["cells"][columns[1]].upper(), href))
    pick = (
        next((d for d in docs if d[0].startswith("EX-99.1")), None)
        or next((d for d in docs if d[0].startswith("EX-99")), None)
        or next((d for d in docs if d[0].split("/")[0] in ("8-K", "6-K")), None)
    )
    if not pick:
        return None
    href = re.sub(r"^/ix\?doc=", "", pick[1])  # inline-XBRL viewer link -> the document itself
    return urljoin(index_url, href), pick[0]


# ---- HTTP -------------------------------------------------------------------------------------------
@dataclass
class Response:
    url: str
    status: int | None = None  # HTTP status; None when no response arrived
    body: bytes = b""
    content_type: str = ""
    error: str = ""            # empty on success

    @property
    def ok(self) -> bool:
        return not self.error and self.status is not None and 200 <= self.status < 300


def describe(resp: Response) -> str:
    return resp.error or f"HTTP {resp.status}"


def _transient(resp: Response) -> bool:
    return resp.status is None or resp.status == 429 or resp.status >= 500


def decompress(body: bytes, encoding: str) -> bytes:
    encoding = (encoding or "").lower()
    try:
        if "gzip" in encoding or body[:2] == b"\x1f\x8b":
            return gzip.decompress(body)
        if "deflate" in encoding:
            try:
                return zlib.decompress(body)
            except zlib.error:
                return zlib.decompress(body, -zlib.MAX_WBITS)
    except (OSError, EOFError, zlib.error):
        pass
    return body


def decode_body(resp: Response) -> str:
    """Response body as text, using the charset from the header or a <meta> tag (UTF-8 otherwise)."""
    m = re.search(r"charset=[\"']?([A-Za-z0-9._-]+)", resp.content_type or "")
    if not m:
        m = re.search(rb"<meta[^>]+charset=[\"']?([A-Za-z0-9._-]+)", resp.body[:4096], re.IGNORECASE)
    charset = m.group(1) if m else "utf-8"
    if isinstance(charset, bytes):
        charset = charset.decode("ascii", "ignore")
    try:
        return resp.body.decode(charset, errors="replace")
    except LookupError:
        return resp.body.decode("utf-8", errors="replace")


class HttpFetcher:
    """GET with a 20 s timeout and one retry after 3 s (network errors, 429, 5xx); gzip handled.
    At most PER_HOST requests run against one host at a time; sec.gov gets its own User-Agent and at
    most 5 requests per second."""

    def __init__(self, timeout: float = TIMEOUT, retry_delay: float = RETRY_DELAY, per_host: int = PER_HOST, sleep=time.sleep):
        self.timeout = timeout
        self.retry_delay = retry_delay
        self.per_host = per_host
        self.sleep = sleep
        self._lock = threading.Lock()
        self._hosts: dict[str, threading.Semaphore] = {}
        self._sec_next = 0.0

    def _semaphore(self, host: str) -> threading.Semaphore:
        with self._lock:
            return self._hosts.setdefault(host, threading.Semaphore(self.per_host))

    def _sec_pause(self) -> None:
        with self._lock:
            now = time.monotonic()
            start = max(now, self._sec_next)
            self._sec_next = start + SEC_INTERVAL
        if start > now:
            self.sleep(start - now)

    def __call__(self, url: str) -> Response:
        host = _host(url)
        for attempt in (1, 2):
            with self._semaphore(host):
                if _is_sec(host):
                    self._sec_pause()
                resp = self.request(url, SEC_USER_AGENT if _is_sec(host) else USER_AGENT)
            if resp.ok or attempt == 2 or not _transient(resp):
                return resp
            self.sleep(self.retry_delay)
        return resp

    def request(self, url: str, user_agent: str) -> Response:
        req = urllib.request.Request(url, headers={
            "User-Agent": user_agent,
            "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5",
            "Accept-Encoding": "gzip, deflate",
            "Accept-Language": "en-US,en;q=0.8",
        })
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                body = decompress(r.read(MAX_BYTES), r.headers.get("Content-Encoding", ""))
                return Response(url=r.geturl(), status=r.status, body=body, content_type=r.headers.get("Content-Type", ""))
        except urllib.error.HTTPError as exc:
            return Response(url=url, status=exc.code, error=f"HTTP {exc.code}")
        except (TimeoutError, ConnectionError, urllib.error.URLError, http.client.HTTPException, OSError, ValueError) as exc:
            reason = getattr(exc, "reason", None) or exc
            if isinstance(reason, TimeoutError):
                text = "timeout"
            else:
                text = f"{type(reason if isinstance(reason, BaseException) else exc).__name__}: {reason}"
            return Response(url=url, error=text[:160])


def interleave(things: list, host_of) -> list:
    """Reorder so consecutive tasks hit different hosts (keeps the thread pool busy)."""
    groups: dict[str, list] = {}
    for t in things:
        groups.setdefault(host_of(t), []).append(t)
    out = []
    while any(groups.values()):
        for queue in groups.values():
            if queue:
                out.append(queue.pop(0))
    return out


# ---- Pipeline ---------------------------------------------------------------------------------------
def build_item(src: dict, entry: dict, matcher: Matcher) -> dict | None:
    """One candidate from a feed entry, or None for a media entry with no company or layer keyword."""
    url = canonical_url(entry["url"])
    title = html_to_text(entry["title"]) or url
    summary = strip_feed_tail(html_to_text(entry["summary"] or entry["content"]))
    item = {
        "id": item_id(url),
        "title": title,
        "url": url,
        "published": iso(entry["published"]),
        "source": src["id"],
        "sourceName": src["name"],
        "kind": src["kind"],
        "summary": clip(summary, SUMMARY_CHARS),
        "companies": [],
        "layers": [],
    }
    if src["kind"] == "filing" and _is_sec(_host(src["url"])):
        numbers = sec_items(entry["summary"], entry["extra"])
        company = matcher.name_of(src["companies"][0]) if src["companies"] else src["name"]
        item["title"] = sec_title(company, entry, numbers)
        if numbers:  # 8-K item numbers; 6-K reports have none
            item["items"] = [n for n, _ in numbers]
    elif src["excerpt"]:
        # Many company feeds carry the whole release; then the feed is the excerpt and no page fetch is needed.
        for body in (entry["content"], entry["summary"]):
            text = page_excerpt(body, EXCERPT_CHARS) if body else ""
            if len(text) >= FEED_BODY_MIN:
                item["excerpt"] = text
                break
    found, keywords = tag_item(item, matcher, [title, summary, item.get("excerpt", "")], src["companies"])
    if src["kind"] == "media" and not found and not keywords:
        return None
    return item


def feed_items(src: dict, entries: list[dict], matcher: Matcher, now: datetime, days: int) -> tuple[list[dict], int]:
    """Items for entries published inside the window (up to a day of clock skew ahead is allowed).
    Returns (items, number of entries without a date, which are skipped)."""
    start, end = now - timedelta(days=days), now + timedelta(days=1)
    items, undated = [], 0
    for entry in entries:
        if not entry["url"]:
            continue
        if entry["published"] is None:
            undated += 1
            continue
        if start <= entry["published"] <= end:
            item = build_item(src, entry, matcher)
            if item:
                items.append(item)
    return items, undated


CARRIED = ("excerpt", "excerptUrl", "excerptError")


def merge(new_items: list[dict], previous: list[dict], now: datetime, days: int, known_sources=None, cap: int = MAX_ITEMS) -> list[dict]:
    """Combine this run's items with the previous file: drop items older than the window (and items of
    sources no longer listed), dedupe by id preferring this run's copy but keeping an earlier excerpt,
    sort newest first and cap."""
    start = now - timedelta(days=days)
    by_id: dict[str, dict] = {}
    for old in previous or []:
        when = parse_date(old.get("published")) if isinstance(old, dict) else None
        if when is None or when < start or not old.get("id") or not old.get("url"):
            continue
        if known_sources is not None and old.get("source") not in known_sources:
            continue
        by_id[old["id"]] = {**old, "published": iso(when)}
    for item in new_items:
        old = by_id.get(item["id"])
        if old:
            if "excerpt" not in item and "excerptError" not in item:
                item.update({k: old[k] for k in CARRIED if old.get(k)})
            if "items" not in item and old.get("items"):
                item["items"] = old["items"]
        by_id[item["id"]] = item
    items = sorted(by_id.values(), key=lambda it: (it["published"], it["id"]), reverse=True)
    return items[:cap]


def page_excerpt_for(url: str, fetch) -> dict:
    resp = fetch(url)
    if not resp.ok:
        return {"error": describe(resp), "transient": _transient(resp)}
    ctype = (resp.content_type or "").lower()
    if "pdf" in ctype or urlsplit(resp.url or url).path.lower().endswith(".pdf"):
        return {"error": "pdf"}
    if ctype and not any(t in ctype for t in ("html", "xml", "text")):
        return {"error": f"unsupported type {ctype.split(';')[0]}"}
    text = page_excerpt(decode_body(resp), EXCERPT_CHARS)
    return {"excerpt": text} if text else {"error": "no text"}


def sec_excerpt_for(url: str, fetch) -> dict:
    """Excerpt of an SEC filing: open the filing index, then its EX-99.1 exhibit (or main document)."""
    resp = fetch(url)
    if not resp.ok:
        return {"error": describe(resp), "transient": _transient(resp)}
    doc_url, doc_type = url, ""
    if re.search(r"-index\.html?$", urlsplit(url).path):
        found = sec_document_url(decode_body(resp), url)
        if not found:
            return {"error": "no exhibit"}
        doc_url, doc_type = found
        resp = fetch(doc_url)
        if not resp.ok:
            return {"error": describe(resp), "transient": _transient(resp), "excerptUrl": doc_url}
    text = document_text(decode_body(resp), SEC_EXCERPT_CHARS, from_item=not doc_type.startswith("EX-"))
    if not text:
        return {"error": "no text", "excerptUrl": doc_url}
    return {"excerpt": text, "excerptUrl": doc_url}


def fill_excerpts(items: list[dict], excerpt_sources: set[str], fetch, limit: int = MAX_EXCERPT_FETCHES) -> dict:
    """Fetch excerpts for items of primary sources that have none yet, newest first, at most `limit`.
    Permanent failures (404, PDF, no text) are recorded in excerptError and not retried; transient ones
    (timeouts, 5xx) are left for the next run. A host that keeps failing is skipped for the rest of the run."""
    todo = [it for it in items if it.get("source") in excerpt_sources and not it.get("excerpt") and not it.get("excerptError")]
    todo = sorted(todo, key=lambda it: it["published"], reverse=True)[:limit]
    stats = {"fetched": 0, "failed": 0, "retry": 0}
    failures: dict[str, int] = {}
    lock = threading.Lock()

    def work(item: dict):
        host = _host(item["url"])
        with lock:
            if failures.get(host, 0) >= HOST_FAILURE_LIMIT:
                return item, None
        try:
            result = (sec_excerpt_for if _is_sec(host) else page_excerpt_for)(item["url"], fetch)
        except Exception as exc:  # a broken page must not stop the run
            result = {"error": f"{type(exc).__name__}: {exc}"[:160]}
        if "error" in result:
            with lock:
                failures[host] = failures.get(host, 0) + 1
        return item, result

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for item, result in pool.map(work, interleave(todo, lambda it: _host(it["url"]))):
            if result is None:
                stats["retry"] += 1
            elif "excerpt" in result:
                item["excerpt"] = result["excerpt"]
                if result.get("excerptUrl"):
                    item["excerptUrl"] = result["excerptUrl"]
                stats["fetched"] += 1
            elif result.get("transient"):
                stats["retry"] += 1
            else:
                item["excerptError"] = result["error"]
                if result.get("excerptUrl"):
                    item["excerptUrl"] = result["excerptUrl"]
                stats["failed"] += 1
    return stats


ITEM_KEYS = ("id", "title", "url", "published", "source", "sourceName", "kind", "summary", "companies",
             "layers", "items", "excerpt", "excerptUrl", "excerptError")


def ordered(item: dict) -> dict:
    """Item with keys in a fixed order, so the JSON reads the same from run to run."""
    out = {k: item[k] for k in ITEM_KEYS if k in item}
    out.update({k: v for k, v in item.items() if k not in out})
    return out


def run(sources: list[dict], matcher: Matcher, previous: list[dict], now: datetime, days: int = DEFAULT_DAYS,
        excerpts: bool = True, fetch=None, all_sources: list[dict] | None = None) -> tuple[dict, dict, dict]:
    """Fetch the sources and build (news-candidates document, per-source status, run statistics).
    all_sources is the full source list (when --only selects a few): previous items of the other
    sources are kept, and items of sources that were removed are dropped."""
    fetch = fetch or HttpFetcher()
    all_sources = all_sources or sources

    def get(src: dict) -> Response:
        try:
            return fetch(src["url"])
        except Exception as exc:  # one bad source must not stop the run
            return Response(url=src["url"], error=f"{type(exc).__name__}: {exc}"[:160])

    ordered_sources = interleave(sources, lambda s: _host(s["url"]))
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        responses = dict(zip((s["id"] for s in ordered_sources), pool.map(get, ordered_sources)))

    status: dict[str, dict] = {}
    new_items: list[dict] = []
    seen: set[str] = set()
    for src in sources:
        resp = responses[src["id"]]
        st = {"ok": False, "status": resp.status if resp.ok or resp.status else resp.error, "entries": 0, "kept": 0, "at": iso(now)}
        if resp.ok:
            try:
                entries = parse_feed(resp.body, resp.url or src["url"])
            except (ET.ParseError, ValueError) as exc:
                st["status"] = f"parse error: {exc}"[:200]
            else:
                items, undated = feed_items(src, entries, matcher, now, days)
                st.update(ok=True, entries=len(entries), kept=len(items))
                if undated:
                    st["undated"] = undated
                for item in items:
                    if item["id"] not in seen:  # the same link in two feeds: the first source wins
                        seen.add(item["id"])
                        new_items.append(item)
        status[src["id"]] = st

    previous_ids = {it.get("id") for it in previous if isinstance(it, dict)}
    items = merge(new_items, previous, now, days, known_sources={s["id"] for s in all_sources})
    stats = {"new": len(seen - previous_ids), "fetched": 0, "failed": 0, "retry": 0}
    if excerpts:
        stats.update(fill_excerpts(items, {s["id"] for s in all_sources if s["excerpt"]}, fetch))
    for item in items:
        if item.get("excerpt"):  # companies named in the opening text count too
            tag_item(item, matcher, [item.get("excerpt", "")])
    doc = {
        "generatedAt": iso(now),
        "days": days,
        "sources": sum(1 for st in status.values() if st["ok"]),
        "items": [ordered(it) for it in items],
    }
    return doc, status, stats


# ---- Configuration ----------------------------------------------------------------------------------
def load_yaml(path: str):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_companies(pattern: str = COMPANIES_GLOB) -> dict[str, dict]:
    """Company id -> name, aliases, layer (first segment of primary; the file name as a fallback), tickers."""
    out: dict[str, dict] = {}
    for path in sorted(glob.glob(pattern)):
        file_layer = os.path.splitext(os.path.basename(path))[0]
        for cid, rec in (load_yaml(path).get("companies") or {}).items():
            if not isinstance(rec, dict):
                continue
            primary = str(rec.get("primary") or "")
            out[str(cid)] = {
                "name": str(rec.get("name") or cid),
                "aliases": [str(a) for a in rec.get("aliases") or []],
                "layer": primary.split("/")[0] or file_layer,
                "tickers": [t for t in rec.get("tickers") or [] if isinstance(t, dict) and t.get("symbol")],
            }
    return out


def _warn(msg: str) -> None:
    print(f"warning: {msg}", file=sys.stderr)


def load_sources(doc: dict, company_ids: set[str], warn=_warn) -> list[dict]:
    """Validated sources from news-sources.yaml. Structural problems raise ValueError; unknown company
    ids and excerpt on media sources only warn."""
    raw = doc.get("sources") if isinstance(doc, dict) else None
    if not isinstance(raw, list) or not raw:
        raise ValueError("news-sources.yaml has no sources")
    out, ids = [], set()
    for n, s in enumerate(raw, 1):
        if not isinstance(s, dict):
            raise ValueError(f"source #{n} is not a mapping")
        sid = str(s.get("id") or "")
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", sid):
            raise ValueError(f"source #{n}: bad id {sid!r}")
        if sid in ids:
            raise ValueError(f"duplicate source id {sid}")
        kind, url = s.get("kind"), str(s.get("url") or "").strip()
        if kind not in KINDS:
            raise ValueError(f"{sid}: kind must be one of {', '.join(KINDS)}")
        if not url.startswith(("https://", "http://")):
            raise ValueError(f"{sid}: url must start with http(s)://")
        companies = [str(c) for c in s.get("companies") or []]
        unknown = [c for c in companies if c not in company_ids]
        if unknown:
            warn(f"{sid}: unknown company ids ignored: {', '.join(unknown)}")
        excerpt = bool(s.get("excerpt", False))
        if excerpt and kind == "media":
            warn(f"{sid}: excerpts are never kept for media; ignoring excerpt: true")
            excerpt = False
        ids.add(sid)
        out.append({"id": sid, "name": str(s.get("name") or sid), "kind": kind, "url": url,
                    "companies": [c for c in companies if c in company_ids], "excerpt": excerpt})
    return out


def load_match(doc: dict, company_ids: set[str], warn=_warn) -> tuple[dict, list[str], list[str]]:
    """(extra names by company id, names to ignore, names that keep their capitalisation)."""
    cfg = (doc.get("match") if isinstance(doc, dict) else None) or {}
    extra = {}
    for cid, words in (cfg.get("extra") or {}).items():
        if cid not in company_ids:
            warn(f"match.extra: unknown company id {cid}")
            continue
        extra[cid] = [str(w) for w in words or []]
    return extra, [str(w) for w in cfg.get("ignore") or []], [str(w) for w in cfg.get("exactCase") or []]


def load_previous(path: str) -> list[dict]:
    """Items of an earlier news-candidates.json; a missing or invalid file gives none."""
    if not path:
        return []
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError):
        return []
    items = doc.get("items") if isinstance(doc, dict) else None
    return [it for it in items if isinstance(it, dict)] if isinstance(items, list) else []


# ---- Output -----------------------------------------------------------------------------------------
README = """# feeds (machine-written branch)

This branch is rewritten about every two hours by `.github/workflows/news-feed.yml` running on `main`
(`scripts/news/fetch_feeds.py`). It always holds a single commit; do not edit it by hand.

- `news-candidates.json`: entries from the feeds in `content/news-sources.yaml` published in the last
  {days} days, newest first (at most {cap}). Each item has `companies` (ids from `content/companies`)
  and `layers`. Primary sources (company newsrooms, regulators, SEC filings) also carry `excerpt`, the
  opening text of the linked page or of the filing's press-release exhibit (`excerptUrl`). Media items
  carry only the summary from their feed.
- `sources-status.json`: the last run's result for each source (`ok`, HTTP status or error, entries in
  the feed, entries kept).

A Claude routine reads `news-candidates.json` each morning to pick news items and verify them against
the primary source before adding them to `content/news/`. Candidates are unverified leads, not site
content.
"""


def write_json(path: str, obj) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")


def write_outputs(out_dir: str, doc: dict, status: dict) -> None:
    os.makedirs(out_dir, exist_ok=True)
    write_json(os.path.join(out_dir, "news-candidates.json"), doc)
    write_json(os.path.join(out_dir, "sources-status.json"), status)
    with open(os.path.join(out_dir, "README.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write(README.format(days=doc["days"], cap=MAX_ITEMS))


def print_summary(status: dict, doc: dict, stats: dict, seconds: float) -> None:
    width = max((len(sid) for sid in status), default=10)
    for sid, st in status.items():
        if st["ok"]:
            line = f"  ok    {sid:<{width}}  {st['status']}  entries {st['entries']:>3}  kept {st['kept']:>3}"
            if st.get("undated"):
                line += f"  undated {st['undated']}"
        else:
            line = f"  FAIL  {sid:<{width}}  {st['status']}"
        print(line)
    print(
        f"{doc['sources']}/{len(status)} sources ok; {len(doc['items'])} items ({stats['new']} new); "
        f"excerpts {stats['fetched']} fetched, {stats['failed']} failed, {stats['retry']} left for later; "
        f"{seconds:.1f} s"
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Fetch the news feeds in content/news-sources.yaml into news-candidates.json.")
    ap.add_argument("--out", required=True, help="output directory")
    ap.add_argument("--previous", default="", help="earlier news-candidates.json to merge (missing or invalid = none)")
    ap.add_argument("--days", type=int, default=DEFAULT_DAYS, help="keep entries published in the last N days")
    ap.add_argument("--only", default="", help="comma-separated source ids to fetch")
    ap.add_argument("--no-excerpts", action="store_true", help="do not open linked pages for excerpts")
    args = ap.parse_args(argv)
    if args.days < 1:
        ap.error("--days must be at least 1")

    started = time.time()
    now = datetime.now(timezone.utc).replace(microsecond=0)
    companies = load_companies()
    config = load_yaml(SOURCES_FILE)
    try:
        sources = load_sources(config, set(companies))
        extra, ignore, exact_case = load_match(config, set(companies))
    except ValueError as exc:
        print(f"error: content/news-sources.yaml: {exc}", file=sys.stderr)
        return 2
    selected = sources
    if args.only:
        wanted = {s.strip() for s in args.only.split(",") if s.strip()}
        unknown = sorted(wanted - {s["id"] for s in sources})
        if unknown:
            print(f"error: unknown source ids: {', '.join(unknown)}", file=sys.stderr)
            return 2
        selected = [s for s in sources if s["id"] in wanted]

    previous = load_previous(args.previous)
    print(f"{len(selected)} sources, {len(previous)} previous items, window {args.days} days")
    matcher = Matcher(companies, extra, ignore, exact_case)
    doc, status, stats = run(selected, matcher, previous, now, days=args.days,
                             excerpts=not args.no_excerpts, all_sources=sources)
    write_outputs(args.out, doc, status)
    print_summary(status, doc, stats, time.time() - started)
    # A few dead feeds are normal; fail only when nothing could be fetched (e.g. no network).
    return 0 if doc["sources"] else 1


if __name__ == "__main__":
    sys.exit(main())
