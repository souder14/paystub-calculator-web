// Tax rates will be loaded from JSON
let TAX_RATES;
// Pay periods will be generated dynamically
let PAY_PERIODS;
// Selected years for pay period generation
let PAY_PERIOD_YEARS = [new Date().getFullYear()];

// DOM elements
const form = document.getElementById('payrollForm');
const stateSelect = document.getElementById('stateSelect');
const loading = document.getElementById('loading');
const error = document.getElementById('error');
const errorMessage = document.getElementById('errorMessage');
const results = document.getElementById('results');
const resultsBody = document.getElementById('resultsBody');
const resultsSummary = document.getElementById('resultsSummary');
const taxTotalsSummary = document.getElementById('taxTotalsSummary');
const federalTaxTotalEl = document.getElementById('federalTaxTotal');
const stateLocalTaxTotalEl = document.getElementById('stateLocalTaxTotal');
const totalsRow = document.getElementById('totalsRow');
const checkDateFilter = document.getElementById('checkDateFilter');
const applyFilter = document.getElementById('applyFilter');
const ytdNotification = document.getElementById('ytdNotification');
const ytdNotificationText = document.getElementById('ytdNotificationText');
const payDateOffsetInput = document.getElementById('payDateOffsetDays');
const hourlyRateContainer = document.getElementById('hourlyRateContainer');
const hourlyRateDisplay = document.getElementById('hourlyRateDisplay');
const TaxEngine = typeof PayrollTaxEngine !== 'undefined' ? PayrollTaxEngine : null;
const YtdEngine = typeof YtdEditEngine !== 'undefined' ? YtdEditEngine : null;
const SalaryMath = typeof SalaryConversion !== 'undefined' ? SalaryConversion : null;
const W2Engine = typeof W2Generator !== 'undefined' ? W2Generator : null;
const STANDARD_BIWEEKLY_HOURS = SalaryMath ? SalaryMath.STANDARD_BIWEEKLY_HOURS : 80;
const STANDARD_BIWEEKLY_PERIODS = SalaryMath ? SalaryMath.STANDARD_BIWEEKLY_PERIODS : 26;
const STANDARD_MONTHS_PER_YEAR = SalaryMath ? SalaryMath.STANDARD_MONTHS_PER_YEAR : 12;
const w2Section = document.getElementById('w2Section');
const w2YearSelect = document.getElementById('w2YearSelect');
const w2Content = document.getElementById('w2Content');

function normalizeYearList(years) {
    const list = Array.isArray(years) ? years : [years];
    const normalized = list
        .map(year => parseInt(year, 10))
        .filter(year => Number.isFinite(year));
    const unique = Array.from(new Set(normalized));
    unique.sort((a, b) => a - b);
    return unique;
}

function getSelectedPayPeriodYears() {
    const yearSelect = document.getElementById('payPeriodYear');
    if (!yearSelect) return [];
    const selected = Array.from(yearSelect.selectedOptions)
        .map(option => parseInt(option.value, 10))
        .filter(year => Number.isFinite(year));
    return selected;
}

function applyPayPeriodYearSelection(years) {
    const yearSelect = document.getElementById('payPeriodYear');
    if (!yearSelect) return;
    const normalized = new Set(normalizeYearList(years).map(String));
    Array.from(yearSelect.options).forEach(option => {
        option.selected = normalized.has(option.value);
    });
}

function getPayDateOffsetDays() {
    if (!payDateOffsetInput) return 0;
    const parsed = parseInt(payDateOffsetInput.value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

// Pay configuration UI
const payTypeSelect = document.getElementById('payType');
const hourlyFieldsWrapper = document.getElementById('hourlyFields');
const salaryFieldsWrapper = document.getElementById('salaryFields');
const salaryMethodSelect = document.getElementById('salaryMethod');
const salaryAmountInput = document.getElementById('salaryAmount');

function applyPayTypeUI(payType) {
    const normalizedType = (payType === 'salary' || payType === 'monthly') ? 'salary' : 'hourly';
    const isMonthly = payType === 'monthly';
    if (hourlyFieldsWrapper) {
        hourlyFieldsWrapper.classList.toggle('hidden', normalizedType === 'salary');
    }
    if (salaryFieldsWrapper) {
        salaryFieldsWrapper.classList.toggle('hidden', normalizedType !== 'salary');
    }
    const isHourly = normalizedType === 'hourly';
    if (form.startHours) form.startHours.disabled = !isHourly;
    if (form.endHours) form.endHours.disabled = !isHourly;
    if (form.payRate) form.payRate.disabled = !isHourly;
    if (salaryMethodSelect) salaryMethodSelect.disabled = isHourly || isMonthly;
    if (salaryAmountInput) salaryAmountInput.disabled = isHourly;
    if (salaryMethodSelect && isMonthly) salaryMethodSelect.value = 'monthly';
    if (!isHourly) updateHourlyRateDisplay();
}

/**
 * Calculates and displays the estimated hourly rate based on salary input
 */
function updateHourlyRateDisplay() {
    if (!salaryAmountInput || !salaryMethodSelect || !hourlyRateDisplay || !hourlyRateContainer) return;

    const amount = parseFloat(salaryAmountInput.value);
    const method = salaryMethodSelect.value;

    if (isNaN(amount) || amount <= 0) {
        hourlyRateContainer.classList.add('hidden');
        return;
    }

    const hourlyRate = SalaryMath
        ? SalaryMath.estimateHourlyRate(amount, method)
        : (method === 'annual'
            ? amount / (STANDARD_BIWEEKLY_PERIODS * STANDARD_BIWEEKLY_HOURS)
            : (method === 'monthly'
                ? (amount * STANDARD_MONTHS_PER_YEAR) / (STANDARD_BIWEEKLY_PERIODS * STANDARD_BIWEEKLY_HOURS)
                : amount / STANDARD_BIWEEKLY_HOURS));

    if (typeof formatCurrency === 'function') {
        const showCommas = document.getElementById('showCommas') ? document.getElementById('showCommas').checked : true;
        hourlyRateDisplay.textContent = formatCurrency(hourlyRate, showCommas);
    } else {
        hourlyRateDisplay.textContent = '$' + hourlyRate.toFixed(2);
    }
    hourlyRateContainer.classList.remove('hidden');
}

if (payTypeSelect) {
    payTypeSelect.addEventListener('change', function() {
        applyPayTypeUI(this.value);
    });
}

if (salaryAmountInput) {
    salaryAmountInput.addEventListener('input', updateHourlyRateDisplay);
}
if (salaryMethodSelect) {
    salaryMethodSelect.addEventListener('change', updateHourlyRateDisplay);
}

// Saved runs UI
const runNameInput = document.getElementById('runName');
const saveRunBtn = document.getElementById('saveRun');
const savedRunsSelect = document.getElementById('savedRuns');
const loadRunBtn = document.getElementById('loadRun');
const deleteRunBtn = document.getElementById('deleteRun');

// Store full payroll data for filtering
let fullPayrollData;
// Track state used at calculation time (prevents CA/NJ mismatch in cards)
let lastStateCodeUsed = null;
const SAVED_RUNS_KEY = 'payroll:savedRuns:v1';
const APP_STATE_KEY = 'payroll:appState:v1';

// State management: Save current application state
function saveAppState() {
    try {
        const state = {
            version: 1,
            timestamp: new Date().toISOString(),
            formInputs: {
                payType: payTypeSelect ? payTypeSelect.value : 'hourly',
                startHours: form.startHours ? form.startHours.value : '',
                endHours: form.endHours ? form.endHours.value : '',
                payRate: form.payRate ? form.payRate.value : '',
                salaryMethod: salaryMethodSelect ? salaryMethodSelect.value : 'annual',
                salaryAmount: salaryAmountInput ? salaryAmountInput.value : '',
                stateSelect: form.stateSelect ? form.stateSelect.value : '',
                payPeriodYears: PAY_PERIOD_YEARS,
                payDateOffsetDays: getPayDateOffsetDays()
            },
            filterState: {
                selectedDates: Array.from(checkDateFilter.selectedOptions).map(o => o.value),
                plainTextFormat: document.getElementById('plainTextFormat') ? document.getElementById('plainTextFormat').checked : false,
                showCommas: document.getElementById('showCommas') ? document.getElementById('showCommas').checked : true,
                copyOnlyResults: document.getElementById('copyOnlyResults') ? document.getElementById('copyOnlyResults').checked : false,
                w2Year: w2YearSelect ? w2YearSelect.value : ''
            },
            calculationData: fullPayrollData ? {
                data: fullPayrollData,
                stateCode: lastStateCodeUsed
            } : null
        };
        localStorage.setItem(APP_STATE_KEY, JSON.stringify(state));
        console.log('App state saved');
    } catch (err) {
        console.error('Failed to save app state:', err);
    }
}

// State management: Load and restore application state
async function loadAppState() {
    try {
        const raw = localStorage.getItem(APP_STATE_KEY);
        if (!raw) return false;
        
        const state = JSON.parse(raw);
        if (!state || state.version !== 1) return false;
        
        console.log('Restoring app state from', state.timestamp);
        
        // Restore form inputs
        if (state.formInputs) {
            const inputs = state.formInputs;
            
            if (payTypeSelect && inputs.payType) {
                payTypeSelect.value = inputs.payType;
            }
            if (form.startHours && inputs.startHours !== undefined) {
                form.startHours.value = inputs.startHours;
            }
            if (form.endHours && inputs.endHours !== undefined) {
                form.endHours.value = inputs.endHours;
            }
            if (form.payRate && inputs.payRate !== undefined) {
                form.payRate.value = inputs.payRate;
            }
            if (salaryMethodSelect && inputs.salaryMethod) {
                salaryMethodSelect.value = inputs.salaryMethod;
            }
            if (salaryAmountInput && inputs.salaryAmount !== undefined) {
                salaryAmountInput.value = inputs.salaryAmount;
            }
            if (form.stateSelect && inputs.stateSelect) {
                form.stateSelect.value = inputs.stateSelect;
            }
            
            // Restore pay period years
            const savedYears = normalizeYearList(
                Array.isArray(inputs.payPeriodYears) && inputs.payPeriodYears.length
                    ? inputs.payPeriodYears
                    : (inputs.payPeriodYear ? [inputs.payPeriodYear] : [])
            );
            if (payDateOffsetInput && inputs.payDateOffsetDays !== undefined) {
                payDateOffsetInput.value = inputs.payDateOffsetDays;
            }
            if (savedYears.length > 0) {
                PAY_PERIOD_YEARS = savedYears;
                applyPayPeriodYearSelection(savedYears);
                // Reload pay periods for the saved years
                await loadPayPeriods(savedYears, { checkDateOffsetDays: getPayDateOffsetDays() });
            }
            
            // Apply UI state for pay type
            if (inputs.payType) {
                applyPayTypeUI(inputs.payType);
            }
        }
        
        // Restore filter state
        if (state.filterState) {
            if (state.filterState.plainTextFormat !== undefined) {
                const plainTextCheckbox = document.getElementById('plainTextFormat');
                if (plainTextCheckbox) {
                    plainTextCheckbox.checked = state.filterState.plainTextFormat;
                }
            }
            if (state.filterState.showCommas !== undefined) {
                const showCommasCheckbox = document.getElementById('showCommas');
                if (showCommasCheckbox) {
                    showCommasCheckbox.checked = state.filterState.showCommas;
                }
            }
            if (state.filterState.copyOnlyResults !== undefined) {
                const copyOnlyCheckbox = document.getElementById('copyOnlyResults');
                if (copyOnlyCheckbox) {
                    copyOnlyCheckbox.checked = state.filterState.copyOnlyResults;
                }
            }
        }
        
        // Restore calculation results
        if (state.calculationData && state.calculationData.data) {
            fullPayrollData = state.calculationData.data;
            lastStateCodeUsed = state.calculationData.stateCode;
            
            // Restore filter selections after results are displayed
            const selectedDates = state.filterState && state.filterState.selectedDates 
                ? state.filterState.selectedDates 
                : ['all'];
            
            displayResults(fullPayrollData, selectedDates, lastStateCodeUsed);
            if (w2YearSelect && state.filterState && state.filterState.w2Year) {
                w2YearSelect.value = state.filterState.w2Year;
                renderW2Section(fullPayrollData, lastStateCodeUsed, state.filterState.w2Year);
            }
            console.log('Calculation results restored');
        }
        
        return true;
    } catch (err) {
        console.error('Failed to load app state:', err);
        return false;
    }
}

// Auto-save state on any significant change
function setupAutoSave() {
    // Save on form input changes (debounced)
    let saveTimeout;
    const debouncedSave = () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveAppState, 500);
    };
    
    // Monitor form inputs
    if (form) {
        form.addEventListener('input', debouncedSave);
        form.addEventListener('change', debouncedSave);
    }
    
    // Save on filter changes
    if (checkDateFilter) {
        checkDateFilter.addEventListener('change', debouncedSave);
    }
    
    // Save on format toggle
    const plainTextCheckbox = document.getElementById('plainTextFormat');
    if (plainTextCheckbox) {
        plainTextCheckbox.addEventListener('change', debouncedSave);
    }
    const showCommasCheckbox = document.getElementById('showCommas');
    if (showCommasCheckbox) {
        showCommasCheckbox.addEventListener('change', debouncedSave);
    }
    const copyOnlyResultsCheckbox = document.getElementById('copyOnlyResults');
    if (copyOnlyResultsCheckbox) {
        copyOnlyResultsCheckbox.addEventListener('change', debouncedSave);
    }
    if (w2YearSelect) {
        w2YearSelect.addEventListener('change', debouncedSave);
    }
    
    // Save before page unload
    window.addEventListener('beforeunload', saveAppState);
}

