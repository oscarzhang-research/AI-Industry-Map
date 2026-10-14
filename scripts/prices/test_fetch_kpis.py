"""Offline tests for fetch_kpis.py. From the repository root:

    python3 -m unittest discover -s scripts/prices -p 'test_*.py'

The fixtures in scripts/prices/fixtures/ are hand-made samples in the real formats, with synthetic
values: companyfacts_fiscal_july.json (SEC companyfacts for a company with a July-June fiscal year),
twse_t187ap05_L.json (TWSE OpenAPI monthly revenue) and mops_t21sc03_115_8_0.html (a MOPS monthly
summary page for 2026-08, Big5-encoded). No test touches the network.
"""
from __future__ import annotations

import contextlib
import gzip
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.error
from datetime import date, datetime, timedelta, timezone
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetch_kpis as k  # noqa: E402

FIXTURES = os.path.join(HERE, "fixtures")
NOW = datetime(2026, 10, 13, 21, 40, tzinfo=timezone.utc)
B = 1_000_000_000


def fixture(name: str) -> bytes:
    with open(os.path.join(FIXTURES, name), "rb") as f:
        return f.read()


def load(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def quiet(*_args) -> None:
    pass


class FakeHttp:
    """Canned responses by URL (bytes or an exception to raise), then fallback(url); else a 404."""

    def __init__(self, routes: dict | None = None, fallback=None):
        self.routes = routes or {}
        self.fallback = fallback or (lambda url: None)
        self.calls: list[str] = []

    def get(self, url, headers=None, group=None):
        self.calls.append(url)
        response = self.routes.get(url)
        if response is None:
            response = self.fallback(url)
        if response is None:
            raise k.HttpError(url, 404)
        if isinstance(response, Exception):
            raise response
        return response


def facts(*rows, form="10-Q", filed="2024-01-01", accn="0000000000-24-000001") -> list[k.Fact]:
    """Facts from (start, end, value) tuples."""
    return [k.Fact(date.fromisoformat(s), date.fromisoformat(e), v, 2024, "Q1", form, filed, accn)
            for s, e, v in rows]


# A foreign-issuer (-KY) page with a one-row header, as an inline Big5 sample.
FOREIGN_PAGE = (
    "<html><head><meta charset='big5'></head><body><table class='hasBorder'>"
    "<tr><th>公司<br>代號</th><th>公司名稱</th><th>當月營收</th><th>上月營收</th><th>去年當月營收</th>"
    "<th>上月比較<br>增減(%)</th><th>去年同月<br>增減(%)</th><th>當月累計營收</th><th>去年累計營收</th>"
    "<th>前期比較<br>增減(%)</th><th>備註</th></tr>"
    "<tr><td>3661</td><td>世芯-KY</td><td>8,000,000</td><td>7,500,000</td><td>5,000,000</td><td>6.67</td>"
    "<td>60.00</td><td>50,000,000</td><td>30,000,000</td><td>66.67</td><td>-</td></tr>"
    "</table></body></html>"
).encode("cp950")


class HelperTests(unittest.TestCase):
    def test_sec_throttle(self):
        recent, key = "2026-10-13T08:00:00+00:00", k.SEC_CONCEPTS_KEY
        self.assertTrue(k.sec_throttled({"at": recent, "concepts": key, "skipped": 1}, NOW, 20))  # 1 company skipped
        self.assertFalse(k.sec_throttled({"at": recent, "concepts": key, "skipped": "needs SEC_USER_AGENT"}, NOW, 20))
        self.assertFalse(k.sec_throttled({"at": recent}, NOW, 20))  # made before the concept key existed
        self.assertFalse(k.sec_throttled({"at": recent, "concepts": "00000000"}, NOW, 20))  # other concept lists
        self.assertFalse(k.sec_throttled({"at": "2026-10-12T21:00:00+00:00", "concepts": key}, NOW, 20))
        self.assertFalse(k.sec_throttled({"at": recent, "concepts": key}, NOW, 0))
        self.assertFalse(k.sec_throttled({}, NOW, 20))

    def test_safe_symbol_matches_the_site(self):
        self.assertEqual(k.safe_symbol("BRK-B"), "BRK-B")
        self.assertEqual(k.safe_symbol("2330.TW"), "2330.TW")
        self.assertEqual(k.safe_symbol("^TWII"), "_TWII")
        self.assertEqual(k.safe_symbol("A/B C"), "A_B_C")

    def test_roc_month_conversion(self):
        self.assertEqual(k.roc_to_month("11509"), "2026-09")
        self.assertEqual(k.roc_to_month(11501), "2026-01")
        self.assertEqual(k.roc_to_month("115/9"), "2026-09")
        self.assertEqual(k.roc_to_month("115年10月"), "2026-10")
        self.assertEqual(k.roc_to_month("9912"), "2010-12")
        self.assertEqual(k.roc_to_month("202609"), "2026-09")
        for bad in ("11513", "11500", "", None, "1151012", "abc"):
            self.assertIsNone(k.roc_to_month(bad), bad)
        self.assertEqual(k.month_to_roc("2026-09"), (115, 9))
        self.assertEqual(k.month_add("2026-01", -1), "2025-12")
        self.assertEqual(k.month_add("2025-12", 13), "2027-01")

    def test_mops_url_uses_roc_year_and_unpadded_month(self):
        self.assertEqual(k.mops_url(k.MOPS_HOSTS[0], "sii", "2026-08", 0),
                         "https://mopsov.twse.com.tw/nas/t21/sii/t21sc03_115_8_0.html")
        self.assertEqual(k.mops_url(k.MOPS_HOSTS[0], "otc", "2025-12", 1),
                         "https://mopsov.twse.com.tw/nas/t21/otc/t21sc03_114_12_1.html")

    def test_expected_latest_month_follows_the_tenth_in_taipei(self):
        self.assertEqual(k.expected_latest_month(NOW), "2026-09")
        self.assertEqual(k.expected_latest_month(datetime(2026, 10, 5, tzinfo=timezone.utc)), "2026-08")
        # 17:00 UTC on the 10th is already the 11th in Taipei.
        self.assertEqual(k.expected_latest_month(datetime(2026, 10, 10, 17, tzinfo=timezone.utc)), "2026-09")

    def test_parse_number(self):
        self.assertEqual(k.parse_number(" 1,234,567 "), 1234567.0)
        self.assertEqual(k.parse_number("\xa0-4.30"), -4.3)
        self.assertEqual(k.parse_number("12.5%"), 12.5)
        for blank in ("", "-", None, "N/A", True):
            self.assertIsNone(k.parse_number(blank))


class SecSeriesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = json.loads(fixture("companyfacts_fiscal_july.json"))
        cls.doc = k.build_sec_doc(cls.raw, "EXFC", 1234567, "example-fiscal", NOW)

    def by_end(self, series: str) -> dict[str, dict]:
        return {q["end"]: q for q in self.doc[series]}

    def test_document_header(self):
        self.assertEqual(self.doc["symbol"], "EXFC")
        self.assertEqual(self.doc["cik"], "0001234567")
        self.assertEqual(self.doc["name"], "EXAMPLE FISCAL CORP")
        self.assertEqual(self.doc["company"], "example-fiscal")
        self.assertEqual(self.doc["updatedAt"], "2026-10-13T21:40:00+00:00")

    def test_revenue_quarters_direct_and_derived(self):
        revenue = self.doc["revenue"]
        self.assertEqual([q["value"] / B for q in revenue],
                         [9.0, 9.5, 10.0, 10.5, 10.0, 11.2, 12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0])
        self.assertEqual([q["end"] for q in revenue], sorted(q["end"] for q in revenue))
        # Fourth quarters only exist as FY minus nine months.
        self.assertEqual([q["end"] for q in revenue if q["derived"]],
                         ["2023-06-30", "2024-06-30", "2025-06-30"])
        q4 = self.by_end("revenue")["2025-06-30"]
        self.assertEqual((q4["start"], q4["form"], q4["filed"], q4["fy"], q4["fp"]),
                         ("2025-04-01", "10-K", "2025-07-30", 2025, "Q4"))
        self.assertEqual({q["concept"] for q in revenue},
                         {"RevenueFromContractWithCustomerExcludingAssessedTax"})

    def test_restatement_latest_filing_wins_but_label_comes_from_the_original(self):
        q = self.by_end("revenue")["2023-12-31"]
        self.assertEqual(q["value"], int(11.2 * B))  # restated in the FY2025 Q2 10-Q
        self.assertEqual(q["filed"], "2025-01-29")
        self.assertFalse(q["derived"])
        self.assertEqual((q["fy"], q["fp"]), (2024, "Q2"))  # not the comparative filing's fy 2025
        # The derived Q4 of FY2024 uses the restated year and nine months: 46.2 - 33.2.
        self.assertEqual(self.by_end("revenue")["2024-06-30"]["value"], int(13.0 * B))

    def test_comparative_only_quarters_are_labelled_by_counting(self):
        first = self.doc["revenue"][:5]
        self.assertEqual([(q["fy"], q["fp"]) for q in first],
                         [(2023, "Q1"), (2023, "Q2"), (2023, "Q3"), (2023, "Q4"), (2024, "Q1")])

    def test_capex_ytd_differencing_across_a_july_june_year(self):
        capex = self.by_end("capex")
        self.assertEqual(len(capex), 12)
        expected = {"2022-12-31": 1.7, "2023-03-31": 1.8, "2023-06-30": 2.0, "2023-12-31": 2.5,
                    "2024-03-31": 3.0, "2024-06-30": 3.5, "2024-12-31": 4.5, "2025-03-31": 5.0}
        for end, value in expected.items():
            self.assertAlmostEqual(capex[end]["value"] / B, value, places=6, msg=end)
            self.assertTrue(capex[end]["derived"], end)
        self.assertEqual(capex["2023-12-31"]["start"], "2023-10-01")
        self.assertEqual((capex["2024-12-31"]["fy"], capex["2024-12-31"]["fp"]), (2025, "Q2"))
        self.assertFalse(capex["2025-09-30"]["derived"])

    def test_negative_derived_quarter_is_dropped(self):
        # FY2025 capex (12.0) is below the nine-month figure (13.5).
        self.assertNotIn("2025-06-30", self.by_end("capex"))

    def test_annual_only_concept_and_other_forms_are_ignored(self):
        # Revenues has FY totals only (46.5 and 63.5); the S-1 fact for 2021 is not a 10-Q or 10-K.
        self.assertEqual(self.by_end("revenue")["2025-06-30"]["value"], int(17.0 * B))
        self.assertFalse([q for q in self.doc["revenue"] if q["start"] < "2022-07-01"])

    def test_mismatched_start_is_not_differenced(self):
        series = k.quarterly_series(facts(
            ("2024-01-01", "2024-03-31", 10), ("2024-01-01", "2024-06-30", 25),
            ("2024-01-02", "2024-09-30", 40)))  # nine months tagged with a different start
        self.assertEqual([(q.end.isoformat(), q.value, q.derived) for q in series],
                         [("2024-03-31", 10, False), ("2024-06-30", 15, True)])

    def test_direct_quarter_beats_derived_and_latest_filing_wins(self):
        series = k.quarterly_series(
            facts(("2024-01-01", "2024-03-31", 10), ("2024-01-01", "2024-06-30", 25), filed="2024-07-30")
            + facts(("2024-04-01", "2024-06-30", 14), filed="2024-07-30")
            + facts(("2024-04-01", "2024-06-30", 16), filed="2025-07-30", accn="0000000000-25-000001"))
        q2 = series[-1]
        self.assertEqual((q2.value, q2.derived, q2.filed), (16, False, "2025-07-30"))

    def test_53_week_year_and_14_week_quarter(self):
        series = k.quarterly_series(facts(
            ("2022-09-25", "2022-12-31", 117), ("2022-09-25", "2023-04-01", 212),
            ("2022-09-25", "2023-07-01", 294), ("2022-09-25", "2023-09-30", 383)))
        self.assertEqual([(q.start.isoformat(), q.end.isoformat(), q.value) for q in series],
                         [("2022-09-25", "2022-12-31", 117), ("2023-01-01", "2023-04-01", 95),
                          ("2023-04-02", "2023-07-01", 82), ("2023-07-02", "2023-09-30", 89)])

    def test_first_concept_with_data_wins_per_quarter(self):
        concepts = ("A", "B")
        by_concept = {
            "A": facts(("2024-01-01", "2024-03-31", 1), ("2024-04-01", "2024-06-30", 2)),
            "B": facts(("2024-04-01", "2024-06-30", 20), ("2024-07-01", "2024-09-30", 30)),
        }
        series = k.merged_series(by_concept, concepts, {})
        self.assertEqual([(q.value, q.concept) for q in series], [(1, "A"), (2, "A"), (30, "B")])

    def test_net_productive_assets_tag_fills_capex_when_no_gross_tag(self):
        def fact(end, val, fp, form="10-Q"):
            return {"start": "2025-01-01", "end": end, "val": val, "fy": 2025, "fp": fp, "form": form,
                    "filed": "2026-02-20", "accn": "0000000001-26-000001"}
        raw = {"entityName": "Example Utility", "facts": {"us-gaap": {"PaymentsForProceedsFromProductiveAssets": {"units": {"USD": [
            fact("2025-03-31", 3.0 * B, "Q1"), fact("2025-06-30", 6.4 * B, "Q2"),
            fact("2025-09-30", 9.27 * B, "Q3"), fact("2025-12-31", 12.65 * B, "FY", "10-K")]}}}}}
        doc = k.build_sec_doc(raw, "EXU", 1, None, NOW)
        self.assertEqual([(q["end"], round(q["value"] / B, 2)) for q in doc["capex"]],
                         [("2025-03-31", 3.0), ("2025-06-30", 3.4), ("2025-09-30", 2.87), ("2025-12-31", 3.38)])

    def test_keeps_the_last_40_quarters(self):
        rows, start = [], date(2010, 1, 1)
        for i in range(45):
            end = (start + timedelta(days=95)).replace(day=1) - timedelta(days=1)
            rows.append((start.isoformat(), end.isoformat(), i))
            start = end + timedelta(days=1)
        series = k.merged_series({"A": facts(*rows)}, ("A",), {})
        self.assertEqual(len(series), 40)
        self.assertEqual((series[0].value, series[-1].value), (5, 44))

    def test_one_quarter_per_line_and_no_rewrite_for_updated_at_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "sec", "EXFC.json")
            self.assertTrue(k.write_sec_doc(path, self.doc))
            with open(path, encoding="utf-8") as f:
                text = f.read()
            self.assertEqual(json.loads(text), self.doc)
            self.assertEqual(sum(1 for line in text.splitlines() if line.startswith('  {"start"')), 25)
            later = dict(self.doc, updatedAt="2026-10-14T21:40:00+00:00")
            self.assertFalse(k.write_sec_doc(path, later))
            changed = dict(later, revenue=self.doc["revenue"][1:])
            self.assertTrue(k.write_sec_doc(path, changed))
            self.assertEqual(load(path)["updatedAt"], "2026-10-14T21:40:00+00:00")


