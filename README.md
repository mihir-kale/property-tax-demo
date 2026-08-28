# NC Property Tax Pressure Index — Mecklenburg County (Static Demo)

A static, single-county demonstration page built for consultant review. It computes
Mecklenburg County's property tax pressure index over **2016–2025** and renders it
as a GitHub Pages site with a Leaflet map and D3-based revenue/spending Sankey.

Because GitHub Pages hosts only static files (no R/Shiny runtime), the county-level
index is pre-computed from the source CSVs into `data/mecklenburg.json`, and the
Mecklenburg polygon is bundled as `data/mecklenburg.geojson`. No backend is required.

## How the index works

For each year the actual property tax collected is compared against a benchmark equal
to the prior year's actual, grown by **population growth + CPI-U inflation**. The
pressure score counts how many of the past years Mecklenburg collected **more** than
that benchmark (0 = at or below benchmark, up to 10 = above in every year). A negative
`difference_pct` means the county raised less property tax than the benchmark over the
period.

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
