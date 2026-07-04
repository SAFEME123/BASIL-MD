import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CRASH_LOG_DIR = path.resolve(__dirname, '..', 'assets', 'crash-logs');
const MAX_CRASH_LOGS = 50;

function ensureCrashLogDir() {
  try {
    if (!fs.existsSync(CRASH_LOG_DIR)) {
      fs.mkdirSync(CRASH_LOG_DIR, { recursive: true });
    }
  } catch (err) {
    console.error('[ProcessErrorGuard] Failed to create crash log directory:', err.message);
  }
}

function writeCrashLog(type, error) {
  ensureCrashLogDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(CRASH_LOG_DIR, `${type}_${timestamp}.json`);
  const entry = {
    type,
    timestamp: new Date().toISOString(),
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
    memoryUsage: process.memoryUsage(),
    error: {
      message: error?.message || String(error),
      stack: error?.stack || null,
      code: error?.code || null,
      name: error?.name || null,
    },
  };
  try {
    fs.writeFileSync(logFile, JSON.stringify(entry, null, 2));
  } catch (writeErr) {
    console.error('[ProcessErrorGuard] Failed to write crash log:', writeErr.message);
  }
  pruneOldCrashLogs();
}

function pruneOldCrashLogs() {
  try {
    const files = fs.readdirSync(CRASH_LOG_DIR)
      .filter(f => f.endsWith('.json'))
      .sort();
    if (files.length > MAX_CRASH_LOGS) {
      const toRemove = files.slice(0, files.length - MAX_CRASH_LOGS);
      for (const file of toRemove) {
        fs.unlinkSync(path.join(CRASH_LOG_DIR, file));
      }
    }
  } catch (err) {
    // pruning is non-critical
  }
}

const FATAL_PATTERNS = [
  /Cannot find module/,
  /ENOSPC/,
  /ENOMEM/,
];

function isFatalError(error) {
  const msg = error?.message || String(error);
  return FATAL_PATTERNS.some(pattern => pattern.test(msg));
}

let _installed = false;

export function installProcessErrorGuard() {
  if (_installed) return;
  _installed = true;

  process.on('uncaughtException', (error, origin) => {
    console.error(`[ProcessErrorGuard] Uncaught Exception (origin: ${origin}):`, error);
    writeCrashLog('uncaughtException', error);

    if (isFatalError(error)) {
      console.error('[ProcessErrorGuard] Fatal error detected, exiting.');
      process.exit(1);
    }
  });

  process.on('unhandledRejection', (reason, promise) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    console.error('[ProcessErrorGuard] Unhandled Promise Rejection:', error);
    writeCrashLog('unhandledRejection', error);
  });

  process.on('warning', (warning) => {
    if (warning.name === 'DeprecationWarning') return;
    console.warn('[ProcessErrorGuard] Node.js Warning:', warning.message);
  });

  console.log('[ProcessErrorGuard] Process-level error handlers installed');
}

export function getCrashLogs(limit = 20) {
  ensureCrashLogDir();
  try {
    const files = fs.readdirSync(CRASH_LOG_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit);

    return files.map(file => {
      try {
        return JSON.parse(fs.readFileSync(path.join(CRASH_LOG_DIR, file), 'utf-8'));
      } catch {
        return { file, error: 'Failed to parse' };
      }
    });
  } catch (err) {
    console.error('[ProcessErrorGuard] Failed to read crash logs:', err.message);
    return [];
  }
}

export function formatCrashReport(limit = 10) {
  const logs = getCrashLogs(limit);
  if (logs.length === 0) {
    return 'No crash logs found. System is healthy.';
  }

  let report = `*CRASH LOG REPORT* (${logs.length} most recent)\n\n`;
  logs.forEach((log, i) => {
    report += `${i + 1}. *${log.type}* [${log.timestamp}]\n`;
    report += `   Error: ${log.error?.message || 'Unknown'}\n`;
    if (log.error?.code) {
      report += `   Code: ${log.error.code}\n`;
    }
    report += '\n';
  });
  return report;
}

export default {
  installProcessErrorGuard,
  getCrashLogs,
  formatCrashReport,
};
