const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  generatePayPeriods,
  getPayPeriods,
  findPayPeriodByDate,
  clearPayPeriodCache,
} = require('../pay-period-generator.js');

function parseCsvDateToIso(value) {
  const [month, day, year] = value.split('/').map(Number);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function readExpectedFromCsv(year) {
  const csvPath = path.join(__dirname, '..', 'biweekly_payroll_2025_2026.csv');
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
  const rows = lines.slice(1).map(line => line.split(','));
  return rows
    .filter(cols => Number(cols[0]) === year)
    .map(cols => ({
      startDate: parseCsvDateToIso(cols[2]),
      endDate: parseCsvDateToIso(cols[3]),
      checkDate: parseCsvDateToIso(cols[4]),
    }));
}

function assertFriday(dateIso) {
  const date = new Date(`${dateIso}T00:00:00Z`);
  assert.equal(date.getUTCDay(), 5, `Expected Friday check date, got ${dateIso}`);
}

function assertSunday(dateIso) {
  const date = new Date(`${dateIso}T00:00:00Z`);
  assert.equal(date.getUTCDay(), 0, `Expected Sunday period start, got ${dateIso}`);
}

function assertSaturday(dateIso) {
  const date = new Date(`${dateIso}T00:00:00Z`);
  assert.equal(date.getUTCDay(), 6, `Expected Saturday period end, got ${dateIso}`);
}

for (const year of [2025, 2026]) {
  test(`generatePayPeriods(${year}) matches known payroll schedule`, () => {
    const generated = generatePayPeriods(year);
    const expected = readExpectedFromCsv(year);

    assert.equal(generated.length, 26);
    assert.equal(expected.length, 26);

    for (let i = 0; i < generated.length; i++) {
      const actual = generated[i];
      const target = expected[i];
      assert.equal(actual.startDate, target.startDate, `startDate mismatch at row ${i + 1}`);
      assert.equal(actual.endDate, target.endDate, `endDate mismatch at row ${i + 1}`);
      assert.equal(actual.checkDate, target.checkDate, `checkDate mismatch at row ${i + 1}`);

      assertSunday(actual.startDate);
      assertSaturday(actual.endDate);
      assertFriday(actual.checkDate);
      assert.equal(Number(actual.checkDate.slice(0, 4)), year, `checkDate year mismatch at row ${i + 1}`);
    }
  });
}

test('generated pay periods remain bi-weekly', () => {
  const periods = generatePayPeriods(2026);
  assert.equal(periods.length, 26);

  for (let i = 1; i < periods.length; i++) {
    const prevStart = new Date(`${periods[i - 1].startDate}T00:00:00Z`);
    const currStart = new Date(`${periods[i].startDate}T00:00:00Z`);
    const diffDays = Math.round((currStart.getTime() - prevStart.getTime()) / (24 * 60 * 60 * 1000));
    assert.equal(diffDays, 14, `Expected 14-day cadence at index ${i}`);
  }
});

test('pay period cache APIs work when localStorage is unavailable', async () => {
  const originalLocalStorage = global.localStorage;
  try {
    // Simulate environments where localStorage is blocked/unavailable.
    delete global.localStorage;

    clearPayPeriodCache(2026);
    clearPayPeriodCache();

    const periods = await getPayPeriods(2026);
    assert.equal(periods.length, 26);
  } finally {
    if (originalLocalStorage !== undefined) {
      global.localStorage = originalLocalStorage;
    }
  }
});

test('findPayPeriodByDate handles Date inputs with time components', async () => {
  const period = await findPayPeriodByDate(2026, new Date('2026-03-10T15:30:00Z'));
  assert.ok(period);
  assert.equal(period.startDate, '2026-03-08');
  assert.equal(period.endDate, '2026-03-21');
  assert.equal(period.checkDate, '2026-03-27');
});
