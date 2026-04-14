(function initW2Generator(globalScope) {
  function toNumber(value, fallback = 0) {
    const parsed = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function roundCurrency(value) {
    return Math.round(toNumber(value, 0) * 100) / 100;
  }

  function normalizeWageLimit(value) {
    if (value === 'Infinity' || value === Infinity) return Infinity;
    const parsed = toNumber(value, Infinity);
    return Number.isFinite(parsed) ? parsed : Infinity;
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

  function getCheckYear(result) {
    if (!result) return null;
    if (Number.isFinite(result.checkYear)) return result.checkYear;
    if (result.checkDate instanceof Date) return result.checkDate.getUTCFullYear();
    if (typeof result.checkDate === 'string') {
      const isoMatch = result.checkDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (isoMatch) return parseInt(isoMatch[1], 10);
      const slashMatch = result.checkDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
      if (slashMatch) {
        const yearPart = slashMatch[3];
        const year = parseInt(yearPart, 10);
        if (!Number.isFinite(year)) return null;
        return yearPart.length === 2 ? 2000 + year : year;
      }
    }
    return null;
  }

  function sumKey(results, key) {
    return roundCurrency(results.reduce((total, result) => total + toNumber(result && result[key], 0), 0));
  }

  function getAvailableYears(results) {
    const years = Array.from(new Set((Array.isArray(results) ? results : [])
      .map(getCheckYear)
      .filter(year => Number.isFinite(year))));
    years.sort((a, b) => a - b);
    return years;
  }

  function getStateOtherBoxConfig(stateCode) {
    if (stateCode === 'NJ') {
      return [
        { code: 'NJ DI', key: 'di' },
        { code: 'NJ FLI', key: 'fli' },
        { code: 'NJ SUI', key: 'sui' },
      ];
    }
    if (stateCode === 'CA') {
      return [
        { code: 'CA SDI', key: 'sdi' },
      ];
    }
    if (stateCode === 'NY') {
      return [
        { code: 'NY SDI', key: 'nySDI' },
        { code: 'NY PFL', key: 'pfl' },
      ];
    }
    return [];
  }

  function calculateSocialSecurityWages(results, taxRates, year) {
    const wageLimit = getWageLimitForYear((taxRates || {}).socialSecurity, year);
    let remainingWages = wageLimit;
    let wages = 0;

    for (const result of results) {
      const gross = Math.max(0, toNumber((result || {}).gross, 0));
      if (remainingWages <= 0) break;
      const eligibleWages = Math.min(gross, Math.max(0, remainingWages));
      wages += eligibleWages;
      if (Number.isFinite(remainingWages)) {
        remainingWages -= eligibleWages;
      }
    }

    return roundCurrency(wages);
  }

  function generateW2Data(payrollData, stateCode, taxRates, year) {
    const allResults = Array.isArray(payrollData)
      ? payrollData
      : ((payrollData && Array.isArray(payrollData.results)) ? payrollData.results : []);
    const availableYears = getAvailableYears(allResults);
    const targetYear = Number.isFinite(year) ? year : (availableYears.length ? availableYears[availableYears.length - 1] : null);
    const yearResults = allResults.filter(result => getCheckYear(result) === targetYear);
    const grossWages = sumKey(yearResults, 'gross');
    const federalWithholding = sumKey(yearResults, 'federal');
    const socialSecurityTax = sumKey(yearResults, 'ss');
    const medicareTax = sumKey(yearResults, 'medicare');
    const stateWithholding = sumKey(yearResults, 'state');
    const socialSecurityWages = calculateSocialSecurityWages(yearResults, taxRates, targetYear);
    const medicareWages = grossWages;
    const stateWages = grossWages;
    const otherItems = getStateOtherBoxConfig(stateCode)
      .map(item => ({
        code: item.code,
        amount: sumKey(yearResults, item.key),
      }))
      .filter(item => item.amount > 0);

    return {
      year: targetYear,
      stateCode: stateCode || '',
      availableYears,
      periodCount: yearResults.length,
      hasData: yearResults.length > 0,
      isEstimate: true,
      box1Wages: grossWages,
      box2FederalWithholding: federalWithholding,
      box3SocialSecurityWages: socialSecurityWages,
      box4SocialSecurityTax: socialSecurityTax,
      box5MedicareWages: medicareWages,
      box6MedicareTax: medicareTax,
      box15State: stateCode || '',
      box16StateWages: stateWages,
      box17StateIncomeTax: stateWithholding,
      box14Other: otherItems,
    };
  }

  function toCsvString(w2Data) {
    const otherItems = (w2Data.box14Other || [])
      .map(item => `${item.code}: ${item.amount.toFixed(2)}`)
      .join('; ');
    const rows = [
      [
        'Tax Year',
        'State',
        'Box 1 Wages, tips, other compensation',
        'Box 2 Federal income tax withheld',
        'Box 3 Social Security wages',
        'Box 4 Social Security tax withheld',
        'Box 5 Medicare wages and tips',
        'Box 6 Medicare tax withheld',
        'Box 16 State wages, tips, etc.',
        'Box 17 State income tax',
        'Box 14 Other',
      ],
      [
        w2Data.year ?? '',
        w2Data.stateCode || '',
        w2Data.box1Wages.toFixed(2),
        w2Data.box2FederalWithholding.toFixed(2),
        w2Data.box3SocialSecurityWages.toFixed(2),
        w2Data.box4SocialSecurityTax.toFixed(2),
        w2Data.box5MedicareWages.toFixed(2),
        w2Data.box6MedicareTax.toFixed(2),
        w2Data.box16StateWages.toFixed(2),
        w2Data.box17StateIncomeTax.toFixed(2),
        otherItems,
      ],
    ];

    return rows
      .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
  }

  const exported = {
    getAvailableYears,
    generateW2Data,
    toCsvString,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
  if (globalScope && typeof globalScope === 'object') {
    globalScope.W2Generator = exported;
  }
})(typeof window !== 'undefined' ? window : globalThis);
