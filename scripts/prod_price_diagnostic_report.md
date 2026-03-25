# PRODUCTION Pricing Diagnostic Report

Run at: 3/10/2026, 12:11:59 AM
Target Database: brandeduk_prod

## 1. Style Inconsistency (sell_price)
❌ Found 100 styles with multiple sell prices.
| Style | Price Count | Min | Max |
|---|---|---|---|
| AA11 | 2 | 4.38 | 8.21 |
| AA12 | 3 | 4.90 | 10.29 |
| AA21 | 2 | 11.65 | 12.82 |
| AA22 | 2 | 15.14 | 16.31 |
| AA24 | 3 | 11.64 | 13.40 |
| AA26 | 2 | 16.31 | 17.48 |
| AA550 | 2 | 1.45 | 2.21 |
| AC004 | 2 | 8.33 | 9.31 |
| AC04J | 2 | 4.55 | 4.88 |
| AD002 | 2 | 37.93 | 41.63 |
| AM011 | 5 | 11.39 | 14.66 |
| AQ001 | 4 | 11.88 | 15.03 |
| AQ002 | 4 | 16.66 | 20.15 |
| AQ005 | 2 | 11.88 | 13.16 |
| AQ011 | 2 | 16.29 | 17.45 |
| AQ012 | 2 | 16.29 | 17.45 |
| AQ020 | 2 | 11.64 | 13.63 |
| AQ021 | 2 | 16.29 | 18.62 |
| AQ022 | 2 | 16.29 | 18.62 |
| AQ025 | 2 | 11.88 | 13.05 |

## 2. Style Inconsistency (carton_price)
❌ Found 100 styles with multiple carton prices.
| Style | Carton Count | Min | Max |
|---|---|---|---|
| AA11 | 2 | 2.50 | 3.35 |
| AA12 | 3 | 2.80 | 4.20 |
| AA21 | 2 | 5.00 | 5.50 |
| AA22 | 2 | 6.50 | 7.00 |
| AA24 | 3 | 4.75 | 5.75 |
| AA26 | 2 | 7.00 | 7.50 |
| AA550 | 2 | 0.49 | 0.75 |
| AC004 | 2 | 3.40 | 3.80 |
| AC04J | 2 | 2.60 | 2.79 |
| AD002 | 2 | 20.50 | 22.50 |
| AM011 | 5 | 4.65 | 6.29 |
| AQ001 | 4 | 4.85 | 6.45 |
| AQ002 | 4 | 7.15 | 8.65 |
| AQ005 | 2 | 5.10 | 5.65 |
| AQ011 | 2 | 6.99 | 7.49 |
| AQ012 | 2 | 6.99 | 7.49 |
| AQ020 | 2 | 4.75 | 5.85 |
| AQ021 | 2 | 6.99 | 7.99 |
| AQ022 | 2 | 6.99 | 7.99 |
| AQ025 | 2 | 5.10 | 5.60 |

## 3. Pricing Calculation Accuracy
❌ Found 100 products where the sell_price is NOT calculated correctly based on your rules/overrides.
*(This usually means the markup rules were updated but the products weren't repriced)*

| SKU | Style | DB Sell | Expected | Markup % |
|---|---|---|---|---|
| AD082TCRD | AD082 | 23.40 | 18.17 | 133.00% |
| AD082TNBL | AD082 | 23.40 | 18.17 | 133.00% |
| AD082TRBL | AD082 | 23.40 | 18.17 | 133.00% |
| AD082WHIT | AD082 | 23.40 | 18.17 | 133.00% |
| AD082BLAC | AD082 | 23.40 | 18.17 | 133.00% |
| AD082GTHR | AD082 | 23.40 | 18.17 | 133.00% |
| AD200LEIN | AD200 | 76.26 | 75.77 | 54.80% |
| BD301BLACS | BD301 | 101.27 | 100.62 | 54.80% |
| BD301BLACM | BD301 | 101.27 | 100.62 | 54.80% |
| BD301BLACL | BD301 | 101.27 | 100.62 | 54.80% |
| BD301BLACXL | BD301 | 101.27 | 100.62 | 54.80% |
| BD301BLAC2XL | BD301 | 101.27 | 100.62 | 54.80% |
| BD301NAVYS | BD301 | 101.27 | 100.62 | 54.80% |
| BD301NAVYM | BD301 | 101.27 | 100.62 | 54.80% |
| BD301NAVYL | BD301 | 101.27 | 100.62 | 54.80% |
| BD301NAVYXL | BD301 | 101.27 | 100.62 | 54.80% |
| BD301NAVY2XL | BD301 | 101.27 | 100.62 | 54.80% |
| BD301OLIVS | BD301 | 101.27 | 100.62 | 54.80% |
| BD301OLIVM | BD301 | 101.27 | 100.62 | 54.80% |
| BD301OLIVL | BD301 | 101.27 | 100.62 | 54.80% |

## 4. Materialized View Consistency (Stale Cache)
❌ Found 100 styles where the Keyword Search price is STALE (wrong) compared to the actual database price.

| Style | Database Price | Search View Price |
|---|---|---|
| CRBT100 | 4.38 | 5.23 |
| CRBT100 | 4.38 | 5.23 |
| CRBT100 | 4.38 | 5.23 |
| CRBHS50 | 20.95 | 23.28 |
| CRBHS50 | 20.95 | 23.28 |
| CRBHS50 | 20.95 | 23.28 |
| CRBHS50 | 20.95 | 23.28 |
| CRBHS50 | 20.95 | 23.28 |
| CRBHS50 | 20.95 | 23.28 |
| CRBHS50 | 20.95 | 23.28 |
| CRBHS50 | 20.95 | 23.28 |
| CRBHS50 | 20.95 | 23.28 |
| CRBHS50 | 20.95 | 23.28 |
| CRBHS50 | 20.95 | 23.28 |
| CRBHS50 | 20.95 | 23.28 |
| CRBHS50 | 20.95 | 23.28 |
| CRBHS50 | 20.95 | 23.28 |
| CRBHS50 | 20.95 | 23.28 |
| CRBHS50 | 20.95 | 23.28 |
| CRBHS50 | 20.95 | 23.28 |

## 5. Critical Price Issues (Zeros/Missing)
❌ Found **20 Live products** that have £0.00 or NULL prices. This is a critical issue causing free items on the store.

