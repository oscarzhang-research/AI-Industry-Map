"""Unit tests for scripts/news/fetch_feeds.py. Offline and deterministic; from the repository root:

    python3 -m unittest discover -s scripts/news -p 'test_*.py'
"""
from __future__ import annotations

import contextlib
import gzip
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import fetch_feeds as ff  # noqa: E402

FIXTURES = os.path.join(HERE, "fixtures")
NOW = datetime(2026, 10, 13, 12, 0, tzinfo=timezone.utc)  # the clock every test runs at


def fixture(name: str) -> bytes:
    with open(os.path.join(FIXTURES, name), "rb") as f:
        return f.read()


def company(name, aliases=(), layer="chips", tickers=()):
    return {"name": name, "aliases": list(aliases), "layer": layer,
            "tickers": [{"symbol": s, "exchange": x} for s, x in tickers]}


# A small universe with the cases that matter; the real one is checked in RepositoryConfigTests.
COMPANIES = {
    "nvidia": company("NVIDIA", ["NVDA", "Nvidia Corporation", "輝達"], tickers=[("NVDA", "NASDAQ")]),
    "intel": company("Intel", ["INTC", "Intel Corporation"], tickers=[("INTC", "NASDAQ")]),
    "arm": company("Arm", ["ARM", "Arm Holdings"], tickers=[("ARM", "NASDAQ")]),
    "amd": company("AMD", ["Advanced Micro Devices", "超微"], tickers=[("AMD", "NASDAQ")]),
    "sk-hynix": company("SK hynix", ["000660", "SK Hynix Inc."], tickers=[("000660.KS", "KOSPI")]),
    "micron": company("Micron", ["MU", "Micron Technology"], tickers=[("MU", "NASDAQ")]),
    "tsmc": company("TSMC", ["TSM", "2330", "Taiwan Semiconductor Manufacturing"], tickers=[("TSM", "NYSE"), ("2330.TW", "TWSE")]),
    "meta": company("Meta Platforms", ["META", "Facebook"], "applications", [("META", "NASDAQ")]),
    "dell": company("Dell Technologies", ["DELL", "Dell"], "infrastructure", [("DELL", "NYSE")]),
    "vertiv": company("Vertiv", ["VRT"], "infrastructure", [("VRT", "NYSE")]),
    "microsoft": company("Microsoft", ["MSFT", "Azure"], "infrastructure", [("MSFT", "NASDAQ")]),
    "schneider": company("Schneider Electric", ["SU", "Schneider Electric SE"], "infrastructure", [("SU.PA", "Euronext Paris")]),
    "siemens": company("Siemens", ["Siemens AG"], "applications", [("SIE.DE", "XETRA")]),
    "siemens-energy": company("Siemens Energy", ["Siemens Energy AG"], "energy", [("ENR.DE", "XETRA")]),
    "hon-hai": company("Hon Hai (Foxconn)", ["Hon Hai Precision Industry"], "infrastructure", [("2317.TW", "TWSE")]),
    "scale-ai": company("Scale AI", ["Scale"], "models"),
    "constellation": company("Constellation Energy", ["CEG"], "energy", [("CEG", "NASDAQ")]),
    "example-corp": company("Example Corp", [], "chips"),
}
MATCHER = ff.Matcher(COMPANIES, extra={"meta": ["Meta"], "constellation": ["Constellation"]},
                     ignore=["Scale"], exact_case=["Micron"])


def source(sid, kind, url, companies=(), excerpt=None):
    return {"id": sid, "name": sid.replace("-", " ").title(), "kind": kind, "url": url,
            "companies": list(companies), "excerpt": kind != "media" if excerpt is None else excerpt}


class FakeFetch:
    """Serves fixture bytes by URL and records every request."""

    def __init__(self, pages: dict):
        self.pages = pages
        self.calls: list[str] = []

    def __call__(self, url: str) -> ff.Response:
        self.calls.append(url)
        page = self.pages.get(url)
        if page is None:
            return ff.Response(url=url, status=404, error="HTTP 404")
        if isinstance(page, int):
            return ff.Response(url=url, status=page, error=f"HTTP {page}")
        body, ctype = page
        return ff.Response(url=url, status=200, body=body, content_type=ctype)


