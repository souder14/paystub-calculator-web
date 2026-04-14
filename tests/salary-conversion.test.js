const test = require('node:test');
const assert = require('node:assert/strict');

const salaryConversion = require('../salary-conversion.js');

function approxEqual(actual, expected, epsilon = 0.0001) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `Expected ${expected}, got ${actual}`);
}

test('estimated hourly rate matches annual salary conversion', () => {
  approxEqual(salaryConversion.estimateHourlyRate(60000, 'annual'), 60000 / 26 / 80);
});

test('estimated hourly rate matches monthly salary conversion', () => {
  approxEqual(salaryConversion.estimateHourlyRate(5000, 'monthly'), (5000 * 12) / 26 / 80);
});

test('estimated hourly rate matches per-period salary conversion', () => {
  approxEqual(salaryConversion.estimateHourlyRate(2307.69, 'perPeriod'), 2307.69 / 80);
});

test('annualized and per-period salary math stays internally consistent', () => {
  const amount = 5000;
  const perPeriod = salaryConversion.getSalaryPerPeriod(amount, 'monthly');
  const annualized = salaryConversion.getSalaryAnnualized(amount, 'monthly', 26);

  approxEqual(perPeriod * 26, annualized);
});
