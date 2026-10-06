const REQUIRED_COLUMNS = Object.freeze([
  'valid_price_observations',
  'extreme_multiple_above_1000x_review',
  'detected_at_utc',
  'first_price_at_utc',
  'first_observed_price_sol',
  'source_initial_price_sol',
  'peak_multiple_x',
  'minutes_first_price_to_peak',
  'last_observed_price_sol',
  'largest_observed_drop_from_peak_pct',
  'last_observed_drop_from_peak_pct',
  'median_observation_gap_seconds',
  'first_price_precedes_detection',
  'is_mayhem_mode',
  'source_holder_concentration_suspect',
]);

export function parseCsvRecord(text) {
  if (typeof text !== 'string') throw new TypeError('BACKTEST_CSV_RECORD_INVALID');
  const fields = [];
  let value = '';
  let quoted = false;
  let quoteClosed = false;
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') { value += '"'; i += 1; }
        else { quoted = false; quoteClosed = true; }
      } else value += character;
      continue;
    }
    if (character === ',') {
      fields.push(value);
      value = '';
      quoteClosed = false;
      continue;
    }
    if (character === '"' && value === '' && !quoteClosed) {
      quoted = true;
      continue;
    }
    if (quoteClosed || character === '"') throw new TypeError('BACKTEST_CSV_QUOTE_INVALID');
    value += character;
  }
  if (quoted) throw new TypeError('BACKTEST_CSV_QUOTE_UNTERMINATED');
  fields.push(value);
  return fields;
}

export function isCsvRecordComplete(text) {
  if (typeof text !== 'string') throw new TypeError('BACKTEST_CSV_RECORD_INVALID');
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '"') continue;
    if (quoted && text[i + 1] === '"') { i += 1; continue; }
    quoted = !quoted;
  }
  return !quoted;
}

export async function* iterateCsvRecords(readable, { maxRecordChars = 2_000_000 } = {}) {
  let pending = '';
  for await (const physicalLine of readable) {
    pending = pending === '' ? physicalLine : `${pending}\n${physicalLine}`;
    if (pending.length > maxRecordChars) throw new Error('BACKTEST_CSV_RECORD_TOO_LARGE');
    if (!isCsvRecordComplete(pending)) continue;
    yield pending;
    pending = '';
  }
  if (pending !== '') throw new Error('BACKTEST_CSV_QUOTE_UNTERMINATED');
}

export async function runBacktestCli(task, { reportPath, stderr = console.error, setExitCode = code => { process.exitCode = code; } } = {}) {
  try {
    fs.rmSync(reportPath, { force: true });
    await task();
  } catch (error) {
    stderr(error);
    setExitCode(1);
  }
}

export function createColumnIndex(header) {
  if (!Array.isArray(header) || header.some(name => typeof name !== 'string' || name.length === 0)) {
    throw new TypeError('BACKTEST_CSV_HEADER_INVALID');
  }
  const index = new Map();
  for (let i = 0; i < header.length; i += 1) {
    if (index.has(header[i])) throw new TypeError(`BACKTEST_CSV_DUPLICATE_COLUMN:${header[i]}`);
    index.set(header[i], i);
  }
  for (const name of REQUIRED_COLUMNS) {
    if (!index.has(name)) throw new TypeError(`BACKTEST_CSV_REQUIRED_COLUMN_MISSING:${name}`);
  }
  return index;
}

export function assertCsvDatasetPresent(columnIndex, totalParsed) {
  if (!(columnIndex instanceof Map)) throw new Error('BACKTEST_CSV_HEADER_MISSING');
  if (totalParsed < 2) throw new Error('BACKTEST_CSV_DATA_ROWS_MISSING');
}

function field(row, index, name) {
  const position = index.get(name);
  if (!Number.isSafeInteger(position) || position >= row.length) throw new TypeError(`BACKTEST_CSV_ROW_COLUMN_MISSING:${name}`);
  return row[position];
}

