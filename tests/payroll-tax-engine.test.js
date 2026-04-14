const test = require('node:test');
const assert = require('node:assert/strict');

const taxRates = require('../tax-rates/tax-rates.json');
const taxEngine = require('../payroll-tax-engine.js');
const { generatePayPeriods } = require('../pay-period-generator.js');

function approxEqual(actual, expected, epsilon = 0.0001) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `Expected ${expected}, got ${actual}`);
}

test('progressive tax math handles plus-one bracket mins correctly', () => {
  const brackets = [
    { min: 0, max: 100, rate: 0.10 },
    { min: 101, max: 200, rate: 0.20 },
    { min: 201, max: null, rate: 0.30 },
  ];

  approxEqual(taxEngine.calculateProgressiveTax(100, brackets), 10);
  approxEqual(taxEngine.calculateProgressiveTax(101, brackets), 10.2);
  approxEqual(taxEngine.calculateProgressiveTax(250, brackets), 45);
});

test('federal withholding uses check-year-specific brackets', () => {
  const allPeriods = [...generatePayPeriods(2025), ...generatePayPeriods(2026)];
  const gross = 5000;

  const federal2025 = taxEngine.calculateFederalTaxForPeriod(gross, taxRates, allPeriods, 2025);
  const federal2026 = taxEngine.calculateFederalTaxForPeriod(gross, taxRates, allPeriods, 2026);

  // Manual annual tax / 26 pay periods
  approxEqual(federal2025, 24047 / 26, 0.01);
  approxEqual(federal2026, 23798 / 26, 0.01);
  assert.ok(federal2025 > federal2026, 'Expected 2025 withholding to be slightly higher at this income');
});

test('state withholding is not distorted by loading multiple years', () => {
  const year2025 = generatePayPeriods(2025);
  const year2026 = generatePayPeriods(2026);
  const combined = [...year2025, ...year2026];
  const gross = 4000;

  const njOnly2025 = taxEngine.calculateStateTaxForPeriod(gross, 'NJ', taxRates, year2025, 2025);
  const njCombined2025 = taxEngine.calculateStateTaxForPeriod(gross, 'NJ', taxRates, combined, 2025);
  approxEqual(njOnly2025, njCombined2025, 0.0001);

  const njOnly2026 = taxEngine.calculateStateTaxForPeriod(gross, 'NJ', taxRates, year2026, 2026);
  const njCombined2026 = taxEngine.calculateStateTaxForPeriod(gross, 'NJ', taxRates, combined, 2026);
  approxEqual(njOnly2026, njCombined2026, 0.0001);
});

test('year-specific wage limits are selected correctly (2025 vs 2026)', () => {
  const gross = 10000;
  const ytdGross = 175000;

  const ss2025 = taxEngine.calculateWageBasedTaxForPeriod(taxRates.socialSecurity, gross, ytdGross, 2025);
  const ss2026 = taxEngine.calculateWageBasedTaxForPeriod(taxRates.socialSecurity, gross, ytdGross, 2026);

  approxEqual(ss2025, 68.2, 0.01); // (176100 - 175000) * 6.2%
  approxEqual(ss2026, 589, 0.01);  // (184500 - 175000) * 6.2%
});

test('NY brackets remain strictly increasing by max threshold', () => {
  const nyBrackets = taxRates.states.NY.brackets;
  let prevMax = -Infinity;

  for (const [index, bracket] of nyBrackets.entries()) {
    const max = bracket.max == null ? Infinity : Number(bracket.max);
    assert.ok(max > prevMax, `Bracket max must increase at index ${index}`);
    prevMax = max;
  }
});