class SecRunTests(unittest.TestCase):
    TICKERS = json.dumps({
        "0": {"cik_str": 1234567, "ticker": "EXFC", "title": "EXAMPLE FISCAL CORP"},
        "1": {"cik_str": 7654321, "ticker": "NODATA", "title": "NO DATA INC"},
        "2": {"cik_str": 1111111, "ticker": "BRK-B", "title": "BROKEN INC"},
    }).encode()

    def routes(self):
        return {
            k.SEC_TICKERS_URL: self.TICKERS,
            k.SEC_FACTS_URL.format(cik="0001234567"): fixture("companyfacts_fiscal_july.json"),
            k.SEC_FACTS_URL.format(cik="0001111111"): k.HttpError("facts", 500),
        }

    def test_run_writes_files_and_counts_outcomes(self):
        targets = [k.SecTarget("EXFC", "example-fiscal"), k.SecTarget("NODATA"), k.SecTarget("BRK.B"),
                   k.SecTarget("MISSING")]
        with tempfile.TemporaryDirectory() as tmp:
            http = FakeHttp(self.routes())
            status, healthy = k.run_sec(targets, http, tmp, NOW, keep=["OTHER"], log=quiet)
            self.assertTrue(healthy)
            self.assertEqual(status, {"targets": 4, "ok": 1, "failed": ["BRK.B"], "skipped": 2})
            out = load(os.path.join(tmp, "sec", "EXFC.json"))
            self.assertEqual((len(out["revenue"]), len(out["capex"])), (13, 12))
            cache = load(os.path.join(tmp, "sec", "_tickers.json"))
            self.assertEqual(sorted(cache["tickers"]), ["BRK-B", "EXFC", "NODATA"])

            # A day later: the ticker cache is fresh, and unchanged data leaves the file alone.
            http2 = FakeHttp(self.routes())
            k.run_sec(targets[:1], http2, tmp, NOW + timedelta(days=1), log=quiet)
            self.assertNotIn(k.SEC_TICKERS_URL, http2.calls)
            again = load(os.path.join(tmp, "sec", "EXFC.json"))
            self.assertEqual(again["updatedAt"], out["updatedAt"])

            # After a week the ticker list is fetched again.
            http3 = FakeHttp(self.routes())
            k.run_sec(targets[:1], http3, tmp, NOW + timedelta(days=8), log=quiet)
            self.assertIn(k.SEC_TICKERS_URL, http3.calls)

    def test_stops_after_repeated_403(self):
        targets = [k.SecTarget(s) for s in ("EXFC", "NODATA", "BRK-B", "ZZZ")]
        tickers = json.dumps({str(i): {"cik_str": 10 + i, "ticker": t.symbol, "title": t.symbol}
                              for i, t in enumerate(targets)}).encode()
        refused = {k.SEC_FACTS_URL.format(cik=f"{10 + i:010d}"): k.HttpError("x", 403) for i in range(4)}
        http = FakeHttp({k.SEC_TICKERS_URL: tickers, **refused})
        with tempfile.TemporaryDirectory() as tmp:
            status, healthy = k.run_sec(targets, http, tmp, NOW, log=quiet)
        self.assertFalse(healthy)
        self.assertEqual(status["failed"], sorted(t.symbol for t in targets))
        self.assertEqual(len([c for c in http.calls if "companyfacts" in c]), 3)


