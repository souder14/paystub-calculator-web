const test = require('node:test');
const assert = require('node:assert/strict');

const ytdEngine = require('../ytd-edit-engine.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('YTD edit uses edited row as base and updates only subsequent selected rows', () => {
  const results = clone([
    { checkDate: '01/03/26', checkYear: 2026, gross: 100, ytdGross: 100 },
    { checkDate: '01/17/26', checkYear: 2026, gross: 200, ytdGross: 300 },
    { checkDate: '01/31/26', checkYear: 2026, gross: 150, ytdGross: 450 },
    { checkDate: '02/14/26', checkYear: 2026, gross: 120, ytdGross: 570 },
    { checkDate: '02/28/26', checkYear: 2026, gross: 80, ytdGross: 650 },
  ]);
  const originalCurrent = results.map(row => row.gross);

  const selected = ['01/17/26', '02/14/26', '02/28/26'];
  const { updatedIndices } = ytdEngine.applyYtdBaseUpdate({
    results,
    startIndex: 1,
    ytdFieldType: 'ytdGross',
    newYtdValue: 999,
    selectedCheckDates: selected,
  });

  assert.deepEqual(updatedIndices, [1, 3, 4]);
  assert.equal(results[1].ytdGross, 999);
  assert.equal(results[3].ytdGross, 1119);
  assert.equal(results[4].ytdGross, 1199);

  // Unselected row remains unchanged.
  assert.equal(results[2].ytdGross, 450);

  // Current values are untouched.
  assert.deepEqual(results.map(row => row.gross), originalCurrent);
});

test('YTD edit on "all" selection propagates through all subsequent rows', () => {
  const results = clone([
    { checkDate: '01/03/26', checkYear: 2026, federal: 10, ytdFederal: 10 },
    { checkDate: '01/17/26', checkYear: 2026, federal: 20, ytdFederal: 30 },
    { checkDate: '01/31/26', checkYear: 2026, federal: 15, ytdFederal: 45 },
    { checkDate: '02/14/26', checkYear: 2026, federal: 12, ytdFederal: 57 },
  ]);

  ytdEngine.applyYtdBaseUpdate({
    results,
    startIndex: 1,
    ytdFieldType: 'ytdFederal',
    newYtdValue: 50,
    selectedCheckDates: ['all'],
  });

  assert.equal(results[0].ytdFederal, 10);
  assert.equal(results[1].ytdFederal, 50);
  assert.equal(results[2].ytdFederal, 65);
  assert.equal(results[3].ytdFederal, 77);
});

test('YTD propagation resets at check-year boundary', () => {
  const results = clone([
    { checkDate: '12/20/25', checkYear: 2025, netPay: 100, ytdNet: 2400 },
    { checkDate: '12/31/25', checkYear: 2025, netPay: 200, ytdNet: 2600 },
    { checkDate: '01/15/26', checkYear: 2026, netPay: 300, ytdNet: 300 },
    { checkDate: '01/29/26', checkYear: 2026, netPay: 50, ytdNet: 350 },
  ]);

  ytdEngine.applyYtdBaseUpdate({
    results,
    startIndex: 1,
    ytdFieldType: 'ytdNet',
    newYtdValue: 900,
    selectedCheckDates: ['all'],
    respectYearBoundaries: true,
  });

  assert.equal(results[1].ytdNet, 900);
  assert.equal(results[2].ytdNet, 300);
  assert.equal(results[3].ytdNet, 350);
});

test('engine supports start row even if it is not in selected date list', () => {
  const results = clone([
    { checkDate: '01/03/26', checkYear: 2026, ss: 6, ytdSS: 6 },
    { checkDate: '01/17/26', checkYear: 2026, ss: 12, ytdSS: 18 },
    { checkDate: '01/31/26', checkYear: 2026, ss: 9, ytdSS: 27 },
  ]);

  ytdEngine.applyYtdBaseUpdate({
    results,
    startIndex: 1,
    ytdFieldType: 'ytdSS',
    newYtdValue: 500,
    selectedCheckDates: ['01/31/26'],
  });

  assert.equal(results[1].ytdSS, 500);
  assert.equal(results[2].ytdSS, 509);
});