class DateTests(unittest.TestCase):
    def test_rss_dates(self):
        self.assertEqual(ff.iso(ff.parse_date("Mon, 12 Oct 2026 10:30:00 -0400")), "2026-10-12T14:30:00Z")
        self.assertEqual(ff.iso(ff.parse_date("Sun, 11 Oct 2026 16:00:00 EDT")), "2026-10-11T20:00:00Z")
        self.assertEqual(ff.iso(ff.parse_date("12 Oct 2026 10:30 GMT")), "2026-10-12T10:30:00Z")

    def test_atom_and_iso_dates(self):
        self.assertEqual(ff.iso(ff.parse_date("2026-10-13T08:30:00Z")), "2026-10-13T08:30:00Z")
        self.assertEqual(ff.iso(ff.parse_date("2026-10-12T15:00:00+02:00")), "2026-10-12T13:00:00Z")
        self.assertEqual(ff.iso(ff.parse_date("2026-10-11T07:15:00.123456789Z")), "2026-10-11T07:15:00Z")
        self.assertEqual(ff.iso(ff.parse_date("2026-10-13")), "2026-10-13T00:00:00Z")  # no zone: UTC

    def test_missing_or_bad_dates(self):
        for value in (None, "", "   ", "yesterday", "2026-13-45"):
            self.assertIsNone(ff.parse_date(value), value)


class FeedParsingTests(unittest.TestCase):
    def test_rss(self):
        entries = ff.parse_feed(fixture("rss-sample.xml"), "https://newsroom.example.com/feed/")
        self.assertEqual(len(entries), 5)
        first = entries[0]
        self.assertEqual(ff.html_to_text(first["title"]), "Test release: Vertiv & NVIDIA publish an 800 VDC reference design")
        self.assertEqual(ff.iso(first["published"]), "2026-10-12T14:30:00Z")
        self.assertIn("full text of a release", first["content"])
        self.assertEqual(ff.iso(entries[1]["published"]), "2026-10-13T08:00:00Z")  # dc:date
        self.assertIsNone(entries[3]["published"])
        self.assertEqual(entries[4]["url"], "https://newsroom.example.com/2026/10/11/guid-only/")  # guid permalink

    def test_atom(self):
        entries = ff.parse_feed(fixture("atom-sample.xml"), "https://media.example.com/feed.atom")
        self.assertEqual(len(entries), 7)
        self.assertEqual(entries[0]["url"], "https://media.example.com/2026/10/13/hbm4-item?utm_campaign=feed&ref=home#comments")
        self.assertEqual(ff.iso(entries[0]["published"]), "2026-10-13T08:30:00Z")  # published, not updated
        self.assertEqual(ff.iso(entries[5]["published"]), "2026-10-11T07:15:00Z")  # only <updated>
        self.assertEqual(ff.html_to_text(entries[5]["content"]), "The new region adds two data centers.")  # xhtml

    def test_sec_feed(self):
        entries = ff.parse_feed(fixture("sec-8k-atom.xml"))
        self.assertEqual(len(entries), 3)
        e = entries[0]
        self.assertEqual(e["url"], "https://www.sec.gov/Archives/edgar/data/1/000000000126000042/0000000001-26-000042-index.htm")
        self.assertEqual(e["extra"]["filing-type"], "8-K")
        self.assertEqual(e["extra"]["items-desc"], "items 2.02 and 9.01")
        self.assertEqual(ff.iso(e["published"]), "2026-10-12T20:05:09Z")

    def test_broken_xml_is_repaired(self):
        data = b'<?xml version="1.0"?><rss><channel><item><title>AT&T &nbsp;test</title>' \
               b'<link>https://example.com/a</link><pubDate>Mon, 12 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>'
        entries = ff.parse_feed(data)
        self.assertEqual(ff.html_to_text(entries[0]["title"]), "AT&T test")

    def test_not_a_feed(self):
        with self.assertRaises(ValueError):
            ff.parse_feed(b"<html><body><p>Hello</p></body></html>")


class WindowTests(unittest.TestCase):
    def test_rss_window(self):
        src = source("example-newsroom", "company", "https://newsroom.example.com/feed/", ["vertiv"])
        entries = ff.parse_feed(fixture("rss-sample.xml"), src["url"])
        items, undated = ff.feed_items(src, entries, MATCHER, NOW, 4)
        titles = [it["title"] for it in items]
        self.assertEqual(undated, 1)
        self.assertEqual(len(items), 3)
        self.assertNotIn("Test release: an older notice outside the window", titles)
        self.assertTrue(all(it["published"] >= "2026-10-09T12:00:00Z" for it in items))

    def test_shorter_window_and_future_entries(self):
        src = source("example-newsroom", "company", "https://newsroom.example.com/feed/")
        entries = ff.parse_feed(fixture("rss-sample.xml"), src["url"])
        items, _ = ff.feed_items(src, entries, MATCHER, NOW, 1)
        self.assertEqual([it["published"] for it in items], ["2026-10-12T14:30:00Z", "2026-10-13T08:00:00Z"])
        future = [{"title": "x", "url": "https://example.com/f", "published": NOW + timedelta(days=3),
                   "summary": "", "content": "", "extra": {}, "category": ""}]
        self.assertEqual(ff.feed_items(src, future, MATCHER, NOW, 4)[0], [])