class FakeResponse:
    def __init__(self, body: bytes, headers: dict | None = None):
        self.body, self.headers = body, headers or {}

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class FakeClock:
    def __init__(self):
        self.now, self.sleeps = 100.0, []

    def clock(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(round(seconds, 3))
        self.now += seconds


class HttpTests(unittest.TestCase):
    def client(self, outcomes, gaps=None):
        clock, requests = FakeClock(), []

        def urlopen(request, timeout=None):
            requests.append(request)
            outcome = outcomes.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        http = k.Http("test-agent", gaps or {"default": 0.0}, urlopen=urlopen, sleep=clock.sleep,
                      clock=clock.clock)
        return http, clock, requests

    def test_retries_429_honouring_retry_after(self):
        busy = urllib.error.HTTPError("u", 429, "Too Many Requests", {"Retry-After": "3"}, None)
        http, clock, requests = self.client([busy, FakeResponse(b"ok")])
        self.assertEqual(http.get("https://example.test/a"), b"ok")
        self.assertEqual(clock.sleeps, [3.0])
        self.assertEqual(requests[0].get_header("User-agent"), "test-agent")

    def test_backs_off_on_5xx_and_network_errors_then_gives_up(self):
        down = urllib.error.HTTPError("u", 503, "Unavailable", {}, None)
        http, clock, _ = self.client([down, urllib.error.URLError("reset"), down, down])
        with self.assertRaises(k.HttpError) as caught:
            http.get("https://example.test/a")
        self.assertEqual(caught.exception.status, 503)
        self.assertEqual(clock.sleeps, [2.0, 4.0, 8.0])

    def test_no_retry_on_404(self):
        http, clock, requests = self.client([urllib.error.HTTPError("u", 404, "Not Found", {}, None)])
        with self.assertRaises(k.HttpError) as caught:
            http.get("https://example.test/a")
        self.assertEqual((caught.exception.status, len(requests), clock.sleeps), (404, 1, []))

    def test_gzip_and_minimum_gap_per_group(self):
        body = gzip.compress(b'{"a": 1}')
        http, clock, _ = self.client([FakeResponse(body, {"Content-Encoding": "gzip"}), FakeResponse(b"2"),
                                      FakeResponse(b"3")], gaps={"sec": 0.125, "default": 0.0})
        self.assertEqual(http.get("https://data.sec.gov/x", group="sec"), b'{"a": 1}')
        http.get("https://www.sec.gov/y", group="sec")
        http.get("https://example.test/z")
        self.assertEqual(clock.sleeps, [0.125])


class TaiwanParseTests(unittest.TestCase):
    def test_openapi_fixture(self):
        rows = k.parse_openapi_rows(json.loads(fixture("twse_t187ap05_L.json")))
        self.assertEqual(rows["2330"],
                         {"month": "2026-09", "revenue": 300000000, "yoy": 20.0, "mom": 7.142857})
        self.assertAlmostEqual(rows["2317"]["yoy"], 16.6667, places=3)  # blank in the feed: from last year
        self.assertEqual(rows["2454"]["month"], "2026-08")  # not reported for September yet
        self.assertEqual(rows["3661"]["revenue"], 9000000)

    def test_openapi_keys_matched_by_substring(self):
        payload = [{" 資料年月 ": "11509", "公司代號": "5274", "營業收入 - 當月營收": "1,200",
                    "營業收入 - 去年當月營收": "1000", "營業收入 - 上月營收": "1100",
                    "累計營業收入 - 當月累計營收": "9000", "營業收入 - 去年同月增減（%）": "20.0"}]
        row = k.parse_openapi_rows(payload)["5274"]
        self.assertEqual((row["month"], row["revenue"], row["yoy"]), ("2026-09", 1200, 20.0))
        self.assertAlmostEqual(row["mom"], 9.0909, places=3)  # no mom key: from 上月營收

    def test_openapi_reports_the_keys_it_saw(self):
        with self.assertRaises(ValueError) as caught:
            k.parse_openapi_rows([{"Code": "2330", "Revenue": "1"}])
        self.assertIn("keys seen: Code, Revenue", str(caught.exception))
        with self.assertRaises(ValueError):
            k.parse_openapi_rows({"error": "maintenance"})

    def test_mops_big5_page(self):
        raw = fixture("mops_t21sc03_115_8_0.html")
        with self.assertRaises(UnicodeDecodeError):
            raw.decode("utf-8")  # the fixture really is Big5
        rows = k.parse_mops_html(k.decode_html(raw), "2026-08")
        self.assertEqual(sorted(rows), ["2303", "2317", "2330", "2454"])  # 合計 rows skipped
        self.assertEqual(rows["2330"], {"month": "2026-08", "revenue": 280000000, "yoy": 21.74, "mom": 7.69})
        self.assertAlmostEqual(rows["2317"]["yoy"], 8.3333, places=3)  # '-' on the page: from last year
        self.assertEqual(rows["2303"]["revenue"], 19000000)  # row with unclosed tags

    def test_mops_one_row_header(self):
        rows = k.parse_mops_html(k.decode_html(FOREIGN_PAGE), "2026-08")
        self.assertEqual(rows, {"3661": {"month": "2026-08", "revenue": 8000000, "yoy": 60.0, "mom": 6.67}})

    def test_csv_merge_new_data_wins(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "2330.csv")
            with open(path, "w", encoding="utf-8") as f:
                f.write("month,revenue,yoy,mom\n2026-07,100,1.00,\n2026-08,110,,\n")
            rows = k.read_tw_csv(path)
            rows["2026-08"] = k.merge_row(rows.get("2026-08"), {"revenue": 110, "yoy": 5.0, "mom": None})
            rows["2026-07"] = k.merge_row(rows.get("2026-07"), {"revenue": 105, "yoy": None, "mom": -0.001})
            rows["2026-09"] = k.merge_row(None, {"revenue": 121, "yoy": None, "mom": None})
            k.fill_changes(rows)
            text = k.format_tw_csv(rows)
            self.assertEqual(text, "month,revenue,yoy,mom\n2026-07,105,,0.00\n2026-08,110,5.00,4.76\n"
                                   "2026-09,121,,10.00\n")
            self.assertTrue(k.write_text_if_changed(path, text))
            self.assertFalse(k.write_text_if_changed(path, text))
            self.assertEqual(k.read_tw_csv(path)["2026-08"], {"revenue": 110, "yoy": 5.0, "mom": 4.76})


class TaiwanRunTests(unittest.TestCase):
    TARGETS = [
        k.TwTarget("2330", "sii", "2330.TW", "tsmc"),
        k.TwTarget("2317", "sii", "2317.TW", "hon-hai"),
        k.TwTarget("3661", "sii", "3661.TW", "alchip"),
        k.TwTarget("5274", "otc", "5274.TWO", "aspeed"),
    ]

    def routes(self):
        host = k.MOPS_HOSTS[0]
        page = fixture("mops_t21sc03_115_8_0.html")
        return {
            k.TWSE_REVENUE_URL: fixture("twse_t187ap05_L.json"),
            k.TPEX_REVENUE_URL: k.HttpError(k.TPEX_REVENUE_URL, 500),
            k.mops_url(host, "sii", "2026-08", 0): page,
            k.mops_url(host, "sii", "2026-08", 1): FOREIGN_PAGE,
            k.mops_url(host, "sii", "2026-06", 0): page,  # same layout; the month comes from the URL
        }

    def read(self, tmp, name):
        with open(os.path.join(tmp, "tw", name), encoding="utf-8") as f:
            return f.read()

    @mock.patch.object(k, "MOPS_MIN_ROWS", 1)  # the fixture page counts as a full page
    def test_latest_month_backfill_and_absent_ledger(self):
        with tempfile.TemporaryDirectory() as tmp:
            http = FakeHttp(self.routes())
            status, healthy = k.run_tw(self.TARGETS, http, tmp, NOW, backfill_months=4, log=quiet)
            self.assertTrue(healthy)
            self.assertEqual(status, {"targets": 4, "latestMonth": "2026-09", "ok": 3, "failed": ["5274"],
                                      "backfilled": 5})
            self.assertEqual(self.read(tmp, "2330.csv"),
                             "month,revenue,yoy,mom\n2026-06,280000000,21.74,7.69\n"
                             "2026-08,280000000,21.74,7.69\n2026-09,300000000,20.00,7.14\n")
            self.assertEqual(self.read(tmp, "3661.csv"), "month,revenue,yoy,mom\n2026-08,8000000,60.00,6.67\n"
                                                         "2026-09,9000000,50.00,12.50\n")
            self.assertIn("2026-09,700000000,16.67,7.69", self.read(tmp, "2317.csv"))
            self.assertFalse(os.path.exists(os.path.join(tmp, "tw", "5274.csv")))
            # 3661 is on neither June page (the foreign one is a 404), and June is settled.
            self.assertEqual(json.loads(self.read(tmp, "_absent.json")), {"3661": ["2026-06"]})

            http2 = FakeHttp(self.routes())
            k.run_tw(self.TARGETS, http2, tmp, NOW, backfill_months=4, log=quiet)
            mops_calls = [c for c in http2.calls if "t21sc03" in c]
            self.assertFalse([c for c in mops_calls if "/sii/" in c and ("_115_6_" in c or "_115_8_" in c)])
            self.assertTrue([c for c in mops_calls if "/sii/t21sc03_115_7_0" in c])

    def test_short_page_never_marks_a_company_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            k.run_tw(self.TARGETS, FakeHttp(self.routes()), tmp, NOW, backfill_months=4, log=quiet)
            self.assertFalse(os.path.exists(os.path.join(tmp, "tw", "_absent.json")))

    def test_each_market_stops_on_its_own_failures(self):
        page = fixture("mops_t21sc03_115_8_0.html")
        http = FakeHttp({k.TWSE_REVENUE_URL: fixture("twse_t187ap05_L.json")},
                        fallback=lambda url: page if "/sii/" in url and url.endswith("_0.html") else None)
        targets = [self.TARGETS[0], self.TARGETS[3]]  # 2330 (TWSE) and 5274 (TPEx)
        with tempfile.TemporaryDirectory() as tmp:
            status, _ = k.run_tw(targets, http, tmp, NOW, backfill_months=12, log=quiet)
        otc = [c for c in http.calls if "/otc/" in c]
        self.assertEqual(len(otc), 5 * len(k.MOPS_HOSTS))
        self.assertEqual(status["backfilled"], 11)  # TWSE carried on: 2025-10 to 2026-08

    def test_backfill_stops_after_five_failed_pages(self):
        http = FakeHttp({k.TWSE_REVENUE_URL: fixture("twse_t187ap05_L.json")})
        with tempfile.TemporaryDirectory() as tmp:
            status, healthy = k.run_tw(self.TARGETS[:1], http, tmp, NOW, backfill_months=12, log=quiet)
        mops_calls = [c for c in http.calls if "t21sc03" in c]
        self.assertEqual(len(mops_calls), 5 * len(k.MOPS_HOSTS))  # each page is tried on both hosts
        self.assertFalse([c for c in mops_calls if "_115_3_" in c])
        self.assertTrue(healthy)
        self.assertEqual((status["ok"], status["backfilled"]), (1, 0))

    def test_every_request_failing_is_unhealthy(self):
        with tempfile.TemporaryDirectory() as tmp:
            status, healthy = k.run_tw(self.TARGETS, FakeHttp(), tmp, NOW, backfill_months=3, log=quiet)
        self.assertFalse(healthy)
        self.assertEqual((status["latestMonth"], status["ok"]), (None, 0))


COMPANIES = """
companies:
  alpha: {name: Alpha, listing: listed, country: US, tier: watch,
          tickers: [{symbol: ALPH, exchange: NASDAQ, currency: USD}]}
  beta: {name: Beta, listing: listed, country: US, tier: core,
         tickers: [{symbol: BETA, exchange: NYSE, currency: USD}]}
  gamma: {name: Gamma, listing: listed, country: US, tier: focus,
          tickers: [{symbol: GAMM, exchange: NYSE American, currency: USD}]}
  delta: {name: Delta, listing: listed, country: US, tier: watch,
          tickers: [{symbol: DELT, exchange: NASDAQ, currency: USD}]}
  otc-only: {name: Otc, listing: listed, country: US, tier: core,
             tickers: [{symbol: OTCX, exchange: OTC, currency: USD}]}
  london: {name: London, listing: listed, country: US, tier: core,
           tickers: [{symbol: LDN.L, exchange: LSE, currency: GBP}]}
  tsmc: {name: TSMC, listing: listed, country: TW, tier: core,
         tickers: [{symbol: TSM, exchange: NYSE, currency: USD},
                   {symbol: 2330.TW, exchange: TWSE, currency: TWD}]}
  aspeed: {name: ASPEED, listing: listed, country: TW, tier: watch,
           tickers: [{symbol: 5274.TWO, exchange: TPEx, currency: TWD}]}
  startup: {name: Startup, listing: private, country: US, tier: core}
"""


class UniverseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        os.makedirs(os.path.join(self.root, "content", "companies"))
        with open(os.path.join(self.root, "content", "companies", "chips.yaml"), "w", encoding="utf-8") as f:
            f.write(COMPANIES)
        self.companies = k.load_companies(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_sec_universe_order_and_cap(self):
        symbols = lambda targets: [t.symbol for t in targets]  # noqa: E731
        self.assertEqual(symbols(k.sec_universe(self.companies)), ["BETA", "GAMM", "ALPH", "DELT"])
        caps = {"DELT": 2e9, "ALPH": 1e9}
        self.assertEqual(symbols(k.sec_universe(self.companies, market_caps=caps)),
                         ["BETA", "GAMM", "DELT", "ALPH"])
        self.assertEqual(symbols(k.sec_universe(self.companies, market_caps=caps, cap=3)),
                         ["BETA", "GAMM", "DELT"])
        self.assertEqual(k.sec_universe(self.companies)[0], k.SecTarget("BETA", "beta"))

    def test_allow_list_replaces_the_default_universe(self):
        self.assertIsNone(k.load_allow_list(self.root))
        with open(os.path.join(self.root, "content", "kpis.yaml"), "w", encoding="utf-8") as f:
            f.write("sec: [TSM, BETA, TSM]\n")
        allow = k.load_allow_list(self.root)
        self.assertEqual(k.sec_universe(self.companies, allow),
                         [k.SecTarget("TSM", "tsmc"), k.SecTarget("BETA", "beta")])
        self.assertIn("TSM", k.sec_cache_symbols(self.companies, allow))
        self.assertNotIn("LDN.L", k.sec_cache_symbols(self.companies, allow))

    def test_tw_universe_and_only(self):
        tw = k.tw_universe(self.companies)
        self.assertEqual(tw, [k.TwTarget("2330", "sii", "2330.TW", "tsmc"),
                              k.TwTarget("5274", "otc", "5274.TWO", "aspeed")])
        sec, tw_only = k.select_only(k.sec_universe(self.companies), tw, ["BETA", "5274", "IBM", "6488.TWO"])
        self.assertEqual(sec, [k.SecTarget("BETA", "beta"), k.SecTarget("IBM")])
        self.assertEqual([(t.code, t.market) for t in tw_only], [("5274", "otc"), ("6488", "otc")])

    def test_main_status_and_exit_code(self):
        kpis = os.path.join(self.root, "data", "kpis")
        routes: dict = {}
        with mock.patch.object(k, "ROOT", self.root), mock.patch.object(k, "KPIS", kpis), \
                mock.patch.object(k, "Http", lambda *a, **kw: FakeHttp(routes)), \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(k.main([]), 1)  # every request fails: both sources down
            first = load(os.path.join(kpis, "status.json"))
            self.assertEqual(first["sec"]["ok"], 0)
            self.assertEqual(first["tw"]["ok"], 0)
            routes[k.TWSE_REVENUE_URL] = fixture("twse_t187ap05_L.json")
            self.assertEqual(k.main(["--tw", "--tw-backfill-months", "0"]), 0)
            second = load(os.path.join(kpis, "status.json"))
            self.assertEqual(second["sec"], first["sec"])  # a source that did not run keeps its status
            self.assertEqual((second["tw"]["latestMonth"], second["tw"]["ok"]), ("2026-09", 1))
            self.assertEqual(k.main(["--only", "NOPE.XX"]), 1)


if __name__ == "__main__":
    unittest.main()
