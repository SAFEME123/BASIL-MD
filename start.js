/**
 * BASIL-MD — Secure Bootstrap Loader
 *
 * Downloads and executes the bot's main loader from a trusted source.
 * All secrets are read from environment variables — never hardcoded.
 *
 * Required env vars:
 *   LOADER_URL     — URL to the loader script (GitHub Gist raw URL)
 *   BUNDLE_TOKEN   — GitHub PAT for downloading private release assets (optional)
 *   BUNDLE_KEY     — AES-256-CBC hex key for decrypting the bundle (optional)
 *   LOADER_SHA256  — Expected SHA-256 hash of loader.js for integrity verification (optional but recommended)
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOADER_PATH = path.join(__dirname, 'loader.js');

// ─── Configuration from environment ────────────────────────────────────────────
const LOADER_URL = process.env.LOADER_URL || '';
const LOADER_SHA256 = process.env.LOADER_SHA256 || ''; // optional integrity check
const MAX_REDIRECTS = 5;

if (!LOADER_URL) {
  console.error('[start] LOADER_URL environment variable is not set. Please set it in your deployment config.');
  process.exit(1);
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function computeSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function verifyIntegrity(filePath, expectedHash) {
  if (!expectedHash) return true; // skip if not configured
  const actual = computeSha256(filePath);
  if (actual !== expectedHash.toLowerCase()) {
    console.error(`[start] Integrity check FAILED for ${path.basename(filePath)}`);
    console.error(`[start]   Expected SHA-256: ${expectedHash}`);
    console.error(`[start]   Actual SHA-256:   ${actual}`);
    return false;
  }
  console.log(`[start] Integrity verified: ${path.basename(filePath)}`);
  return true;
}

async function downloadFile(url, dest, redirects = 0) {
  if (redirects > MAX_REDIRECTS) {
    throw new Error('Too many redirects');
  }

  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const outStream = fs.createWriteStream(dest);

    client.get(url, { headers: { 'User-Agent': 'BASIL-MD/2.0' } }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode <= 399 && res.headers.location) {
        outStream.close(() => fs.unlink(dest, () => {}));
        return downloadFile(res.headers.location, dest, redirects + 1)
          .then(resolve, reject);
      }

      // Handle HTTP errors
      if (res.statusCode !== 200) {
        outStream.close(() => fs.unlink(dest, () => {}));
        return reject(new Error(`HTTP ${res.statusCode} downloading loader`));
      }

      res.pipe(outStream);
      outStream.on('finish', () => outStream.close(resolve));
      outStream.on('error', reject);
    }).on('error', reject);
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────────

async function boot() {
  // Validate LOADER_URL is a trusted source
  if (!LOADER_URL.startsWith('https://')) {
    console.error('[start] LOADER_URL must use HTTPS for security.');
    process.exit(1);
  }

  try {
    console.log('[start] Downloading loader...');
    await downloadFile(LOADER_URL, LOADER_PATH);

    // Verify integrity if hash is provided
    if (!verifyIntegrity(LOADER_PATH, LOADER_SHA256)) {
      fs.unlinkSync(LOADER_PATH);
      console.error('[start] Aborting: loader integrity check failed. The file may have been tampered with.');
      process.exit(1);
    }

    // Import and execute the loader
    const loaderURL = pathToFileURL(LOADER_PATH).href;
    await import(loaderURL);
  } catch (err) {
    console.error('[start] Startup failed:', err.message);
    process.exit(1);
  }
}

boot();
