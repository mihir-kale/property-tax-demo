# Generalized single-county JSON export for the GitHub Pages demo, mirroring
# export_mecklenburg.R exactly but parameterized by target county + output path.
#
# Usage: Rscript export_county.R <Target County> <output.json>

suppressMessages({
  library(readr)
  library(dplyr)
  library(tidyr)
  library(stringr)
  library(jsonlite)
})

args <- commandArgs(trailingOnly = TRUE)
target <- args[1]
out_json <- args[2]
stopifnot(!is.na(target), !is.na(out_json))

# ----------------------------
# 1. Settings (mirror app.R)
# ----------------------------
preferred_start_year <- 2016L
preferred_end_year   <- 2025L

cpi_path  <- "/Users/mihirkale/repos/property_tax_project/nc_property_tax_pressure_index/CPI-U.csv"
pop_path  <- "/Users/mihirkale/repos/property_tax_project/nc_property_tax_pressure_index/county_populations.csv"
fin_path  <- "/Users/mihirkale/repos/property_tax_project/nc_property_tax_pressure_index/county_finances.csv"

# ----------------------------
# 2. Helpers (mirror app.R)
# ----------------------------
clean_join_name <- function(x) {
  x %>%
    str_to_lower() %>%
    str_replace_all("&", "and") %>%
    str_replace_all("[^a-z0-9]+", " ") %>%
    str_squish()
}

pretty_bucket <- function(x) {
  bucket <- as.character(x)
  recode(
    bucket,
    "property_taxes" = "Property taxes",
    "other_taxes" = "Other taxes",
    "sales_tax" = "Sales taxes",
    "sales_taxes" = "Sales taxes",
    "sales_&_services" = "Sales & services",
    "intergovernmental" = "Intergovernmental",
    "debt_proceeds" = "Debt proceeds",
    "education" = "Education",
    "debt_service" = "Debt service",
    "human_services" = "Human services",
    "general_government" = "General government",
    "public_safety" = "Public safety",
    "utilities" = "Utilities",
    "transportation" = "Transportation",
    "other" = "Other",
    .default = bucket %>%
      str_replace_all("_&_", " & ") %>%
      str_replace_all("_", " ") %>%
      str_squish() %>%
      str_to_lower() %>%
      { ifelse(is.na(.) | . == "", ., paste0(str_to_upper(str_sub(., 1, 1)), str_sub(., 2))) }
  )
}

parse_money_number <- function(x) readr::parse_number(as.character(x))

# ----------------------------
# 3. Read source data
# ----------------------------
cpi_raw <- read_csv(cpi_path, show_col_types = FALSE)
cpi <- cpi_raw %>%
  transmute(
    year = as.integer(year),
    cpi = parse_money_number(.[[2]])
  ) %>%
  filter(year >= 2014, year <= 2023)

county_pop <- read_csv(pop_path, show_col_types = FALSE) %>%
  transmute(
    place = county,
    join_name = clean_join_name(county),
    year = as.integer(year),
    population = parse_money_number(population)
  )

county_fin <- read_csv(fin_path, show_col_types = FALSE) %>%
  select(county, year, type, bucket, amount) %>%
  transmute(
    place = county,
    join_name = clean_join_name(county),
    year = as.integer(year),
    type = as.character(type),
    bucket = as.character(bucket),
    amount = parse_money_number(amount)
  )

# ----------------------------
# 4. Benchmark (mirror make_allowed_growth)
# ----------------------------
make_allowed_growth <- function(population_data, cpi_data) {
  inflation_growth <- cpi_data %>%
    arrange(year) %>%
    mutate(
      inflation_growth = cpi / lag(cpi) - 1,
      year = year + 2L
    ) %>%
    select(year, inflation_growth)

  population_growth <- population_data %>%
    arrange(join_name, year) %>%
    group_by(join_name) %>%
    mutate(
      population_growth = population / lag(population) - 1,
      year = year + 2L
    ) %>%
    ungroup() %>%
    select(join_name, year, population_growth)

  population_growth %>%
    left_join(inflation_growth, by = "year") %>%
    mutate(
      population_growth = replace_na(population_growth, 0),
      inflation_growth = replace_na(inflation_growth, 0),
      benchmark_growth_rate = population_growth + inflation_growth
    ) %>%
    select(join_name, year, population_growth, inflation_growth, benchmark_growth_rate)
}

allowed_growth <- make_allowed_growth(county_pop, cpi)

# ----------------------------
# 5. Property tax benchmark by year
# ----------------------------
actual_property_tax <- county_fin %>%
  filter(type == "revenue", bucket == "property_taxes",
         year >= preferred_start_year, year <= preferred_end_year) %>%
  group_by(place, join_name, year) %>%
  summarize(actual_property_tax = sum(amount, na.rm = TRUE), .groups = "drop")