class UrlTests(unittest.TestCase):
    def test_canonical_url(self):
        self.assertEqual(
            ff.canonical_url("HTTPS://News.Example.COM:443/Path/Story?id=7&utm_source=rss&UTM_Medium=x#top"),
            "https://news.example.com/Path/Story?id=7",
        )
        self.assertEqual(ff.canonical_url("https://example.com"), "https://example.com/")
        self.assertEqual(ff.canonical_url("http://example.com:80/a?utm_campaign=z"), "http://example.com/a")

    def test_id(self):
        a = ff.item_id("https://news.example.com/story?utm_source=feed#comments")
        b = ff.item_id("HTTPS://NEWS.EXAMPLE.COM/story")
        self.assertEqual(a, b)
        self.assertEqual(len(a), 12)
        self.assertEqual(a, hashlib.sha1(b"https://news.example.com/story").hexdigest()[:12])
        self.assertNotEqual(a, ff.item_id("https://news.example.com/Story"))  # paths keep their case


class MatchTests(unittest.TestCase):
    def match(self, text):
        return MATCHER.companies_in(text)

    def test_long_names_ignore_case_on_word_boundaries(self):
        self.assertEqual(self.match("Intel unveils a new CPU"), {"intel"})
        self.assertEqual(self.match("INTEL and Nvidia Corporation"), {"intel", "nvidia"})
        self.assertEqual(self.match("Artificial intelligence and business intelligence"), set())
        self.assertEqual(self.match("Vertiv's results"), {"vertiv"})

    def test_short_names_are_case_sensitive(self):
        self.assertEqual(self.match("Arm shares rise"), {"arm"})
        self.assertEqual(self.match("an arm of the company"), set())
        self.assertEqual(self.match("AMD-powered servers"), {"amd"})
        self.assertEqual(self.match("amd lowercase"), set())
        self.assertEqual(self.match("Dell and Meta sign a deal"), {"dell", "meta"})
        self.assertEqual(self.match("meta-analysis of the metaverse"), set())
        self.assertEqual(self.match("TSMC ramps 2nm"), {"tsmc"})

    def test_aliases(self):
        self.assertEqual(self.match("Advanced Micro Devices and SK Hynix Inc."), {"amd", "sk-hynix"})
        self.assertEqual(self.match("Facebook parent"), {"meta"})
        self.assertEqual(self.match("輝達 and 超微"), set())  # Chinese aliases are skipped

    def test_tickers_only_in_exchange_patterns(self):
        self.assertEqual(self.match("NVDA and INTC rallied"), set())
        self.assertEqual(self.match("Vertiv Holdings Co (NYSE: VRT) said"), {"vertiv"})
        self.assertEqual(self.match("(NASDAQ: NVDA)"), {"nvidia"})
        self.assertEqual(self.match("Nasdaq:INTC and $AMD"), {"intel", "amd"})
        self.assertEqual(self.match("listed in Taiwan (TWSE: 2330) and Korea (KRX: 000660)"), {"tsmc", "sk-hynix"})
        # SU is Schneider's ticker in Paris only; NYSE: SU is another company.
        self.assertEqual(self.match("(NYSE: SU)"), set())
        self.assertEqual(self.match("(Euronext Paris: SU)"), {"schneider"})
        self.assertEqual(self.match("$5B deal"), set())

    def test_overlaps_prefer_the_longest_name(self):
        self.assertEqual(self.match("Siemens Energy wins a turbine order"), {"siemens-energy"})
        self.assertEqual(self.match("Siemens and Siemens Energy"), {"siemens", "siemens-energy"})

    def test_match_config(self):
        self.assertEqual(self.match("Hon Hai (Foxconn) and Foxconn"), {"hon-hai"})  # name in parentheses
        self.assertEqual(self.match("growth at scale"), set())                       # ignored alias
        self.assertEqual(self.match("Scale AI raises"), {"scale-ai"})
        self.assertEqual(self.match("a 3-micron pitch"), set())                      # exact case only
        self.assertEqual(self.match("Micron raises guidance"), {"micron"})
        self.assertEqual(self.match("Constellation signs a PPA"), {"constellation"})  # extra name
        self.assertEqual(self.match("a satellite constellation"), set())


