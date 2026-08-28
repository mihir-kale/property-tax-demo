# NC Property Tax — Understanding HB 1089 (Static Demo)

A static demonstration built for consultant review, hosted on GitHub Pages (no backend
required). It is a single page (`index.html`) with a **My Bill / County** toggle:

- **County** view — the county-level 2016–2025 pressure index: a visual **grade**
  (A–D), a revenue/spending **Sankey**, a Leaflet map, and a county selector
  (Mecklenburg now, Halifax next).
- **My Bill** view — enter a Mecklenburg address, pick the matching parcel, and see its
  county tax at the actual 2025 county rate vs. a rate implied by a 2016-to-2025
  inflation-plus-population benchmark, with annual difference and comparison bars.

## How the county-level index works (index.html)

For each year the actual property tax collected is compared against a benchmark equal
to the prior year's actual, grown by **population growth + CPI-U inflation**. The
pressure score counts how many of the past years Mecklenburg collected **more** than
that benchmark (0 = at or below benchmark, up to 10 = above in every year). A negative
`difference_pct` means the county raised less property tax than the benchmark over the
period.

## How the property comparison works (My Bill)

The comparison holds the property's **assessed value constant** and changes only the
**county tax rate**, per the brief's calculation contract:

```
B_2016 = L_2016
B_t    = B_(t-1) * (1 + inflation_growth_t + population_growth_t)   # 9 transitions, 2016→2025
L_scenario = min(L_actual, B)                                       # capped: never prescribe an increase
r_scenario = 100 * L_scenario / X
tax_actual    = V * r_actual / 100
tax_scenario  = V * r_scenario / 100
difference    = tax_actual - tax_scenario
```

- `V` = parcel assessed value (from NC OneMap; ordinary residential parcels only).
- `r_actual` = **0.4927 per $100** (official FY2025–26 Mecklenburg county rate).
- `X` = **$302,954,055,682** FY2025–26 assessed valuation (NCDOR LG04).
- `L_actual` = **$1,492,300,028** FY2025–26 county-wide levy (NCDOR LG04).
- `L_2016` = **$999,363,501** FY2016–17 county-wide levy (NCDOR LG04).
- Inflation = U.S. CPI-U annual average (BLS). Population = Mecklenburg annual
  resident estimates (U.S. Census, 2020-base vintage).
- `X * r_actual / 100` reproduces the reported levy within **+0.024%** (documented
  rounding); the two rate equations agree within that reconciliation gap.

**Finding for Mecklenburg:** the 2025 benchmark ceiling (~$1.555B) is **above** the
actual 2025 county levy (~$1.492B), so `L_scenario = L_actual` — Mecklenburg is
**at/below** the inflation-plus-population benchmark. The county cut its rate from
~0.816 (2016) to 0.493 (2025) as assessed values grew, so the per-property difference
is effectively $0. This is the intended, honest output and is surfaced clearly in the UI.

The parcel lookup uses the NC OneMap parcel point service filtered to Mecklenburg
(`cntyfips='119'`), a residential use code (`R*`), the **assessed value as the taxable
value**, and excludes owner names/addresses. Relief/exemption cases are flagged as out
of scope. Parcel values are a live snapshot and may predate the 2025 tax year; the 2025
county rate and levy figures are official FY2025–26 records.

## Precomputed county inputs

`data/mecklenburg_benchmark.json` holds the county-level constants (rates, levies,
total taxable base, benchmark ceiling, scenario levy/rate) and the nine growth
transitions. Values are embedded once rather than recomputed on each address search.

## Tests

The shared calculation logic lives in `calc.js` (used by both the page and the tests).

```
node --test test/calc.test.mjs
```

Covers the brief's fixtures (rate/levy reconciliation, benchmark recurrence, the
$100m/2%+1% transition, rate-on-base), the equivalence of the two rate equations,
working in the capped "below benchmark" case, zero-value handling, missing-input
states, and address-search escaping/residential filtering.

## Regenerating the data

Requires R with `readr`, `dplyr`, `tidyr`, `stringr`, and `jsonlite`:

```
Rscript export_mecklenburg.R
```

This recomputes `data/mecklenburg.json` from the source CSVs in the Shiny app repo
(`nc_property_tax_pressure_index/`).

## Local preview

```
python3 -m http.server 8000
```

then open `http://localhost:8000/`.

## Live site

https://mihir-kale.github.io/property-tax-demo/
