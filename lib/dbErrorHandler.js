import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_ERROR_LOG = path.resolve(__dirname, '..', 'assets', 'db_errors.json');
const MAX_DB_ERRORS = 100;

function ensureAssetsDir() {
  const assetsDir = path.dirname(DB_ERROR_LOG);
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
}

function loadDbErrors() {
  try {
    if (fs.existsSync(DB_ERROR_LOG)) {
      return JSON.parse(fs.readFileSync(DB_ERROR_LOG, 'utf-8'));
    }
  } catch (err) {
    console.error('[DbErrorHandler] Failed to load DB error log:', err.message);
  }
  return [];
}

function saveDbErrors(errors) {
  ensureAssetsDir();
  try {
    fs.writeFileSync(DB_ERROR_LOG, JSON.stringify(errors, null, 2));
  } catch (err) {
    console.error('[DbErrorHandler] Failed to save DB error log:', err.message);
  }
}

export function logDbError(operation, error, context = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    operation,
    error: {
      message: error?.message || String(error),
      code: error?.original?.code || error?.parent?.code || error?.code || null,
      name: error?.name || null,
    },
    context: {
      database: context.database || 'unknown',
      table: context.table || null,
      ...context,
    },
  };

  console.error(
    `[DbErrorHandler] ${operation} failed on ${entry.context.database}: ${entry.error.message}`
  );

  const errors = loadDbErrors();
  errors.unshift(entry);
  if (errors.length > MAX_DB_ERRORS) {
    errors.splice(MAX_DB_ERRORS);
  }
  saveDbErrors(errors);

  return entry;
}

export function getDbErrors(limit = 20) {
  const errors = loadDbErrors();
  return errors.slice(0, limit);
}

export function clearDbErrors() {
  saveDbErrors([]);
  return true;
}

export async function withDbErrorHandling(operation, fn, context = {}) {
  try {
    return await fn();
  } catch (error) {
    logDbError(operation, error, context);
    throw error;
  }
}

export function isConnectionError(error) {
  const msg = (error?.message || String(error)).toLowerCase();
  const connectionPatterns = [
    'econnrefused',
    'econnreset',
    'etimedout',
    'enotfound',
    'connection refused',
    'connection reset',
    'connection terminated',
    'too many connections',
    'ssl',
    'authentication failed',
  ];
  return connectionPatterns.some(pattern => msg.includes(pattern));
}

export function getDbErrorSummary() {
  const errors = loadDbErrors();
  if (errors.length === 0) {
    return {
      total: 0,
      byOperation: {},
      byDatabase: {},
      connectionErrors: 0,
      lastError: null,
    };
  }

  const byOperation = {};
  const byDatabase = {};
  let connectionErrors = 0;

  errors.forEach(entry => {
    byOperation[entry.operation] = (byOperation[entry.operation] || 0) + 1;
    const db = entry.context?.database || 'unknown';
    byDatabase[db] = (byDatabase[db] || 0) + 1;
    if (isConnectionError(entry.error)) {
      connectionErrors++;
    }
  });

  return {
    total: errors.length,
    byOperation,
    byDatabase,
    connectionErrors,
    lastError: errors[0] || null,
  };
}

export default {
  logDbError,
  getDbErrors,
  clearDbErrors,
  withDbErrorHandling,
  isConnectionError,
  getDbErrorSummary,
};
