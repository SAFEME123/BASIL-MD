/**
 * BASIL-MD Boot Wrapper
 *
 * Installs process-level error handling before delegating to start.js.
 * Ensures uncaught exceptions and unhandled rejections are logged to disk
 * rather than silently crashing or being swallowed.
 *
 * Usage:
 *   node boot.js          (instead of node start.js)
 *   pm2 start boot.js     (instead of pm2 start start.js)
 */

import { installProcessErrorGuard } from './lib/processErrorGuard.js';

installProcessErrorGuard();

// Delegate to the original entry point
await import('./start.js');