// Load tax rates from JSON
async function loadTaxRates() {
    try {
        const response = await fetch('tax-rates/tax-rates.json?v=' + Date.now());
        if (!response.ok) {
            throw new Error('Failed to load tax rates');
        }
        TAX_RATES = await response.json();
    } catch (err) {
        showError('Failed to load tax rates: ' + err.message);
        throw err;
    }
}

// Load pay periods dynamically using PayPeriodGenerator
async function loadPayPeriods(years = PAY_PERIOD_YEARS, options = {}) {
    try {
        if (typeof PayPeriodGenerator === 'undefined') {
            throw new Error('PayPeriodGenerator not loaded. Please ensure pay-period-generator.js is loaded.');
        }
        const yearList = normalizeYearList(years);
        if (yearList.length === 0) {
            throw new Error('No pay period years selected.');
        }
        const offsetDays = Number.isFinite(options.checkDateOffsetDays)
            ? options.checkDateOffsetDays
            : getPayDateOffsetDays();
        const allPeriods = [];
        for (const year of yearList) {
            const yearPeriods = await PayPeriodGenerator.getPayPeriods(year, { checkDateOffsetDays: offsetDays });
            allPeriods.push(...yearPeriods);
        }
        const deduped = new Map();
        allPeriods.forEach(period => {
            const key = period.checkDate || `${period.startDate}_${period.endDate}`;
            if (!deduped.has(key)) {
                deduped.set(key, period);
            }
        });
        PAY_PERIODS = Array.from(deduped.values()).sort((a, b) => {
            if (a.checkDate && b.checkDate) return a.checkDate.localeCompare(b.checkDate);
            if (a.startDate && b.startDate) return a.startDate.localeCompare(b.startDate);
            return 0;
        });
        console.log(`Loaded ${PAY_PERIODS.length} pay periods for ${yearList.join(', ')} (offset ${offsetDays} day${offsetDays === 1 || offsetDays === -1 ? '' : 's'})`);
        return PAY_PERIODS;
    } catch (err) {
        showError('Failed to load pay periods: ' + err.message);
        throw err;
    }
}

// Initialize state dropdown
async function initializeStates() {
    await loadTaxRates();
    await loadPayPeriods();
    Object.keys(TAX_RATES.states).sort().forEach(stateCode => {
        const state = TAX_RATES.states[stateCode];
        const option = document.createElement('option');
        option.value = stateCode;
        option.textContent = `${stateCode} - ${state.name}`;
        stateSelect.appendChild(option);
    });
}

// Federal tax calculation - annualized by check year then converted to per-period
function calculateFederalTax(gross, checkYear = null) {
    if (!TAX_RATES) return 0;
    if (!TaxEngine) {
        throw new Error('PayrollTaxEngine is not loaded.');
    }
    return TaxEngine.calculateFederalTaxForPeriod(gross, TAX_RATES, PAY_PERIODS, checkYear);
}

// State tax calculation - annualized by check year then converted to per-period
function calculateStateTax(gross, stateCode, checkYear = null) {
    if (!TAX_RATES) return 0;
    if (!TaxEngine) {
        throw new Error('PayrollTaxEngine is not loaded.');
    }
    return TaxEngine.calculateStateTaxForPeriod(gross, stateCode, TAX_RATES, PAY_PERIODS, checkYear);
}

// Generate random hours within range
function generateRandomHours(min, max) {
    return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

// Format currency
function formatCurrency(amount, useCommas = true) {
    const value = parseFloat(amount);
    if (isNaN(value)) return '$0.00';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        useGrouping: useCommas
    }).format(value);
}

// Format plain number
function formatPlainNumber(amount) {
    const value = parseFloat(amount);
    if (isNaN(value)) return '0.00';
    return value.toFixed(2);
}

function getShowCommasPreference() {
    const showCommasCheckbox = document.getElementById('showCommas');
    return showCommasCheckbox ? showCommasCheckbox.checked : true;
}

