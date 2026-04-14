/**
 * Shared payroll tax math used by browser UI and Node tests.
 */
(function initPayrollTaxEngine(globalScope) {
  function toNumber(value, fallback = 0) {
    const parsed = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeWageLimit(value) {
    if (value === 'Infinity' || value === Infinity) return Infinity;
    const parsed = toNumber(value, Infinity);
    return Number.isFinite(parsed) ? parsed : Infinity;
  }

  function getRateForYear(details, year) {
    if (!details) return null;
    if (Number.isFinite(year) && details.ratesByYear && details.ratesByYear[year] != null) {
      return toNumber(details.ratesByYear[year], null);
    }
    if (details.rate != null) {
      return toNumber(details.rate, null);
    }
    return null;
  }

  function getWageLimitForYear(details, year) {
    if (!details) return Infinity;
    if (Number.isFinite(year) && details.wageLimitsByYear && details.wageLimitsByYear[year] != null) {
      return normalizeWageLimit(details.wageLimitsByYear[year]);
    }
    if (details.wageLimit != null) {
      return normalizeWageLimit(details.wageLimit);
    }
    return Infinity;
  }

  function getValueForYear(details, key, year) {
    if (!details) return null;
    const byYearKey = `${key}ByYear`;
    if (Number.isFinite(year) && details[byYearKey] && details[byYearKey][year] != null) {
      return details[byYearKey][year];
    }
    if (details[key] != null) return details[key];
    return null;
  }

  function getBracketsForYear(details, year) {
    if (!details) return [];
    if (Number.isFinite(year) && details.bracketsByYear && Array.isArray(details.bracketsByYear[year])) {
      return details.bracketsByYear[year];
    }
    return Array.isArray(details.brackets) ? details.brackets : [];
  }

  function parseYearFromDateValue(value) {
    if (value instanceof Date) {
      return value.getUTCFullYear();
    }
    if (typeof value === 'string') {
      const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (isoMatch) return parseInt(isoMatch[1], 10);
      const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
      if (slashMatch) {
        const yearPart = slashMatch[3];
        const yearNum = parseInt(yearPart, 10);
        if (!Number.isFinite(yearNum)) return null;
        return yearPart.length === 2 ? 2000 + yearNum : yearNum;
      }
    }
    return null;
  }

  function getPayPeriodCountForYear(payPeriods, checkYear, fallback = 26) {
    if (!Array.isArray(payPeriods) || payPeriods.length === 0) return fallback;
    if (!Number.isFinite(checkYear)) return payPeriods.length;
    const count = payPeriods.reduce((total, period) => {
      const year = parseYearFromDateValue((period || {}).checkDate);
      return total + (year === checkYear ? 1 : 0);
    }, 0);
    return count > 0 ? count : fallback;
  }

  /**
   * Progressive tax helper:
   * - Handles either "gapless" brackets (next min == prev max) or
   *   "plus-one" bracket mins (next min == prev max + 1).
   * - Uses previous bracket max as the exclusive lower bound when available.
   */
  function calculateProgressiveTax(taxableAmount, brackets) {
    if (!Array.isArray(brackets) || brackets.length === 0) return 0;
    const annualTaxable = Math.max(0, toNumber(taxableAmount, 0));
    let totalTax = 0;

    for (let index = 0; index < brackets.length; index++) {
      const bracket = brackets[index] || {};
      const rate = toNumber(bracket.rate, 0);
      if (!(rate > 0)) continue;

      let lowerBound = toNumber(bracket.min, 0);
      if (index > 0) {
        const prev = brackets[index - 1] || {};
        const prevMax = prev.max == null ? Infinity : toNumber(prev.max, Infinity);
        if (Number.isFinite(prevMax)) {
          lowerBound = prevMax;
        }
      }

      const upperBound = bracket.max == null ? Infinity : toNumber(bracket.max, Infinity);
      if (!(upperBound > lowerBound)) continue;

      const taxableInBracket = Math.max(0, Math.min(annualTaxable, upperBound) - lowerBound);
      if (taxableInBracket > 0) {
        totalTax += taxableInBracket * rate;
      }
      if (annualTaxable <= upperBound) break;
    }

    return Math.max(0, totalTax);
  }

  function calculateFederalTaxForPeriod(gross, taxRates, payPeriods, checkYear) {
    if (!taxRates || !taxRates.federal) return 0;
    const taxableGross = Math.max(0, toNumber(gross, 0));
    if (taxableGross === 0) return 0;
    const brackets = getBracketsForYear(taxRates.federal, checkYear);
    if (!Array.isArray(brackets) || brackets.length === 0) return 0;

    const periodCount = getPayPeriodCountForYear(payPeriods, checkYear, 26);
    const annualGross = taxableGross * periodCount;
    
    // Federal standard deduction
    const standardDeduction = toNumber(getValueForYear(taxRates.federal, 'standardDeduction', checkYear), 0);
    const annualTaxable = Math.max(0, annualGross - standardDeduction);
    
    const annualTax = calculateProgressiveTax(annualTaxable, brackets);
    return annualTax / periodCount;
  }

  function calculateStateTaxForPeriod(gross, stateCode, taxRates, payPeriods, checkYear) {
    if (!taxRates || !taxRates.states) return 0;
    const state = taxRates.states[stateCode];
    if (!state) return 0;
    const taxableGross = Math.max(0, toNumber(gross, 0));
    if (taxableGross === 0) return 0;

    const brackets = getBracketsForYear(state, checkYear);
    if (!Array.isArray(brackets) || brackets.length === 0) return 0;

    const periodCount = getPayPeriodCountForYear(payPeriods, checkYear, 26);
    const annualGross = taxableGross * periodCount;

    const allowances = toNumber(getValueForYear(state, 'allowances', checkYear), 0);
    const allowanceAmount = toNumber(getValueForYear(state, 'allowanceAmount', checkYear), 0);
    const standardDeduction = toNumber(getValueForYear(state, 'standardDeduction', checkYear), 0);
    const deductionTotal = (allowances * allowanceAmount) + standardDeduction;

    const annualTaxable = Math.max(0, annualGross - deductionTotal);
    const annualTax = calculateProgressiveTax(annualTaxable, brackets);
    return annualTax / periodCount;
  }

  function calculateWageBasedTaxForPeriod(details, gross, ytdGross, checkYear) {
    const rate = getRateForYear(details, checkYear);
    if (!Number.isFinite(rate) || rate <= 0) return 0;
    const wageLimit = getWageLimitForYear(details, checkYear);
    const currentGross = Math.max(0, toNumber(gross, 0));
    const priorGross = Math.max(0, toNumber(ytdGross, 0));
    const eligibleWages = Math.min(currentGross, Math.max(0, wageLimit - priorGross));
    let tax = rate * eligibleWages;

    // Handle additional tax (e.g. Additional Medicare Tax)
    const addRate = toNumber(getValueForYear(details, 'additionalRate', checkYear), 0);
    const addThreshold = toNumber(getValueForYear(details, 'additionalThreshold', checkYear), Infinity);
    if (addRate > 0 && Number.isFinite(addThreshold)) {
      const totalYtdBefore = priorGross;
      const totalYtdAfter = priorGross + currentGross;
      const addTaxable = Math.max(0, totalYtdAfter - Math.max(totalYtdBefore, addThreshold));
      if (addTaxable > 0) {
        tax += addTaxable * addRate;
      }
    }

    return Math.round(tax * 100) / 100;
  }

  const exported = {
    toNumber,
    normalizeWageLimit,
    getRateForYear,
    getWageLimitForYear,
    getValueForYear,
    getBracketsForYear,
    parseYearFromDateValue,
    getPayPeriodCountForYear,
    calculateProgressiveTax,
    calculateFederalTaxForPeriod,
    calculateStateTaxForPeriod,
    calculateWageBasedTaxForPeriod,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
  if (globalScope && typeof globalScope === 'object') {
    globalScope.PayrollTaxEngine = exported;
  }
})(typeof window !== 'undefined' ? window : globalThis);