by_year <- actual_property_tax %>%
  left_join(allowed_growth, by = c("join_name", "year")) %>%
  arrange(join_name, year) %>%
  group_by(place, join_name) %>%
  group_modify(~ {
    d <- .x %>% arrange(year)
    expected_years <- seq(preferred_start_year, preferred_end_year)
    has_complete_window <- all(expected_years %in% d$year[!is.na(d$actual_property_tax)])
    d$benchmark_property_tax <- NA_real_
    if (has_complete_window) {
      start_row <- which(d$year == preferred_start_year)
      d$benchmark_property_tax[start_row] <- d$actual_property_tax[start_row]
      if (nrow(d) > start_row) {
        for (i in (start_row + 1):nrow(d)) {
          g <- d$benchmark_growth_rate[i]
          if (is.na(g)) g <- 0
          d$benchmark_property_tax[i] <- d$benchmark_property_tax[i - 1] * (1 + g)
        }
      }
    }
    d
  }) %>%
  ungroup()

scores <- by_year %>%
  group_by(place, join_name) %>%
  summarize(
    actual_property_tax_total = sum(actual_property_tax, na.rm = TRUE),
    benchmark_property_tax_total = sum(benchmark_property_tax, na.rm = TRUE),
    difference_dollars = actual_property_tax_total - benchmark_property_tax_total,
    difference_pct = if_else(benchmark_property_tax_total > 0,
                             100 * (actual_property_tax_total / benchmark_property_tax_total - 1),
                             NA_real_),
    .groups = "drop"
  ) %>%
  mutate(
    score = case_when(
      is.na(difference_pct) ~ NA_real_,
      difference_pct <= 0 ~ 0,
      difference_pct < 10 ~ 1,
      difference_pct < 20 ~ 2,
      TRUE ~ 3
    )
  )

# ----------------------------
# 6. Revenue breakdown by source
# ----------------------------
revenue_total <- county_fin %>%
  filter(type == "revenue", year >= preferred_start_year, year <= preferred_end_year) %>%
  group_by(place, join_name, bucket) %>%
  summarize(revenue_total = sum(amount, na.rm = TRUE), .groups = "drop") %>%
  group_by(place, join_name) %>%
  mutate(total_revenue = sum(revenue_total),
         share = if_else(total_revenue > 0, revenue_total / total_revenue, NA_real_)) %>%
  ungroup() %>%
  mutate(revenue_area = pretty_bucket(bucket)) %>%
  arrange(desc(revenue_total))

# ----------------------------
# 7. Spending breakdown by area
# ----------------------------
spending_total <- county_fin %>%
  filter(type == "expenditure", year >= preferred_start_year, year <= preferred_end_year) %>%
  group_by(place, join_name, bucket) %>%
  summarize(actual_spending_total = sum(amount, na.rm = TRUE), .groups = "drop") %>%
  group_by(place, join_name) %>%
  mutate(total_spending = sum(actual_spending_total),
         share = if_else(total_spending > 0, actual_spending_total / total_spending, NA_real_)) %>%
  ungroup() %>%
  mutate(spending_area = pretty_bucket(bucket)) %>%
  arrange(desc(actual_spending_total))

# ----------------------------
# 8. Assemble JSON
# ----------------------------
s <- scores %>% filter(join_name == clean_join_name(target))

benchmark_by_year_json <- by_year %>%
  filter(join_name == clean_join_name(target)) %>%
  arrange(year) %>%
  transmute(
    year,
    actual = round(actual_property_tax),
    benchmark = round(benchmark_property_tax),
    population_growth = round(population_growth, 4),
    inflation_growth = round(inflation_growth, 4),
    allowed_growth = round(benchmark_growth_rate, 4)
  )

out <- list(
  place = target,
  label = paste0(target, " County"),
  geography = "County",
  period = paste0(preferred_start_year, "-", preferred_end_year),
  score = s$score,
  difference_dollars = round(s$difference_dollars),
  difference_pct = round(s$difference_pct, 2),
  actual_property_tax_total = round(s$actual_property_tax_total),
  benchmark_property_tax_total = round(s$benchmark_property_tax_total),
  revenue = revenue_total %>%
    filter(join_name == clean_join_name(target)) %>%
    transmute(area = revenue_area, total = round(revenue_total), share = round(share, 4)),
  spending = spending_total %>%
    filter(join_name == clean_join_name(target)) %>%
    transmute(area = spending_area, total = round(actual_spending_total), share = round(share, 4)),
  benchmark_by_year = benchmark_by_year_json
)

json <- toJSON(out, pretty = TRUE, auto_unbox = TRUE)

writeLines(json, out_json)

cat("Wrote", out_json, "\n")
cat("Score:", s$score, "| Diff%:", round(s$difference_pct, 2),
    "| Diff$:", format(s$difference_dollars, big.mark=","),
    "| Actual:", format(s$actual_property_tax_total, big.mark=","),
    "| Benchmark:", format(s$benchmark_property_tax_total, big.mark=","), "\n")