class LayerTests(unittest.TestCase):
    def test_keywords(self):
        cases = {
            "Utility signs a 20-year power purchase agreement": {"energy"},
            "A 1.2 GW campus and a 300MW plant": {"energy"},
            "TSMC expands CoWoS and HBM4 packaging": {"chips"},
            "New data centres and hyperscalers": {"infrastructure"},
            "Open-weight LLMs get cheaper": {"models"},
            "Robotaxis and humanoid robots": {"applications"},
            "AI agents need GPUs in data centers": {"applications", "chips", "infrastructure"},
        }
        for text, layers in cases.items():
            self.assertEqual(ff.keyword_layers(text), layers, text)

    def test_ignored_phrases_and_boundaries(self):
        for text in ("Blue-chip stocks rally", "She chipped in", "A transformer model for vision",
                     "the chipotle menu", "rack up gains", "switch to a new plan"):
            self.assertEqual(ff.keyword_layers(text), set(), text)
        self.assertEqual(ff.keyword_layers("Transformer shortage hits utilities"), {"energy"})

    def test_company_layers_are_added(self):
        item = {"companies": [], "layers": []}
        found, keywords = ff.tag_item(item, MATCHER, ["Constellation and Meta"], ["vertiv"])
        self.assertEqual(found, {"constellation", "meta"})
        self.assertEqual(keywords, set())
        self.assertEqual(item["companies"], ["constellation", "meta", "vertiv"])
        self.assertEqual(item["layers"], ["applications", "energy", "infrastructure"])


class RelevanceTests(unittest.TestCase):
    def test_media_needs_a_company_or_keyword(self):
        src = source("example-media", "media", "https://media.example.com/feed.atom")
        entries = ff.parse_feed(fixture("atom-sample.xml"), src["url"])
        items, _ = ff.feed_items(src, entries, MATCHER, NOW, 4)
        self.assertEqual(sorted(it["title"] for it in items), [
            "Test entry: Microsoft opens a cloud region",
            "Test entry: Nvidia and SK Hynix in an HBM4 supply item",
            "Test entry: utility plans 1.2 GW of gas turbines",
        ])
        hbm = next(it for it in items if "HBM4" in it["title"])
        self.assertEqual(hbm["companies"], ["nvidia", "sk-hynix"])
        self.assertEqual(hbm["layers"], ["chips"])
        self.assertEqual(hbm["url"], "https://media.example.com/2026/10/13/hbm4-item?ref=home")
        self.assertEqual(hbm["summary"], "A test summary about memory supply.")  # "Read more" dropped
        self.assertNotIn("excerpt", hbm)  # never for media

    def test_primary_sources_keep_everything(self):
        src = source("example-media-as-company", "company", "https://media.example.com/feed.atom")
        entries = ff.parse_feed(fixture("atom-sample.xml"), src["url"])
        items, _ = ff.feed_items(src, entries, MATCHER, NOW, 4)
        self.assertEqual(len(items), 6)  # all but the old entry


class ItemTests(unittest.TestCase):
    def test_rss_item_fields(self):
        src = source("example-newsroom", "company", "https://newsroom.example.com/feed/", ["vertiv"])
        entries = ff.parse_feed(fixture("rss-sample.xml"), src["url"])
        items, _ = ff.feed_items(src, entries, MATCHER, NOW, 4)
        first = items[0]
        self.assertEqual(first["url"], "https://newsroom.example.com/2026/10/12/reference-design/")
        self.assertEqual(first["id"], ff.item_id(first["url"]))
        self.assertEqual(first["summary"], "Vertiv (NYSE: VRT) and NVIDIA (NASDAQ: NVDA) describe a test design for this fixture.")
        self.assertEqual(first["companies"], ["nvidia", "vertiv"])
        self.assertIn("infrastructure", first["layers"])
        self.assertTrue(first["excerpt"].startswith("This fixture paragraph"))  # from content:encoded
        self.assertNotIn("excerpt", items[1])  # a short teaser: the page will be opened instead
        self.assertEqual(items[2]["summary"], "Only a guid permalink, no link element.")
        for item in items:
            self.assertLessEqual(len(item["summary"]), ff.SUMMARY_CHARS)

    def test_sec_items_and_title(self):
        src = source("sec-example-8k", "filing", "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=EXMP&type=8-K&output=atom", ["example-corp"])
        entries = ff.parse_feed(fixture("sec-8k-atom.xml"), src["url"])
        self.assertEqual(ff.sec_items(entries[0]["summary"], entries[0]["extra"]), [
            ("2.02", "Results of Operations and Financial Condition"),
            ("9.01", "Financial Statements and Exhibits"),
        ])
        self.assertEqual([n for n, _ in ff.sec_items(entries[1]["summary"], entries[1]["extra"])], ["7.01", "9.01"])
        items, _ = ff.feed_items(src, entries, MATCHER, NOW, 4)
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["title"], "Example Corp 8-K: Results of Operations and Financial Condition (2.02); "
                                            "Financial Statements and Exhibits (9.01)")
        self.assertEqual(items[0]["items"], ["2.02", "9.01"])
        self.assertEqual(items[1]["title"], "Example Corp 8-K/A: Item 7.01; Item 9.01")
        self.assertEqual(items[0]["companies"], ["example-corp"])


