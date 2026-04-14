/**
 * Shared salary conversion math used by the browser UI and Node tests.
 */
(function initSalaryConversion(globalScope) {
  const STANDARD_BIWEEKLY_HOURS = 80;
  const STANDARD_BIWEEKLY_PERIODS = 26;
  const STANDARD_MONTHS_PER_YEAR = 12;

  function toNumber(value, fallback = 0) {
    const parsed = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeSalaryMethod(method, fallback = 'annual') {
    return ['annual', 'monthly', 'perPeriod'].includes(method) ? method : fallback;
  }

  function getSalaryPerPeriod(amount, method) {
    const normalizedAmount = Math.max(0, toNumber(amount, 0));
    const normalizedMethod = normalizeSalaryMethod(method);

    if (normalizedMethod === 'perPeriod') {
      return normalizedAmount;
    }
    if (normalizedMethod === 'monthly') {
      return (normalizedAmount * STANDARD_MONTHS_PER_YEAR) / STANDARD_BIWEEKLY_PERIODS;
    }
    return normalizedAmount / STANDARD_BIWEEKLY_PERIODS;
  }

  function getSalaryAnnualized(amount, method, periodCount = STANDARD_BIWEEKLY_PERIODS) {
    const normalizedAmount = Math.max(0, toNumber(amount, 0));
    const normalizedMethod = normalizeSalaryMethod(method);
    const normalizedPeriodCount = Number.isFinite(periodCount) && periodCount > 0
      ? periodCount
      : STANDARD_BIWEEKLY_PERIODS;

    if (normalizedMethod === 'perPeriod') {
      return normalizedAmount * normalizedPeriodCount;
    }
    if (normalizedMethod === 'monthly') {
      return normalizedAmount * STANDARD_MONTHS_PER_YEAR;
    }
    return normalizedAmount;
  }

  function estimateHourlyRate(amount, method) {
    return getSalaryPerPeriod(amount, method) / STANDARD_BIWEEKLY_HOURS;
  }

  const exported = {
    STANDARD_BIWEEKLY_HOURS,
    STANDARD_BIWEEKLY_PERIODS,
    STANDARD_MONTHS_PER_YEAR,
    toNumber,
    normalizeSalaryMethod,
    getSalaryPerPeriod,
    getSalaryAnnualized,
    estimateHourlyRate,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
  if (globalScope && typeof globalScope === 'object') {
    globalScope.SalaryConversion = exported;
  }
})(typeof window !== 'undefined' ? window : globalThis);
