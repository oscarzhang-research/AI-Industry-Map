"""Offline tests for fetch_prices.py. From the repository root:

    python3 -m unittest discover -s scripts/prices -p 'test_*.py'

No test touches the network; yfinance and pandas are not needed.
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetch_prices as fp  # noqa: E402


class Frame:
    """The part of a pandas frame write_csv uses: iterrows() over (timestamp, row)."""

    def __init__(self, *rows):
        self.rows = rows

    def iterrows(self):
        for day, close in self.rows:
            yield datetime.strptime(day, "%Y-%m-%d"), {"Close": close, "High": close + 1, "Low": close - 1}


def utc(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)


class SessionTests(unittest.TestCase):
    def test_open_session_is_the_local_day_until_the_close(self):
        self.assertEqual(fp.session_open_day("000660.KS", utc("2026-11-10 03:50")), "2026-11-10")  # 12:50 in Seoul
        self.assertIsNone(fp.session_open_day("000660.KS", utc("2026-11-10 09:45")))  # 18:45 in Seoul
        self.assertEqual(fp.session_open_day("000660.KS", utc("2026-11-10 17:00")), "2026-11-11")  # 02:00 next day
        self.assertEqual(fp.session_open_day("NVDA", utc("2026-11-10 17:00")), "2026-11-10")
        self.assertIsNone(fp.session_open_day("NVDA", utc("2026-11-10 21:30")))


class KeptTailTests(unittest.TestCase):
    stored = ["2026-11-06,1132000,1217000,1089000", "2026-11-09,1136000,1193000,1116000", "2026-11-10,1212000,1242000,1190000"]

    def test_a_stored_close_survives_an_empty_latest_bar(self):
        rows = self.stored[:2]  # Yahoo returned Nov 10 as an empty bar
        self.assertEqual(fp.kept_tail(self.stored, rows, "2026-11-11"), self.stored[2:])

    def test_nothing_is_kept_when_the_download_is_complete(self):
        self.assertEqual(fp.kept_tail(self.stored, list(self.stored), None), [])

    def test_the_open_session_is_never_kept(self):
        stored = self.stored + ["2026-11-11,1250000,1260000,1200000"]  # written before the session rule existed
        self.assertEqual(fp.kept_tail(stored, self.stored[:2], "2026-11-11"), self.stored[2:3])

    def test_rescaled_history_drops_the_stored_tail(self):
        rows = ["2026-11-06,377333.3,405666.7,363000", "2026-11-09,378666.7,397666.7,372000"]  # after a 3-for-1 split
        self.assertEqual(fp.kept_tail(self.stored, rows, None), [])

    def test_no_overlap_or_no_file(self):
        self.assertEqual(fp.kept_tail([], self.stored[:2], None), [])
        self.assertEqual(fp.kept_tail(self.stored[2:], self.stored[:1], None), [])
        self.assertEqual(fp.kept_tail(self.stored, [], None), [])


class WriteCsvTests(unittest.TestCase):
    def run_at(self, when: str, frame: Frame, symbol: str = "000660.KS") -> list[str]:
        real = fp.session_open_day
        with mock.patch.object(fp, "session_open_day", lambda s, now=None: real(s, utc(when))):
            fp.write_csv(symbol, frame)
        with open(os.path.join(fp.PRICES, symbol + ".csv"), encoding="utf-8") as f:
            return f.read().splitlines()

    def test_a_later_run_with_an_empty_bar_keeps_the_close(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(fp, "PRICES", tmp):
            full = Frame(("2026-11-06", 1132000), ("2026-11-09", 1136000), ("2026-11-10", 1212000))
            lines = self.run_at("2026-11-10 09:45", full)
            self.assertEqual(lines[0], "date,close,high,low")
            self.assertEqual(lines[-1], "2026-11-10,1212000,1212001,1211999")
            short = Frame(("2026-11-06", 1132000), ("2026-11-09", 1136000))  # 17:00 UTC: Nov 10 came back empty
            self.assertEqual(self.run_at("2026-11-10 17:00", short), lines)
            # The next morning in Seoul the session is open: its row is dropped and Nov 10 stays.
            live = Frame(("2026-11-06", 1132000), ("2026-11-09", 1136000), ("2026-11-10", 1212000), ("2026-11-11", 1300000))
            self.assertEqual(self.run_at("2026-11-11 03:50", live), lines)


def row(day, est=None, actual=None):
    return {"date": day, "time": "amc", "epsEst": est, "epsActual": actual, "surprise": None}


NO_REVENUE = lambda day: (None, None)  # noqa: E731
ESTIMATES = (120.0, 30, 2.5, 28)  # revenue estimate, analysts, EPS estimate, analysts


class EarningsTests(unittest.TestCase):
    prev = {
        "updatedAt": "2026-10-27",
        "checkedAt": "2026-10-27T21:50+00:00",
        "next": {"date": "2026-10-28", "time": "amc", "epsEst": 2.0, "epsN": 30, "revEst": 100.0, "revN": 28, "asOf": "2026-10-27"},
        "history": [{"date": "2026-07-29", "epsEst": 1.8, "epsActual": 1.9, "revActual": 90.0}],
    }

    def test_a_report_whose_figures_arrive_late_is_still_recorded(self):
        # The day after the report Yahoo lists the next date but not yet the reported EPS.
        rows = [row("2027-01-27", 2.5), row("2026-10-28", 2.0), row("2026-07-29", 1.8, 1.9)]
        rec = fp.earnings_record(self.prev, rows, ESTIMATES, True, utc("2026-10-29 21:50"), NO_REVENUE)
        self.assertEqual(rec["next"]["date"], "2027-01-27")
        self.assertEqual(rec["pending"]["date"], "2026-10-28")
        self.assertEqual(rec["pending"]["revEst"], 100.0)
        self.assertEqual(rec["history"][0]["date"], "2026-07-29")
        # A week later Yahoo's next date is far outside the window, but the name is still asked about.
        fundamentals = {"META": {"nextEarnings": "2027-01-27"}}
        now = utc("2026-11-05 21:50")
        self.assertEqual(fp.earnings_due(["META"], fundamentals, {"META": rec}, {"META": "core"}, now), ["META"])
        rows = [row("2027-01-27", 2.5), row("2026-10-28", 2.0, 2.2), row("2026-07-29", 1.8, 1.9)]
        rec2 = fp.earnings_record(rec, rows, ESTIMATES, True, now, lambda day: (104.0, "2026-09-30") if day == "2026-10-28" else (None, None))
        self.assertNotIn("pending", rec2)
        self.assertEqual(rec2["history"][0], {"date": "2026-10-28", "time": "amc", "epsEst": 2.0, "epsActual": 2.2,
                                              "revEst": 100.0, "revActual": 104.0, "period": "2026-09-30"})
        self.assertEqual(rec2["history"][1]["revActual"], 90.0)

    def test_the_report_day_itself_is_not_pending(self):
        rows = [row("2026-10-28", 2.0), row("2026-07-29", 1.8, 1.9)]
        rec = fp.earnings_record(self.prev, rows, ESTIMATES, False, utc("2026-10-28 12:00"), NO_REVENUE)
        self.assertEqual(rec["next"]["date"], "2026-10-28")
        self.assertNotIn("pending", rec)

    def test_a_report_a_day_off_the_expected_date_gets_the_frozen_consensus(self):
        rows = [row("2026-10-29", 2.0, 2.1), row("2026-07-29", 1.8, 1.9)]
        rec = fp.earnings_record(self.prev, rows, ESTIMATES, False, utc("2026-10-30 12:00"), NO_REVENUE)
        self.assertEqual(rec["history"][0]["revEst"], 100.0)
        self.assertNotIn("pending", rec)

    def test_waiting_ends_after_a_month(self):
        rows = [row("2026-07-29", 1.8, 1.9)]
        rec = fp.earnings_record(self.prev, rows, ESTIMATES, False, utc("2026-11-10 12:00"), NO_REVENUE)
        self.assertEqual(rec["pending"]["date"], "2026-10-28")
        rec = fp.earnings_record(rec, rows, ESTIMATES, False, utc("2026-12-01 12:00"), NO_REVENUE)
        self.assertNotIn("pending", rec)

    def test_catch_up_follows_the_window_and_waits_a_week_between_tries(self):
        now = utc("2026-11-10 21:40")
        previous = {
            "WIN": {"next": {"date": "2026-11-12"}, "history": [{"date": "2026-08-12"}]},
            "OLD": {"history": [{"date": "2026-07-28"}]},  # missed its October report
            "FRESH": {"history": [{"date": "2026-10-20"}]},
            "TRIED": {"history": [], "checkedAt": "2026-11-08T21:40+00:00"},
            "RETRY": {"history": [], "checkedAt": "2026-11-01T21:40+00:00"},
        }
        symbols = ["NEW", "WIN", "OLD", "FRESH", "TRIED", "RETRY", "SOON"]
        fundamentals = {"SOON": {"nextEarnings": "2026-11-20"}}
        tiers = {"OLD": "core", "NEW": "focus", "WIN": "watch", "SOON": "focus", "RETRY": "watch"}
        self.assertEqual(fp.earnings_due(symbols, fundamentals, previous, tiers, now), ["SOON", "WIN", "OLD", "NEW", "RETRY"])
        with mock.patch.object(fp, "EARN_CATCH_UP", 1):
            self.assertEqual(fp.earnings_due(symbols, fundamentals, previous, tiers, now), ["SOON", "WIN", "OLD"])


if __name__ == "__main__":
    unittest.main()
