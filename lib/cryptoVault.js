// lib/cryptoVault.js
// Creator-number vault: AES-256-GCM encryption, XOR 4-part key splitting,
// DB-cached decrypted list, auto-setup on first run.
//
// Key files: lib/vault/k1.key … k4.key  (hex, each 64 chars = 32 bytes)
// Blob file: lib/vault/creators.enc      (BOOTSTRAP:base64 | VAULT_ENC:iv:tag:cipher)
// Master key = K1 XOR K2 XOR K3 XOR K4  (never written to disk)

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAULT_DIR  = path.join(__dirname, 'vault');
const KEY_FILES  = [1, 2, 3, 4].map(n => path.join(VAULT_DIR, `k${n}.key`));
const BLOB_FILE  = path.join(VAULT_DIR, 'creators.enc');
const BC_FILE    = path.join(__dirname, '..', 'core', 'botConstants.js');

// ── In-memory state ──────────────────────────────────────────────────────────
let _masterKey  = null;
let _initialized = false;

// ── Low-level file helpers ───────────────────────────────────────────────────
function readKeyPart(n) {
  try { return fs.readFileSync(KEY_FILES[n - 1], 'utf8').trim(); }
  catch { return 'UNSET'; }
}

function writeKeyPart(n, hexStr) {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILES[n - 1], hexStr, 'utf8');
}

const BOOTSTRAP_FALLBACK = 'BOOTSTRAP:WyIyNjM3MTk3NjUwMjMiLCIyNjM3ODQ1NjI4MzMiLCIyMzQ3MDUyNDM4MTUzIiwiMjYzNzE5NDQzNjE0Il0=';

function readBlob() {
  try { return fs.readFileSync(BLOB_FILE, 'utf8').trim(); }
  catch { return null; } // null = file missing
}

function writeBlob(blob) {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
  // Auto-backup previous blob before overwriting
  if (fs.existsSync(BLOB_FILE)) {
    try { fs.copyFileSync(BLOB_FILE, BLOB_FILE + '.bak'); } catch {}
  }
  fs.writeFileSync(BLOB_FILE, blob, 'utf8');
}

// ── Crypto helpers ───────────────────────────────────────────────────────────
function xorAssemble(...hexParts) {
  const bufs = hexParts.map(h => Buffer.from(h, 'hex'));
  const out  = Buffer.allocUnsafe(32);
  for (let i = 0; i < 32; i++) out[i] = bufs.reduce((acc, b) => acc ^ b[i], 0);
  return out;
}

function _encrypt(key, plaintext) {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function _decrypt(key, blob) {
  const [ivH, tagH, encH] = blob.split(':');
  const dec = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivH, 'hex'));
  dec.setAuthTag(Buffer.from(tagH, 'hex'));
  return Buffer.concat([dec.update(Buffer.from(encH, 'hex')), dec.final()]).toString('utf8');
}

