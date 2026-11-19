import unittest

from shipping.quote import quote_shipping


class ShippingQuoteAcceptanceTests(unittest.TestCase):
    def test_ac_ship_001_below_threshold(self):
        for subtotal_fen in (0, 9899):
            with self.subTest(subtotal_fen=subtotal_fen):
                self.assertEqual(quote_shipping(subtotal_fen), 800)

    def test_ac_ship_002_at_threshold(self):
        self.assertEqual(quote_shipping(9900), 0)

    def test_ac_ship_003_above_threshold(self):
        self.assertEqual(quote_shipping(9901), 0)

    def test_ac_ship_004_invalid_subtotal(self):
        for invalid_subtotal in (-1, 9900.0, "9900", True, None):
            with self.subTest(invalid_subtotal=invalid_subtotal):
                with self.assertRaises(ValueError):
                    quote_shipping(invalid_subtotal)
