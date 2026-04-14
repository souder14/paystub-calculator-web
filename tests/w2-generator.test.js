const test = require('node:test');
const assert = require('node:assert/strict');

const taxRates = require('../tax-rates/tax-rates.json');
const w2Generator = require('../w2-generator.js');

test('W-2 generator groups results by check year and sums core boxes', () => {
  const payrollData = {
    results: [
      { checkDate: '12/27/24', gross: 1500, federal: 120, ss: 93, medicare: 21.75, state: 45, sdi: 15 },
      { checkDate: '01/10/25', gross: 2000, federal: 180, ss: 124, medicare: 29, state: 60, sdi: 20 },
      { checkDate: '01/24/25', gross: 2100, federal: 185, ss: 130.2, medicare: 30.45, state: 63, sdi: 21 },
    ],
  };

  const w2 = w2Generator.generateW2Data(payrollData, 'CA', taxRates, 2025);

  assert.equal(w2.year, 2025);
  assert.equal(w2.periodCount, 2);
  assert.equal(w2.box1Wages, 4100);
  assert.equal(w2.box2FederalWithholding, 365);
  assert.equal(w2.box3SocialSecurityWages, 4100);
  assert.equal(w2.box4SocialSecurityTax, 254.2);
  assert.equal(w2.box5MedicareWages, 4100);
  assert.equal(w2.box6MedicareTax, 59.45);
  assert.equal(w2.box16StateWages, 4100);
  assert.equal(w2.box17StateIncomeTax, 123);
  assert.deepEqual(w2.box14Other, [{ code: 'CA SDI', amount: 41 }]);
});

test('W-2 generator caps Social Security wages at the annual wage base', () => {
  const payrollData = {
    results: [
      { checkYear: 2025, gross: 100000, federal: 0, ss: 6200, medicare: 1450, state: 0 },
      { checkYear: 2025, gross: 100000, federal: 0, ss: 4718.2, medicare: 1450, state: 0 },
      { checkYear: 2025, gross: 100000, federal: 0, ss: 0, medicare: 1450, state: 0 },
    ],
  };

  const w2 = w2Generator.generateW2Data(payrollData, 'TX', taxRates, 2025);

  assert.equal(w2.box1Wages, 300000);
  assert.equal(w2.box3SocialSecurityWages, 176100);
  assert.equal(w2.box4SocialSecurityTax, 10918.2);
  assert.equal(w2.box5MedicareWages, 300000);
  assert.equal(w2.box6MedicareTax, 4350);
});
