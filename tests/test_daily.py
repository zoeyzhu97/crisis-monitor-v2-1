import importlib.util
import unittest
import json
import tempfile
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location("daily", Path(__file__).parents[1] / "scripts/fetch_daily.py")
daily = importlib.util.module_from_spec(spec)
spec.loader.exec_module(daily)

class DailyTests(unittest.TestCase):
    def test_outage_preserves_every_verified_value_and_date(self):
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder)
            values = {"credit_spread": 330, "uk_10y": 5.3, "vix": 20}
            meta = {k: {"source": "BoE IUDMNPY" if k == "uk_10y" else "FRED BAMLH0A0HYM2" if k == "credit_spread" else "Yahoo ^VIX", "as_of": "2026-10-26"} for k in values}
            (out / "latest.json").write_text(json.dumps({"values": values, "meta": meta}))
            (out / "series.json").write_text(json.dumps({"credit_spread": [{"d": "2026-10-26", "v": 330}]}))
            with patch.object(daily, "OUT_DIR", out), patch.object(daily, "fred_series", side_effect=RuntimeError("offline")), patch.object(daily, "fred_public_dashboard_oas", side_effect=RuntimeError("offline")), patch.object(daily, "autario_oas", side_effect=RuntimeError("offline")), patch.object(daily, "boe_uk_10y", side_effect=RuntimeError("offline")), patch.object(daily, "yahoo_history", return_value=None):
                fields, _, _ = daily.fetch_all()
            for key, value in values.items():
                self.assertEqual(fields[key]["value"], value)
                self.assertEqual(fields[key]["as_of"], "2026-10-26")
                self.assertEqual(fields[key]["fetch_status"], "fetch_failed_cached")

    def test_newest_source_wins_and_official_revises_overlap(self):
        selected = daily.select_oas([
            ("cache", [("2026-10-21", 320)]),
            ("official", [("2026-10-22", 340), ("2026-10-23", 338)]),
            ("dashboard", []),
            ("mirror", [("2026-10-22", 341)])])
        self.assertEqual(selected, ("official", [("2026-10-21", 320), ("2026-10-22", 340), ("2026-10-23", 338)]))
    def test_cache_does_not_regress_on_stale_response(self):
        selected = daily.select_oas([("cache", [("2026-10-23", 338)]), ("official", [("2026-10-22", 340)])])
        self.assertEqual(selected[1][-1], ("2026-10-23", 338))
    def test_boe_quoted_reversed_and_invalid_rows(self):
        self.assertEqual(daily.parse_boe_csv('DATE,IUDMNPY\n"23 Oct 2026","5.3152"\n22 Oct 2026,5.2784\n26 Oct 2026,NA\n27 Oct 2026,999\n'), ("2026-10-23", 5.3152))
    def test_future_data_rejected(self):
        self.assertIsNone(daily.select_oas([("cache", []), ("official", [("2099-01-01", 300)])]))

if __name__ == "__main__":
    unittest.main()
