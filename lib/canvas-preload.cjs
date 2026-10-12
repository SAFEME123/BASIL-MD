// lib/canvas-preload.cjs — NODE_OPTIONS=--require preload for Docker/Render.
//
// Guarantees node-canvas is loaded BEFORE sharp or any other native image
// module in ANY entry script. Order matters: canvas-first -> both work;
// sharp-first -> canvas breaks on DLL symbol collisions (see the long
// comment at the top of index.js for the Windows repro).
//
// This file is --require'd into EVERY node process in the container
// (start.js, index.js, spawned children), so it must NEVER throw.
try {
  require("canvas");
} catch (e) {
  // Canvas is optional — image features degrade, the bot still boots.
  try { console.warn("[canvas-preload] canvas unavailable:", e && e.message); } catch {}
}
module.exports = {};