class TextTests(unittest.TestCase):
    def test_clip(self):
        self.assertEqual(ff.clip("short text", 600), "short text")
        clipped = ff.clip("word " * 200, 50)
        self.assertLessEqual(len(clipped), 50)
        self.assertTrue(clipped.endswith("word…"))

    def test_feed_boilerplate(self):
        self.assertEqual(ff.strip_feed_tail("Body text. The post Title appeared first on Site."), "Body text.")
        self.assertEqual(ff.strip_feed_tail("Body text […]"), "Body text")
        self.assertEqual(ff.strip_feed_tail("Body text. Read more »"), "Body text.")

    def test_page_excerpt(self):
        text = ff.page_excerpt(fixture("press-release.html").decode("utf-8"))
        self.assertTrue(text.startswith("SANTA CLARA, Calif., Oct. 13, 2026 – Example Corp"))
        self.assertIn("Read the notice for details.", text)          # inline links stay in the paragraph
        self.assertIn("An unclosed third paragraph continues here", text)
        self.assertIn("\n\nThe second paragraph mentions Vertiv", text)
        for unwanted in ("cookies", "Home", "tagline", "Share this", "Related:", "Copyright", "script text",
                         "October 13, 2026\n", "seventh paragraph"):
            self.assertNotIn(unwanted, text)
        self.assertLessEqual(len(text), ff.EXCERPT_CHARS)
        self.assertTrue(text.endswith("…"))

    def test_page_without_paragraphs(self):
        self.assertEqual(ff.page_excerpt("<div>Only a div with text in it, and no paragraph tags at all.</div>"),
                         "Only a div with text in it, and no paragraph tags at all.")
        self.assertEqual(ff.page_excerpt("<script>x()</script>"), "")

    def test_sec_document_choice(self):
        url = "https://www.sec.gov/Archives/edgar/data/1/000000000126000042/0000000001-26-000042-index.htm"
        found = ff.sec_document_url(fixture("sec-8k-index.html").decode("utf-8"), url)
        self.assertEqual(found, ("https://www.sec.gov/Archives/edgar/data/1/000000000126000042/exmp-ex99_1.htm", "EX-99.1"))
        no_ex991 = fixture("sec-8k-index.html").decode("utf-8").replace("EX-99.1", "EX-101.INS")
        self.assertEqual(ff.sec_document_url(no_ex991, url)[1], "EX-99.2")
        main_only = "<table><tr><th>Seq</th><th>Description</th><th>Document</th><th>Type</th></tr>" \
                    "<tr><td>1</td><td>8-K</td><td><a href=\"/ix?doc=/Archives/x/main.htm\">main.htm</a></td><td>8-K</td></tr></table>"
        self.assertEqual(ff.sec_document_url(main_only, url), ("https://www.sec.gov/Archives/x/main.htm", "8-K"))

    def test_sec_document_text(self):
        text = ff.document_text(fixture("sec-ex99-1.htm").decode("utf-8"))
        self.assertTrue(text.startswith("Exhibit 99.1\n\nExample Corp Reports Results"))
        self.assertNotIn("hidden inline XBRL", text)
        cover = "<p>UNITED STATES SECURITIES AND EXCHANGE COMMISSION</p><p>Item 5.02 Departure of Directors.</p><p>Body.</p>"
        self.assertTrue(ff.document_text(cover, from_item=True).startswith("Item 5.02 Departure"))


