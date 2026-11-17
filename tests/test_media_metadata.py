import unittest

from services.worker.media import _as_fraction, _to_us
from apps.desktop.ui import seconds_to_us


class MetadataParsingTests(unittest.TestCase):
    def test_fraction_rates_are_reduced_and_unknown_rate_is_none(self) -> None:
        self.assertEqual(_as_fraction("60000/1001"), (60000, 1001))
        self.assertIsNone(_as_fraction("0/0"))
        self.assertEqual(_to_us("12.345678"), 12_345_678)

    def test_ui_seconds_use_decimal_microseconds_without_float_accumulation(self) -> None:
        self.assertEqual(seconds_to_us("0.1"), 100_000)
        self.assertEqual(seconds_to_us("1.0000005"), 1_000_001)
        with self.assertRaises(ValueError):
            seconds_to_us("nan")


if __name__ == "__main__":
    unittest.main()