function numeric(row, index, name, { min = -Infinity, max = Infinity } = {}) {
  const raw = field(row, index, name);
  if (raw.trim() === '') throw new TypeError(`BACKTEST_CSV_NUMBER_MISSING:${name}`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) throw new TypeError(`BACKTEST_CSV_NUMBER_INVALID:${name}`);
  return value;
}

function optionalNumeric(row, index, name, { min = -Infinity, max = Infinity } = {}) {
  const raw = field(row, index, name);
  if (raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) throw new TypeError(`BACKTEST_CSV_NUMBER_INVALID:${name}`);
  return value;
}

function boolean(row, index, name) {
  const raw = field(row, index, name);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new TypeError(`BACKTEST_CSV_BOOLEAN_INVALID:${name}`);
}

function optionalBoolean(row, index, name) {
  const raw = field(row, index, name);
  if (raw === '') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new TypeError(`BACKTEST_CSV_BOOLEAN_INVALID:${name}`);
}

function timestamp(row, index, name) {
  const raw = field(row, index, name);
  const value = Date.parse(raw);
  if (!raw || !Number.isFinite(value)) throw new TypeError(`BACKTEST_CSV_TIMESTAMP_INVALID:${name}`);
  return value;
}

/** Returns null for explicitly excluded rows; malformed included rows throw. */
export function parseBacktestTokenRow(row, index) {
  if (!Array.isArray(row) || !(index instanceof Map)) throw new TypeError('BACKTEST_CSV_ROW_INVALID');
  const validObservations = numeric(row, index, 'valid_price_observations', { min: 0 });
  const extremeOutlier = boolean(row, index, 'extreme_multiple_above_1000x_review');
  if (!Number.isInteger(validObservations)) throw new TypeError('BACKTEST_CSV_NUMBER_INVALID:valid_price_observations');
  if (validObservations < 2 || extremeOutlier) return null;

  const detectedAtMs = timestamp(row, index, 'detected_at_utc');
  const firstPriceAtMs = timestamp(row, index, 'first_price_at_utc');
  const firstPriceSol = numeric(row, index, 'first_observed_price_sol', { min: Number.MIN_VALUE });
  const sourceInitialPriceSol = numeric(row, index, 'source_initial_price_sol', { min: Number.MIN_VALUE });
  return {
    detectedAt: field(row, index, 'detected_at_utc'),
    detectedAtMs,
    firstPriceSol,
    initialSourcePriceSol: sourceInitialPriceSol,
    initialPriceRatio: firstPriceSol / sourceInitialPriceSol,
    detectionLagSec: (firstPriceAtMs - detectedAtMs) / 1000,
    holderConcentrationSuspect: optionalBoolean(row, index, 'source_holder_concentration_suspect'),
    isMayhemMode: optionalBoolean(row, index, 'is_mayhem_mode'),
    firstPricePrecedesDetection: optionalBoolean(row, index, 'first_price_precedes_detection'),
    medianObsGapSec: numeric(row, index, 'median_observation_gap_seconds', { min: 0 }),
    peakMultipleX: numeric(row, index, 'peak_multiple_x', { min: 0 }),
    minutesToPeak: numeric(row, index, 'minutes_first_price_to_peak', { min: 0 }),
    firstObservedPriceSol: firstPriceSol,
    lastObservedPriceSol: optionalNumeric(row, index, 'last_observed_price_sol', { min: 0 }),
    largestDropFromPeakPct: optionalNumeric(row, index, 'largest_observed_drop_from_peak_pct', { min: 0 }),
    lastObservedDropFromPeakPct: optionalNumeric(row, index, 'last_observed_drop_from_peak_pct', { min: 0 }),
    exitOutcomeEvidenceComplete: ['last_observed_price_sol','largest_observed_drop_from_peak_pct','last_observed_drop_from_peak_pct']
      .every(name => field(row, index, name).trim() !== ''),
  };
}
import fs from 'node:fs';

