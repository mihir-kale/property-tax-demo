import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PT = (await import(path.join(__dirname, "..", "calc.js"))).default;
const county = JSON.parse(
  readFileSync(path.join(__dirname, "..", "data", "mecklenburg_benchmark.json"), "utf8")
);

test("arithmetic fixture: V=400000, r_actual=0.4927, r_scenario=0.4000", () => {
  const res = PT.computeComparison(400000, {
    x: 1, l_scenario: 1, r_actual: 0.4927, r_scenario: 0.4000, l_actual: 0, b_endpoint: 0
  });
  assert.equal(Math.round(res.tax_actual * 100) / 100, 1970.8);
  assert.equal(Math.round(res.tax_scenario * 100) / 100, 1600.0);
  assert.equal(Math.round(res.difference * 100) / 100, 370.8);
});

test("benchmark fixture: $100m baseline, 2% infl + 1% pop => $103m after one transition", () => {
  const out = PT.benchmarkEndpoint(100_000_000, [{ growth: 0.02 + 0.01 }]);
  assert.equal(out, 103_000_000);
});

test("benchmark compounds from the prior benchmark, not the baseline", () => {
  // baseline 100m; two transitions each 3% -> 100*1.03*1.03
  const out = PT.benchmarkEndpoint(100_000_000, [{ growth: 0.03 }, { growth: 0.03 }]);
  assert.equal(out, 100_000_000 * 1.03 * 1.03);
});

test("rate fixture: scenario levy $100m on $25b base => 0.4000 per $100", () => {
  assert.equal(PT.rateFor(100_000_000, 25_000_000_000), 0.4);
});

test("scenarioLevy caps at actual when actual is below ceiling", () => {
  assert.equal(PT.scenarioLevy(1_492_300_028, 1_554_687_233), 1_492_300_028);
});

test("two rate equations are equivalent within reconciliation rounding", () => {
  const fromBase = PT.rateFor(county.l_scenario, county.x);
  const fromActual = county.r_actual * (county.l_scenario / county.l_actual);
  // The two agree only to the extent that L_actual = X*r_actual/100; NC DOR reports
  // a 0.024% reconciliation gap, so allow a relative tolerance an order looser.
  const rel = Math.abs(fromBase - fromActual) / county.r_actual;
  assert.ok(rel < 0.001, `relative discrepancy ${rel}`);
});

test("rate reconciliation: X*r_actual/100 reproduces official levy within documented rounding", () => {
  const pct = PT.rateReconciliationPct(county.r_actual, county.x, county.l_actual);
  assert.ok(Math.abs(pct) < 0.05, `reconciliation off by ${pct}%`);
});

test("reported benchmark ceiling equals computed compounding of the 2016 baseline", () => {
  const computed = PT.benchmarkEndpoint(county.l_2016, county.transitions);
  // Allow for rounding of the growth factors stored in the JSON data file.
  const rel = Math.abs(computed - county.b_endpoint) / county.b_endpoint;
  assert.ok(rel < 1e-5, `${computed} vs ${county.b_endpoint} (rel ${rel})`);
});

test("Mecklenburg reported r_scenario equals 100*L_scenario/X", () => {
  assert.ok(Math.abs(PT.rateFor(county.l_scenario, county.x) - county.r_scenario) < 1e-4);
});

test("missing/inconsistent inputs -> unavailable, not zero-dollar tax", () => {
  const res = PT.computeComparison(400000, null);
  assert.equal(res.ok, false);
  assert.notEqual(res.reason, "");
  const bad = PT.computeComparison(400000, { r_actual: 0.49, l_scenario: 0, x: -1 });
  assert.equal(bad.ok, false);
});

test("zero actual value does not divide by zero", () => {
  const res = PT.computeComparison(0, { x: 1, l_scenario: 0.5, r_actual: 0.49, r_scenario: 0.4, l_actual: 0, b_endpoint: 0 });
  assert.equal(res.ok, true);
  assert.equal(res.tax_actual, 0);
  assert.equal(res.percent_difference, 0);
});

test("unchanged rate when actual is below ceiling", () => {
  const res = PT.computeComparison(400000, county);
  assert.equal(res.below_benchmark, true);
  assert.equal(res.same_rate, true);
  assert.ok(Math.abs(res.percent_difference) < 0.05);
});

test("address where-clause escapes single quotes (injection safe)", () => {
  const w = PT.buildAddressWhere("O'Brien 100");
  assert.equal(w, "UPPER(siteadd) LIKE UPPER('%O''Brien 100%')");
  assert.ok(!w.includes("O'Brien'%'")); // no unescaped quote
  assert.equal(PT.buildAddressWhere("   "), null);
  assert.equal(PT.buildAddressWhere(""), null);
});

test("partial address where clause matches OneMap substring form", () => {
  const w = PT.buildAddressWhere("1000 E Woodlawn");
  assert.equal(w, "UPPER(siteadd) LIKE UPPER('%1000 E Woodlawn%')");
});

test("residential filter keeps usable homes and excludes commercial/non-value", () => {
  assert.equal(PT.isUsableResidential({ parval: 260653, parusecode: "R100" }), true);
  assert.equal(PT.isUsableResidential({ parval: 2754300, parusecode: "C700" }), false);
  assert.equal(PT.isUsableResidential({ parval: 0, parusecode: "R100" }), false);
  assert.equal(PT.isUsableResidential({ parval: 260653, parusecode: null }), false);
});

test("ambiguity: a multi-match search yields a candidate list, not a silent pick", () => {
  // Simulation of one OneMap response with several matching residential parcels.
  const mock = [
    { parno: "17103426", parval: 260653, parusecode: "R300" },
    { parno: "17103458", parval: 276968, parusecode: "R300" },
    { parno: "17103483", parval: 437421, parusecode: "R300" }
  ];
  const usable = mock.filter(PT.isUsableResidential);
  assert.equal(usable.length, 3);
  // Each candidate's bill differs with its value; no single value is forced.
  const amounts = new Set(usable.map(p => PT.computeComparison(p.parval, county).tax_actual));
  assert.equal(amounts.size, usable.length);
});