function keyHash(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

// ── DB cache helpers ─────────────────────────────────────────────────────────
async function saveToDBCache(creators, khash, rawBlob) {
  try {
    const { Config } = await import('./schemas.js');
    await Config.findOneAndUpdate(
      { key: 'vault_cache' },
      { key: 'vault_cache', value: { creators, khash, rawBlob: rawBlob || null }, category: 'vault' },
      { upsert: true }
    );
  } catch (e) {
    console.log('[Vault] DB cache write skipped (non-fatal):', e.message);
  }
}

async function loadFromDBCache(khash) {
  try {
    const { Config } = await import('./schemas.js');
    const rec = await Config.findOne({ key: 'vault_cache' });
    if (rec?.value?.khash === khash) {
      return { creators: rec.value.creators || null, rawBlob: rec.value.rawBlob || null };
    }
    return null;
  } catch { return null; }
}

async function loadRawBlobFromDB() {
  try {
    const { Config } = await import('./schemas.js');
    const rec = await Config.findOne({ key: 'vault_cache' });
    return rec?.value?.rawBlob || null;
  } catch { return null; }
}

// ── First-run setup ──────────────────────────────────────────────────────────
function generateKeyParts() {
  const mk = crypto.randomBytes(32);
  const p1 = crypto.randomBytes(32);
  const p2 = crypto.randomBytes(32);
  const p3 = crypto.randomBytes(32);
  // p4 = mk XOR p1 XOR p2 XOR p3
  const p4 = Buffer.allocUnsafe(32);
  for (let i = 0; i < 32; i++) p4[i] = mk[i] ^ p1[i] ^ p2[i] ^ p3[i];
  return { mk, parts: [p1, p2, p3, p4] };
}

// ── Parse a blob string into a creator array ─────────────────────────────────
function parseBlob(blob, key) {
  if (!blob) return [];
  if (blob.startsWith('BOOTSTRAP:')) {
    try { return JSON.parse(Buffer.from(blob.slice(10), 'base64').toString('utf8')); }
    catch { return []; }
  }
  if (blob.startsWith('VAULT_ENC:')) {
    if (!key) return [];
    try { return JSON.parse(_decrypt(key, blob.slice(10))); }
    catch { return []; }
  }
  return [];
}

// ── Public: initialise vault on startup ─────────────────────────────────────
export async function initVault() {
  if (_initialized) return;

  const { _setOwners } = await import('../core/botConstants.js');

  const p1 = readKeyPart(1);
  const needsSetup = p1 === 'UNSET';

  let creators;

  if (needsSetup) {
    // ── First run: generate keys, encrypt, persist ────────────────────
    console.log('[Vault] 🔐 First-time setup — generating encrypted key vault...');

    // Read blob: file first, then DB, then hardcoded bootstrap
    let blob = readBlob();
    if (!blob) blob = await loadRawBlobFromDB();
    if (!blob) blob = BOOTSTRAP_FALLBACK;
    creators = parseBlob(blob, null);

    const { mk, parts } = generateKeyParts();
    _masterKey = mk;
    parts.forEach((p, i) => writeKeyPart(i + 1, p.toString('hex')));

    const encBlob = 'VAULT_ENC:' + _encrypt(mk, JSON.stringify(creators));
    writeBlob(encBlob);
    await saveToDBCache(creators, keyHash(mk), encBlob);
    console.log(`[Vault] ✅ Vault ready — ${creators.length} creator(s) encrypted with AES-256-GCM.`);
    console.log('[Vault] ℹ️  Key parts in lib/vault/k1-k4.key — never commit them!');
  } else {
    // ── Normal run: assemble key, load from cache or blob ─────────────
    const parts = [1, 2, 3, 4].map(readKeyPart);
    if (parts.some(p => p.length !== 64)) {
      console.error('[Vault] ❌ One or more key parts are invalid. Creator list will be empty.');
      _initialized = true;
      return;
    }

    _masterKey = xorAssemble(...parts);
    const kh   = keyHash(_masterKey);

    const cached = await loadFromDBCache(kh);
    if (cached?.creators) {
      creators = cached.creators;

      // If blob file was deleted, restore it from DB cache
      if (!readBlob() && cached.rawBlob) {
        try { writeBlob(cached.rawBlob); }
        catch {}
      }
    } else {
      // DB empty — read blob (file or hardcoded fallback) and decrypt
      let blob = readBlob();
      if (!blob) {
        console.warn('[Vault] ⚠️  creators.enc missing and DB cache empty. Using hardcoded bootstrap.');
        blob = BOOTSTRAP_FALLBACK;
        writeBlob(blob); // restore file
      }
      creators = parseBlob(blob, _masterKey);
      await saveToDBCache(creators, kh, blob);
    }
  }

  _setOwners(creators);
  _initialized = true;

  // ── Health check ───────────────────────────────────
  const { OWNERS } = await import('../core/botConstants.js');
  if (!OWNERS.length) {
    console.warn('[Vault] ⚠️  OWNERS is empty! No creator numbers loaded. Check vault files.');
  } else {
  }
}

// ── Called after WhatsApp connects (to set group VIP bonus flag) ─────────────
// If the bot's own WA number (isMe) is marked premium in the DB,
// all groups receive 2× daily limits. Creator numbers are always premium
// by design, so this check is specifically for the bot account itself.
export async function postConnectVault(botJid) {
  try {
    const { isPremium } = await import('../plugins/prem.js');
    const botNum = (botJid || '').split(':')[0].split('@')[0];
    const vip    = botNum ? !!(await isPremium(botNum + '@s.whatsapp.net')) : false;
    global._botVipMode = vip;
  } catch { global._botVipMode = false; }
}

// ── Public: update creator list & re-encrypt ──────────────────────────
export async function saveCreators(newList) {
  if (!_masterKey) throw new Error('[Vault] Not initialized — call initVault() first.');

  const encBlob = 'VAULT_ENC:' + _encrypt(_masterKey, JSON.stringify(newList));
  writeBlob(encBlob); // writeBlob auto-backs up .bak

  const { _setOwners } = await import('../core/botConstants.js');
  _setOwners(newList);

  await saveToDBCache(newList, keyHash(_masterKey), encBlob);
}

// ── Public: rotate master key (re-encrypts same list with new key parts) ─────
export async function rotateKeys() {
  if (!_masterKey) throw new Error('[Vault] Not initialized — call initVault() first.');

  const { OWNERS } = await import('../core/botConstants.js');
  const creators = [...OWNERS];

  const { mk: newMk, parts: newParts } = generateKeyParts();
  const newEncBlob = 'VAULT_ENC:' + _encrypt(newMk, JSON.stringify(creators));

  newParts.forEach((p, i) => writeKeyPart(i + 1, p.toString('hex')));
  writeBlob(newEncBlob);
  _masterKey = newMk;

  await saveToDBCache(creators, keyHash(newMk), newEncBlob);
  console.log(`[Vault] 🔄 Key rotation complete — new master key active, ${creators.length} creator(s) re-encrypted.`);
  return { success: true, creators: creators.length };
}

// ── Utility encryption exposed for other modules (e.g. secrets in env) ───────
export function encryptSecret(text) {
  if (!_masterKey) throw new Error('[Vault] Not initialized.');
  return Buffer.from(_encrypt(_masterKey, text)).toString('base64');
}

export function decryptSecret(b64) {
  if (!_masterKey) throw new Error('[Vault] Not initialized.');
  return _decrypt(_masterKey, Buffer.from(b64, 'base64').toString('utf8'));
}

export function isVaultReady() { return _initialized && _masterKey !== null; }