class MergeTests(unittest.TestCase):
    def item(self, n, published, **extra):
        return {"id": f"id{n:04d}", "title": f"t{n}", "url": f"https://example.com/{n}", "published": published,
                "source": "s", "sourceName": "S", "kind": "company", "summary": "", "companies": [], "layers": [], **extra}

    def test_dedupe_keeps_earlier_excerpt_and_drops_old(self):
        previous = [
            self.item(1, "2026-10-12T10:00:00Z", title="old title", excerpt="earlier excerpt"),
            self.item(2, "2026-10-01T10:00:00Z"),                         # outside the window
            self.item(3, "2026-10-12T09:00:00+00:00", source="gone"),     # source no longer listed
            self.item(4, "not a date"),
            {"title": "no id"},
            "not an item",
        ]
        new = [self.item(1, "2026-10-12T10:00:00Z", title="new title"), self.item(5, "2026-10-13T11:00:00Z")]
        merged = ff.merge(new, previous, NOW, 4, known_sources={"s"})
        self.assertEqual([it["id"] for it in merged], ["id0005", "id0001"])
        self.assertEqual(merged[1]["title"], "new title")         # the newer fetch wins
        self.assertEqual(merged[1]["excerpt"], "earlier excerpt")  # but keeps the excerpt

    def test_new_excerpt_wins_and_errors_carry(self):
        previous = [self.item(1, "2026-10-12T10:00:00Z", excerpt="old"), self.item(2, "2026-10-12T10:00:00Z", excerptError="HTTP 404")]
        new = [self.item(1, "2026-10-12T10:00:00Z", excerpt="fresh"), self.item(2, "2026-10-12T10:00:00Z")]
        merged = {it["id"]: it for it in ff.merge(new, previous, NOW, 4)}
        self.assertEqual(merged["id0001"]["excerpt"], "fresh")
        self.assertEqual(merged["id0002"]["excerptError"], "HTTP 404")

    def test_sort_and_cap(self):
        start = NOW - timedelta(days=3)
        new = [self.item(n, ff.iso(start + timedelta(minutes=n))) for n in range(600)]
        merged = ff.merge(new, [], NOW, 4)
        self.assertEqual(len(merged), ff.MAX_ITEMS)
        self.assertEqual(merged[0]["id"], "id0599")
        self.assertEqual(merged[-1]["id"], "id0100")

    def test_previous_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad = os.path.join(tmp, "bad.json")
            with open(bad, "w") as f:
                f.write("{not json")
            self.assertEqual(ff.load_previous(bad), [])
            self.assertEqual(ff.load_previous(os.path.join(tmp, "missing.json")), [])
            self.assertEqual(ff.load_previous(""), [])
            good = os.path.join(tmp, "prev.json")
            with open(good, "w") as f:
                json.dump({"items": [self.item(1, "2026-10-12T10:00:00Z"), 7]}, f)
            self.assertEqual(len(ff.load_previous(good)), 1)


class FetcherTests(unittest.TestCase):
    class Scripted(ff.HttpFetcher):
        def __init__(self, responses):
            self.sleeps = []
            super().__init__(sleep=self.sleeps.append)
            self.responses = list(responses)
            self.agents = []

        def request(self, url, user_agent):
            self.agents.append(user_agent)
            return self.responses.pop(0)

    def test_one_retry_on_transient_errors(self):
        f = self.Scripted([ff.Response("u", 503, error="HTTP 503"), ff.Response("u", 200, b"ok")])
        self.assertTrue(f("https://example.com/feed").ok)
        self.assertEqual(f.sleeps, [ff.RETRY_DELAY])
        f = self.Scripted([ff.Response("u", error="timeout"), ff.Response("u", error="timeout")])
        self.assertEqual(f("https://example.com/feed").error, "timeout")
        self.assertEqual(len(f.agents), 2)

    def test_no_retry_on_404_and_sec_user_agent(self):
        f = self.Scripted([ff.Response("u", 404, error="HTTP 404")])
        self.assertEqual(f("https://www.sec.gov/cgi-bin/browse-edgar").status, 404)
        self.assertEqual(f.sleeps, [])
        self.assertEqual(f.agents, [ff.SEC_USER_AGENT])

    def test_decompress(self):
        self.assertEqual(ff.decompress(gzip.compress(b"<rss/>"), "gzip"), b"<rss/>")
        self.assertEqual(ff.decompress(b"<rss/>", ""), b"<rss/>")


