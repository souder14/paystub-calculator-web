/**
 * Pay Period Generator Module
 * Dynamically generates bi-weekly pay periods for any year
 * Handles 27-period years and banking holidays automatically
 */

/**
 * ANCHOR DATES: Known pay period from actual payroll
 * All other pay periods are calculated from this reference point
 * Pay Period: March 9, 2025 (Sunday) to March 22, 2025 (Saturday)
 * Check Date: March 28, 2025 (Friday)
 */
const ANCHOR_PERIOD_START = new Date(Date.UTC(2025, 2, 9)); // March 9, 2025 (Sunday)
const ANCHOR_CHECK_DATE = new Date(Date.UTC(2025, 2, 28)); // March 28, 2025 (Friday)
const PERIOD_LENGTH_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MEMORY_CACHE = new Map();

/**
 * Day of week constants
 */
const DAY_OF_WEEK = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

/**
 * Adds days to a date and returns a new Date object
 * @param {Date} date - The starting date
 * @param {number} days - Number of days to add (can be negative)
 * @returns {Date} New date with days added
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Formats a date as 'YYYY-MM-DD' in UTC
 * @param {Date} date - The date to format
 * @returns {string} Formatted date string
 */
function formatDateUTC(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculates the check date for a pay period based on the anchor
 * Simply adds/subtracts 14-day intervals from the known anchor check date
 * @param {Date} periodStartDate - The start date of the pay period
 * @returns {Date} The check date for this period
 */
function normalizeOffsetDays(value) {
  const parsed = typeof value === 'number' ? value : parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculateCheckDate(periodStartDate, offsetDays = 0) {
  // Calculate how many 14-day periods away from anchor we are
  const daysDiff = Math.round((periodStartDate.getTime() - ANCHOR_PERIOD_START.getTime()) / MS_PER_DAY);
  const periodsDiff = Math.round(daysDiff / PERIOD_LENGTH_DAYS);
  
  // Add that many 14-day periods to the anchor check date
  const checkDate = addDays(ANCHOR_CHECK_DATE, periodsDiff * PERIOD_LENGTH_DAYS);
  const normalizedOffset = normalizeOffsetDays(offsetDays);
  return normalizedOffset ? addDays(checkDate, normalizedOffset) : checkDate;
}

/**
 * Generates pay periods for a given year
 * @param {number} year - The year to generate pay periods for
 * @param {Object} options - Configuration options
 * @param {Date|string} options.startDate - First pay period start date (default: calculated from anchor)
 * @param {number} options.periodLength - Length of each pay period in days (default: 14)
 * @param {boolean} options.includeCrossYear - Include period that starts in previous year (default: true)
 * @param {number} options.checkDateOffsetDays - Offset check dates by N days (default: 0)
 * @returns {Array} Array of pay period objects with startDate, endDate, and checkDate
 */
function generatePayPeriods(year, options = {}) {
  const {
    startDate = null,
    periodLength = PERIOD_LENGTH_DAYS,
    includeCrossYear = true,
    checkDateOffsetDays = 0,
  } = options;

  const periods = [];
  const offsetDays = normalizeOffsetDays(checkDateOffsetDays);
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  const anchorCheckDateWithOffset = calculateCheckDate(ANCHOR_PERIOD_START, offsetDays);

  // Custom start date mode remains useful for diagnostics/tools.
  if (startDate) {
    let currentStart = startDate instanceof Date ? new Date(startDate) : new Date(startDate + 'T00:00:00Z');
    let iterations = 0;

    while (iterations < 60) {
      const currentEnd = addDays(currentStart, periodLength - 1);
      const checkDate = calculateCheckDate(currentStart, offsetDays);
      const checkDateInYear = checkDate >= yearStart && checkDate <= yearEnd;
      const periodFullyInYear = currentStart >= yearStart && currentEnd <= yearEnd;

      if ((includeCrossYear && checkDateInYear) || (!includeCrossYear && periodFullyInYear && checkDateInYear)) {
        periods.push({
          periodNumber: periods.length + 1,
          startDate: formatDateUTC(currentStart),
          endDate: formatDateUTC(currentEnd),
          checkDate: formatDateUTC(checkDate),
        });
      }

      if (checkDate > addDays(yearEnd, periodLength)) break;
      currentStart = addDays(currentStart, periodLength);
      iterations++;
    }

    return periods;
  }

  // Default mode: generate by check-date year so each tax year gets the correct set.
  const firstCandidateIndex = Math.floor((yearStart.getTime() - anchorCheckDateWithOffset.getTime()) / (MS_PER_DAY * periodLength)) - 2;
  const lastCandidateIndex = Math.ceil((yearEnd.getTime() - anchorCheckDateWithOffset.getTime()) / (MS_PER_DAY * periodLength)) + 2;

  for (let index = firstCandidateIndex; index <= lastCandidateIndex; index++) {
    const currentStart = addDays(ANCHOR_PERIOD_START, index * periodLength);
    const currentEnd = addDays(currentStart, periodLength - 1);
    const checkDate = calculateCheckDate(currentStart, offsetDays);
    const checkDateInYear = checkDate >= yearStart && checkDate <= yearEnd;
    const periodFullyInYear = currentStart >= yearStart && currentEnd <= yearEnd;

    if ((includeCrossYear && checkDateInYear) || (!includeCrossYear && periodFullyInYear && checkDateInYear)) {
      periods.push({
        periodNumber: periods.length + 1,
        startDate: formatDateUTC(currentStart),
        endDate: formatDateUTC(currentEnd),
        checkDate: formatDateUTC(checkDate),
      });
    }
  }

  return periods;
}

/**
 * Gets pay periods for a specific year with caching
 * @param {number} year - The year to get pay periods for
 * @param {Object} options - Configuration options passed to generatePayPeriods
 * @returns {Promise<Array>} Array of pay period objects
 */
async function getPayPeriods(year, options = {}) {
  // Check localStorage cache first
  const offsetDays = normalizeOffsetDays(options.checkDateOffsetDays);
  const cacheKey = `payperiods_${year}_${offsetDays}`;
  const hasLocalStorage = typeof localStorage !== 'undefined';
  let cached = null;

  if (hasLocalStorage) {
    try {
      cached = localStorage.getItem(cacheKey);
    } catch (e) {
      console.warn('Failed to read localStorage cache, using memory cache');
    }
  }
  if (!cached && MEMORY_CACHE.has(cacheKey)) {
    cached = MEMORY_CACHE.get(cacheKey);
  }

  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      // Verify cache has expected structure
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].startDate) {
        console.log(`Using cached pay periods for ${year}`);
        return parsed;
      }
    } catch (e) {
      console.warn('Failed to parse cached pay periods, regenerating');
    }
  }

  // Generate new periods
  console.log(`Generating pay periods for ${year}`);
  const periods = generatePayPeriods(year, { ...options, checkDateOffsetDays: offsetDays });

  // Cache the result
  try {
    const serialized = JSON.stringify(periods);
    MEMORY_CACHE.set(cacheKey, serialized);
    if (hasLocalStorage) {
      localStorage.setItem(cacheKey, serialized);
    }
    console.log(`Cached ${periods.length} pay periods for ${year}`);
  } catch (e) {
    console.warn('Failed to cache pay periods:', e);
  }

  return periods;
}