function formatEditableNumber(amount, useCommas = getShowCommasPreference()) {
    const value = parseFloat(amount);
    if (isNaN(value)) return '0.00';

    return new Intl.NumberFormat('en-US', {
        style: 'decimal',
        useGrouping: useCommas,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

function parseFormattedNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return NaN;

    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) return NaN;

    return parseFloat(normalized);
}

// Format number based on user preference
function formatNumber(amount, hideCurrency = false, useCommas = true) {
    const value = parseFloat(amount);
    if (isNaN(value)) return hideCurrency ? '0.00' : '$0.00';
    
    return new Intl.NumberFormat('en-US', {
        style: hideCurrency ? 'decimal' : 'currency',
        currency: 'USD',
        useGrouping: useCommas,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

// Format date as MM/DD/YY using UTC to keep stable check dates
function formatDate(date) {
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');
    const year = (date.getUTCFullYear() % 100).toString().padStart(2, '0');
    return `${month}/${day}/${year}`;
}

function getCheckYearFromResult(result) {
    if (!result) return null;
    if (Number.isFinite(result.checkYear)) return result.checkYear;
    if (result.checkDate instanceof Date) {
        return result.checkDate.getUTCFullYear();
    }
    if (typeof result.checkDate === 'string') {
        const isoMatch = result.checkDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) return parseInt(isoMatch[1], 10);
        const slashMatch = result.checkDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
        if (slashMatch) {
            const yearPart = slashMatch[3];
            const yearNum = parseInt(yearPart, 10);
            if (!Number.isFinite(yearNum)) return null;
            return yearPart.length === 2 ? 2000 + yearNum : yearNum;
        }
    }
    return null;
}

function toNumber(value, fallback = 0) {
    if (TaxEngine && typeof TaxEngine.toNumber === 'function') {
        return TaxEngine.toNumber(value, fallback);
    }
    const parsed = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeWageLimit(value) {
    if (TaxEngine && typeof TaxEngine.normalizeWageLimit === 'function') {
        return TaxEngine.normalizeWageLimit(value);
    }
    if (value === "Infinity") return Infinity;
    const parsed = toNumber(value, Infinity);
    return Number.isFinite(parsed) ? parsed : Infinity;
}

function getValueForYear(details, key, year, fallback = null) {
    if (TaxEngine && typeof TaxEngine.getValueForYear === 'function') {
        const value = TaxEngine.getValueForYear(details, key, year);
        return value != null ? value : fallback;
    }
    if (!details) return fallback;
    const byYearKey = `${key}ByYear`;
    if (Number.isFinite(year) && details[byYearKey] && details[byYearKey][year] != null) {
        return details[byYearKey][year];
    }
    if (details[key] != null) return details[key];
    return fallback;
}

function getRateForYear(details, year) {
    if (TaxEngine && typeof TaxEngine.getRateForYear === 'function') {
        return TaxEngine.getRateForYear(details, year);
    }
    if (!details) return null;
    if (details.ratesByYear && details.ratesByYear[year] != null) {
        return toNumber(details.ratesByYear[year], null);
    }
    if (details.rate != null) {
        return toNumber(details.rate, null);
    }
    return null;
}

function getWageLimitForYear(details, year) {
    if (TaxEngine && typeof TaxEngine.getWageLimitForYear === 'function') {
        return TaxEngine.getWageLimitForYear(details, year);
    }
    if (!details) return Infinity;
    if (details.wageLimitsByYear && details.wageLimitsByYear[year] != null) {
        return normalizeWageLimit(details.wageLimitsByYear[year]);
    }
    if (details.wageLimit != null) {
        return normalizeWageLimit(details.wageLimit);
    }
    return Infinity;
}

function calculateWageBasedTax(details, gross, ytdGross, year) {
    if (TaxEngine && typeof TaxEngine.calculateWageBasedTaxForPeriod === 'function') {
        return TaxEngine.calculateWageBasedTaxForPeriod(details, gross, ytdGross, year);
    }
    const rate = getRateForYear(details, year);
    if (!Number.isFinite(rate) || rate <= 0) return 0;
    const wageLimit = getWageLimitForYear(details, year);
    const eligibleWages = Math.min(gross, Math.max(0, wageLimit - ytdGross));
    return Math.round(rate * eligibleWages * 100) / 100;
}

function sumTaxes(result) {
    return [
        result.federal,
        result.state,
        result.ss,
        result.medicare,
        result.di,
        result.fli,
        result.sui,
        result.sdi,
        result.nySDI,
        result.pfl
    ].reduce((total, value) => total + toNumber(value, 0), 0);
}

function sumStateLocalTaxes(result) {
    return [
        result.state,
        result.di,
        result.fli,
        result.sui,
        result.sdi,
        result.nySDI,
        result.pfl
    ].reduce((total, value) => total + toNumber(value, 0), 0);
}

function sumYtdTaxes(result) {
    return [
        result.ytdFederal,
        result.ytdState,
        result.ytdSS,
        result.ytdMedicare,
        result.ytdDI,
        result.ytdFLI,
        result.ytdSUI,
        result.ytdSDI,
        result.ytdNYSDI,
        result.ytdPFL
    ].reduce((total, value) => total + toNumber(value, 0), 0);
}

// Deduction configuration helpers
function getApplicableDeductions(stateCode) {
    const always = ['federalTax', 'stateTax', 'socialSecurity', 'medicare'];
    if (stateCode === 'NJ') {
        return [...always, 'di', 'fli', 'sui'];
    } else if (stateCode === 'CA') {
        return [...always, 'sdi'];
    } else if (stateCode === 'NY') {
        return [...always, 'nySDI', 'pfl'];
    } else {
        return always;
    }
}

function getDeductionLabel(key) {
    const labels = {
        federalTax: 'Federal Tax',
        stateTax: 'State Tax',
        socialSecurity: 'Social Security',
        medicare: 'Medicare',
        di: 'NJ SDI',
        fli: 'NJ FLI',
        sui: 'NJ SUI',
        sdi: 'SDI',
        nySDI: 'NY SDI',
        pfl: 'NY PFL'
    };
    return labels[key] || key;
}

// Map deduction keys to result object keys
function currentKeyFor(d) {
    const map = {
        federalTax: 'federal',
        stateTax: 'state',
        socialSecurity: 'ss',
        medicare: 'medicare',
        di: 'di',
        fli: 'fli',
        sui: 'sui',
        sdi: 'sdi',
        nySDI: 'nySDI',
        pfl: 'pfl'
    };
    return map[d] || d;
}
function ytdKeyFor(currentKey) {
    const map = {
        federal: 'ytdFederal',
        state: 'ytdState',
        ss: 'ytdSS',
        medicare: 'ytdMedicare',
        di: 'ytdDI',
        fli: 'ytdFLI',
        sui: 'ytdSUI',
        sdi: 'ytdSDI',
        nySDI: 'ytdNYSDI',
        pfl: 'ytdPFL'
    };
    return map[currentKey] || ('ytd' + currentKey.charAt(0).toUpperCase() + currentKey.slice(1));
}

// Initialize table headers dynamically
function initializeTableHeaders(stateCode) {
    const thead = document.getElementById('tableHead');
    thead.innerHTML = '';
    const deductions = getApplicableDeductions(stateCode);
    const fixedHeaders = ['Pay Period', 'Check Date', 'Check Number', 'Hours', 'Gross Pay', 'YTD Gross'];
    fixedHeaders.forEach(h => {
        const th = document.createElement('th');
        th.className = 'px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
        th.textContent = h;
        thead.appendChild(th);
    });
    deductions.forEach(d => {
        const th = document.createElement('th');
        th.className = 'px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
        th.textContent = getDeductionLabel(d);
        thead.appendChild(th);
        const ytdTh = document.createElement('th');
        ytdTh.className = 'px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
        ytdTh.textContent = 'YTD ' + getDeductionLabel(d);
        thead.appendChild(ytdTh);
    });
    const finalHeaders = ['Total Taxes', 'YTD Total', 'Net Pay', 'YTD Net'];
    finalHeaders.forEach(h => {
        const th = document.createElement('th');
        th.className = 'px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
        th.textContent = h;
        thead.appendChild(th);
    });
}

// Export to CSV (respects plain text toggle and proper key mapping)
function exportToCsv(results, stateCode, meta = {}) {
    const usePlainText = document.getElementById('plainTextFormat').checked;
    const deductions = getApplicableDeductions(stateCode);
    const headers = ['Pay Period', 'Check Date', 'Check Number', 'Hours', 'Gross Pay', 'YTD Gross'];
    deductions.forEach(d => {
        headers.push(getDeductionLabel(d));
        headers.push('YTD ' + getDeductionLabel(d));
    });
    headers.push('Total Taxes', 'YTD Total', 'Net Pay', 'YTD Net');

    const isSalary = meta.payType === 'salary' || meta.payType === 'monthly';
    const rows = results.map(result => {
        const hasNumericHours = typeof result.hours === 'number' && !isNaN(result.hours);
        const hoursValue = hasNumericHours ? result.hours : (isSalary ? 'Salary' : '');
        const base = [
            `"${result.period}"`,
            result.checkDate,
            result.checkNumber,
            hoursValue,
            result.gross,
            result.ytdGross
        ];
        const dedPairs = deductions.flatMap(d => {
            const ck = currentKeyFor(d);
            const yk = ytdKeyFor(ck);
            return [result[ck], result[yk]];
        });
        const tail = [result.totalTaxes, result.ytdTotalTaxes, result.netPay, result.ytdNet];
        return [...base, ...dedPairs, ...tail]
            .map(val => usePlainText ? val : `"${val}"`)
            .join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'payroll-results.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

function getPreferredW2Year(payrollData, preferredYear = null) {
    if (!W2Engine || !payrollData || !Array.isArray(payrollData.results)) return null;
    const years = W2Engine.getAvailableYears(payrollData.results);
    const parsedPreferred = parseInt(preferredYear, 10);
    if (Number.isFinite(parsedPreferred) && years.includes(parsedPreferred)) {
        return parsedPreferred;
    }
    if (w2YearSelect) {
        const selected = parseInt(w2YearSelect.value, 10);
        if (Number.isFinite(selected) && years.includes(selected)) {
            return selected;
        }
    }
    return years.length ? years[years.length - 1] : null;
}

function renderW2Section(payrollData, stateCode, preferredYear = null) {
    if (!w2Section || !w2YearSelect || !w2Content) return;
    if (!W2Engine || !payrollData || !Array.isArray(payrollData.results) || !stateCode) {
        w2Section.classList.add('hidden');
        w2Content.innerHTML = '';
        return;
    }

    const years = W2Engine.getAvailableYears(payrollData.results);
    if (years.length === 0) {
        w2Section.classList.add('hidden');
        w2Content.innerHTML = '';
        return;
    }

    const selectedYear = getPreferredW2Year(payrollData, preferredYear);
    w2YearSelect.innerHTML = years.map(year => `<option value="${year}">${year}</option>`).join('');
    if (selectedYear != null) {
        w2YearSelect.value = String(selectedYear);
    }

    const w2Data = W2Engine.generateW2Data(payrollData, stateCode, TAX_RATES, selectedYear);
    const hideCurrency = document.getElementById('plainTextFormat').checked;
    const showCommas = document.getElementById('showCommas').checked;
    const otherItems = (w2Data.box14Other || []).length
        ? w2Data.box14Other.map(item => `
            <div class="flex items-center justify-between rounded-md border border-emerald-100 bg-white px-3 py-2">
                <span class="text-sm font-medium text-gray-700">${item.code}</span>
                <span class="text-sm font-semibold text-gray-900">${formatNumber(item.amount, hideCurrency, showCommas)}</span>
            </div>`).join('')
        : '<p class="text-sm text-gray-500">No Box 14 items were generated for this state and year.</p>';

    w2Content.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div class="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="rounded-lg border border-emerald-200 bg-white p-3">
                    <div class="text-xs uppercase tracking-wide text-gray-500">Box 1</div>
                    <div class="mt-1 text-sm text-gray-600">Wages, tips, other compensation</div>
                    <div class="mt-2 text-xl font-semibold text-gray-900">${formatNumber(w2Data.box1Wages, hideCurrency, showCommas)}</div>
                </div>
                <div class="rounded-lg border border-emerald-200 bg-white p-3">
                    <div class="text-xs uppercase tracking-wide text-gray-500">Box 2</div>
                    <div class="mt-1 text-sm text-gray-600">Federal income tax withheld</div>
                    <div class="mt-2 text-xl font-semibold text-gray-900">${formatNumber(w2Data.box2FederalWithholding, hideCurrency, showCommas)}</div>
                </div>
                <div class="rounded-lg border border-emerald-200 bg-white p-3">
                    <div class="text-xs uppercase tracking-wide text-gray-500">Box 3</div>
                    <div class="mt-1 text-sm text-gray-600">Social Security wages</div>
                    <div class="mt-2 text-xl font-semibold text-gray-900">${formatNumber(w2Data.box3SocialSecurityWages, hideCurrency, showCommas)}</div>
                </div>
                <div class="rounded-lg border border-emerald-200 bg-white p-3">
                    <div class="text-xs uppercase tracking-wide text-gray-500">Box 4</div>
                    <div class="mt-1 text-sm text-gray-600">Social Security tax withheld</div>
                    <div class="mt-2 text-xl font-semibold text-gray-900">${formatNumber(w2Data.box4SocialSecurityTax, hideCurrency, showCommas)}</div>
                </div>
                <div class="rounded-lg border border-emerald-200 bg-white p-3">
                    <div class="text-xs uppercase tracking-wide text-gray-500">Box 5</div>
                    <div class="mt-1 text-sm text-gray-600">Medicare wages and tips</div>
                    <div class="mt-2 text-xl font-semibold text-gray-900">${formatNumber(w2Data.box5MedicareWages, hideCurrency, showCommas)}</div>
                </div>
                <div class="rounded-lg border border-emerald-200 bg-white p-3">
                    <div class="text-xs uppercase tracking-wide text-gray-500">Box 6</div>
                    <div class="mt-1 text-sm text-gray-600">Medicare tax withheld</div>
                    <div class="mt-2 text-xl font-semibold text-gray-900">${formatNumber(w2Data.box6MedicareTax, hideCurrency, showCommas)}</div>
                </div>
                <div class="rounded-lg border border-emerald-200 bg-white p-3">
                    <div class="text-xs uppercase tracking-wide text-gray-500">Box 15</div>
                    <div class="mt-1 text-sm text-gray-600">State</div>
                    <div class="mt-2 text-xl font-semibold text-gray-900">${w2Data.box15State || 'N/A'}</div>
                </div>
                <div class="rounded-lg border border-emerald-200 bg-white p-3">
                    <div class="text-xs uppercase tracking-wide text-gray-500">Box 16</div>
                    <div class="mt-1 text-sm text-gray-600">State wages, tips, etc.</div>
                    <div class="mt-2 text-xl font-semibold text-gray-900">${formatNumber(w2Data.box16StateWages, hideCurrency, showCommas)}</div>
                </div>
                <div class="rounded-lg border border-emerald-200 bg-white p-3 md:col-span-2">
                    <div class="text-xs uppercase tracking-wide text-gray-500">Box 17</div>
                    <div class="mt-1 text-sm text-gray-600">State income tax</div>
                    <div class="mt-2 text-xl font-semibold text-gray-900">${formatNumber(w2Data.box17StateIncomeTax, hideCurrency, showCommas)}</div>
                </div>
            </div>
            <div class="rounded-lg border border-emerald-200 bg-white p-4">
                <div class="text-xs uppercase tracking-wide text-gray-500">Box 14</div>
                <div class="mt-1 text-sm text-gray-600">Other state payroll items</div>
                <div class="mt-3 space-y-2">${otherItems}</div>
                <div class="mt-4 rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                    Estimated W-2 only. This uses generated payroll totals and does not model pre-tax benefits, retirement deferrals, dependent care, or employer identity fields.
                </div>
                <div class="mt-3 text-xs text-gray-500">${w2Data.periodCount} paystub${w2Data.periodCount === 1 ? '' : 's'} included for tax year ${w2Data.year}.</div>
            </div>
        </div>`;

    w2Section.classList.remove('hidden');
}

// Copy to clipboard
async function copyToClipboard(text) {
    // Try modern Clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            console.log('Copied using Clipboard API:', text);
            return true;
        } catch (err) {
            console.warn('Clipboard API failed, trying fallback:', err);
        }
    }

    // Fallback to document.execCommand
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);

        if (successful) {
            console.log('Copied using execCommand fallback:', text);
            return true;
        } else {
            console.error('execCommand copy failed');
            return false;
        }
    } catch (err) {
        console.error('Fallback copy failed:', err);
        return false;
    }
}

function handleCopyClick(element) {
    const value = element.dataset.value;
    if (!value) {
        console.warn('No data-value attribute found on element');
        return;
    }

    // Check if the value is a date (contains /) or non-numeric text
    // If so, copy as-is. Otherwise format as number with 2 decimals.
    const isDateOrText = value.includes('/') || value === 'Salary' || isNaN(parseFloat(value));
    const copyValue = isDateOrText ? value : parseFloat(value).toFixed(2);

    copyToClipboard(copyValue).then(success => {
        if (success) {
            element.classList.add('copy-success');
            setTimeout(() => element.classList.remove('copy-success'), 2000);
        } else {
            console.error('Failed to copy value:', copyValue);
            alert('Failed to copy. Please select and copy manually.');
        }
    });
}
function initializeCopyFunctionality() {
    document.addEventListener('click', function(e) {
        const t = e.target;
        if (t instanceof Element && t.closest('#resultFormatOptions')) {
            return;
        }
        const copyable = t instanceof Element ? t.closest('.copyable') : null;
        if (copyable) {
            handleCopyClick(copyable);
        }
    });
}

// Generic function to update a paystub field and recalculate dependent values
function updatePaystubField(index, fieldType, newValue, stateCode) {
    if (!fullPayrollData || !fullPayrollData.results || index < 0 || index >= fullPayrollData.results.length) {
        console.error('Invalid paystub index or no payroll data');
        return;
    }

    const result = fullPayrollData.results[index];
    const meta = fullPayrollData.meta || {};
    const roundedValue = Math.round(newValue * 100) / 100;

    console.log(`Updating pay period ${index + 1}: ${fieldType} = ${roundedValue}`);

    // Store original values for proportional scaling
    const originalFederal = result.federal;
    const originalState = result.state;
    const originalSS = result.ss;
    const originalMedicare = result.medicare;
    const originalDI = result.di;
    const originalFLI = result.fli;
    const originalSUI = result.sui || 0;
    const originalSDI = result.sdi;
    const originalNYSDI = result.nySDI || 0;
    const originalPFL = result.pfl || 0;
    const originalTotalTaxes = result.totalTaxes;

    switch (fieldType) {
        case 'hours':
            const payRate = meta.payRate || 0;
            result.hours = roundedValue;
            result.gross = Math.round(roundedValue * payRate * 100) / 100;
            recalculateTaxesFromGross(result, stateCode, index);
            break;

        case 'gross':
            result.gross = roundedValue;
            recalculateTaxesFromGross(result, stateCode, index);
            break;

        case 'federal':
            result.federal = roundedValue;
            scaleOtherTaxes(result, 'federal', roundedValue, originalFederal, originalTotalTaxes);
            break;

        case 'state':
            result.state = roundedValue;
            scaleOtherTaxes(result, 'state', roundedValue, originalState, originalTotalTaxes);
            break;

        case 'ss':
            result.ss = roundedValue;
            scaleOtherTaxes(result, 'ss', roundedValue, originalSS, originalTotalTaxes);
            break;

        case 'medicare':
            result.medicare = roundedValue;
            scaleOtherTaxes(result, 'medicare', roundedValue, originalMedicare, originalTotalTaxes);
            break;

        case 'di':
            result.di = roundedValue;
            scaleOtherTaxes(result, 'di', roundedValue, originalDI, originalTotalTaxes);
            break;

        case 'fli':
            result.fli = roundedValue;
            scaleOtherTaxes(result, 'fli', roundedValue, originalFLI, originalTotalTaxes);
            break;

        case 'sui':
            result.sui = roundedValue;
            scaleOtherTaxes(result, 'sui', roundedValue, originalSUI, originalTotalTaxes);
            break;

        case 'sdi':
            result.sdi = roundedValue;
            scaleOtherTaxes(result, 'sdi', roundedValue, originalSDI, originalTotalTaxes);
            break;

        case 'nySDI':
            result.nySDI = roundedValue;
            scaleOtherTaxes(result, 'nySDI', roundedValue, originalNYSDI, originalTotalTaxes);
            break;

        case 'pfl':
            result.pfl = roundedValue;
            scaleOtherTaxes(result, 'pfl', roundedValue, originalPFL, originalTotalTaxes);
            break;

        case 'totalTaxes':
            result.totalTaxes = roundedValue;
            result.netPay = Math.round((result.gross - roundedValue) * 100) / 100;
            break;

        case 'netPay':
            result.netPay = roundedValue;
            result.totalTaxes = Math.round((result.gross - roundedValue) * 100) / 100;
            const newTotal = result.totalTaxes;
            if (originalTotalTaxes > 0) {
                const netRatio = newTotal / originalTotalTaxes;
                const taxFields = ['federal', 'state', 'ss', 'medicare', 'di', 'fli', 'sui', 'sdi', 'nySDI', 'pfl'];
                taxFields.forEach(f => {
                    if (typeof result[f] === 'number') {
                        result[f] = Math.round(result[f] * netRatio * 100) / 100;
                    }
                });
            }
            break;
    }

    recalculateYTDFromIndex(index, stateCode);
    const selectedDates = Array.from(checkDateFilter.selectedOptions).map(o => o.value);
    displayResults(fullPayrollData, selectedDates, stateCode);
    saveAppState();
    showYTDNotification(null, fullPayrollData.results.length - index);
}

// Helper function to scale other taxes proportionally when one tax is edited
function scaleOtherTaxes(result, editedField, newValue, originalValue, originalTotalTaxes) {
    const fields = ['federal', 'state', 'ss', 'medicare', 'di', 'fli', 'sui', 'sdi', 'nySDI', 'pfl'];
    const newTotal = originalTotalTaxes - originalValue + newValue;
    const ratio = originalTotalTaxes > 0 ? newTotal / originalTotalTaxes : 1;

    if (ratio > 0 && isFinite(ratio)) {
        fields.forEach(field => {
            if (field !== editedField && typeof result[field] === 'number') {
                result[field] = Math.round(result[field] * ratio * 100) / 100;
            }
        });
    }

    result.totalTaxes = Math.round(sumTaxes(result) * 100) / 100;
    result.netPay = Math.round((result.gross - result.totalTaxes) * 100) / 100;
}

// Recalculate taxes based on gross (used when hours are changed)
function recalculateTaxesFromGross(result, stateCode, index) {
    const gross = result.gross;

    // Get previous YTD gross
    let prevYtdGross = 0;
    const directYear = getCheckYearFromResult(result);
    const fallbackYear = index > 0 ? getCheckYearFromResult(fullPayrollData.results[index - 1]) : null;
    const checkYear = Number.isFinite(directYear)
        ? directYear
        : (Number.isFinite(fallbackYear) ? fallbackYear : new Date().getFullYear());
        
    if (index > 0) {
        const prevResult = fullPayrollData.results[index - 1];
        const prevCheckYear = getCheckYearFromResult(prevResult);
        // YTD-based tax caps reset when check year changes.
        if (!Number.isFinite(prevCheckYear) || prevCheckYear === checkYear) {
            prevYtdGross = prevResult.ytdGross;
        }
    }

    // Calculate taxes
    result.federal = Math.round(calculateFederalTax(gross, checkYear) * 100) / 100;
    result.state = Math.round(calculateStateTax(gross, stateCode, checkYear) * 100) / 100;

    // Social Security with wage cap
    const ssDetails = TAX_RATES.socialSecurity || {};
    const ssRate = getRateForYear(ssDetails, checkYear);
    const ssWageLimit = getWageLimitForYear(ssDetails, checkYear);
    const ssWages = Math.min(gross, Math.max(0, ssWageLimit - prevYtdGross));
    result.ss = Math.round(ssWages * toNumber(ssRate, 0) * 100) / 100;

    // Medicare with Additional Medicare Tax
    const medicareDetails = TAX_RATES.medicare || {};
    const medicareBaseRate = getRateForYear(medicareDetails, checkYear);
    const medicareBase = Math.round(gross * toNumber(medicareBaseRate, 0) * 100) / 100;
    let medicareAdditional = 0;
    const additionalRate = toNumber(getValueForYear(medicareDetails, 'additionalRate', checkYear), 0);
    const additionalThreshold = toNumber(getValueForYear(medicareDetails, 'additionalThreshold', checkYear), 0);
    if (additionalRate > 0 && additionalThreshold > 0) {
        const postGross = prevYtdGross + gross;
        let additionalWages = 0;
        if (prevYtdGross >= additionalThreshold) {
            additionalWages = gross;
        } else if (postGross > additionalThreshold) {
            additionalWages = Math.min(gross, postGross - additionalThreshold);
        }
        medicareAdditional = Math.round(additionalWages * additionalRate * 100) / 100;
    }
    result.medicare = Math.round((medicareBase + medicareAdditional) * 100) / 100;

    result.di = 0;
    result.fli = 0;
    result.sui = 0;
    result.sdi = 0;
    result.nySDI = 0;
    result.pfl = 0;

    // NJ SDI/FLI/SUI if applicable
    if (stateCode === 'NJ') {
        const njState = TAX_RATES.states['NJ'];
        result.di = calculateWageBasedTax(njState.di, gross, prevYtdGross, checkYear);
        result.fli = calculateWageBasedTax(njState.fli, gross, prevYtdGross, checkYear);
        result.sui = calculateWageBasedTax(njState.sui, gross, prevYtdGross, checkYear);
    }

    // CA SDI if applicable
    if (stateCode === 'CA') {
        const sdiDetails = (TAX_RATES.states[stateCode] || {}).sdi;
        if (sdiDetails) {
            result.sdi = calculateWageBasedTax(sdiDetails, gross, prevYtdGross, checkYear);
        }
    }

    // NY SDI and PFL if applicable
    if (stateCode === 'NY') {
        const nyState = TAX_RATES.states['NY'];
        
        // NY SDI (Disability Benefits) - 0.5% of weekly wages, capped at $0.60/week
        if (nyState && nyState.sdi) {
            const sdiDetails = nyState.sdi;
            const sdiRate = getRateForYear(sdiDetails, checkYear);
            const maxPerWeek = sdiDetails.maxPerWeek || 0.60;
            
            if (sdiRate) {
                let nySDIVal = sdiRate * gross;
                // Cap at max per week
                nySDIVal = Math.min(nySDIVal, maxPerWeek);
                result.nySDI = Math.round(nySDIVal * 100) / 100;
            }
        }
        
        // NY PFL (Paid Family Leave) - annual wage base with max
        if (nyState && nyState.pfl) {
            const pflDetails = nyState.pfl;
            const pflRate = getRateForYear(pflDetails, checkYear);
            const wageLimit = getWageLimitForYear(pflDetails, checkYear);
            const maxAnnual = pflDetails.maxAnnual || 411.91;
            
            if (pflRate && wageLimit) {
                const priorYtdGross = prevYtdGross;
                const eligibleWages = Math.min(gross, Math.max(0, wageLimit - priorYtdGross));
                let pflVal = pflRate * eligibleWages;
                // Cap at remaining annual max
                const ytdPFL = index > 0 ? fullPayrollData.results[index - 1].ytdPFL : 0;
                const remainingMax = Math.max(0, maxAnnual - ytdPFL);
                pflVal = Math.min(pflVal, remainingMax);
                result.pfl = Math.round(pflVal * 100) / 100;
            }
        }
    }

    result.totalTaxes = Math.round(sumTaxes(result) * 100) / 100;
    result.netPay = Math.round((gross - result.totalTaxes) * 100) / 100;
}

// Recalculate a single paystub when hours are edited (legacy compatibility)
function recalculatePaystub(index, newHours, stateCode) {
    updatePaystubField(index, 'hours', newHours, stateCode);
}

// Recalculate YTD totals starting from a specific index
function recalculateYTDFromIndex(startIndex, stateCode) {
    const periodsAffected = fullPayrollData.results.length - startIndex;
    console.log(`Recalculating YTD for ${periodsAffected} pay period(s) starting from period ${startIndex + 1}...`);
    
    let ytdGross = startIndex > 0 ? fullPayrollData.results[startIndex - 1].ytdGross : 0;
    let ytdFederal = startIndex > 0 ? fullPayrollData.results[startIndex - 1].ytdFederal : 0;
    let ytdState = startIndex > 0 ? fullPayrollData.results[startIndex - 1].ytdState : 0;
    let ytdSS = startIndex > 0 ? fullPayrollData.results[startIndex - 1].ytdSS : 0;
    let ytdMedicare = startIndex > 0 ? fullPayrollData.results[startIndex - 1].ytdMedicare : 0;
    let ytdDI = startIndex > 0 ? fullPayrollData.results[startIndex - 1].ytdDI : 0;
    let ytdFLI = startIndex > 0 ? fullPayrollData.results[startIndex - 1].ytdFLI : 0;
    let ytdSUI = startIndex > 0 ? fullPayrollData.results[startIndex - 1].ytdSUI : 0;
    let ytdSDI = startIndex > 0 ? fullPayrollData.results[startIndex - 1].ytdSDI : 0;
    let ytdNYSDI = startIndex > 0 ? fullPayrollData.results[startIndex - 1].ytdNYSDI : 0;
    let ytdPFL = startIndex > 0 ? fullPayrollData.results[startIndex - 1].ytdPFL : 0;
    let ytdNet = startIndex > 0 ? fullPayrollData.results[startIndex - 1].ytdNet : 0;
    
    // Track year for YTD reset
    let currentYear = null;
    if (startIndex > 0) {
        const prevYear = getCheckYearFromResult(fullPayrollData.results[startIndex - 1]);
        currentYear = Number.isFinite(prevYear) ? prevYear : null;
    }
    
    for (let i = startIndex; i < fullPayrollData.results.length; i++) {
        const result = fullPayrollData.results[i];
        
        // Check for year change
        const checkYear = getCheckYearFromResult(result);
        if (checkYear !== null && currentYear !== null && checkYear !== currentYear) {
            // Reset YTD for new year
            console.log(`Year change detected at period ${i + 1}. Resetting YTD values.`);
            ytdGross = 0;
            ytdFederal = 0;
            ytdState = 0;
            ytdSS = 0;
            ytdMedicare = 0;
            ytdDI = 0;
            ytdFLI = 0;
            ytdSUI = 0;
            ytdSDI = 0;
            ytdNYSDI = 0;
            ytdPFL = 0;
            ytdNet = 0;
        }
        if (checkYear !== null) {
            currentYear = checkYear;
        }
        
        // Update YTD totals
        ytdGross += result.gross;
        ytdFederal += result.federal;
        ytdState += result.state;
        ytdSS += result.ss;
        ytdMedicare += result.medicare;
        ytdDI += result.di;
        ytdFLI += result.fli;
        ytdSUI += result.sui || 0;
        ytdSDI += result.sdi;
        ytdNYSDI += result.nySDI || 0;
        ytdPFL += result.pfl || 0;
        ytdNet += result.netPay;
        
        result.ytdGross = Math.round(ytdGross * 100) / 100;
        result.ytdFederal = Math.round(ytdFederal * 100) / 100;
        result.ytdState = Math.round(ytdState * 100) / 100;
        result.ytdSS = Math.round(ytdSS * 100) / 100;
        result.ytdMedicare = Math.round(ytdMedicare * 100) / 100;
        result.ytdDI = Math.round(ytdDI * 100) / 100;
        result.ytdFLI = Math.round(ytdFLI * 100) / 100;
        result.ytdSUI = Math.round(ytdSUI * 100) / 100;
        result.ytdSDI = Math.round(ytdSDI * 100) / 100;
        result.ytdNYSDI = Math.round(ytdNYSDI * 100) / 100;
        result.ytdPFL = Math.round(ytdPFL * 100) / 100;
        result.ytdTotalTaxes = Math.round(sumYtdTaxes(result) * 100) / 100;
        result.ytdNet = Math.round(ytdNet * 100) / 100;
    }
    
    console.log(`✓ YTD recalculation complete for ${periodsAffected} period(s)`);
}

// Core calculation
function calculatePayroll(payConfig, stateCode) {
    const config = payConfig || {};
    const payType = config.payType === 'monthly'
        ? 'monthly'
        : (config.payType === 'salary' ? 'salary' : 'hourly');

    // Parse dates as UTC to prevent timezone shifts
    // Bug fix #4: Prevent division by zero if PAY_PERIODS is empty
    if (!Array.isArray(PAY_PERIODS) || PAY_PERIODS.length === 0) {
        throw new Error('No pay periods available. Please reload the page.');
    }
    
    const periods = PAY_PERIODS.map(p => ({
        startDate: new Date(p.startDate + 'T00:00:00Z'),
        endDate: new Date(p.endDate + 'T00:00:00Z'),
        checkDate: new Date(p.checkDate + 'T00:00:00Z')
    }));
    const periodCount = periods.length;
    const results = [];

    const normalizedStartHours = typeof config.startHours === 'number' ? config.startHours : parseFloat(config.startHours);
    const normalizedEndHours = typeof config.endHours === 'number' ? config.endHours : parseFloat(config.endHours);
    const normalizedPayRate = typeof config.payRate === 'number' ? config.payRate : parseFloat(config.payRate);

    const meta = {
        payType,
        startHours: null,
        endHours: null,
        payRate: null,
        salaryMethod: null,
        salaryAmount: null,
        salaryPerPeriod: null,
        salaryAnnual: null
    };

    let salaryPerPeriod = 0;
    if (payType === 'salary' || payType === 'monthly') {
        const defaultMethod = payType === 'monthly' ? 'monthly' : 'annual';
        const method = ['annual', 'monthly', 'perPeriod'].includes(config.salaryMethod) ? config.salaryMethod : defaultMethod;
        meta.salaryMethod = method;
        const rawAmount = typeof config.salaryAmount === 'number' ? config.salaryAmount : parseFloat(config.salaryAmount);
        const safeAmount = isNaN(rawAmount) ? 0 : rawAmount;
        const roundedAmount = Math.round(safeAmount * 100) / 100;
        meta.salaryAmount = roundedAmount;

        if (method === 'perPeriod') {
            salaryPerPeriod = Math.round(roundedAmount * 100) / 100;
            meta.salaryPerPeriod = salaryPerPeriod;
        } else {
            salaryPerPeriod = Math.round((SalaryMath
                ? SalaryMath.getSalaryPerPeriod(safeAmount, method)
                : (method === 'monthly'
                    ? (safeAmount * STANDARD_MONTHS_PER_YEAR) / STANDARD_BIWEEKLY_PERIODS
                    : safeAmount / STANDARD_BIWEEKLY_PERIODS)) * 100) / 100;
            meta.salaryPerPeriod = salaryPerPeriod;
        }
        meta.salaryAnnual = Math.round((SalaryMath
            ? SalaryMath.getSalaryAnnualized(safeAmount, method, periodCount)
            : (method === 'perPeriod' ? salaryPerPeriod * periodCount : (method === 'monthly' ? safeAmount * STANDARD_MONTHS_PER_YEAR : roundedAmount))) * 100) / 100;
        meta.payRate = Math.round(((SalaryMath
            ? SalaryMath.estimateHourlyRate(safeAmount, method)
            : (salaryPerPeriod / STANDARD_BIWEEKLY_HOURS)) || 0) * 100) / 100;
    } else {
        meta.startHours = isNaN(normalizedStartHours) ? 0 : Math.round(normalizedStartHours * 100) / 100;
        meta.endHours = isNaN(normalizedEndHours) ? 0 : Math.round(normalizedEndHours * 100) / 100;
        meta.payRate = isNaN(normalizedPayRate) ? 0 : Math.round(normalizedPayRate * 100) / 100;
    }

    let salaryRemainderByYear = null;
    let salaryLastIndexByYear = null;
    if ((payType === 'salary' || payType === 'monthly') && (meta.salaryMethod === 'annual' || meta.salaryMethod === 'monthly')) {
        salaryRemainderByYear = {};
        salaryLastIndexByYear = {};
        const periodsByYear = {};
        periods.forEach((period, index) => {
            const yearKey = String(period.checkDate.getUTCFullYear());
            if (!periodsByYear[yearKey]) {
                periodsByYear[yearKey] = [];
            }
            periodsByYear[yearKey].push(index);
        });
        Object.keys(periodsByYear).forEach(yearKey => {
            const indexList = periodsByYear[yearKey];
            const roundedTotal = Math.round(salaryPerPeriod * indexList.length * 100) / 100;
            const targetAnnualAmount = meta.salaryMethod === 'monthly' ? meta.salaryAnnual : meta.salaryAmount;
            const remainder = Math.round((targetAnnualAmount - roundedTotal) * 100) / 100;
            salaryRemainderByYear[yearKey] = remainder;
            salaryLastIndexByYear[yearKey] = indexList[indexList.length - 1];
        });
    }

    let ytdGross = 0;
    let ytdFederal = 0;
    let ytdState = 0;
    let ytdSS = 0;
    let ytdMedicare = 0;
    let ytdDI = 0;
    let ytdFLI = 0;
    let ytdSUI = 0;
    let ytdSDI = 0;
    let ytdNYSDI = 0;
    let ytdPFL = 0;
    let ytdNet = 0;
    
    // Bug fix #7: Use cryptographically secure random number generation
    // Generate unique check number for this calculation run
    let checkNumber;
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const randomArray = new Uint32Array(1);
        crypto.getRandomValues(randomArray);
        checkNumber = 1000 + (randomArray[0] % 9000);
    } else {
        // Fallback for older browsers
        checkNumber = Math.floor(Math.random() * 9000) + 1000;
    }
    
    console.log(`Starting check number sequence at: ${checkNumber}`);
    
    let currentYear = null; // Track the current year for YTD reset

    periods.forEach((period, index) => {
        // Check if we've crossed into a new year - reset YTD if so
        // Use check date year (not period start) since that's what appears in the UI
        const checkYear = period.checkDate.getUTCFullYear();
        if (currentYear !== null && checkYear !== currentYear) {
            // New year detected - reset all YTD totals
            ytdGross = 0;
            ytdFederal = 0;
            ytdState = 0;
            ytdSS = 0;
            ytdMedicare = 0;
            ytdDI = 0;
            ytdFLI = 0;
            ytdSUI = 0;
            ytdSDI = 0;
            ytdNYSDI = 0;
            ytdPFL = 0;
            ytdNet = 0;
        }
        currentYear = checkYear;

        let hours = null;
        let gross = 0;

        if (payType === 'salary' || payType === 'monthly') {
            gross = salaryPerPeriod;
            if ((meta.salaryMethod === 'annual' || meta.salaryMethod === 'monthly') && salaryLastIndexByYear) {
                const yearKey = String(period.checkDate.getUTCFullYear());
                if (salaryLastIndexByYear[yearKey] === index) {
                    const remainder = salaryRemainderByYear[yearKey] || 0;
                    gross = Math.round((gross + remainder) * 100) / 100;
                }
            }
            hours = meta.payRate > 0
                ? Math.round((gross / meta.payRate) * 100) / 100
                : STANDARD_BIWEEKLY_HOURS;
        } else {
            hours = generateRandomHours(meta.startHours, meta.endHours);
            gross = Math.round(hours * meta.payRate * 100) / 100;
        }

        const federal = Math.round(calculateFederalTax(gross, checkYear) * 100) / 100;
        const state = Math.round(calculateStateTax(gross, stateCode, checkYear) * 100) / 100;

        // Social Security with wage cap
        const ssDetails = TAX_RATES.socialSecurity || {};
        const ssRate = getRateForYear(ssDetails, checkYear);
        const ssWageLimit = getWageLimitForYear(ssDetails, checkYear);
        const ssWages = Math.min(gross, Math.max(0, ssWageLimit - ytdGross));
        const ss = Math.round(ssWages * toNumber(ssRate, 0) * 100) / 100;

        // Medicare with Additional Medicare Tax
        const medicareDetails = TAX_RATES.medicare || {};
        const medicareBaseRate = getRateForYear(medicareDetails, checkYear);
        const medicareBase = Math.round(gross * toNumber(medicareBaseRate, 0) * 100) / 100;
        let medicareAdditional = 0;
        const additionalRate = toNumber(getValueForYear(medicareDetails, 'additionalRate', checkYear), 0);
        const additionalThreshold = toNumber(getValueForYear(medicareDetails, 'additionalThreshold', checkYear), 0);
        if (additionalRate > 0 && additionalThreshold > 0) {
            const priorGross = ytdGross;
            const postGross = ytdGross + gross;
            let additionalWages = 0;
            if (priorGross >= additionalThreshold) {
                additionalWages = gross;
            } else if (postGross > additionalThreshold) {
                additionalWages = Math.min(gross, postGross - additionalThreshold);
            }
            medicareAdditional = Math.round(additionalWages * additionalRate * 100) / 100;
        }
        const medicare = Math.round((medicareBase + medicareAdditional) * 100) / 100;

        // NJ SDI/FLI/SUI with wage limits
        let di = 0;
        let fli = 0;
        let sui = 0;
        if (stateCode === 'NJ') {
            const njState = TAX_RATES.states['NJ'];
            di = calculateWageBasedTax(njState.di, gross, ytdGross, checkYear);
            fli = calculateWageBasedTax(njState.fli, gross, ytdGross, checkYear);
            sui = calculateWageBasedTax(njState.sui, gross, ytdGross, checkYear);
        }

        let sdi = 0;
        if (stateCode === 'CA') {
            const sdiDetails = (TAX_RATES.states[stateCode] || {}).sdi;
            if (sdiDetails) {
                sdi = calculateWageBasedTax(sdiDetails, gross, ytdGross, checkYear);
            }
        }

        let nySDI = 0;
        let pfl = 0;
        if (stateCode === 'NY') {
            const nyState = TAX_RATES.states['NY'];
            
            // NY SDI (Disability Benefits) - 0.5% of weekly wages, capped at $0.60/week
            if (nyState && nyState.sdi) {
                const sdiDetails = nyState.sdi;
                const sdiRate = getRateForYear(sdiDetails, checkYear);
                const maxPerWeek = sdiDetails.maxPerWeek || 0.60;
                
                if (sdiRate) {
                    nySDI = sdiRate * gross;
                    // Cap at max per week
                    nySDI = Math.min(nySDI, maxPerWeek);
                    nySDI = Math.round(nySDI * 100) / 100;
                }
            }
            
            // NY PFL (Paid Family Leave) - annual wage base with max
            if (nyState && nyState.pfl) {
                const pflDetails = nyState.pfl;
                const pflRate = getRateForYear(pflDetails, checkYear);
                const wageLimit = getWageLimitForYear(pflDetails, checkYear);
                const maxAnnual = pflDetails.maxAnnual || 411.91;
                
                if (pflRate && wageLimit) {
                    const eligibleWages = Math.min(gross, Math.max(0, wageLimit - ytdGross));
                    pfl = pflRate * eligibleWages;
                    // Cap at remaining annual max
                    const remainingMax = Math.max(0, maxAnnual - ytdPFL);
                    pfl = Math.min(pfl, remainingMax);
                    pfl = Math.round(pfl * 100) / 100;
                }
            }
        }

        const totalTaxes = Math.round(sumTaxes({ federal, state, ss, medicare, di, fli, sui, sdi, nySDI, pfl }) * 100) / 100;
        const netPay = Math.round((gross - totalTaxes) * 100) / 100;

        // Update YTD totals
        ytdGross += gross;
        ytdFederal += federal;
        ytdState += state;
        ytdSS += ss;
        ytdMedicare += medicare;
        ytdDI += di;
        ytdFLI += fli;
        ytdSUI += sui;
        ytdSDI += sdi;
        ytdNYSDI += nySDI;
        ytdPFL += pfl;
        ytdNet += netPay;

        results.push({
            period: `${formatDate(period.startDate)} to ${formatDate(period.endDate)}`,
            checkDate: formatDate(period.checkDate),
            checkYear: checkYear,
            checkNumber: checkNumber++,
            hours: hours,
            gross: gross,
            ytdGross: Math.round(ytdGross * 100) / 100,
            federal: federal,
            ytdFederal: Math.round(ytdFederal * 100) / 100,
            state: state,
            ytdState: Math.round(ytdState * 100) / 100,
            ss: ss,
            ytdSS: Math.round(ytdSS * 100) / 100,
            medicare: medicare,
            ytdMedicare: Math.round(ytdMedicare * 100) / 100,
            di: Math.round(di * 100) / 100,
            ytdDI: Math.round(ytdDI * 100) / 100,
            fli: Math.round(fli * 100) / 100,
            ytdFLI: Math.round(ytdFLI * 100) / 100,
            sui: Math.round(sui * 100) / 100,
            ytdSUI: Math.round(ytdSUI * 100) / 100,
            sdi: Math.round(sdi * 100) / 100,
            ytdSDI: Math.round(ytdSDI * 100) / 100,
            nySDI: Math.round(nySDI * 100) / 100,
            ytdNYSDI: Math.round(ytdNYSDI * 100) / 100,
            pfl: Math.round(pfl * 100) / 100,
            ytdPFL: Math.round(ytdPFL * 100) / 100,
            totalTaxes: totalTaxes,
            ytdTotalTaxes: Math.round(sumYtdTaxes({
                ytdFederal,
                ytdState,
                ytdSS,
                ytdMedicare,
                ytdDI,
                ytdFLI,
                ytdSUI,
                ytdSDI,
                ytdNYSDI,
                ytdPFL
            }) * 100) / 100,
            netPay: netPay,
            ytdNet: Math.round(ytdNet * 100) / 100
        });
    });

    // Bug fix #11: Safe array access with validation
    if (results.length === 0) {
        throw new Error('No payroll results generated');
    }
    
    const lastResult = results[results.length - 1];
    const totals = {
        gross: lastResult.ytdGross,
        federal: lastResult.ytdFederal,
        state: lastResult.ytdState,
        ss: lastResult.ytdSS,
        medicare: lastResult.ytdMedicare,
        di: lastResult.ytdDI,
        fli: lastResult.ytdFLI,
        sui: lastResult.ytdSUI,
        sdi: lastResult.ytdSDI,
        nySDI: lastResult.ytdNYSDI,
        pfl: lastResult.ytdPFL,
        totalTaxes: lastResult.ytdTotalTaxes,
        netPay: lastResult.ytdNet
    };

    return { results, totals, meta };
}

// Render results (cards-first)
function displayResults(payrollData, selectedDates = null, stateCode = null) {
    const hideCurrency = document.getElementById('plainTextFormat').checked;
    const showCommas = document.getElementById('showCommas').checked;
    const copyOnlyCheckbox = document.getElementById('copyOnlyResults');
    const copyOnlyMode = !!(copyOnlyCheckbox && copyOnlyCheckbox.checked);
    const meta = payrollData.meta || {};

    if (results) {
        results.dataset.payrollDisplay = copyOnlyMode ? 'copy' : 'edit';
    }

    const resultsEditTip = document.getElementById('resultsEditTip');
    if (resultsEditTip) {
        if (copyOnlyMode) {
            resultsEditTip.innerHTML = '<strong>💡 Tip:</strong> Copy-only mode: values show as <strong>dashed</strong> blue or green <strong>buttons</strong> (not typeable fields)—click to copy. Turn off <strong>Copy only</strong> in <strong>Payroll results display</strong> (above) for solid boxes you can edit.';
        } else {
            resultsEditTip.innerHTML = '<strong>💡 Tip:</strong> Click any blue field to edit current period values. Click any green field to edit YTD values. When you update a pay period, all YTD totals for that period and all subsequent periods will automatically recalculate.';
        }
    }

    // Selections
    const currentSelections = selectedDates || Array.from(checkDateFilter.selectedOptions).map(o => o.value);

    // Clear
    resultsBody.innerHTML = '';
    totalsRow.innerHTML = '';
    const mobileCards = document.getElementById('mobileCards');
    mobileCards.innerHTML = '';

    // Table headers
    initializeTableHeaders(stateCode);

    // Populate filter dropdown
    checkDateFilter.innerHTML = '<option value="all">Show All Periods</option>';
    payrollData.results.forEach(result => {
        const option = document.createElement('option');
        option.value = result.checkDate;
        option.textContent = result.checkDate;
        checkDateFilter.appendChild(option);
    });

    // Restore selections
    if (currentSelections.length > 0) {
        Array.from(checkDateFilter.options).forEach(option => {
            if (currentSelections.includes(option.value)) {
                option.selected = true;
            }
        });
    }

    // Filter list
    let filteredResults;
    if (currentSelections.includes('all') || currentSelections.length === 0) {
        filteredResults = payrollData.results;
    } else {
        filteredResults = payrollData.results.filter(r => currentSelections.includes(r.checkDate));
    }

    // Cards
    filteredResults.forEach((result, displayIndex) => {
        const card = document.createElement('div');
        card.className = 'bg-white border border-gray-200 rounded-lg p-4 shadow-sm';
        const stateName = TAX_RATES.states[stateCode].name;
        const stateLabel = stateName + ' Income Tax';
        const hasNumericHours = typeof result.hours === 'number' && !isNaN(result.hours);
        const isSalaryLike = meta.payType === 'salary' || meta.payType === 'monthly';
        const hoursDisplay = hasNumericHours ? formatPlainNumber(result.hours) : (isSalaryLike ? 'Salary' : 'N/A');
        const hoursDataValue = hasNumericHours ? result.hours : (isSalaryLike ? 'Salary' : 'N/A');
        const federalTaxTotal = toNumber(result.federal, 0) + toNumber(result.ss, 0) + toNumber(result.medicare, 0);
        const stateLocalTaxTotal = sumStateLocalTaxes(result);

        // Find the actual index in the full payroll data for editing
        const actualIndex = payrollData.results.findIndex(r => r.checkNumber === result.checkNumber);
        const isHourly = meta.payType === 'hourly';

        // Helper to create editable input (or copy-only span when toggle is on)
        const createEditableInput = (fieldType, value, width = 'w-24', min = 0, max = 999999, step = '0.01') => {
            const displayValue = formatEditableNumber(value, showCommas);
            if (copyOnlyMode) {
                const raw = typeof value === 'number' && !isNaN(value) ? value : parseFormattedNumber(String(value));
                const dataVal = isNaN(raw) ? '0' : raw;
                return `<button type="button"
                    class="copyable copy-only-field-btn mobile-card inline-block ${width} px-2 py-1 text-right rounded-md border-2 border-dashed border-blue-500 bg-white text-gray-900 font-semibold shadow-none leading-tight"
                    data-value="${dataVal}"
                    title="Copy: ${displayValue}">${displayValue}</button>`;
            }
            return `<input type="text"
                           inputmode="decimal"
                           class="editable-field ${width} px-2 py-1 text-right border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-blue-50"
                           value="${displayValue}"
                           min="${min}"
                           max="${max}"
                           step="${step}"
                           data-index="${actualIndex}"
                           data-field="${fieldType}"
                           title="Click to edit">`;
        };

        // Helper to create YTD span (read-only but copyable)
        const createYTDSpan = (value, dataAttr) => {
            return `<span class="copyable mobile-card text-gray-600" data-value="${value}">${formatNumber(value, hideCurrency, showCommas)}</span>`;
        };

        // Helper to create editable YTD input (or copy-only span when toggle is on)
        const createEditableYTDInput = (fieldType, value, width = 'w-24') => {
            const displayValue = formatEditableNumber(value, showCommas);
            if (copyOnlyMode) {
                const raw = typeof value === 'number' && !isNaN(value) ? value : parseFormattedNumber(String(value));
                const dataVal = isNaN(raw) ? '0' : raw;
                return `<button type="button"
                    class="copyable copy-only-ytd-btn mobile-card inline-block ${width} px-2 py-1 text-right rounded-md border-2 border-dashed border-green-600 bg-white text-gray-900 font-semibold shadow-none leading-tight"
                    data-value="${dataVal}"
                    title="Copy: ${displayValue}">${displayValue}</button>`;
            }
            return `<input type="text"
                           inputmode="decimal"
                           class="editable-ytd-field ${width} px-2 py-1 text-right border border-green-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500 bg-green-50"
                           value="${displayValue}"
                           min="0"
                           max="9999999"
                           step="0.01"
                           data-index="${actualIndex}"
                           data-field="${fieldType}"
                           title="Click to edit YTD - builds from this row across selected checks">`;
        };

        let cardHTML = `
            <div class="space-y-3">
                <div class="flex justify-between items-center border-b border-gray-100 pb-2">
                    <h3 class="font-semibold text-gray-800">Pay Period</h3>
                    <span class="text-sm text-gray-600 copyable mobile-card" data-value="${result.period}">${result.period}</span>
                </div>
                <div class="mb-4">
                    <div class="overflow-x-auto">
                        <table class="min-w-full text-xs">
                            <thead>
                                <tr class="border-b border-gray-200">
                                    <th class="text-left py-1 text-gray-600">Item</th>
                                    <th class="text-right py-1 text-gray-600">Current</th>
                                    <th class="text-right py-1 text-gray-600">${copyOnlyMode ? 'YTD' : 'YTD (Editable)'}</th>
                                </tr>
                            </thead>
                            <tbody class="text-gray-900">
                                <tr class="border-b border-gray-100">
                                    <td class="py-1 font-medium">Check Date</td>
                                    <td class="text-right py-1 copyable mobile-card" data-value="${result.checkDate}" colspan="2">${result.checkDate}</td>
                                </tr>
                                <tr class="border-b border-gray-100">
                                    <td class="py-1 font-medium">Check Number</td>
                                    <td class="text-right py-1 copyable mobile-card" data-value="${result.checkNumber}" colspan="2">${result.checkNumber}</td>
                                </tr>
                                <tr class="border-b border-gray-100">
                                    <td class="py-1 font-medium">Hours</td>
                                    <td class="text-right py-1">${isHourly ? createEditableInput('hours', result.hours, 'w-20', 0, 100, '0.5') : `<span class="copyable mobile-card" data-value="${hoursDataValue}">${hoursDisplay}</span>`}</td>
                                    <td class="text-right py-1">-</td>
                                </tr>
                                <tr class="border-b border-gray-100">
                                    <td class="py-1 font-medium">Gross Pay</td>
                                    <td class="text-right py-1">${createEditableInput('gross', result.gross)}</td>
                                    <td class="text-right py-1">${createEditableYTDInput('ytdGross', result.ytdGross)}</td>
                                </tr>
                                <tr class="border-b border-gray-100">
                                    <td class="py-1">Fed Income Tax</td>
                                    <td class="text-right py-1">${createEditableInput('federal', result.federal)}</td>
                                    <td class="text-right py-1">${createEditableYTDInput('ytdFederal', result.ytdFederal)}</td>
                                </tr>
                                <tr class="border-b border-gray-100">
                                    <td class="py-1">Social Security</td>
                                    <td class="text-right py-1">${createEditableInput('ss', result.ss)}</td>
                                    <td class="text-right py-1">${createEditableYTDInput('ytdSS', result.ytdSS)}</td>
                                </tr>
                                <tr class="border-b border-gray-100">
                                    <td class="py-1">${stateLabel}</td>
                                    <td class="text-right py-1">${createEditableInput('state', result.state)}</td>
                                    <td class="text-right py-1">${createEditableYTDInput('ytdState', result.ytdState)}</td>
                                </tr>
                                <tr class="border-b border-gray-100">
                                    <td class="py-1">Medicare</td>
                                    <td class="text-right py-1">${createEditableInput('medicare', result.medicare)}</td>
                                    <td class="text-right py-1">${createEditableYTDInput('ytdMedicare', result.ytdMedicare)}</td>
                                </tr>`;

        if (stateCode === 'NJ') {
            cardHTML += `
                <tr class="border-b border-gray-100">
                    <td class="py-1">NJ SDI</td>
                    <td class="text-right py-1">${createEditableInput('di', result.di)}</td>
                    <td class="text-right py-1">${createEditableYTDInput('ytdDI', result.ytdDI)}</td>
                </tr>
                <tr class="border-b border-gray-100">
                    <td class="py-1">NJ FLI</td>
                    <td class="text-right py-1">${createEditableInput('fli', result.fli)}</td>
                    <td class="text-right py-1">${createEditableYTDInput('ytdFLI', result.ytdFLI)}</td>
                </tr>`;
            cardHTML += `
                <tr class="border-b border-gray-100">
                    <td class="py-1">NJ SUI</td>
                    <td class="text-right py-1">${createEditableInput('sui', result.sui)}</td>
                    <td class="text-right py-1">${createEditableYTDInput('ytdSUI', result.ytdSUI)}</td>
                </tr>`;
        }
        if (stateCode === 'CA') {
            cardHTML += `
                <tr class="border-b border-gray-100">
                    <td class="py-1">CA SDI</td>
                    <td class="text-right py-1">${createEditableInput('sdi', result.sdi)}</td>
                    <td class="text-right py-1">${createEditableYTDInput('ytdSDI', result.ytdSDI)}</td>
                </tr>`;
        }
        if (stateCode === 'NY') {
            cardHTML += `
                <tr class="border-b border-gray-100">
                    <td class="py-1">NY SDI</td>
                    <td class="text-right py-1">${createEditableInput('nySDI', result.nySDI)}</td>
                    <td class="text-right py-1">${createEditableYTDInput('ytdNYSDI', result.ytdNYSDI)}</td>
                </tr>
                <tr class="border-b border-gray-100">
                    <td class="py-1">NY PFL</td>
                    <td class="text-right py-1">${createEditableInput('pfl', result.pfl)}</td>
                    <td class="text-right py-1">${createEditableYTDInput('ytdPFL', result.ytdPFL)}</td>
                </tr>`;
        }

        cardHTML += `
                <tr class="border-b border-gray-100">
                    <td class="py-1 font-medium">Federal Tax Total</td>
                    <td class="text-right py-1 copyable mobile-card" data-value="${federalTaxTotal}">${formatNumber(federalTaxTotal, hideCurrency, showCommas)}</td>
                    <td class="text-right py-1">-</td>
                </tr>
                <tr class="border-b border-gray-100">
                    <td class="py-1 font-medium">State &amp; Local Tax Total</td>
                    <td class="text-right py-1 copyable mobile-card" data-value="${stateLocalTaxTotal}">${formatNumber(stateLocalTaxTotal, hideCurrency, showCommas)}</td>
                    <td class="text-right py-1">-</td>
                </tr>
                <tr class="border-b border-gray-100">
                    <td class="py-1 font-medium">Total Taxes</td>
                    <td class="text-right py-1">${createEditableInput('totalTaxes', result.totalTaxes)}</td>
                    <td class="text-right py-1">${createEditableYTDInput('ytdTotalTaxes', result.ytdTotalTaxes)}</td>
                </tr>
                <tr class="font-semibold bg-green-50">
                    <td class="py-1 text-green-700">Net Pay</td>
                    <td class="text-right py-1">${createEditableInput('netPay', result.netPay)}</td>
                    <td class="text-right py-1">${createEditableYTDInput('ytdNet', result.ytdNet)}</td>
                </tr>
            </tbody>
            </table>
        </div>
        </div>
        </div>`;

        card.innerHTML = cardHTML;
        mobileCards.appendChild(card);
    });

    // Cards only (table stays hidden)
    resultsBody.parentElement.parentElement.classList.add('hidden');
    resultsBody.parentElement.parentElement.classList.remove('block');
    mobileCards.classList.remove('hidden');
    mobileCards.classList.add('block');

    // Summary
    const count = filteredResults.length;
    const selectedDatesText = (currentSelections.includes('all') || currentSelections.length === 0)
        ? 'all periods'
        : (count === 1 ? '1 selected period' : `${count} selected periods`);
    const periodCount = payrollData.results.length || (Array.isArray(PAY_PERIODS) && PAY_PERIODS.length) || 26;
    const periodLabel = `${periodCount} bi-weekly pay period${periodCount === 1 ? '' : 's'}`;
    const stateName = (TAX_RATES.states[stateCode] && TAX_RATES.states[stateCode].name) || stateCode || 'the selected';

    let summaryText;
    if (meta.payType === 'salary' || meta.payType === 'monthly') {
        const perPeriod = meta.salaryMethod === 'perPeriod';
        const amount = perPeriod ? meta.salaryPerPeriod : meta.salaryAmount;
        const descriptor = perPeriod
            ? 'per-period salary'
            : (meta.salaryMethod === 'monthly' ? 'monthly salary' : 'annual salary');
        summaryText = `Calculated for ${periodLabel} with ${descriptor} ${formatCurrency(amount || 0, showCommas)} and ${stateName} state taxes. Showing ${selectedDatesText}.`;
    } else {
        const rate = typeof meta.payRate === 'number' && !isNaN(meta.payRate)
            ? meta.payRate
            : parseFloat(form.payRate.value);
        summaryText = `Calculated for ${periodLabel} with hourly rate ${formatCurrency(rate || 0, showCommas)} and ${stateName} state taxes. Showing ${selectedDatesText}.`;
    }
    resultsSummary.textContent = summaryText;

    // Tax totals for selected periods
    const federalTotal = filteredResults.reduce((sum, r) => sum + toNumber(r.federal, 0), 0);
    const stateLocalTotal = filteredResults.reduce((sum, r) => sum + sumStateLocalTaxes(r), 0);
    if (federalTaxTotalEl) {
        federalTaxTotalEl.textContent = formatNumber(federalTotal, hideCurrency, showCommas);
    }
    if (stateLocalTaxTotalEl) {
        stateLocalTaxTotalEl.textContent = formatNumber(stateLocalTotal, hideCurrency, showCommas);
    }
    if (taxTotalsSummary) {
        taxTotalsSummary.classList.toggle('hidden', filteredResults.length === 0);
    }

    // Show results
    results.classList.remove('hidden');
    renderW2Section(payrollData, stateCode);
    
    // Initialize editable field listeners
    initializeEditableFields(stateCode);
}

// Initialize event listeners for all editable inputs
function initializeEditableFields(stateCode) {
    const editableInputs = document.querySelectorAll('.editable-field');
    editableInputs.forEach(input => {
        input.onfocus = handleEditableFieldFocus;
        input.onchange = null;
        input.onblur = (e) => handleFieldChange(e, stateCode);
        input.onkeypress = handleFieldKeypress;
    });

    // Initialize YTD editable fields
    const editableYTDInputs = document.querySelectorAll('.editable-ytd-field');
    editableYTDInputs.forEach(input => {
        input.onfocus = handleEditableFieldFocus;
        input.onchange = null;
        input.onblur = (e) => handleYTDFieldChange(e, stateCode);
        input.onkeypress = handleFieldKeypress;
    });
}

function handleEditableFieldFocus(e) {
    const input = e.target;
    const parsedValue = parseFormattedNumber(input.value);
    if (!isNaN(parsedValue)) {
        input.value = formatPlainNumber(parsedValue);
    }
    input.select();
}

// Handle Enter key in editable inputs
function handleFieldKeypress(e) {
    if (e.key === 'Enter') {
        e.target.blur();
    }
}

// Handle editable field change event
function handleFieldChange(e, stateCode) {
    const input = e.target;
    const index = parseInt(input.dataset.index);
    const fieldType = input.dataset.field;
    const newValue = parseFormattedNumber(input.value);

    // Validate input
    if (isNaN(newValue)) {
        showError('Please enter a valid number');
        // Reset to original value
        if (fullPayrollData && fullPayrollData.results[index]) {
            const result = fullPayrollData.results[index];
            const originalValue = result[fieldType] || 0;
            input.value = formatEditableNumber(originalValue);
        }
        return;
    }

    // Validate specific fields
    if (fieldType === 'hours' && (newValue < 0 || newValue > 100)) {
        showError('Hours must be between 0 and 100');
        if (fullPayrollData && fullPayrollData.results[index]) {
            input.value = formatEditableNumber(fullPayrollData.results[index].hours);
        }
        return;
    }

    if (fieldType === 'gross' && newValue < 0) {
        showError('Gross pay cannot be negative');
        if (fullPayrollData && fullPayrollData.results[index]) {
            input.value = formatEditableNumber(fullPayrollData.results[index].gross);
        }
        return;
    }

    // Validate that net pay doesn't exceed gross (when editing net pay directly)
    if (fieldType === 'netPay') {
        const result = fullPayrollData.results[index];
        if (newValue > result.gross) {
            showError('Net pay cannot exceed gross pay');
            input.value = formatEditableNumber(result.netPay);
            return;
        }
    }

    // Validate that total taxes don't exceed gross (when editing total taxes directly)
    if (fieldType === 'totalTaxes') {
        const result = fullPayrollData.results[index];
        if (newValue > result.gross) {
            showError('Total taxes cannot exceed gross pay');
            input.value = formatEditableNumber(result.totalTaxes);
            return;
        }
    }

    // Round to 2 decimal places and update
    const roundedValue = Math.round(newValue * 100) / 100;
    updatePaystubField(index, fieldType, roundedValue, stateCode);
}

// Handle YTD field change event - sets edited value as base and propagates across selected rows
function handleYTDFieldChange(e, stateCode) {
    const input = e.target;
    const index = parseInt(input.dataset.index);
    const fieldType = input.dataset.field;
    const newYTDValue = parseFormattedNumber(input.value);

    // Validate input
    if (isNaN(newYTDValue)) {
        showError('Please enter a valid number');
        // Reset to original value
        if (fullPayrollData && fullPayrollData.results[index]) {
            const result = fullPayrollData.results[index];
            const originalValue = result[fieldType] || 0;
            input.value = formatEditableNumber(originalValue);
        }
        return;
    }

    if (newYTDValue < 0) {
        showError('YTD value cannot be negative');
        if (fullPayrollData && fullPayrollData.results[index]) {
            input.value = formatEditableNumber(fullPayrollData.results[index][fieldType]);
        }
        return;
    }

    // Round to 2 decimal places
    const roundedYTD = Math.round(newYTDValue * 100) / 100;

    // Apply YTD base update for selected rows
    updateYTDField(index, fieldType, roundedYTD, stateCode);
}

// Update YTD field without changing current-period values.
// The edited row becomes the new base for subsequent selected rows.
function updateYTDField(startIndex, ytdFieldType, newYTDValue, stateCode) {
    if (!fullPayrollData || !fullPayrollData.results || startIndex < 0 || startIndex >= fullPayrollData.results.length) {
        console.error('Invalid paystub index or no payroll data');
        return;
    }

    if (!YtdEngine || typeof YtdEngine.applyYtdBaseUpdate !== 'function') {
        showError('YTD edit engine is not loaded.');
        return;
    }

    const selectedDates = Array.from(checkDateFilter.selectedOptions).map(option => option.value);
    const { updatedIndices } = YtdEngine.applyYtdBaseUpdate({
        results: fullPayrollData.results,
        startIndex: startIndex,
        ytdFieldType,
        newYtdValue,
        selectedCheckDates: selectedDates,
        respectYearBoundaries: true
    });

    // Refresh the display
    displayResults(fullPayrollData, selectedDates, stateCode);

    // Save the updated state
    saveAppState();

    // Notify how many selected rows were updated
    showYTDNotification(null, updatedIndices.length);
}

// Recalculate ALL YTD totals from scratch
function recalculateAllYTD(stateCode) {
    let ytdGross = 0;
    let ytdFederal = 0;
    let ytdState = 0;
    let ytdSS = 0;
    let ytdMedicare = 0;
    let ytdDI = 0;
    let ytdFLI = 0;
    let ytdSUI = 0;
    let ytdSDI = 0;
    let ytdNYSDI = 0;
    let ytdPFL = 0;
    let ytdNet = 0;

    let currentYear = null;

    for (let i = 0; i < fullPayrollData.results.length; i++) {
        const result = fullPayrollData.results[i];

        // Check for year change
        const checkYear = getCheckYearFromResult(result);
        if (checkYear !== null && currentYear !== null && checkYear !== currentYear) {
            // Reset YTD for new year
            ytdGross = 0;
            ytdFederal = 0;
            ytdState = 0;
            ytdSS = 0;
            ytdMedicare = 0;
            ytdDI = 0;
            ytdFLI = 0;
            ytdSUI = 0;
            ytdSDI = 0;
            ytdNYSDI = 0;
            ytdPFL = 0;
            ytdNet = 0;
        }
        if (checkYear !== null) {
            currentYear = checkYear;
        }

        // Add current period values to YTD
        ytdGross += result.gross;
        ytdFederal += result.federal;
        ytdState += result.state;
        ytdSS += result.ss;
        ytdMedicare += result.medicare;
        ytdDI += result.di;
        ytdFLI += result.fli;
        ytdSUI += result.sui || 0;
        ytdSDI += result.sdi;
        ytdNYSDI += result.nySDI || 0;
        ytdPFL += result.pfl || 0;
        ytdNet += result.netPay;

        // Update YTD values
        result.ytdGross = Math.round(ytdGross * 100) / 100;
        result.ytdFederal = Math.round(ytdFederal * 100) / 100;
        result.ytdState = Math.round(ytdState * 100) / 100;
        result.ytdSS = Math.round(ytdSS * 100) / 100;
        result.ytdMedicare = Math.round(ytdMedicare * 100) / 100;
        result.ytdDI = Math.round(ytdDI * 100) / 100;
        result.ytdFLI = Math.round(ytdFLI * 100) / 100;
        result.ytdSUI = Math.round(ytdSUI * 100) / 100;
        result.ytdSDI = Math.round(ytdSDI * 100) / 100;
        result.ytdNYSDI = Math.round(ytdNYSDI * 100) / 100;
        result.ytdPFL = Math.round(ytdPFL * 100) / 100;
        result.ytdTotalTaxes = Math.round(sumYtdTaxes(result) * 100) / 100;
        result.ytdNet = Math.round(ytdNet * 100) / 100;
    }
}

// Show error
function showError(message) {
    errorMessage.textContent = message;
    error.classList.remove('hidden');
    loading.classList.add('hidden');
}

// Show YTD update notification
function showYTDNotification(message, periodsAffected) {
    if (ytdNotification && ytdNotificationText) {
        const displayMessage = message || `YTD values updated for ${periodsAffected} pay period${periodsAffected !== 1 ? 's' : ''}`;
        ytdNotificationText.textContent = displayMessage;
        ytdNotification.classList.remove('hidden');
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
            ytdNotification.classList.add('hidden');
        }, 3000);
    }
}

/* ===========================
   Saved Runs (localStorage)
   =========================== */
function getSavedRuns() {
    try {
        const raw = localStorage.getItem(SAVED_RUNS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (err) {
        console.error('Failed to load saved runs from localStorage:', err);
        return {};
    }
}
function setSavedRuns(runs) {
    try {
        localStorage.setItem(SAVED_RUNS_KEY, JSON.stringify(runs));
    } catch (err) {
        console.error('Failed to save runs to localStorage:', err);
        showError('Failed to save run. Your browser may have storage limits enabled.');
    }
}
function validateSavedRun(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (!payload.data || typeof payload.data !== 'object') return false;
    if (!Array.isArray(payload.data.results)) return false;
    if (!payload.stateCode || typeof payload.stateCode !== 'string') return false;
    if (!payload.inputs || typeof payload.inputs !== 'object') return false;
    return true;
}
function refreshSavedRunsDropdown() {
    if (!savedRunsSelect) return;
    const runs = getSavedRuns();
    const current = savedRunsSelect.value;
    savedRunsSelect.innerHTML = '<option value="">Select a saved run...</option>';
    Object.keys(runs).sort((a,b) => a.localeCompare(b)).forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        savedRunsSelect.appendChild(opt);
    });
    if (current && runs[current]) savedRunsSelect.value = current;
}
function saveCurrentRun(name) {
    if (!fullPayrollData) {
        showError('Calculate payroll first, then save the run.');
        return false;
    }
    const selectedDates = Array.from(checkDateFilter.selectedOptions).map(o => o.value);
    const payload = {
        version: 2,
        createdAt: new Date().toISOString(),
        stateCode: lastStateCodeUsed || form.stateSelect.value,
        inputs: {
            payType: payTypeSelect ? payTypeSelect.value : 'hourly',
            startHours: form.startHours.value,
            endHours: form.endHours.value,
            payRate: form.payRate.value,
            salaryMethod: salaryMethodSelect ? salaryMethodSelect.value : 'annual',
            salaryAmount: salaryAmountInput ? salaryAmountInput.value : '',
            payDateOffsetDays: getPayDateOffsetDays()
        },
        selectedDates,
        data: fullPayrollData
    };
    const runs = getSavedRuns();
    runs[name] = payload;
    setSavedRuns(runs);
    refreshSavedRunsDropdown();
    savedRunsSelect.value = name;
    return true;
}
function loadRunByName(name) {
    const runs = getSavedRuns();
    const payload = runs[name];
    if (!payload) {
        showError('Saved run not found.');
        return;
    }

    // Validate the saved run data
    if (!validateSavedRun(payload)) {
        showError('Saved run data is corrupted or invalid. Please delete and recreate this run.');
        console.error('Invalid saved run data:', payload);
        return;
    }

    fullPayrollData = payload.data;
    lastStateCodeUsed = payload.stateCode;

    // Sync inputs & state to avoid mismatch in the view
    if (payload.inputs) {
        const inputs = payload.inputs;
        const rawPayType = (inputs.payType || '').toLowerCase();
        const payType = ['hourly', 'salary', 'monthly'].includes(rawPayType) ? rawPayType : 'hourly';
        if (payTypeSelect) {
            payTypeSelect.value = payType;
        }
        if (form.startHours && typeof inputs.startHours !== 'undefined') {
            form.startHours.value = inputs.startHours;
        }
        if (form.endHours && typeof inputs.endHours !== 'undefined') {
            form.endHours.value = inputs.endHours;
        }
        if (form.payRate && typeof inputs.payRate !== 'undefined') {
            form.payRate.value = inputs.payRate;
        }
        if (salaryMethodSelect) {
            salaryMethodSelect.value = inputs.salaryMethod || 'annual';
        }
        if (salaryAmountInput) {
            salaryAmountInput.value = inputs.salaryAmount || '';
        }
        if (payDateOffsetInput && inputs.payDateOffsetDays !== undefined) {
            payDateOffsetInput.value = inputs.payDateOffsetDays;
        }
        applyPayTypeUI(payType);
    } else if (payTypeSelect) {
        applyPayTypeUI(payTypeSelect.value);
    }
    if (payload.stateCode) {
        form.stateSelect.value = payload.stateCode;
    }

    const selected = Array.isArray(payload.selectedDates) && payload.selectedDates.length ? payload.selectedDates : ['all'];
    displayResults(fullPayrollData, selected, payload.stateCode || form.stateSelect.value);
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function deleteRunByName(name) {
    const runs = getSavedRuns();
    if (!runs[name]) return;
    delete runs[name];
    setSavedRuns(runs);
    refreshSavedRunsDropdown();
}

/* ===========================
   Event Listeners
   =========================== */
form.addEventListener('submit', function(e) {
    e.preventDefault();

    // Hide previous results and errors
    results.classList.add('hidden');
    error.classList.add('hidden');

    const stateCode = form.stateSelect.value;
    const selectedPayType = payTypeSelect ? payTypeSelect.value : 'hourly';
    let payConfig;

    if (selectedPayType === 'salary' || selectedPayType === 'monthly') {
        const salaryMethod = selectedPayType === 'monthly'
            ? 'monthly'
            : ((salaryMethodSelect && salaryMethodSelect.value) || 'annual');
        const salaryAmountRaw = salaryAmountInput ? salaryAmountInput.value : '';
        const salaryAmount = parseFloat(salaryAmountRaw);
        
        // Bug fix #10: Validate salary amount
        if (isNaN(salaryAmount)) {
            showError('Please enter a valid salary amount.');
            return;
        }
        if (salaryAmount <= 0) {
            showError('Salary amount must be greater than zero.');
            return;
        }
        if (!isFinite(salaryAmount)) {
            showError('Salary amount must be a finite number.');
            return;
        }
        // Reasonable maximum salary validation (10 million per period or annual)
        const maxSalary = 10000000;
        if (salaryAmount > maxSalary) {
            showError(`Salary amount cannot exceed ${formatCurrency(maxSalary)}.`);
            return;
        }
        
        payConfig = {
            payType: selectedPayType,
            salaryMethod,
            salaryAmount
        };
    } else {
        const startHours = parseFloat(form.startHours.value);
        const endHours = parseFloat(form.endHours.value);
        const payRate = parseFloat(form.payRate.value);
        
        // Bug fix #9 & #10: Validate for Infinity/NaN and reasonable maximums
        if (isNaN(startHours) || isNaN(endHours) || isNaN(payRate)) {
            showError('Please enter valid numbers for hours and pay rate.');
            return;
        }
        if (!isFinite(startHours) || !isFinite(endHours) || !isFinite(payRate)) {
            showError('Hours and pay rate must be finite numbers.');
            return;
        }
        if (startHours < 0 || endHours < 0 || payRate <= 0) {
            showError('Hours must be non-negative and pay rate must be positive.');
            return;
        }
        if (startHours >= endHours) {
            showError('Start hours must be less than end hours.');
            return;
        }
        if (startHours > 100 || endHours > 100) {
            showError('Hours cannot exceed 100 per pay period.');
            return;
        }
        // Reasonable maximum pay rate validation ($10,000/hour)
        if (payRate > 10000) {
            showError('Pay rate cannot exceed $10,000 per hour.');
            return;
        }
        
        payConfig = {
            payType: 'hourly',
            startHours,
            endHours,
            payRate
        };
    }

    if (!stateCode) {
        showError('Please select a state.');
        return;
    }

    // Show loading
    loading.classList.remove('hidden');

    // Calculate payroll
    setTimeout(() => {
        try {
            fullPayrollData = calculatePayroll(payConfig, stateCode);
            lastStateCodeUsed = stateCode; // <- track state used
            const currentSelections = Array.from(checkDateFilter.selectedOptions).map(option => option.value);
            displayResults(fullPayrollData, currentSelections, stateCode);
            loading.classList.add('hidden');
            
            // Save state after successful calculation
            saveAppState();
        } catch (err) {
            showError('An error occurred during calculation: ' + err.message);
        }
    }, 300);
});

// Filter
applyFilter.addEventListener('click', function() {
    const selectedDates = Array.from(checkDateFilter.selectedOptions).map(option => option.value);
    if (fullPayrollData) {
        displayResults(fullPayrollData, selectedDates, lastStateCodeUsed || form.stateSelect.value);
        saveAppState();
    }
});

// Select/Clear all
document.getElementById('selectAll').addEventListener('click', function() {
    Array.from(checkDateFilter.options).forEach(option => { option.selected = true; });
});
document.getElementById('clearAll').addEventListener('click', function() {
    Array.from(checkDateFilter.options).forEach(option => { option.selected = false; });
});

// Format toggles: refresh results when present; always persist preference (checkboxes live in #resultFormatOptions).
function refreshDisplayedResultsForFormatToggles() {
    if (fullPayrollData && checkDateFilter) {
        const selectedDates = Array.from(checkDateFilter.selectedOptions).map(option => option.value);
        const stateCode = lastStateCodeUsed || form.stateSelect.value;
        displayResults(fullPayrollData, selectedDates, stateCode);
    }
    saveAppState();
}

function bindResultFormatToggle(el) {
    if (!el) return;
    el.addEventListener('change', refreshDisplayedResultsForFormatToggles);
}

bindResultFormatToggle(document.getElementById('plainTextFormat'));
bindResultFormatToggle(document.getElementById('showCommas'));
bindResultFormatToggle(document.getElementById('copyOnlyResults'));

// Export CSV
document.getElementById('exportCsv').addEventListener('click', function() {
    if (!fullPayrollData) return;
    const selectedDates = Array.from(checkDateFilter.selectedOptions).map(option => option.value);
    let filteredResults;
    if (selectedDates.includes('all') || selectedDates.length === 0) {
        filteredResults = fullPayrollData.results;
    } else {
        filteredResults = fullPayrollData.results.filter(result => selectedDates.includes(result.checkDate));
    }
    exportToCsv(
        filteredResults,
        lastStateCodeUsed || form.stateSelect.value,
        (fullPayrollData && fullPayrollData.meta) || {}
    );
});

if (w2YearSelect) {
    w2YearSelect.addEventListener('change', function() {
        if (!fullPayrollData) return;
        renderW2Section(fullPayrollData, lastStateCodeUsed || form.stateSelect.value, this.value);
        saveAppState();
    });
}

document.getElementById('exportW2Csv').addEventListener('click', function() {
    if (!fullPayrollData || !W2Engine) return;
    const selectedYear = getPreferredW2Year(fullPayrollData);
    if (!Number.isFinite(selectedYear)) return;
    const w2Data = W2Engine.generateW2Data(fullPayrollData, lastStateCodeUsed || form.stateSelect.value, TAX_RATES, selectedYear);
    const csvContent = W2Engine.toCsvString(w2Data);
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `w2-${selectedYear}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
});

// Saved runs events
if (saveRunBtn) {
    saveRunBtn.addEventListener('click', function() {
        const name = (runNameInput && runNameInput.value || '').trim();
        if (!name) { showError('Please enter a name for this run before saving.'); return; }
        saveCurrentRun(name);
    });
}
if (loadRunBtn) {
    loadRunBtn.addEventListener('click', function() {
        const name = savedRunsSelect && savedRunsSelect.value || '';
        if (!name) { showError('Please select a saved run to load.'); return; }
        loadRunByName(name);
    });
}
if (savedRunsSelect) {
    savedRunsSelect.addEventListener('change', function() {
        if (this.value) loadRunByName(this.value);
    });
}
if (deleteRunBtn) {
    deleteRunBtn.addEventListener('click', function() {
        const name = savedRunsSelect && savedRunsSelect.value || '';
        if (!name) { showError('Please select a saved run to delete.'); return; }
        if (confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) {
            deleteRunByName(name);
        }
    });
}

/* ===========================
   Pay Period Year Selector
   =========================== */
const payPeriodYearSelect = document.getElementById('payPeriodYear');

// Handle year change
if (payPeriodYearSelect) {
    payPeriodYearSelect.addEventListener('change', async function() {
        let selectedYears = normalizeYearList(getSelectedPayPeriodYears());
        if (selectedYears.length === 0) {
            selectedYears = PAY_PERIOD_YEARS.length ? PAY_PERIOD_YEARS : [new Date().getFullYear()];
            applyPayPeriodYearSelection(selectedYears);
        }
        PAY_PERIOD_YEARS = selectedYears;
        
        try {
            // Clear cache and reload pay periods for the new selection
            selectedYears.forEach(year => PayPeriodGenerator.clearPayPeriodCache(year));
            PAY_PERIODS = await loadPayPeriods(selectedYears, { checkDateOffsetDays: getPayDateOffsetDays() });
            
            // Save state after year change
            saveAppState();
        } catch (err) {
            console.error('Error loading pay periods:', err);
            showError('Failed to load pay periods for ' + selectedYears.join(', ') + ': ' + err.message);
        }
    });
}

if (payDateOffsetInput) {
    payDateOffsetInput.addEventListener('change', async function() {
        const offsetDays = getPayDateOffsetDays();
        const selectedYears = PAY_PERIOD_YEARS.length
            ? PAY_PERIOD_YEARS
            : normalizeYearList(getSelectedPayPeriodYears());
        const yearsToLoad = selectedYears.length ? selectedYears : [new Date().getFullYear()];
        try {
            yearsToLoad.forEach(year => PayPeriodGenerator.clearPayPeriodCache(year));
            PAY_PERIODS = await loadPayPeriods(yearsToLoad, { checkDateOffsetDays: offsetDays });
            saveAppState();
        } catch (err) {
            console.error('Error loading pay periods with offset:', err);
            showError('Failed to load pay periods with offset ' + offsetDays + ': ' + err.message);
        }
    });
}

// Re-render on resize (keeps cards/table formatting consistent if you switch view logic later)
window.addEventListener('resize', function() {
    if (fullPayrollData) {
        const selectedDates = Array.from(checkDateFilter.selectedOptions).map(option => option.value);
        displayResults(fullPayrollData, selectedDates, lastStateCodeUsed || form.stateSelect.value);
    }
});

// Initialize
(async () => {
    const initialYears = normalizeYearList(getSelectedPayPeriodYears());
    if (initialYears.length > 0) {
        PAY_PERIOD_YEARS = initialYears;
    } else {
        applyPayPeriodYearSelection(PAY_PERIOD_YEARS);
    }

    await initializeStates();

    // Try to restore previous state
    const stateRestored = await loadAppState();
    
    if (!stateRestored) {
        // Set defaults only if no state was restored
        document.getElementById('startHours').value = '75';
        document.getElementById('endHours').value = '80';
        document.getElementById('payRate').value = '14.00';
        document.getElementById('stateSelect').value = 'NJ';
        if (payTypeSelect) {
            payTypeSelect.value = 'hourly';
        }
        if (salaryMethodSelect) {
            salaryMethodSelect.value = 'annual';
        }
        if (salaryAmountInput) {
            salaryAmountInput.value = '';
        }
        if (payDateOffsetInput) {
            payDateOffsetInput.value = '0';
        }
        applyPayTypeUI(payTypeSelect ? payTypeSelect.value : 'hourly');
    }

    initializeCopyFunctionality();
    refreshSavedRunsDropdown();
    setupAutoSave();
    
    console.log('Payroll calculator initialized');
})();