class PipelineTests(unittest.TestCase):
    NEWSROOM = "https://newsroom.example.com/feed/"
    MEDIA = "https://media.example.com/feed.atom"
    SEC = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=EXMP&type=8-K&dateb=&owner=include&count=10&output=atom"
    INDEX = "https://www.sec.gov/Archives/edgar/data/1/000000000126000042/0000000001-26-000042-index.htm"
    EXHIBIT = "https://www.sec.gov/Archives/edgar/data/1/000000000126000042/exmp-ex99_1.htm"
    INDEX_503 = "https://www.sec.gov/Archives/edgar/data/1/000000000126000043/0000000001-26-000043-index.htm"
    PAGE = "https://newsroom.example.com/2026/10/13/Dividend-Notice/"

    def setUp(self):
        self.sources = [
            source("example-newsroom", "company", self.NEWSROOM, ["vertiv"]),
            source("example-media", "media", self.MEDIA),
            source("sec-example-8k", "filing", self.SEC, ["example-corp"]),
            source("dead-feed", "media", "https://dead.example.org/feed"),
            source("not-a-feed", "regulator", "https://notfeed.example.org/"),
        ]
        self.fetch = FakeFetch({
            self.NEWSROOM: (fixture("rss-sample.xml"), "application/rss+xml"),
            self.MEDIA: (fixture("atom-sample.xml"), "application/atom+xml"),
            self.SEC: (fixture("sec-8k-atom.xml"), "application/atom+xml"),
            "https://notfeed.example.org/": (b"<html><body><p>Hello</p></body></html>", "text/html"),
            self.PAGE: (fixture("press-release.html"), "text/html; charset=utf-8"),
            self.INDEX: (fixture("sec-8k-index.html"), "text/html"),
            self.EXHIBIT: (fixture("sec-ex99-1.htm"), "text/html"),
            self.INDEX_503: 503,
        })

    def test_run(self):
        doc, status, stats = ff.run(self.sources, MATCHER, [], NOW, fetch=self.fetch)
        self.assertEqual(doc["generatedAt"], "2026-10-13T12:00:00Z")
        self.assertEqual(doc["days"], 4)
        self.assertEqual(doc["sources"], 3)
        self.assertEqual(status["example-newsroom"], {"ok": True, "status": 200, "entries": 5, "kept": 3,
                                                      "at": "2026-10-13T12:00:00Z", "undated": 1})
        self.assertEqual((status["example-media"]["entries"], status["example-media"]["kept"]), (7, 3))
        self.assertEqual(status["sec-example-8k"]["kept"], 2)
        self.assertEqual(status["dead-feed"], {"ok": False, "status": 404, "entries": 0, "kept": 0, "at": "2026-10-13T12:00:00Z"})
        self.assertFalse(status["not-a-feed"]["ok"])
        self.assertTrue(status["not-a-feed"]["status"].startswith("parse error: not an RSS or Atom feed"))

        items = doc["items"]
        self.assertEqual(len(items), 8)
        self.assertEqual([it["published"] for it in items], sorted((it["published"] for it in items), reverse=True))
        by_url = {it["url"]: it for it in items}

        page = by_url[self.PAGE.replace("NEWSROOM.EXAMPLE.COM", "newsroom.example.com")]
        self.assertTrue(page["excerpt"].startswith("SANTA CLARA"))
        self.assertIn("infrastructure", page["layers"])  # "data center" in the excerpt

        guid_only = by_url["https://newsroom.example.com/2026/10/11/guid-only/"]
        self.assertEqual(guid_only["excerptError"], "HTTP 404")

        filing = by_url[self.INDEX]
        self.assertEqual(filing["items"], ["2.02", "9.01"])
        self.assertEqual(filing["excerptUrl"], self.EXHIBIT)
        self.assertTrue(filing["excerpt"].startswith("Exhibit 99.1"))
        self.assertEqual(filing["companies"], ["example-corp", "micron", "nvidia"])  # named in the exhibit

        retry = by_url[self.INDEX_503]
        self.assertNotIn("excerpt", retry)
        self.assertNotIn("excerptError", retry)  # transient: tried again next run
        self.assertEqual(stats, {"new": 8, "fetched": 2, "failed": 1, "retry": 1})

        media_urls = {it["url"] for it in items if it["kind"] == "media"}
        self.assertEqual(len(media_urls), 3)
        self.assertFalse(media_urls & set(self.fetch.calls))  # media pages are never opened
        self.assertNotIn("https://newsroom.example.com/2026/10/12/reference-design/", self.fetch.calls)  # feed body used
        self.assertEqual(list(items[0])[:10], ["id", "title", "url", "published", "source", "sourceName",
                                               "kind", "summary", "companies", "layers"])

    def test_previous_excerpts_are_not_fetched_again(self):
        first, _, _ = ff.run(self.sources, MATCHER, [], NOW, fetch=self.fetch)
        self.fetch.calls.clear()
        second, _, stats = ff.run(self.sources, MATCHER, first["items"], NOW + timedelta(hours=2), fetch=self.fetch)
        opened = set(self.fetch.calls) - {s["url"] for s in self.sources}
        self.assertEqual(opened, {self.INDEX_503})  # only the transient failure is retried
        self.assertEqual(stats["new"], 0)
        self.assertEqual(len(second["items"]), len(first["items"]))
        page = next(it for it in second["items"] if it["url"].endswith("/Dividend-Notice/"))
        self.assertTrue(page["excerpt"].startswith("SANTA CLARA"))

    def test_only_a_few_sources_keeps_other_items(self):
        first, _, _ = ff.run(self.sources, MATCHER, [], NOW, fetch=self.fetch)
        second, status, _ = ff.run(self.sources[:1], MATCHER, first["items"], NOW, fetch=self.fetch,
                                   excerpts=False, all_sources=self.sources)
        self.assertEqual(list(status), ["example-newsroom"])
        self.assertEqual(len(second["items"]), len(first["items"]))
        dropped, _, _ = ff.run(self.sources[:1], MATCHER, first["items"], NOW, fetch=self.fetch,
                               excerpts=False, all_sources=self.sources[:1])
        self.assertEqual({it["source"] for it in dropped["items"]}, {"example-newsroom"})  # removed sources

    def test_no_excerpts_and_outputs(self):
        doc, status, _ = ff.run(self.sources, MATCHER, [], NOW, fetch=self.fetch, excerpts=False)
        self.assertNotIn(self.PAGE, self.fetch.calls)
        with tempfile.TemporaryDirectory() as tmp:
            ff.write_outputs(tmp, doc, status)
            self.assertEqual(sorted(os.listdir(tmp)), ["README.md", "news-candidates.json", "sources-status.json"])
            with open(os.path.join(tmp, "news-candidates.json"), encoding="utf-8") as f:
                self.assertEqual(json.load(f)["items"], doc["items"])
            with open(os.path.join(tmp, "README.md"), encoding="utf-8") as f:
                self.assertIn("in the last 4 days", " ".join(f.read().split()))