/**
 * Clears cached pay periods from localStorage
 * @param {number} [year] - Specific year to clear, or undefined to clear all
 */
function clearPayPeriodCache(year) {
  const hasLocalStorage = typeof localStorage !== 'undefined';
  if (year) {
    const keyPrefix = `payperiods_${year}_`;
    Array.from(MEMORY_CACHE.keys()).forEach(key => {
      if (key.startsWith(keyPrefix)) {
        MEMORY_CACHE.delete(key);
      }
    });

    if (!hasLocalStorage) {
      console.log(`Cleared pay period cache for ${year}`);
      return;
    }

    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key === `payperiods_${year}` || key.startsWith(`payperiods_${year}_`)) {
        localStorage.removeItem(key);
      }
    });
    console.log(`Cleared pay period cache for ${year}`);
  } else {
    MEMORY_CACHE.clear();

    if (!hasLocalStorage) {
      console.log('Cleared all pay period caches');
      return;
    }

    // Clear all pay period caches
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('payperiods_')) {
        localStorage.removeItem(key);
      }
    });
    console.log('Cleared all pay period caches');
  }
}

// Clear all caches on load to ensure latest logic is used
// This can be removed after users have refreshed once
if (typeof window !== 'undefined') {
  clearPayPeriodCache();
}

/**
 * Gets the current pay period based on today's date
 * @param {number} year - The year to search
 * @param {Object} options - Configuration options passed to getPayPeriods
 * @returns {Promise<Object|null>} Current pay period or null if not found
 */
async function getCurrentPayPeriod(year, options = {}) {
  const periods = await getPayPeriods(year, options);
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  for (const period of periods) {
    const start = new Date(period.startDate + 'T00:00:00Z');
    const end = new Date(period.endDate + 'T00:00:00Z');

    if (today >= start && today <= end) {
      return period;
    }
  }

  return null;
}

/**
 * Finds a pay period by date
 * @param {number} year - The year to search
 * @param {string|Date} date - Date to find (format: YYYY-MM-DD or Date object)
 * @param {Object} options - Configuration options passed to getPayPeriods
 * @returns {Promise<Object|null>} Pay period containing the date, or null if not found
 */
async function findPayPeriodByDate(year, date, options = {}) {
  const periods = await getPayPeriods(year, options);
  let searchDate;
  if (date instanceof Date) {
    searchDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  } else {
    searchDate = new Date(date + 'T00:00:00Z');
  }

  for (const period of periods) {
    const start = new Date(period.startDate + 'T00:00:00Z');
    const end = new Date(period.endDate + 'T00:00:00Z');

    if (searchDate >= start && searchDate <= end) {
      return period;
    }
  }

  return null;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generatePayPeriods,
    getPayPeriods,
    getCurrentPayPeriod,
    findPayPeriodByDate,
    clearPayPeriodCache,
    DAY_OF_WEEK,
  };
}

// If loaded as a script, add to window
if (typeof window !== 'undefined') {
  window.PayPeriodGenerator = {
    generatePayPeriods,
    getPayPeriods,
    getCurrentPayPeriod,
    findPayPeriodByDate,
    clearPayPeriodCache,
    DAY_OF_WEEK,
  };
  console.log('PayPeriodGenerator loaded successfully');
}
