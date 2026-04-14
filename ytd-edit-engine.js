/**
 * YTD edit propagation engine.
 *
 * Behavior:
 * - Only updates YTD fields.
 * - Never edits current-period fields (gross, taxes, net, etc.).
 * - Propagates from the edited row to subsequent selected rows.
 * - Optionally resets chain across check-year boundaries.
 */
(function initYtdEditEngine(globalScope) {
  const YTD_TO_CURRENT_FIELD = {
    ytdGross: 'gross',
    ytdFederal: 'federal',
    ytdState: 'state',
    ytdSS: 'ss',
    ytdMedicare: 'medicare',
    ytdDI: 'di',
    ytdFLI: 'fli',
    ytdSUI: 'sui',
    ytdSDI: 'sdi',
    ytdNYSDI: 'nySDI',
    ytdPFL: 'pfl',
    ytdTotalTaxes: 'totalTaxes',
    ytdNet: 'netPay',
  };

  function toNumber(value, fallback = 0) {
    const parsed = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function roundCurrency(value) {
    return Math.round(toNumber(value, 0) * 100) / 100;
  }

  function getCheckYearFromResult(result) {
    if (!result) return null;
    if (Number.isFinite(result.checkYear)) return result.checkYear;

    const checkDate = result.checkDate;
    if (checkDate instanceof Date) return checkDate.getUTCFullYear();
    if (typeof checkDate === 'string') {
      const isoMatch = checkDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (isoMatch) return parseInt(isoMatch[1], 10);
      const slashMatch = checkDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
      if (slashMatch) {
        const yearPart = slashMatch[3];
        const yearNum = parseInt(yearPart, 10);
        if (!Number.isFinite(yearNum)) return null;
        return yearPart.length === 2 ? 2000 + yearNum : yearNum;
      }
    }
    return null;
  }

  function getSelectedIndices(results, selectedCheckDates) {
    if (!Array.isArray(results)) return [];
    if (!Array.isArray(selectedCheckDates) || selectedCheckDates.length === 0 || selectedCheckDates.includes('all')) {
      return results.map((_, index) => index);
    }
    const selectedSet = new Set(selectedCheckDates);
    const indices = [];
    results.forEach((row, index) => {
      if (selectedSet.has(row.checkDate)) {
        indices.push(index);
      }
    });
    return indices;
  }

  function applyYtdBaseUpdate(options) {
    const {
      results,
      startIndex,
      ytdFieldType,
      newYtdValue,
      selectedCheckDates,
      respectYearBoundaries = true,
    } = options || {};

    if (!Array.isArray(results) || results.length === 0) {
      return { updatedIndices: [], selectedIndices: [] };
    }
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= results.length) {
      return { updatedIndices: [], selectedIndices: [] };
    }
    const currentField = YTD_TO_CURRENT_FIELD[ytdFieldType];
    if (!currentField) {
      return { updatedIndices: [], selectedIndices: [] };
    }

    const selectedIndices = getSelectedIndices(results, selectedCheckDates).sort((a, b) => a - b);
    let chainIndices = selectedIndices.filter(index => index >= startIndex);

    if (!chainIndices.includes(startIndex)) {
      chainIndices = [startIndex, ...chainIndices].sort((a, b) => a - b);
    }
    if (chainIndices.length === 0) {
      return { updatedIndices: [], selectedIndices };
    }

    const updatedIndices = [];
    let runningYtd = roundCurrency(newYtdValue);
    let prevYear = getCheckYearFromResult(results[startIndex]);
    results[startIndex][ytdFieldType] = runningYtd;
    updatedIndices.push(startIndex);

    for (const index of chainIndices) {
      if (index === startIndex) continue;

      const row = results[index];
      const rowYear = getCheckYearFromResult(row);
      const currentValue = roundCurrency(row[currentField]);

      const yearChanged = (
        respectYearBoundaries &&
        Number.isFinite(prevYear) &&
        Number.isFinite(rowYear) &&
        rowYear !== prevYear
      );

      if (yearChanged) {
        runningYtd = currentValue;
      } else {
        runningYtd = roundCurrency(runningYtd + currentValue);
      }

      row[ytdFieldType] = runningYtd;
      updatedIndices.push(index);

      if (Number.isFinite(rowYear)) {
        prevYear = rowYear;
      }
    }

    return { updatedIndices, selectedIndices };
  }

  const exported = {
    YTD_TO_CURRENT_FIELD,
    roundCurrency,
    toNumber,
    getCheckYearFromResult,
    getSelectedIndices,
    applyYtdBaseUpdate,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
  if (globalScope && typeof globalScope === 'object') {
    globalScope.YtdEditEngine = exported;
  }
})(typeof window !== 'undefined' ? window : globalThis);
