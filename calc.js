(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PT = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Rate in dollars per $100 of value implied by a levy on a taxable base.
  function rateFor(levy, base) {
    if (!isFinite(levy) || !isFinite(base) || base <= 0) return NaN;
    return (100 * levy) / base;
  }

  // Levy that a given rate raises on a base (X * r / 100).
  function levyFor(rate, base) {
    if (!isFinite(rate) || !isFinite(base)) return NaN;
    return (base * rate) / 100;
  }

  // Percent discrepancy between reported levy and rate*base/100, relative to levy.
  function rateReconciliationPct(rate, base, levy) {
    if (!isFinite(rate) || !isFinite(base) || !isFinite(levy) || levy === 0) return NaN;
    return (100 * (levyFor(rate, base) - levy)) / levy;
  }

  // Compound a baseline through an ordered list of { growth } transitions (decimal fractions).
  // Returns the final ceiling after all transitions.
  function benchmarkEndpoint(baseline, transitions) {
    if (!isFinite(baseline) || !Array.isArray(transitions)) return NaN;
    let b = baseline;
    for (const t of transitions) {
      const g = Number(t && t.growth);
      if (!isFinite(g)) return NaN;
      b = b * (1 + g);
    }
    return b;
  }

  // Scenario levy = min(actual, ceiling) so the scenario never prescribes an increase.
  function scenarioLevy(actual, ceiling) {
    if (!isFinite(actual) || !isFinite(ceiling)) return NaN;
    return Math.min(actual, ceiling);
  }

  // Property bill at a rate (dollars per $100).
  function bill(value, rate) {
    if (!isFinite(value) || !isFinite(rate)) return NaN;
    return (value * rate) / 100;
  }

  // Full per-property comparison. county is a precomputed county-input record:
  // { r_actual, x, l_actual, l_2016, b_endpoint, l_scenario, r_scenario, scope_year }
  function computeComparison(value, county) {
    if (!isFinite(value) || value < 0) {
      return { ok: false, reason: "Value must be a non-negative number." };
    }
    if (!county || !isFinite(county.r_actual) || !isFinite(county.l_scenario) || !isFinite(county.x)) {
      return { ok: false, reason: "County inputs are missing or inconsistent." };
    }
    if (county.x <= 0) return { ok: false, reason: "County taxable base is unavailable." };

    const tax_actual = bill(value, county.r_actual);
    const tax_scenario = bill(value, county.r_scenario);
    const difference = tax_actual - tax_scenario;
    const percent_difference =
      tax_actual === 0
        ? (difference === 0 ? 0 : NaN)
        : (100 * difference) / tax_actual;

    return {
      ok: true,
      value: value,
      tax_actual: tax_actual,
      tax_scenario: tax_scenario,
      difference: difference,
      percent_difference: percent_difference,
      same_rate: tax_actual === 0 ? difference === 0 : Math.abs(percent_difference) < 0.05,
      below_benchmark: county.l_actual <= county.b_endpoint
    };
  }

  // Build a safe OneMap where-clause for a free-text Mecklenburg address search.
  // Escapes single quotes (SQL injection safe) and uses a case-insensitive
  // substring match on the site address. Prefix-free; the service matches %...%.
  function buildAddressWhere(query) {
    const q = String(query == null ? "" : query).trim();
    if (!q) return null;
    const escaped = q.replace(/'/g, "''");
    return "UPPER(siteadd) LIKE UPPER('%" + escaped + "%')";
  }

  // True if a parcel attribute object is a usable ordinary residential parcel.
  // Some counties (e.g. Halifax) leave `parusecode` blank and only populate the
  // human-readable `parusedesc`, so fall back to that when needed.
  function isUsableResidential(attrs) {
    const v = Number(attrs && attrs.parval);
    const code = String((attrs && attrs.parusecode) || "").toUpperCase();
    const desc = String((attrs && attrs.parusedesc) || "").toUpperCase();
    const residential = code.indexOf("R") === 0 || desc.indexOf("RESID") !== -1;
    return isFinite(v) && v > 0 && residential;
  }

  return {
    rateFor: rateFor,
    levyFor: levyFor,
    rateReconciliationPct: rateReconciliationPct,
    benchmarkEndpoint: benchmarkEndpoint,
    scenarioLevy: scenarioLevy,
    bill: bill,
    computeComparison: computeComparison,
    buildAddressWhere: buildAddressWhere,
    isUsableResidential: isUsableResidential
  };
});
