import { logCommandError } from './errorReporter.js';
import { logFailure } from './failureTracker.js';

const SUPPRESSED_ERRORS = [
  /rate.?limit/i,
  /too many requests/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /socket hang up/i,
  /network/i,
];

function isTransientError(error) {
  const msg = error?.message || String(error);
  return SUPPRESSED_ERRORS.some(pattern => pattern.test(msg));
}

function sanitizeErrorMessage(error) {
  const msg = error?.message || String(error);
  return msg
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
    .replace(/api[_-]?key[=:]\s*\S+/gi, 'api_key=[REDACTED]')
    .replace(/password[=:]\s*\S+/gi, 'password=[REDACTED]')
    .slice(0, 500);
}

export function wrapPluginHandler(pluginName, handler) {
  return async function wrappedHandler(conn, msg, msgObj, context) {
    const startTime = Date.now();
    try {
      return await handler(conn, msg, msgObj, context);
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const safeMessage = sanitizeErrorMessage(error);

      console.error(
        `[PluginSandbox] ${pluginName} failed after ${elapsed}ms: ${safeMessage}`
      );

      logCommandError(context?.command || pluginName, error, {
        sender: context?.sender || 'unknown',
        senderName: context?.pushname || 'unknown',
        isGroup: context?.isGroup || false,
        groupName: context?.groupName || null,
        elapsed,
      });

      logFailure(pluginName, safeMessage, 'PLUGIN_ERROR');

      if (context?.reply && typeof context.reply === 'function') {
        const userMessage = isTransientError(error)
          ? `The service is temporarily unavailable. Please try again in a moment.`
          : `An error occurred while running *${context?.command || pluginName}*. The error has been logged.`;

        try {
          await context.reply(userMessage);
        } catch (replyErr) {
          console.error(
            `[PluginSandbox] Failed to send error reply: ${replyErr.message}`
          );
        }
      }

      return null;
    }
  };
}

export function wrapAsyncOperation(operationName, fn, options = {}) {
  const { retries = 0, retryDelay = 1000, silent = false } = options;

  return async function wrappedOperation(...args) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn(...args);
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          const delay = retryDelay * Math.pow(2, attempt);
          console.warn(
            `[AsyncOp] ${operationName} attempt ${attempt + 1}/${retries + 1} failed: ${error.message}. Retrying in ${delay}ms...`
          );
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    if (!silent) {
      console.error(
        `[AsyncOp] ${operationName} failed after ${retries + 1} attempt(s): ${lastError?.message}`
      );
    }

    throw lastError;
  };
}

export function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn(`[SafeParse] JSON parse failed: ${error.message}`);
    return fallback;
  }
}

export function withTimeout(promise, ms, operationName = 'operation') {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${ms}ms`));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

export default {
  wrapPluginHandler,
  wrapAsyncOperation,
  safeJsonParse,
  withTimeout,
};
