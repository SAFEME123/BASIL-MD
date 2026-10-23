'use strict';

// Compatibility helper: no backend is loaded until getCanvas()/requireCanvas() runs.
// No packages are installed here. Only already-available backends are tried.
// Consumers must use ONE returned backend for createCanvas, Image and loadImage;
// do not mix native objects from different implementations.
const BACKENDS = Object.freeze(['canvas', '@napi-rs/canvas']);

function createCanvasLoader(loadModule = require) {
  let resolved = false;
  let cached = null;
  return function getCanvas() {
    if (resolved) return cached;
    for (const name of BACKENDS) {
      try {
        const imported = loadModule(name);
        const candidate = typeof imported?.createCanvas === 'function'
          ? imported : imported?.default;
        if (typeof candidate?.createCanvas !== 'function' ||
            typeof candidate?.loadImage !== 'function') continue;
        cached = Object.freeze({
          backend: name,
          createCanvas: candidate.createCanvas.bind(candidate),
          loadImage: candidate.loadImage.bind(candidate),
          Image: candidate.Image,
        });
        break;
      } catch {
        // Missing modules and native load failures both permit safe fallback.
        // Never log module errors: their paths/details may contain secrets.
      }
    }
    resolved = true; // Also cache absence to avoid repeated failed native loads.
    return cached;
  };
}

const getCanvas = createCanvasLoader();
function requireCanvas() {
  const canvas = getCanvas();
  if (canvas) return canvas;
  const error = new Error('Optional canvas backend is unavailable');
  error.code = 'CANVAS_UNAVAILABLE';
  throw error;
}

module.exports = { BACKENDS, createCanvasLoader, getCanvas, requireCanvas };