class ConfigTests(unittest.TestCase):
    def test_load_sources_validation(self):
        warnings = []
        doc = {"sources": [
            {"id": "a", "name": "A", "kind": "media", "url": "https://a.example.com/feed", "excerpt": True},
            {"id": "b", "name": "B", "kind": "company", "url": "https://b.example.com/feed", "companies": ["nvidia", "nope"]},
        ]}
        sources = ff.load_sources(doc, set(COMPANIES), warn=warnings.append)
        self.assertFalse(sources[0]["excerpt"])
        self.assertEqual(sources[1]["companies"], ["nvidia"])
        self.assertEqual(len(warnings), 2)
        for bad in ({"sources": []},
                    {"sources": [{"id": "a", "kind": "media", "url": "https://x"}, {"id": "a", "kind": "media", "url": "https://y"}]},
                    {"sources": [{"id": "a", "kind": "blog", "url": "https://x"}]},
                    {"sources": [{"id": "a", "kind": "media", "url": "ftp://x"}]},
                    {"sources": [{"id": "Bad Id", "kind": "media", "url": "https://x"}]}):
            with self.assertRaises(ValueError):
                ff.load_sources(bad, set(COMPANIES), warn=warnings.append)

    def test_unknown_only_ids(self):
        with contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(ff.main(["--out", tempfile.gettempdir(), "--only", "no-such-source"]), 2)
        self.assertIn("no-such-source", err.getvalue())


class RepositoryConfigTests(unittest.TestCase):
    """Checks content/news-sources.yaml against the real company list."""

    @classmethod
    def setUpClass(cls):
        cls.companies = ff.load_companies()
        cls.doc = ff.load_yaml(ff.SOURCES_FILE)
        cls.warnings = []
        cls.sources = ff.load_sources(cls.doc, set(cls.companies), warn=cls.warnings.append)
        extra, ignore, exact = ff.load_match(cls.doc, set(cls.companies), warn=cls.warnings.append)
        cls.matcher = ff.Matcher(cls.companies, extra, ignore, exact)

    def test_sources_file_is_clean(self):
        self.assertEqual(self.warnings, [])
        self.assertTrue(45 <= len(self.sources) <= 65, len(self.sources))
        self.assertEqual({s["kind"] for s in self.sources}, set(ff.KINDS))
        for raw in self.doc["sources"]:
            if raw["kind"] == "media":
                self.assertNotIn("excerpt", raw, raw["id"])
            self.assertTrue(raw["url"].startswith("https://"), raw["id"])

    def test_match_config_names_exist(self):
        names = {t.lower() for rec in self.companies.values() for t, _ in ff.Matcher._names(rec)}
        _, ignore, exact = ff.load_match(self.doc, set(self.companies))
        self.assertEqual([w for w in ignore + exact if w.lower() not in names], [])

    def test_every_layer_has_a_company_source(self):
        layers = {self.companies[c]["layer"] for s in self.sources for c in s["companies"]}
        self.assertEqual(layers, {"energy", "chips", "infrastructure", "models", "applications"})

    def test_real_matching(self):
        m = self.matcher.companies_in
        self.assertEqual(m("Nvidia and SK Hynix sign an HBM4 deal with TSMC"), {"nvidia", "sk-hynix", "tsmc"})
        self.assertEqual(m("Meta and Arista expand AWS and OCI clusters"), {"meta", "arista", "amazon", "oracle"})
        self.assertEqual(m("Siemens Energy wins a turbine order"), {"siemens-energy"})
        self.assertEqual(m("Shares surge together at scale in North America; the first solar farm"), set())
        self.assertEqual(m("artificial intelligence and a walkie-talkie"), set())


if __name__ == "__main__":
    unittest.main()
