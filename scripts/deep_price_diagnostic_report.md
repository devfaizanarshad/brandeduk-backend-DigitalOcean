# Deep Pricing Diagnostic Report

Run at: 3/10/2026, 12:01:02 AM

## 1. Style Inconsistency (sell_price)
✅ All Live SKUs in each style have unified sell prices.

## 2. Style Inconsistency (carton_price)
✅ All Live SKUs in each style have unified carton prices.

## 3. Pricing Calculation Accuracy
✅ db_sell matches calculated markup for all checked Live SKUs.

## 4. Materialized View Consistency
❌ Found 11 styles where the search view price doesn't match the products table.
| Style | Table Price | View Price |
|---|---|---|
| UC901 | 15.61 | 0.00 |
| UC902 | 16.78 | 0.00 |
| UC902 | 16.78 | 0.00 |
| UC903 | 21.79 | 0.00 |
| UC903 | 21.79 | 0.00 |
| UC904 | 18.52 | 0.00 |
| UC904 | 18.52 | 0.00 |
| UC906 | 31.44 | 0.00 |
| UC906 | 31.44 | 0.00 |
| UC906 | 31.44 | 0.00 |
| UC906 | 31.44 | 0.00 |

## 5. Critical Price Issues
✅ No Live products have zero or missing prices.

