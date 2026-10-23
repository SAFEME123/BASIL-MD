'use strict';

// Explicit startup preloader, before start.js and any sharp/native imports.
// The compatibility module itself remains lazy for non-container consumers.
try {
  const canvas = require('./canvas-compat.cjs').getCanvas();
  if (!canvas) console.warn('[canvas-preload] optional canvas backend unavailable');
} catch {
  // An optional native renderer must never prevent bot startup.
}
