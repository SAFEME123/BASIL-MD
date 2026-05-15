// Suppress libsignal / Baileys session noise that logs via console directly (not pino)
const _origConsoleError = console.error.bind(console);
const _origConsoleLog   = console.log.bind(console);
const _SESSION_NOISE = /Bad MAC|Failed to decrypt|losing open session|Closing open session|Closing session|SessionEntry|pendingPreKey|Session error|resolveImageHeader|Interactive send/i;
console.error = (...a) => { if (a.some(x => _SESSION_NOISE.test(String(x)))) return; _origConsoleError(...a); };
console.log   = (...a) => { if (a.some(x => _SESSION_NOISE.test(String(x)))) return; _origConsoleLog(...a); };
const _origStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function(chunk, ...rest) {
  const s = typeof chunk === 'string' ? chunk : chunk?.toString?.() || '';
  if (_SESSION_NOISE.test(s)) return true;
  return _origStdoutWrite(chunk, ...rest);
};

// Load dev plugin first (best-effort; must never crash the whole bot)
try {
  await import("../plugins/dev.js");
} catch (devLoadErr) {
  console.error("[BASIL-MD] ⚠️ Failed to load plugins/dev.js:", devLoadErr?.message || devLoadErr);
  console.error("[BASIL-MD] Continuing startup without dev plugin.");
}

// Import Baileys adapter (primary: gifted-baileys for LID/PN/Newsletter support)
import makeWASocket, {
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  getContentType,
  downloadContentFromMessage,
  fetchLatestBaileysVersion,
  Browsers,
  proto,
  jidDecode,
  areJidsSameUser,
  generateForwardMessageContent,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  getLoadedFlavor,
  detectCapabilities
} from '../lib/baileys-adapter.js';
import { Boom } from '@hapi/boom';

// Anti-ban systems
import MessageQueue from '../lib/messageQueue.js';
import ReconnectionManager from '../lib/reconnectionManager.js';
import { delayBeforeResponse, shouldAddHumanDelay, getRandomDelay } from '../lib/humanBehavior.js';
import { initializeQueueManager, isMessageQueueEnabled as checkQueueEnabled } from '../lib/messageQueue.js';
import { startSchedulerService } from '../plugins/scheduler.js';

import { makeInMemoryStore } from '../lib/store.js';
import { fileTypeFromBuffer } from 'file-type';
import { logCommandError, formatErrorReport } from '../lib/errorReporter.js';
import { logFailure } from '../lib/failureTracker.js';
import {
  getBuffer,
  getGroupAdmins,
  getRandom,
  h2k,
  isUrl,
  Json,
  runtime,
  sleep,
  fetchJson,
  toSmallCaps,
  getTimezones,
  TOD
} from '../lib/functions.js';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import P from 'pino';
import chalk from 'chalk';
import config from '../config.js';
import * as acorn from 'acorn';
import { sms, downloadMediaMessage } from '../lib/msg.js';
import { commands } from '../command.js';
import { banCheck, enforceFreeUserDM } from "../plugins/ban.js";
import { enforceMute, handleGroupUpdate } from "../plugins/mute.js";
import {
  isPremium,
  isPrivileged,
  addPrivilegedJid,
  checkAndConsumeLimit,
  recordSuccessfulUse,
  checkPremiumInboxLimit,
  recordSuccessfulInboxUse,
  sendExpiryReminders,
  startPremSync,
  loadPrem
} from "../plugins/prem.js";
import { handleAIResponse } from "../plugins/chatbot.js";
import { parseCommand } from '../lib/parseCommand.js';
import { initDB, readEnv } from '../lib/envManager.js';
import { connectDB as connectCoreDB } from '../lib/database.js';
import { ensureTablesReady } from '../lib/schemas.js';
import { envEventBus } from '../lib/envEventEmitter.js';
import * as cooldowns from './cooldowns.js';
import axios from 'axios';
import { streamToFile } from '../lib/downloaderAdapter.js';
import { createWorkerQueue } from '../lib/workerQueue.js';
import { renderProgress } from '../lib/progressRenderer.js';
import { exec } from 'child_process';
import { getSessionByID } from '../lib/sessionManager.js';
import { loadAllPlugins, loadPluginByName, getAllCommandPatternsAndAliases, getPluginFilenames } from '../lib/command.js';
import { getDirname } from '../lib/path-helpers.js';
import qrcode from 'qrcode-terminal';
import { getMonitorClient } from '../lib/botMonitorClient.js';
import { broadcastWs } from '../lib/wsHub.js';

// JID/LID helper utilities for newsletter operations
import {
  fetchLidFromJid,
  getLidForNewsletter,
  resolveUserIds,
  getParticipantsWithLids,
  getGroupParticipantMetadata,
  getGroupParticipantsMetadata,
  isUserJid,
  isLid,
  isGroupJid,
  isNewsletterJid,
  normalizeJid,
  normalizeLid,
  extractPhoneNumber,
  clearLidCache,
  formatUserIdForDisplay
} from '../lib/jid-lid-helper.js';
import { initializeLidStore } from '../lib/groupCache.js';
import { initializeGroupSettings } from '../lib/groupSettings.js';
import { setupDashboardAPI } from '../lib/dashboardAPI.js';
import {
  OWNERS, ST_ID, ST_LINK, ST_NAME, DS_ID, DS_LINK, DS_NAME, ST_GC, DS_GC,
  footer, BASIL, SIG_N, BASIL_IMG, MAX_WA_TEXT
} from './botConstants.js';
import { initVault, postConnectVault } from '../lib/cryptoVault.js';
import {
  detectTypeLabel, getCommandsByFile, validatePlugin, listPlugins, listAllFiles
} from './pluginUtils.js';

// Group event manager for comprehensive group handling
import GroupEventManager from '../lib/groupEventManager.js';

const __dirname = getDirname(import.meta.url);
const l = console.log;
const pendingReplies = {};

// Initialize anti-ban systems
const messageQueue = new MessageQueue({
  minDelay: 2000,        // 2 seconds minimum between messages
  maxDelay: 5000,        // 5 seconds maximum between messages
  messagesPerMinute: 20  // Conservative rate: 20 messages per minute
});

const reconnectionManager = new ReconnectionManager({
  minDelay: 3000,        // Start with 3 seconds
  maxDelay: 300000,      // Max 5 minutes
  factor: 2,             // Exponential backoff factor
  maxAttempts: 10        // Give up after 10 attempts
});

// Get patterns and aliases - now needs to be awaited since it's async
const { patterns, aliases } = await getAllCommandPatternsAndAliases();


// -----------------------------
// [2] Constants / Paths / Globals  (non-path constants live in core/botConstants.js)
// -----------------------------
const PLUGINS_DIR = path.join(__dirname, '../plugins/');
const BACKUP_DIR  = path.join(__dirname, '../assets/BackUp/');
const SAVED_DIR   = path.join(__dirname, '../assets/Saved/');
const sessFile    = path.resolve(__dirname, '../session/creds.json');
const sessDir     = path.resolve(__dirname, '../session/');

// ═══════════════════════════════════════════════════════════════════════════════
// ADVANCED CONSOLE UI SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

const ConsoleUI = {
  // Get terminal width (fallback to 80 if not available)
  getWidth: () => process.stdout.columns || 80,
  
  // Clear console
  clear: () => {
    process.stdout.write('\x1B[2J\x1B[0f');
    console.clear();
  },
  
  // Center text in console
  center: (text, width = null) => {
    const w = width || ConsoleUI.getWidth();
    const padding = Math.max(0, Math.floor((w - text.replace(/\x1B\[[0-9;]*m/g, '').length) / 2));
    return ' '.repeat(padding) + text;
  },
  
  // Create a line separator
  separator: (char = '═', width = null) => {
    const w = width || ConsoleUI.getWidth();
    return char.repeat(Math.min(w, 80));
  },
  
  // Create a box around text
  box: (lines, padding = 2) => {
    const w = Math.min(ConsoleUI.getWidth(), 80);
    const inner = w - 4;
    let result = [];
    result.push('╔' + '═'.repeat(w - 2) + '╗');
    result.push('║' + ' '.repeat(w - 2) + '║');
    for (const line of lines) {
      const clean = line.replace(/\x1B\[[0-9;]*m/g, '');
      const pad = Math.max(0, Math.floor((inner - clean.length) / 2));
      const padEnd = inner - clean.length - pad;
      result.push('║ ' + ' '.repeat(pad) + line + ' '.repeat(Math.max(0, padEnd)) + ' ║');
    }
    result.push('║' + ' '.repeat(w - 2) + '║');
    result.push('╚' + '═'.repeat(w - 2) + '╝');
    return result;
  },
  
  // Animated delay
  delay: (ms) => new Promise(r => setTimeout(r, ms)),
  
  // Progress bar
  progressBar: (current, total, width = 40) => {
    const percent = Math.floor((current / total) * 100);
    const filled = Math.floor((current / total) * width);
    const empty = width - filled;
    const bar = chalk.cyan('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
    return `${bar} ${chalk.white(percent + '%')}`;
  },
  
  // Spinner frames
  spinnerFrames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  spinnerIndex: 0,
  
  // Get next spinner frame
  spinner: () => {
    const frame = ConsoleUI.spinnerFrames[ConsoleUI.spinnerIndex];
    ConsoleUI.spinnerIndex = (ConsoleUI.spinnerIndex + 1) % ConsoleUI.spinnerFrames.length;
    return chalk.cyan(frame);
  }
};

// ASCII Art Banner - Responsive to console width
const getASCIIBanner = () => {
  const w = ConsoleUI.getWidth();
  
  // Large banner for wide terminals (80+)
  if (w >= 80) {
    return [
      chalk.cyan('╔═══════════════════════════════════════════════════════════════════════════════╗'),
      chalk.cyan('║') + chalk.greenBright('  ██████╗  █████╗ ███████╗██╗██╗      ███╗   ███╗██████╗                     ') + chalk.cyan('║'),
      chalk.cyan('║') + chalk.greenBright('  ██╔══██╗██╔══██╗██╔════╝██║██║      ████╗ ████║██╔══██╗                    ') + chalk.cyan('║'),
      chalk.cyan('║') + chalk.greenBright('  ██████╔╝███████║███████╗██║██║█████╗██╔████╔██║██║  ██║                    ') + chalk.cyan('║'),
      chalk.cyan('║') + chalk.greenBright('  ██╔══██╗██╔══██║╚════██║██║██║╚════╝██║╚██╔╝██║██║  ██║                    ') + chalk.cyan('║'),
      chalk.cyan('║') + chalk.greenBright('  ██████╔╝██║  ██║███████║██║███████╗ ██║ ╚═╝ ██║██████╔╝                    ') + chalk.cyan('║'),
      chalk.cyan('║') + chalk.greenBright('  ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝╚══════╝ ╚═╝     ╚═╝╚═════╝                     ') + chalk.cyan('║'),
      chalk.cyan('║') + chalk.gray('                                                                               ') + chalk.cyan('║'),
      chalk.cyan('║') + chalk.white('              ⚡ Advanced WhatsApp Multi-Device Bot ⚡                        ') + chalk.cyan('║'),
      chalk.cyan('║') + chalk.magenta('                     Powered by DEVSTRIKE™                                    ') + chalk.cyan('║'),
      chalk.cyan('╚═══════════════════════════════════════════════════════════════════════════════╝')
    ];
  }
  
  // Medium banner for medium terminals (60-79)
  if (w >= 60) {
    return [
      chalk.cyan('╔════════════════════════════════════════════════════════╗'),
      chalk.cyan('║') + chalk.greenBright('  ██████╗  █████╗ ███████╗██╗██╗     ███╗   ███╗██████╗ ') + chalk.cyan('║'),
      chalk.cyan('║') + chalk.greenBright('  ██╔══██╗██╔══██╗██╔════╝██║██║     ████╗ ████║██╔══██╗') + chalk.cyan('║'),
      chalk.cyan('║') + chalk.greenBright('  ██████╔╝███████║███████╗██║██║     ██╔████╔██║██║  ██║') + chalk.cyan('║'),
      chalk.cyan('║') + chalk.greenBright('  ██╔══██╗██╔══██║╚════██║██║██║     ██║╚██╔╝██║██║  ██║') + chalk.cyan('║'),
      chalk.cyan('║') + chalk.greenBright('  ██████╔╝██║  ██║███████║██║███████╗██║ ╚═╝ ██║██████╔╝') + chalk.cyan('║'),
      chalk.cyan('║') + chalk.greenBright('  ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝╚══════╝╚═╝     ╚═╝╚═════╝ ') + chalk.cyan('║'),
      chalk.cyan('║') + chalk.white('        ⚡ WhatsApp Multi-Device Bot ⚡                  ') + chalk.cyan('║'),
      chalk.cyan('║') + chalk.magenta('           Powered by DEVSTRIKE™                         ') + chalk.cyan('║'),
      chalk.cyan('╚════════════════════════════════════════════════════════╝')
    ];
  }
  
  // Compact banner for narrow terminals (<60)
  return [
    chalk.cyan('╔══════════════════════════════════╗'),
    chalk.cyan('║') + chalk.greenBright('    ____   _   ____ ___ _       ') + chalk.cyan('║'),
    chalk.cyan('║') + chalk.greenBright('   | __ ) / \\ / ___|_ _| |      ') + chalk.cyan('║'),
    chalk.cyan('║') + chalk.greenBright('   |  _ \\/ _ \\\\___ \\| || |     ') + chalk.cyan('║'),
    chalk.cyan('║') + chalk.greenBright('   | |_) / ___ \\___) | || |___  ') + chalk.cyan('║'),
    chalk.cyan('║') + chalk.greenBright('   |____/_/   \\_\\____/___|____| ') + chalk.cyan('║'),
    chalk.cyan('║') + chalk.greenBright('          ███╗   ███╗██████╗    ') + chalk.cyan('║'),
    chalk.cyan('║') + chalk.greenBright('          ████╗ ████║██╔══██╗   ') + chalk.cyan('║'),
    chalk.cyan('║') + chalk.greenBright('          ██╔████╔██║██║  ██║   ') + chalk.cyan('║'),
    chalk.cyan('║') + chalk.greenBright('          ██║╚██╔╝██║██║  ██║   ') + chalk.cyan('║'),
    chalk.cyan('║') + chalk.greenBright('          ██║ ╚═╝ ██║██████╔╝   ') + chalk.cyan('║'),
    chalk.cyan('║') + chalk.greenBright('          ╚═╝     ╚═╝╚═════╝    ') + chalk.cyan('║'),
    chalk.cyan('║') + chalk.white('   ⚡ WhatsApp Bot ⚡           ') + chalk.cyan('║'),
    chalk.cyan('║') + chalk.magenta('    Powered by DEVSTRIKE™      ') + chalk.cyan('║'),
    chalk.cyan('╚══════════════════════════════════╝')
  ];
};

// Display initial banner
const displayBanner = () => {
  ConsoleUI.clear();
  const banner = getASCIIBanner();
  console.log('\n');
  banner.forEach(line => console.log(ConsoleUI.center(line)));
  console.log('\n');
};

// Display loading screen with animation
const displayLoadingScreen = async (message, duration = 2000) => {
  ConsoleUI.clear();
  const banner = getASCIIBanner();
  console.log('\n');
  banner.forEach(line => console.log(ConsoleUI.center(line)));
  console.log('\n');
  
  const frames = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];
  const startTime = Date.now();
  let frameIndex = 0;
  
  while (Date.now() - startTime < duration) {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const bar = ConsoleUI.progressBar(elapsed, duration, 40);
    const spinner = chalk.cyan(frames[frameIndex]);
    
    process.stdout.write(`\r${ConsoleUI.center(`${spinner} ${message} ${bar}`)}`);
    frameIndex = (frameIndex + 1) % frames.length;
    await ConsoleUI.delay(80);
  }
  console.log('\n');
};

// Display starting bot animation
const displayStartingBot = async () => {
  ConsoleUI.clear();
  const banner = getASCIIBanner();
  console.log('\n');
  banner.forEach(line => console.log(ConsoleUI.center(line)));
  console.log('\n');
  
  const stages = [
    { msg: 'Initializing core systems...', emoji: '🔧' },
    { msg: 'Connecting to WhatsApp servers...', emoji: '🌐' },
    { msg: 'Syncing credentials...', emoji: '🔐' },
    { msg: 'Starting BASIL-MD...', emoji: '🚀' }
  ];
  
  for (const stage of stages) {
    console.log(ConsoleUI.center(chalk.cyan(`  ${stage.emoji} ${stage.msg}`)));
    await ConsoleUI.delay(500);
  }
  
  console.log('\n');
  console.log(ConsoleUI.center(chalk.greenBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')));
  console.log(ConsoleUI.center(chalk.greenBright.bold('   ✅ BASIL-MD IS NOW ONLINE AND READY!   ')));
  console.log(ConsoleUI.center(chalk.greenBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')));
  console.log('\n');
};

// ═══════════════════════════════════════════════════════════════════════════════
// END CONSOLE UI SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

const sudo = config.SUDOS;
const owner = config.OWNER_NUMBER;

[PLUGINS_DIR, BACKUP_DIR, SAVED_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });



const store = makeInMemoryStore({
  storeFile: './store.json',
  logger: P().child({ level: 'fatal', stream: 'store' }),
  backupDir: BACKUP_DIR,
  numberFormatter: digits => '+' + digits,
  maxContactsPerMessage: 100
});

store.load();
store.enableAutosave();
store.enablePruning(); // Memory optimization: periodic cleanup of stale entries
global._basilStore = store;
const logger = P({ level: "silent" });

let groupRefreshTimer = null;
let _coreInitDone = false;

// Module-level config2: loaded once, patched in real-time by envEventBus on every .set call
let config2 = {};
envEventBus.on('env-changed', ({ key, value }) => {
  // 1. Always keep config2 in sync (used by all per-message checks)
  config2[key] = value;

  // 2. Live-patch global.* aliases that code reads directly
  const _isTruthy = v => v === true || v === 'true' || v === 'on';
  const _toArr = v => Array.isArray(v) ? v : String(v || '').split(',').map(s => s.trim()).filter(Boolean);

  if (key === 'PREFIX')        { global.prefix = value; }
  else if (key === 'BOT_NAME') { global.BASIL  = value; }

  // 3. Live-patch groupEventManager.config so group features update without restart
  const _gem = global.groupEventManager;
  if (_gem) {
    switch (key) {
      case 'WELCOME':       _gem.config.welcomeMessages = _isTruthy(value); break;
      case 'GOODBYE':       _gem.config.goodbyeMessages = _isTruthy(value); break;
      case 'ANTI_DEMOTE':   _gem.config.antiPromote = _isTruthy(value);
                            _gem.config.antiDemote  = _isTruthy(value); break;
      case 'ANTI_BOT':      _gem.config.antiBot = _isTruthy(value); break;
      case 'PREFIX':        _gem.config.prefix = value; break;
      case 'BOT_NAME':      _gem.botBrand.name  = value; break;
      case 'OWNER_NUMBER':  _gem.config.ownerNumbers = _toArr(value); break;
      case 'SUDOS':         _gem.config.sudoNumbers  = _toArr(value); break;
    }
  }
});

async function connectBASIL(app){

  if (!_coreInitDone) {
    await initDB();
    // Initialize the central/session DB (Sequelize) and bind all compat models.
    // Must run before any plugin (Scheduler, ChessGame, etc.) accesses a model.
    await connectCoreDB().catch(() => {});

    // Decrypt creator numbers from vault (XOR key parts + AES-256-GCM)
    await initVault().catch(e => console.warn('[Vault] init warning (non-fatal):', e.message));
    await cooldowns.loadCooldowns();

    // Wait for Sequelize to finish CREATE TABLE before any service reads/writes DB
    await ensureTablesReady().catch(() => {});

    startPremSync();
    
    // Initialize message queue manager (Phase 2)
    await initializeQueueManager();

    _coreInitDone = true;
  }

  config2 = await readEnv();
  const prefix = config2.PREFIX;

  console.log(chalk.green('CONNECTING BASIL-MD...'));
  
  // Retrieve session creds from the pairing service using SESSION_ID from .env
  if (!fs.existsSync(sessFile)) {
    // If a SESSION_ID is provided, try to fetch stored creds from the pairing service
    if (config.SESSION_ID) {
      try {
        console.log(chalk.blue('📊 Retrieving session by SESSION_ID...'));
        const sessionData = await getSessionByID(config.SESSION_ID);

        // Create session directory and save credentials
        if (!fs.existsSync(sessDir)) {
          fs.mkdirSync(sessDir, { recursive: true });
        }

        // Save credentials for Baileys to use
        fs.writeFileSync(path.join(sessDir, 'creds.json'), JSON.stringify(sessionData.credentials, null, 2));

        store.clear();
        console.log(chalk.green('✅ SESSION RETRIEVED SUCCESSFULLY'));
      } catch (err) {
        console.log(chalk.red(`❌ ERROR retrieving session: ${err.message}`));
        console.log(chalk.yellow('Falling back to QR login.'));
        if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true });
      }
    } else {
      // No session file and no SESSION_ID — fall back to interactive QR pairing
      console.log(chalk.yellow('⚠️ No session file or SESSION_ID found — starting QR login fallback.'));
      if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true });
    }
  }

  // File-based authentication (stable, local-disk backed).
  console.log('📁 Using File-Based Authentication State (useMultiFileAuthState)...');
  const auth = await useMultiFileAuthState(sessDir);
  let state = auth.state;
  let saveCreds = auth.saveCreds;
  console.log('✅ File-based auth state initialized');

  var { version } = await fetchLatestBaileysVersion();

  const conn = makeWASocket({
      logger,
      version,
      auth: {
         creds: state.creds,
         keys:  makeCacheableSignalKeyStore(state.keys, logger)
      },
      browser: ['Ubuntu', 'Chrome', '22.04.4'],
      markOnlineOnConnect: true,
      emitOwnPresence: false,
      emitOwnEvents: true,
      fireInitQueries: false,
      syncFullHistory: true,
      generateHighQualityLinkPreview: true,
      printQRInTerminal: false,
      // Connection timeout and keepalive settings
      connectTimeoutMs: 15000,
      keepAliveIntervalMs: 20000,
      defaultQueryTimeoutMs: 20000,
      retryRequestDelayMs: 50,
      // Message retry configuration
      msgRetryCounterCache: undefined,
      shouldIgnoreJid: jid => false,
      getMessage: async (key) => {
        if (store) {
          const mssg = await store.getMessage(key.remoteJid, key.id);
          return mssg?.message || undefined;
        }
        return { conversation: 'BASIL-MD' };
      },
      patchMessageBeforeSending: (message) => {
        const requiresPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage);
        if (requiresPatch) {
          message = {
            viewOnceMessage: {
              message: {
                messageContextInfo: {
                  deviceListMetadataVersion: 2,
                  deviceListMetadata: {},
                },
                ...message,
              },
            },
          };
        }
        return message;
      }
    });

  // Wrap conn.sendMessage to route direct remote media URLs through sendA/sendV,
  // and to add a 3-attempt timeout/retry for media uploads.
  {
    const _previousSendMessage = conn.sendMessage.bind(conn);
    conn.sendMessage = async function(jid, content, options = {}) {
        return _previousSendMessage(jid, content, options);
    };
  }

  // create a small worker queue to limit concurrent heavy downloads/transcodes
  const downloadQueue = createWorkerQueue(parseInt(process.env.BASIL_DOWNLOAD_CONCURRENCY || '2', 10));

  // Wrap sendMessage with conditional anti-ban queue and human delays
  const originalSendMessage = conn.sendMessage.bind(conn);
  conn.sendMessage = async function(jid, content, options = {}) {
    // Check if this is a priority message (owner, error, system)
    const isPriority = options.priority || options.isOwner || options.isSystem;
    
    // Check if message queue is enabled (anti-ban mode)
    const queueEnabled = checkQueueEnabled();
    
    // For priority messages OR if queue is disabled (fast mode), send immediately
    if (isPriority || !queueEnabled) {
      return originalSendMessage(jid, content, options);
    }
    
    // For normal messages in anti-ban mode, add to queue with human-like delay
    return new Promise((resolve, reject) => {
      messageQueue.enqueue(async () => {
        try {
          // Add random delay before sending (simulate human behavior)
          const delay = getRandomDelay(1000, 2000);
          await new Promise(r => setTimeout(r, delay));
          
          const result = await originalSendMessage(jid, content, options);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }, { priority: isPriority ? 1 : 0 });
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // JID/LID HELPER METHODS - Attached to conn for global access
  // Required for newsletter admin operations (transfer, promote, demote)
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // Fetch user's LID from JID using gifted-baileys fetchUserLid (with caching)
  conn.fetchLidFromJid = (jid) => fetchLidFromJid(conn, jid);
  
  // Get LID for newsletter operations - main function for admin ops
  conn.getLidForNewsletter = (userIdentifier) => getLidForNewsletter(conn, userIdentifier);
  
  // Resolve user to both JID and LID
  conn.resolveUserIds = (userIdentifier) => resolveUserIds(conn, userIdentifier);
  
  // Get participants with their LIDs (for bulk operations)
  conn.getParticipantsWithLids = (jids) => getParticipantsWithLids(conn, jids);
  
  // Static helper methods (don't need conn)
  conn.isUserJid = isUserJid;
  conn.isLid = isLid;
  conn.isGroupJid = isGroupJid;
  conn.isNewsletterJid = isNewsletterJid;
  conn.normalizeJid = normalizeJid;
  conn.normalizeLid = normalizeLid;
  conn.extractPhoneNumber = extractPhoneNumber;
  conn.clearLidCache = clearLidCache;
  conn.formatUserIdForDisplay = formatUserIdForDisplay;
  

  // Detect and attach capability map so plugins can adapt to the loaded Baileys flavor
  try {
    if (typeof detectCapabilities === 'function') {
      conn.capabilities = detectCapabilities(conn) || {};
    } else {
      conn.capabilities = {};
    }
  } catch (e) {
    console.debug('[Capabilities] detection failed:', e?.message || e);
    conn.capabilities = {};
  }

  store.bind(conn.ev);

  global._basilConn = conn;
  for (const hook of (global._basilOnConnectHooks || [])) {
    try { hook(conn); } catch (_) {}
  }

  // Group cache is now fetched on-demand via store events and message handlers
  // Removed 10-minute polling to reduce CPU/memory overhead
  
  let _qrExpireTimer = null;

  conn.ev.on('connection.update', async (update) => {
      try {
        const { connection, lastDisconnect, qr } = update;
        
        // Show QR on every new QR event (auto-refreshes every ~60 s)
        if (qr) {
          if (_qrExpireTimer) { clearTimeout(_qrExpireTimer); _qrExpireTimer = null; }
          console.log(chalk.cyan('\n╔════════════════════════════════════════╗'));
          console.log(chalk.cyan('║     SCAN QR CODE WITH WHATSAPP APP     ║'));
          console.log(chalk.cyan('╚════════════════════════════════════════╝\n'));
          qrcode.generate(qr, { small: true });
          console.log(chalk.yellow('\n⚠️  QR code expires in 60 seconds'));
          console.log(chalk.green('📱 Open WhatsApp → Settings → Linked Devices → Link a Device\n'));
          _qrExpireTimer = setTimeout(() => {
            console.log(chalk.yellow('\n🔄 QR code refreshing automatically...\n'));
          }, 60000);
        }

        if (connection === 'close') {
          // Improved error handling with Boom
          const statusCode = lastDisconnect?.error instanceof Boom 
            ? lastDisconnect.error.output?.statusCode 
            : lastDisconnect?.error?.output?.statusCode;
          
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          // Handle different disconnect reasons
          if (statusCode === DisconnectReason.badSession) {
            console.log(chalk.red('Bad session file. Please delete session and scan QR again.'));
            reconnectionManager.cancel();
            process.exit(1);
          } else if (statusCode === DisconnectReason.connectionClosed) {
            reconnectionManager.scheduleReconnect(() => connectBASIL(), 'Connection Closed');
          } else if (statusCode === DisconnectReason.connectionLost) {
            reconnectionManager.scheduleReconnect(() => connectBASIL(), 'Connection Lost');
          } else if (statusCode === DisconnectReason.connectionReplaced) {
            console.log(chalk.red('Connection replaced, another session opened. Closing this one.'));
            reconnectionManager.cancel();
            process.exit(1);
          } else if (statusCode === DisconnectReason.loggedOut) {
            console.log(chalk.red('Device logged out. Please scan QR again.'));
            reconnectionManager.cancel();
            if (fs.existsSync(sessDir)) {
              fs.rmSync(sessDir, { recursive: true, force: true });
            }
            process.exit(1);
          } else if (statusCode === DisconnectReason.restartRequired) {
            reconnectionManager.reset(); // Reset backoff for immediate restart
            connectBASIL();
          } else if (statusCode === DisconnectReason.timedOut) {
            reconnectionManager.scheduleReconnect(() => connectBASIL(), 'Timed Out');
          } else if (statusCode === DisconnectReason.multideviceMismatch) {
            console.log(chalk.red('Multi-device mismatch. Please rescan QR.'));
            reconnectionManager.cancel();
            process.exit(1);
          } else if (shouldReconnect) {
            reconnectionManager.scheduleReconnect(() => connectBASIL(), 'Unknown Reason');
          }
        } else if (connection === 'open') {
            // QR was scanned — cancel the expiry warning timer
            if (_qrExpireTimer) { clearTimeout(_qrExpireTimer); _qrExpireTimer = null; }
            // Reset reconnection backoff on successful connection
            reconnectionManager.reset();
            // Check if bot account is premium → enable group VIP bonus (2× limits)
            postConnectVault(conn.user?.id).catch(() => null);
            // Initialize LID store once per session (needs open connection)
            if (!connectBASIL._lidStoreReady) {
              connectBASIL._lidStoreReady = true;
              initializeLidStore(conn).catch(() => {});
            }
            (async () => {
              try {
      // ═════════════════════════════════════════════════════════════════════════════════
      // INITIALIZE GLOBAL VARIABLES
      // ═════════════════════════════════════════════════════════════════════════════════
      
      // Set global.prefix from config
      const configPrefix = config2?.PREFIX || config?.PREFIX || process.env.PREFIX || '.';
      global.prefix = configPrefix;
      
      // Set global.BOT_MENUMODE from config or default to 'reply'
      global.BOT_MENUMODE = config2?.BOT_MENUMODE || config?.BOT_MENUMODE || process.env.BOT_MENUMODE || 'reply';
      
      // Set global.CHATBOT_MODE from config
      global.CHATBOT_MODE = config2?.CHATBOT_MODE || config?.CHATBOT_MODE || process.env.CHATBOT_MODE || 'false';
      

      // ═══════════════════════════════════════════════════════════════════════════════
      // LIVE ENV EVENT LISTENER - Real-time Config Updates Without Restart
      // ═══════════════════════════════════════════════════════════════════════════════
      envEventBus.onEnvChange(({ key, value, backend }) => {
        console.log(chalk.yellow(`🔄 [${backend}] Environment Change Detected: ${key} = ${value}`));
        
        // Update global variables in real-time
        if (key === "BOT_MENUMODE") {
          global.BOT_MENUMODE = value;
          console.log(chalk.green(`✅ Menu mode updated to: ${value}`));
        } else if (key === "PREFIX") {
          global.prefix = value;
          console.log(chalk.green(`✅ Prefix updated to: ${value}`));
        } else if (key === "MULTI_PREFIX") {
          global.MULTI_PREFIX = value;
          console.log(chalk.green(`✅ Multi-prefix mode: ${value}`));
        } else if (key === "CHATBOT_MODE") {
          global.CHATBOT_MODE = value;
          console.log(chalk.green(`✅ ChatBot mode: ${value}`));
        } else if (key === "MODE") {
          global.MODE = value;
          console.log(chalk.green(`✅ Bot mode updated to: ${value}`));
        } else if (key === "AI_ENDPOINT") {
          global.AI_ENDPOINT = value;
          console.log(chalk.green(`✅ AI Endpoint updated`));
        } else if (key === "AI_API_KEY") {
          global.AI_API_KEY = value;
          console.log(chalk.green(`✅ AI API Key updated`));
        } else if (key === "AUTO_READ_STATUS") {
          global.AUTO_READ_STATUS = value;
          console.log(chalk.green(`✅ Auto-read status: ${value}`));
        } else if (key === "AUTO_READ_MSG") {
          global.AUTO_READ_MSG = value;
          console.log(chalk.green(`✅ Auto-read messages: ${value}`));
        } else if (key === "ANTI_CALL") {
          global.ANTI_CALL = value;
          console.log(chalk.green(`✅ Anti-call: ${value}`));
        } else if (key === "ANTI_DEMOTE") {
          global.ANTI_DEMOTE = value;
          console.log(chalk.green(`✅ Anti-demote: ${value}`));
        } else if (key === "ANTI_BOT") {
          global.ANTI_BOT = value;
          console.log(chalk.green(`✅ Anti-bot: ${value}`));
        } else if (key === "ANTI_TAG") {
          global.ANTI_TAG = value;
          console.log(chalk.green(`✅ Anti-tag: ${value}`));
        } else if (key === "ANTI_MENTION") {
          global.ANTI_MENTION = value;
          console.log(chalk.green(`✅ Anti-mention: ${value}`));
        } else if (key === "ANTI_MENTION_LIMIT") {
          global.ANTI_MENTION_LIMIT = value;
          console.log(chalk.green(`✅ Anti-mention limit: ${value}`));
        } else if (key === "ANTI_MENTION_ACT") {
          global.ANTI_MENTION_ACT = value;
          console.log(chalk.green(`✅ Anti-mention action: ${value}`));
        } else if (key === "ANTI_GROUP_STATUS") {
          global.ANTI_GROUP_STATUS = value;
          console.log(chalk.green(`✅ Anti-group-status: ${value}`));
        } else if (key === "WELCOME") {
          global.WELCOME = value;
          console.log(chalk.green(`✅ Welcome messages: ${value}`));
        } else if (key === "GOODBYE") {
          global.GOODBYE = value;
          console.log(chalk.green(`✅ Goodbye messages: ${value}`));
        } else if (key === "OWNER_NUMBER") {
          global.OWNER_NUMBER = value;
          console.log(chalk.green(`✅ Owner number updated`));
        } else if (key === "SUDOS") {
          global.SUDOS = value;
          console.log(chalk.green(`✅ Sudo list updated`));
        } else if (key === "BOT_NAME") {
          global.BOT_NAME = value;
          global.BASIL    = value;
          console.log(chalk.green(`✅ Bot name: ${value}`));
        } else {
          // Generic: ensure all other keys are reflected in global namespace too
          global[key] = value;
        }
        
        process.env[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
      });
      
      console.log(chalk.cyan(`✅ Live environment listener activated (EventBus ready)`));
      
      // ═══════════════════════════════════════════════════════════════════════════════
      // ADVANCED PLUGIN LOADING SYSTEM
      // ═══════════════════════════════════════════════════════════════════════════════
      
      // Display initial banner
      displayBanner();
      console.log(ConsoleUI.center(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')));
      console.log(ConsoleUI.center(chalk.yellow.bold('📦 LOADING PLUGIN FILES...')));
      console.log(ConsoleUI.center(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')));
      console.log('');
      
      // 1. Register all plugins for lazy loading (load on-demand, not at startup)
      const pluginFiles = getPluginFilenames();
      const totalPlugins = pluginFiles.length;
      let registeredCount = 0;
      
      // Use lazy loading to save ~200MB memory at startup
      await loadAllPlugins({ lazy: true });
      
      console.log('');
      console.log(ConsoleUI.center(chalk.green(`✅ ${totalPlugins} plugin files registered for lazy loading`)));
      console.log(ConsoleUI.center(chalk.cyan(`💾 Memory saved: ~${Math.round(totalPlugins * 2)}MB (plugins load on first use)`)));
      console.log('');
      
      // 2. Display command registration summary
      await ConsoleUI.delay(500);
      ConsoleUI.clear();
      displayBanner();
      console.log(ConsoleUI.center(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')));
      console.log(ConsoleUI.center(chalk.yellow.bold('⚙️  COMMAND REGISTRATION...')));
      console.log(ConsoleUI.center(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')));
      console.log('');
      
      const totalLoadedCommands = commands?.size || Array.from(commands?.values?.() || []).length || 0;
      console.log(ConsoleUI.center(chalk.cyan(`  📋 ${totalLoadedCommands} commands registered`)));
      console.log(ConsoleUI.center(chalk.gray(`  (Plugins load on-demand when commands are used)`)));
      console.log('');
      
      // 3. Show loading screen
      await ConsoleUI.delay(1000);
      await displayLoadingScreen('Initializing BASIL-MD...', 3000);
      
      // 4. Show starting bot animation
      await displayStartingBot();
      
      console.log(ConsoleUI.center(chalk.magenta(`📦 Baileys Package: ${getLoadedFlavor()}`)));
      console.log('');
                
      // Register bot JID as privileged so the bot itself is exempt from limits
      try {
        const botJidForPriv = conn.user?.id || (conn.user?.id?.split(':')[0] + '@s.whatsapp.net');
        if (botJidForPriv) addPrivilegedJid(botJidForPriv);
        try {
          // Also set cooldown bypass flags in memory/db so the bot is exempt immediately
          await cooldowns.setUserFlags(botJidForPriv, { bypassRateLimit: true, bypassCooldown: true }, conn);
        } catch (e) { /* ignore */ }
      } catch (e) { /* ignore */ }

      // Start scheduler service (Phase 3)
      startSchedulerService(conn);
      console.log(ConsoleUI.center(chalk.green('📅 Scheduler service started')));

      // Start bot monitor client (if configured)
      if (process.env.MONITOR_URL) {
        try {
          const botNumber = conn.user?.id?.split(':')[0] || conn.user?.id?.split('@')[0] || '';
          const monitorClient = getMonitorClient({
            monitorUrl: process.env.MONITOR_URL,
            monitorKey: process.env.MONITOR_KEY,
            botNumber: botNumber,
            botName: global.BASIL || config2.BOT_NAME || 'BASIL-MD',
            sessionId: config.SESSION_ID,
            ownerJid: config2.OWNER_NUMBER ? `${config2.OWNER_NUMBER}@s.whatsapp.net` : ''
          });
          
          monitorClient.setConnection(conn);
          
          // Handle commands from dashboard - execute real commands
          monitorClient.onCommand(async (cmd) => {
            console.log(`[Monitor] Executing dashboard command: ${cmd.command}`);
            try {
              const commandStr = cmd.command?.trim();
              const targetJid = cmd.targetJid || conn.user?.id;
              
              if (!commandStr) {
                return { success: false, error: 'No command provided' };
              }
              
              // Use owner JID for command execution (passes privilege checks)
              const ownerNumber = config2.OWNER_NUMBER || process.env.OWNER_NUMBER;
              const senderJid = ownerNumber ? `${ownerNumber}@s.whatsapp.net` : conn.user?.id;
              
              // Create message that appears from owner (not fromMe) so it gets processed
              const fakeMessage = {
                key: { 
                  remoteJid: targetJid, 
                  fromMe: false, 
                  id: `monitor-${Date.now()}`,
                  participant: senderJid  // Appears from owner
                },
                pushName: 'Monitor Dashboard',
                message: { conversation: commandStr },
                messageTimestamp: Math.floor(Date.now() / 1000)
              };
              
              // Emit as messages.upsert for command processing
              conn.ev.emit('messages.upsert', { 
                messages: [fakeMessage], 
                type: 'notify' 
              });
              
              return { 
                success: true, 
                command: commandStr,
                message: `Command "${commandStr}" dispatched from owner to ${targetJid}`
              };
            } catch (e) {
              console.error('[Monitor] Command execution error:', e.message);
              return { success: false, error: e.message };
            }
          });
          
          // Handle control actions from dashboard
          monitorClient.onControl(async (action) => {
            console.log(`[Monitor] Control action: ${action}`);
            if (action === 'pause') {
              global.BOT_PAUSED = true;
              return { success: true, message: 'Bot paused' };
            } else if (action === 'resume') {
              global.BOT_PAUSED = false;
              return { success: true, message: 'Bot resumed' };
            }
            return { success: true };
          });
          
          await monitorClient.start(180000); // Ping every 3 minutes (180 seconds)
          console.log(ConsoleUI.center(chalk.green('📡 Bot monitor connected')));
        } catch (e) {
          console.log(ConsoleUI.center(chalk.yellow(`⚠️ Bot monitor not connected: ${e.message}`)));
        }
      }

                const ID = conn.user.id;
                const name = conn.user.name || 'BASIL';
                const td = await getTimezones(ID);
                const nw = await TOD(td[0]);
 const ctxInfo1 = {
            forwardingScore: 999,
            isForwarded: true,
            mentionedJid: [ID],
            forwardedNewsletterMessageInfo: { newsletterJid: DS_ID, newsletterName: DS_NAME, serverMessageId: 5 },
            externalAdReply: {
              title: BASIL,
              body: footer,
              sourceUrl: DS_LINK,
              mediaType: 1,
              showAdAttribution: false,
              renderLargerThumbnail: true,
              thumbnailUrl: BASIL_IMG
            }
          };
                // Mask sensitive values in the startup message
                const mask = v => (v ? String(v).replace(/.(?=.{4})/g, '*') : 'Not Set');
                const status = v => v === 'true' || v === true || v === 'on' ? '✅ ON' : '❌ OFF';
                const truncate = (v, len = 30) => v && v.length > len ? v.substring(0, len) + '...' : (v || 'Not Set');
                
                // Calculate bot uptime and system info
                const memUsage = process.memoryUsage();
                const heapUsed = Math.round(memUsage.heapUsed / 1024 / 1024);
                const heapTotal = Math.round(memUsage.heapTotal / 1024 / 1024);
                const cmdCount = commands?.size || Array.from(commands?.values?.() || []).length || 0;
                const baileysType = getLoadedFlavor();
                
                const up = `
╔══════════════════════════════════════╗
║    𝗕𝗔𝗦𝗜𝗟-𝗠𝗗 𝗦𝗧𝗔𝗥𝗧𝗨𝗣 𝗥𝗘𝗣𝗢𝗥𝗧    ║
╚══════════════════════════════════════╝

👋 ${nw.greeting}, *${name}*!

┌─────────── 📅 𝗦𝗬𝗦𝗧𝗘𝗠 𝗜𝗡𝗙𝗢 ───────────┐
│ Date: ${nw.date}
│ Time: ${nw.time}
│ Timezone: ${td}
│ Memory: ${heapUsed}MB / ${heapTotal}MB
│ Commands: ${cmdCount} loaded
│ Baileys: ${baileysType}
│ Platform: ${conn.authState?.creds?.platform || 'Unknown'}
└──────────────────────────────────────┘

┌──── 👤 𝗢𝗪𝗡𝗘𝗥 𝗦𝗘𝗧𝗧𝗜𝗡𝗚𝗦 ─────────┐
│ Owner: ${config2.OWNER_NUMBER || 'Not Set'}
│ Sudos: ${truncate(config2.SUDOS, 25)}
│ Mode: *${config2.MODE?.toUpperCase() || 'PUBLIC'}*
│ Prefix: *${config2.PREFIX || '.'}*
│ Multi-Prefix: ${status(config2.MULTI_PREFIX)}
└──────────────────────────────────┘

┌─────── 🛡️ 𝗣𝗥𝗢𝗧𝗘𝗖𝗧𝗜𝗢𝗡 ───────────┐
│ Anti-ViewOnce: ${status(config2.ANTI_VV)}
│ Anti-Link: ${status(config2.ANTI_LINK)}
│ Anti-Link Action: ${config2.ANTI_LINK_ACT || 'warn'}
│ Anti-Delete: ${status(config2.ANTI_DELETE)}
│ Anti-Edit: ${status(config2.ANTI_EDIT)}
└──────────────────────────────────┘

┌──── 🤖 𝗔𝗨𝗧𝗢 𝗙𝗘𝗔𝗧𝗨𝗥𝗘𝗦 ───────────┐
│ Auto-Read: ${status(config2.AUTO_READ_MSG)}
│ Auto-Status Reply: ${status(config2.AUTO_STATUS_REPLY)}
│ Auto-Read Status: ${status(config2.AUTO_READ_STATUS)}
│ Auto-Status Like: ${status(config2.AUTO_STATUS_LIKE)}
│ Auto-Reply: ${status(config2.AUTO_REPLY)}
│ Auto-Sticker: ${status(config2.AUTO_STICKER)}
│ Auto-Voice: ${status(config2.AUTO_VOICE)}
└──────────────────────────────────┘

┌─────── 😊 𝗥𝗘𝗔𝗖𝗧𝗜𝗢𝗡𝗦 ───────────┐
│ Auto-React: ${status(config2.AUTO_REACT)}
│ Custom-React: ${status(config2.CUSTOM_REACT)}
│ Owner-React: ${status(config2.OWNER_REACT)}
└─────────────────────────────────┘

┌───── 👥 𝗚𝗥𝗢𝗨𝗣 𝗙𝗘𝗔𝗧𝗨𝗥𝗘𝗦 ──────────┐
│ Welcome: ${status(config2.WELCOME)}
│ Goodbye: ${status(config2.GOODBYE)}
│ Events: ${status(config2.EVENTS)}
└───────────────────────────────────┘

┌─────── 🎨 𝗖𝗨𝗦𝗧𝗢𝗠𝗜𝗭𝗔𝗧𝗜𝗢𝗡 ─────────┐
│ Alive Image: ${truncate(config2.ALIVE_IMG, 25)}
│ Alive Message: ${truncate(config2.ALIVE_MSG, 25)}
└────────────────────────────────────┘

┌──── 🔐 𝗦𝗘𝗖𝗥𝗘𝗧𝗦 (Masked) ───────────┐
│ GitHub User: ${config.GITHUB_USERNAME || 'Not Set'}
│ GitHub Token: ${mask(config2.GITHUB_AUTH_TOKEN)}
│ PostgreSQL: ${config2.POSTGRE_URI ? '✅ Configured' : '❌ Not Set'}
└─────────────────────────────────────┘

╔═════════════════════════════════╗
║     𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗗𝗘𝗩𝗦𝗧𝗥𝗜𝗞𝗘™          ║
╚═════════════════════════════════╝`;

                const _startImgBuf = (() => { try { return fs.readFileSync(path.join(__dirname, '../assets/basil.jpg')); } catch { try { return fs.readFileSync(path.join(__dirname, '../assets/basil2.jpg')); } catch { return null; } } })();
                await conn.sendMessage( conn.user?.id?.split(':')[0] + '@s.whatsapp.net' , { image: _startImgBuf || { url: BASIL_IMG }, caption: up, contextInfo: ctxInfo1 });

                await sleep(500);
                await conn.groupAcceptInvite(ST_GC).catch(() => {});
                await sleep(1000);
                await conn.groupAcceptInvite(DS_GC).catch(() => {});
                await sleep(1000);
                // Newsletter follow/unmute - guard these calls so a non-gifted-baileys build
                // doesn't throw a TypeError. Log debug messages on failure to aid diagnostics.
                if (typeof conn.newsletterFollow === 'function') {
                  await conn.newsletterFollow(DS_ID).catch(() => {});
                  await sleep(1000);
                  await conn.newsletterFollow(ST_ID).catch(() => {});
                } else if (typeof conn.newsletterSubscribe === 'function') {
                  await conn.newsletterSubscribe(DS_ID).catch(() => {});
                  await sleep(1000);
                  await conn.newsletterSubscribe(ST_ID).catch(() => {});
                }

                await sleep(500);
                if (typeof conn.newsletterUnmute === 'function') {
                  await conn.newsletterUnmute(DS_ID).catch(() => {});
                  await sleep(500);
                  await conn.newsletterUnmute(ST_ID).catch(() => {});
                }

                // --- Clean up gifted-baileys auto channels ---
                try {
                  const autoJids = [
                    "120363426409647211@newsletter",
                    "120363400305125384@newsletter",
                    "120363417843694687@newsletter",
                    "120363404978384902@newsletter",
                    "120363200367779016@newsletter",
                    "120363426705024581@newsletter"
                  ];
                  
                  if (typeof conn.newsletterMetadata === 'function' && 
                      (typeof conn.newsletterUnfollow === 'function' || typeof conn.newsletterUnsubscribe === 'function')) {
                    for (const jid of autoJids) {
                      await sleep(1500);
                      try {
                        let meta = null;
                        try {
                          meta = await conn.newsletterMetadata('jid', jid);
                        } catch (e) {}
                        
                        if (meta && meta.name) {
                          if (!meta.name.toLowerCase().includes('gifted')) {
                            if (typeof conn.newsletterUnfollow === 'function') {
                              await conn.newsletterUnfollow(jid).catch(() => {});
                            } else {
                              await conn.newsletterUnsubscribe(jid).catch(() => {});
                            }
                          }
                        } else {
                          // Fallback unfollow if fetch fails
                          if (typeof conn.newsletterUnfollow === 'function') {
                            await conn.newsletterUnfollow(jid).catch(() => {});
                          } else {
                            await conn.newsletterUnsubscribe(jid).catch(() => {});
                          }
                        }
                      } catch (e) {}
                    }
                  }
                } catch (err) {}
                // ---------------------------------------------
              } catch (err) {
                console.error('on-open init error:', err);
              }
            })();
        }
      } catch (err) {
        console.error('connection.update handler error:', err);
      }
    });

    conn.ev.on('creds.update', saveCreds);

    // ========== INITIALIZE GROUP EVENT MANAGER ==========
    // Initialize comprehensive group event handling with JID/LID resolution
    const groupEventManager = new GroupEventManager(conn, {
      botName: global.BASIL || config2.BOT_NAME || BASIL,
      footer: footer,
      botImage: BASIL_IMG,
      newsletterId: DS_ID,
      newsletterName: DS_NAME,
      dsLink: DS_LINK,
      prefix: global.prefix || config2.PREFIX || '.',
      welcomeMessages: config2.WELCOME === true || config2.WELCOME === 'on' || config2.WELCOME === 'true',
      goodbyeMessages: config2.GOODBYE === true || config2.GOODBYE === 'on' || config2.GOODBYE === 'true',
      promotionNotifications: config2.EVENTS === 'on',
      demotionNotifications: config2.EVENTS === 'on',
      kickNotifications: config2.EVENTS === 'on',
      antiPromote: config2.ANTI_DEMOTE === true || config2.ANTI_DEMOTE === 'on',
      antiDemote: config2.ANTI_DEMOTE === true || config2.ANTI_DEMOTE === 'on',
      antiBot: config2.ANTI_BOT === true || config2.ANTI_BOT === 'on',
      timeZone: 'Africa/Harare',
      // Protection config
      ownerNumbers: owner,
      sudoNumbers: sudo,
      creatorNumbers: OWNERS
    });

    // Register event listeners (group-participants.update, groups.update)
    groupEventManager.registerEventListeners();
    global.groupEventManager = groupEventManager;

    // Initialize group settings from database
    await initializeGroupSettings('data/groupSettings.json').catch((err) => {
      console.warn('[⚠️] Group settings initialization warning:', err.message);
    });

    // LID store is initialized inside the connection.update 'open' handler (see below)

    // Initialize Dashboard API if app is provided
    if (app) {
      try {
        setupDashboardAPI(app, conn, store);
        console.log(chalk.green('[✅] Dashboard API initialized at /api/dashboard'));
      } catch (dashErr) {
        console.warn('[⚠️] Dashboard API initialization warning:', dashErr.message);
      }
    }

    // ------------- Call Handler (auto-reject) -------------
    let callHandlerModule = null;
    
    conn.ev.on('call', async (calls) => {
      try {
        if (!callHandlerModule) {
          try {
            callHandlerModule = await import('../plugins/calls.js');
          } catch (importErr) {
            console.error('[CALL] Failed to load call handler:', importErr.message);
            return;
          }
        }
        
        const { handleIncomingCall, isAutoRejectEnabled } = callHandlerModule;
        
        for (const call of calls) {
          console.log(`[CALL] Incoming ${call.isVideo ? 'video' : 'voice'} call from ${call.from}`);
          
          const _antiCallEnv = config2.ANTI_CALL === true || config2.ANTI_CALL === 'on';
          if (_antiCallEnv || (isAutoRejectEnabled && isAutoRejectEnabled())) {
            if (handleIncomingCall) {
              const handled = await handleIncomingCall(conn, call);
              if (handled) {
                console.log(`[CALL] Auto-rejected call from ${call.from}`);
              }
            }
          }
        }
      } catch (err) {
        console.error('[CALL] Handler error:', err.message);
      }
    });

conn.ev.on('messages.delete', async (delEvt) => {
  try {
    const config2 = await readEnv();
    if (config2.ANTI_DELETE !== true && config2.ANTI_DELETE !== "true") return;

    if ('keys' in delEvt) {
      for (const key of delEvt.keys) {
        if (!key.remoteJid || key.remoteJid === 'status@broadcast') continue;
        const msg = await store.getMessage(key.remoteJid, key.id);
        if (msg && msg.message) {
          await conn.sendMessage(key.remoteJid, { forward: { key, message: msg.message } });
          await conn.sendMessage(key.remoteJid, {
            text: `╔═══「 🗑️ *ᴀɴᴛɪ-ᴅᴇʟᴇᴛᴇ* 」═══╗\n║\n║  ⚠️ *A message was deleted!*\n║  📩 The original has been\n║  restored above.\n║\n╚═══════════════════════════╝`,
            contextInfo: {
              externalAdReply: {
                title: BASIL,
                body: footer,
                sourceUrl: DS_LINK,
                thumbnailUrl: BASIL_IMG,
                mediaType: 1,
                renderLargerThumbnail: false
              }
            }
          });
        }
      }
    } else if ('all' in delEvt && delEvt.all) {
      if (!delEvt.jid || delEvt.jid === 'status@broadcast') return;
      await conn.sendMessage(delEvt.jid, {
        text: `╔═══「 🗑️ *ᴀɴᴛɪ-ᴅᴇʟᴇᴛᴇ* 」═══╗\n║\n║  🧹 *Chat history was cleared!*\n║  Someone deleted all messages\n║  in this chat.\n║\n╚═══════════════════════════╝`,
        contextInfo: {
          externalAdReply: {
            title: BASIL,
            body: footer,
            sourceUrl: DS_LINK,
            thumbnailUrl: BASIL_IMG,
            mediaType: 1,
            renderLargerThumbnail: false
          }
        }
      });
    }
  } catch (err) {
    console.error('messages.delete handler error:', err);
  }
});

// MEMORY-OPTIMIZED antiCache with size cap and periodic cleanup
const ANTI_CACHE_MAX_SIZE = 500;
const ANTI_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours instead of 6
const antiCache = new Map();

// Use a single Map with entries containing message, time, and use Map's iteration order (insertion order)
// Periodic cleanup every 15 minutes - remove expired entries
setInterval(() => {
  const now = Date.now();
  let deleted = 0;
  // Collect keys to delete first, then delete (avoid mutation during iteration)
  const keysToDelete = [];
  for (const [key, entry] of antiCache) {
    if (entry && entry.time && now - entry.time > ANTI_CACHE_TTL) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    antiCache.delete(key);
    deleted++;
  }
  if (deleted > 0) console.log(`[MEMORY] antiCache cleanup: removed ${deleted} expired entries, ${antiCache.size} remaining`);
}, 15 * 60 * 1000);

function addToAntiCache(key, message) {
  // If key exists, delete and re-add to move to end (Map maintains insertion order)
  if (antiCache.has(key)) {
    antiCache.delete(key);
  }
  
  // Enforce size limit using Map's inherent FIFO order
  // Map.keys().next() gives us the first (oldest) entry
  while (antiCache.size >= ANTI_CACHE_MAX_SIZE) {
    const oldestKey = antiCache.keys().next().value;
    if (oldestKey) {
      antiCache.delete(oldestKey);
    } else {
      break;
    }
  }
  
  antiCache.set(key, { message, time: Date.now() });
}

  // --- FULL MESSAGE HANDLER ---
  conn.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const mek of messages) {

      if (!mek.message) continue;

      // Push to dashboard WebSocket clients
      try {
        const _chatId = mek.key?.remoteJid;
        const _body = mek.message?.conversation || mek.message?.extendedTextMessage?.text || mek.message?.imageMessage?.caption || mek.message?.videoMessage?.caption || '';
        broadcastWs({ type: 'new_message', chatId: _chatId, message: { id: mek.key?.id, body: _body, fromMe: mek.key?.fromMe, pushName: mek.pushName || '', timestamp: mek.messageTimestamp ? mek.messageTimestamp * 1000 : Date.now(), msgType: Object.keys(mek.message || {})[0] } });
      } catch (_) {}

      const { remoteJid, id } = mek.key || {};
    if (remoteJid && id && mek.message) {
      addToAntiCache(`${remoteJid}_${id}`, mek.message);
    }

    // Check for view-once wrappers
    if (mek.message.viewOnceMessage || mek.message.viewOnceMessageV2) {
      const viewOnceMsg = mek.message.viewOnceMessageV2 || mek.message.viewOnceMessage;
    }

      mek.message = (getContentType(mek.message) === 'ephemeralMessage')
        ? mek.message.ephemeralMessage.message
        : mek.message;

// --- Global pendingReplies dispatcher ---
if (mek.message?.extendedTextMessage?.contextInfo) {
  const ctx = mek.message.extendedTextMessage.contextInfo;

  // Baileys sometimes uses stanzaId, sometimes quotedMessage.stanzaId
  const quotedId = ctx.stanzaId;

  if (quotedId && pendingReplies[quotedId]) {
    try {
      await pendingReplies[quotedId](mek);
    } catch (e) {
      console.error("Prompt reply error:", e);
    }
    delete pendingReplies[quotedId];
    return;
  }
}


function registerPrompt(sent, handler, ttl = 60_000) {
  // sent.key.id is the message ID of the prompt
  const id = sent.key.id;
  pendingReplies[id] = handler;

  // Auto-expire after TTL
  setTimeout(() => {
    delete pendingReplies[id];
  }, ttl);
}

async function checkPendingReply(mek) {
  const ctx = mek.message?.extendedTextMessage?.contextInfo;
  if (!ctx) return false;

  // Quoted message ID (the one being replied to)
  const quotedId = ctx.stanzaId;
  if (!quotedId) return false;

  const handler = pendingReplies[quotedId];
  if (handler) {
    try {
      await handler(mek);
    } catch (e) {
      console.error("Prompt reply error:", e);
    }
    delete pendingReplies[quotedId];
    return true;
  }
  return false;
}
      if (mek.key && mek.key.remoteJid === 'status@broadcast' && config2.AUTO_READ_STATUS === true) {
        await conn.readMessages([mek.key]);
      }
      if (mek.key && mek.key.remoteJid === 'status@broadcast' && config2.AUTO_STATUS_REPLY === true) {
        const user = mek.key.participant;
        const v11 = `${config2.AUTO_STATUS_MSG}`;
        await conn.sendMessage(user, { text: v11 }, { quoted: mek });
        await conn.sendMessage(user, { react: { text: '❤', key: mek.key } });
      }
      if (mek.key && mek.key.remoteJid === 'status@broadcast' && config2.AUTO_STATUS_LIKE == "on") {
        const v12 = mek.key.participant;
        await conn.sendMessage(v12, {
          react: { 
             text: "💙", 
             key: mek.key 
             }
          }, 
           { 
           quoted: mek 
           }
         );
      }
      
     

      const m = sms(conn, mek);

      // Keep quoted variable as requested - with safe access
      const mtype = getContentType(mek.message);
      const quoted =
        (mtype === 'extendedTextMessage' && mek.message?.extendedTextMessage?.contextInfo?.quotedMessage)
          ? mek.message.extendedTextMessage.contextInfo.quotedMessage
          : [];

      const body =
        (mtype === 'conversation' && mek.message?.conversation) ? mek.message.conversation :
        (mtype === 'extendedTextMessage' && mek.message?.extendedTextMessage?.text) ? mek.message.extendedTextMessage.text :
        (mtype === 'imageMessage' && mek.message?.imageMessage?.caption) ? mek.message.imageMessage.caption :
        (mtype === 'videoMessage' && mek.message?.videoMessage?.caption) ? mek.message.videoMessage.caption : '';
      
      const multiPrefixEnabled = global.MULTI_PREFIX === true || global.MULTI_PREFIX === "true" || config2.MULTI_PREFIX === true || config2.MULTI_PREFIX === "true";
      const activePrefix = global.prefix || prefix;
      const { isCmd, cmdName, prefixUsed } = parseCommand(body || '', activePrefix, multiPrefixEnabled);
      const args = (body || '').trim().split(/ +/).slice(1);
      const q = args.join(' ');
      const from = mek.key?.remoteJid || '';
      if (!from) return;
      const isGroup = from.endsWith('@g.us');
      const isNewsletter = from.endsWith('@newsletter');
      const groupMetadata = isGroup ? await conn.groupMetadata(from).catch(e => null) : null;
      const groupName = groupMetadata?.subject || '';
      const participants = groupMetadata?.participants || [];
      const groupAdmins = isGroup && participants.length ? getGroupAdmins(participants) : [];
      // For newsletters the participant field carries the admin's JID; fall back to bot JID if fromMe
      const sender = mek.key?.fromMe ? (conn.user?.id?.split(':')[0] + '@s.whatsapp.net' || conn.user?.id || '') : (mek.key?.participant_pn || mek.key?.participant || (!isNewsletter ? mek.key?.remoteJid : '') || '');
      const senderNumber = sender.split('@')[0] || '';
      const botNumber = conn.user?.id?.split(':')[0] || '';
      // Normalized bot JID: strip :device suffix (e.g. 27821234567:0 → 27821234567)
      const _rawBotJid = (conn.user?.id?.split(':')[0] || '') + '@s.whatsapp.net';
      const botNumber2 = (typeof jidNormalizedUser === 'function'
        ? jidNormalizedUser(conn.user?.id || '') || _rawBotJid
        : _rawBotJid);
      const pushname = mek.pushName || mek.key?.pushName || mek.verifiedBizName ||'Unkown';
      const isMe = botNumber && senderNumber ? botNumber.includes(senderNumber) : false;
      // Read owner/sudo from live config2 (updated by envEventBus on every .set call)
      // Falls back to module-level statics from config file if config2 not yet populated
      const _liveOwner = config2.OWNER_NUMBER || owner;
      const _liveSudo  = Array.isArray(config2.SUDOS)
        ? config2.SUDOS
        : String(config2.SUDOS || '').split(',').map(s => s.trim()).filter(Boolean);
      const isOwner = (Array.isArray(_liveOwner)
        ? _liveOwner.some(n => String(n) === senderNumber)
        : String(_liveOwner || '').split(',').map(s => s.trim()).some(n => n === senderNumber)
      ) || isMe;
      const isSudo = _liveSudo.includes(senderNumber);
      const creator = OWNERS.includes(senderNumber);
      // LID-safe admin checks — use Baileys areJidsSameUser (compares jidDecode().user)
      // so @lid and @s.whatsapp.net are treated as equal; fallback to number string match
      // Strip :device suffix before digit extraction so 27821234567:0 → 27821234567
      const _numOf = id => (id || '').split('@')[0].split(':')[0].replace(/[^\d]/g, '');
      const _sameUser = (a, b) =>
        (typeof areJidsSameUser === 'function' && areJidsSameUser(a, b)) || _numOf(a) === _numOf(b);
      const _adminParticipants = isGroup
        ? participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin')
        : [];
      const groupAdminNumbers = _adminParticipants.map(p => _numOf(p.id || ''));
      const _botLid = conn.user?.lid || '';
      const isBotAdmins = isGroup
        ? _adminParticipants.some(p => {
            const pId  = p.id  || '';
            const pJid = p.jid || '';
            // Direct LID match via conn.user.lid
            if (_botLid && (pId === _botLid || pJid === _botLid)) return true;
            // JID match on both id and jid fields
            return _sameUser(pId, botNumber2) || _sameUser(pJid, botNumber2);
          })
        : false;
      const isAdmins = isGroup
        ? _adminParticipants.some(p =>
            _sameUser(p.id || '', sender) || _sameUser(p.jid || '', sender)
          )
        : false;
      const isReact = m.message?.reactionMessage ? true : false;
      const mimet = (typeof quoted === 'object' && quoted !== null && (quoted.msg || quoted)?.mimetype) || '';
      let viewOnceMsg = mek.message.viewOnceMessageV2 || mek.message.viewOnceMessage;

  if (viewOnceMsg && (config2.ANTI_VV === true || config2.ANTI_VV === "true")) {
    const realMsg = viewOnceMsg.message;
    const msgType = Object.keys(realMsg)[0]; // e.g. "imageMessage", "videoMessage", "audioMessage"
    const content = realMsg[msgType];

    // download using your helper
    const file = await conn.downloadAndSaveMediaMessage(content);

    // send back based on type
    if (msgType === "imageMessage") {
      const cap = content.caption || '';
      await conn.sendMessage(from, { image: { url: file.path }, caption: cap }, { quoted: mek });
    } else if (msgType === "videoMessage") {
      const cap = content.caption || '';
      await conn.sendMessage(from, { video: { url: file.path }, caption: cap }, { quoted: mek });
    } else if (msgType === "audioMessage") {
      await conn.sendMessage(from, { audio: { url: file.path } }, { quoted: mek });
    } else {
      // fallback: just send the raw file if it’s some other type
      await conn.sendMessage(from, { document: { url: file.path }, mimetype: file.mimetype, fileName: file.filename }, { quoted: mek });
    }

    // optional: clean up temp file
    try { await fs.promises.unlink(file.path); } catch {}
  }


if (isGroup) {
  const deleted = await enforceMute(conn, mek, from, sender);
  if (deleted) return;
}

// ── ANTI_TAG gate ─────────────────────────────────────────────────────────
// Block any message that mentions/tags the bot unless sender is privileged
const _antiTagEnabled = global.ANTI_TAG === true || global.ANTI_TAG === 'on' || config2.ANTI_TAG === true || config2.ANTI_TAG === 'on';
if (_antiTagEnabled && !isMe && !isOwner && !isSudo && !creator) {
  const _ctxMentioned = mek.message?.extendedTextMessage?.contextInfo?.mentionedJid
    || mek.message?.imageMessage?.contextInfo?.mentionedJid
    || mek.message?.videoMessage?.contextInfo?.mentionedJid
    || [];
  const _botJid = botNumber + '@s.whatsapp.net';
  const _botMentioned = _ctxMentioned.some(j => j === _botJid || j?.split(':')[0] === botNumber);
  if (_botMentioned) return; // silently ignore — do not process the message
}
// ─────────────────────────────────────────────────────────────────────────

      // --- Helpers with contextInfo ---
      const adReplyCtx = (name, thumb) => ({
        forwardingScore: 999,
        isForwarded: true,
        mentionedJid: [sender],
        forwardedNewsletterMessageInfo: {
          newsletterJid: DS_ID,
          newsletterName: DS_NAME,
          serverMessageId: 1399
        },
        externalAdReply: {
          title: name || groupName || pushname || BASIL,
          body: footer,
          sourceUrl: DS_LINK,
          mediaType: 1,
          showAdAttribution: false,
          renderLargerThumbnail: false,
          thumbnailUrl: thumb || BASIL_IMG
        }
      });

      const adReplyCtx1 = (name, thumb) => ({
        forwardingScore: 999,
        isForwarded: true,
        mentionedJid: [sender],
        forwardedNewsletterMessageInfo: {
          newsletterJid: DS_ID,
          newsletterName: DS_NAME,
          serverMessageId: 1399
        },
        externalAdReply: {
          title: name || groupName || pushname || BASIL,
          body: footer,
          sourceUrl: DS_LINK,
          mediaType: 1,
          showAdAttribution: false,
          renderLargerThumbnail: true,
          thumbnailUrl: thumb || BASIL_IMG
        }
      });
      
      const reply = (teks) => conn.sendMessage(from, { text: teks, contextInfo: adReplyCtx(groupName, BASIL_IMG) }, { quoted: mek });
const sendC = (teks, user, thumb, name, qut = mek ) =>
  conn.sendMessage(from, { text: teks, mentions: [user || sender], contextInfo: adReplyCtx(name || groupName, thumb || BASIL_IMG) }, { quoted: qut });
const sendA = async (id, audioUrl, name = 'audio', asDocument = false, pt1 = false, thumb, adname, quot3 = mek) => {
  const target = id || from;
  try {
    // Direct send for remote URLs
    if (typeof audioUrl === 'string' && /^https?:\/\//i.test(audioUrl)) {
      if (asDocument) {
        return originalSendMessage(target, {
          document: {url: audioUrl},
          mimetype: 'audio/mpeg',
          fileName: name + '.mp3',
          caption: name,
          contextInfo: adReplyCtx1(adname || groupName, thumb || BASIL_IMG)
        }, { quoted: quot3 });
      } else {
        return originalSendMessage(target, {
          audio: {url: audioUrl},
          mimetype: 'audio/mpeg',
          ptt: pt1,
          contextInfo: adReplyCtx1(adname || groupName, thumb || BASIL_IMG)
        }, { quoted: quot3 });
      }
    }

    // If audioUrl is a local file path, stream it and show upload progress
    if (typeof audioUrl === 'string' && fs.existsSync(audioUrl)) {
      const progressMsg = await conn.sendMessage(target, { text: `⏫ Uploading ${name}: 0%` }, { quoted: quot3 });
      const stats = fs.statSync(audioUrl);
      const totalSize = stats.size || 0;
      const fileStream = fs.createReadStream(audioUrl);
      const { PassThrough } = await import('stream');
      const pt = new PassThrough();
      let uploaded = 0;
      fileStream.on('data', (chunk) => {
        uploaded += chunk.length;
        const upPercent = totalSize ? Math.floor((uploaded / totalSize) * 100) : null;
        try { conn.sendMessage(target, { text: `${renderProgress(upPercent, { frames: global.DOWNLOAD_PROGRESS_FRAMES })} - uploading ${name}` }, { edit: progressMsg.key }); } catch(e){}
      });
      fileStream.pipe(pt);

      if (asDocument) {
        const sent = await conn.sendMessage(target, {
          document: pt,
          mimetype: 'audio/mpeg',
          fileName: name + '.mp3',
          caption: name,
          contextInfo: adReplyCtx1(adname || groupName, thumb || BASIL_IMG)
        }, { quoted: quot3 });
        try { await conn.sendMessage(target, { text: `✅ Sent ${name}` }, { edit: progressMsg.key }); } catch(e){}
        return sent;
      } else {
        const sent = await conn.sendMessage(target, {
          audio: pt,
          mimetype: 'audio/mpeg',
          ptt: pt1,
          contextInfo: adReplyCtx1(adname || groupName, thumb || BASIL_IMG)
        }, { quoted: quot3 });
        try { await conn.sendMessage(target, { text: `✅ Sent ${name}` }, { edit: progressMsg.key }); } catch(e){}
        return sent;
      }
    }
  } catch (e) {
    console.error('[sendA local upload]', e);
    try { await conn.sendMessage(target, { text: `❌ Failed to send audio: ${e.message || 'Unknown error'}` }, { quoted: quot3 }); } catch(ex){}
    return;
  }
  // No valid URL or local file matched
  try { await conn.sendMessage(target, { text: `❌ Invalid audio source. Provide a valid URL or file path.` }, { quoted: quot3 }); } catch(e){}
};
const sendV = async (id, videoUrl, name = 'video', asDocument = false, pt = false, thumb, adname, quot1 = mek) => {
  const target = id || from;
  try {
    // Direct send for remote URLs
    if (typeof videoUrl === 'string' && /^https?:\/\//i.test(videoUrl)) {
      if (asDocument) {
        return originalSendMessage(target, {
          document: {url: videoUrl},
          mimetype: 'video/mp4',
          fileName: name + '.mp4',
          caption: name,
          contextInfo: adReplyCtx1(adname || groupName, thumb || BASIL_IMG)
        }, { quoted: quot1 });
      } else {
        return originalSendMessage(target, {
          video: {url: videoUrl},
          caption: name,
          mimetype: 'video/mp4',
          ptv: pt,
          contextInfo: adReplyCtx1(adname || groupName, thumb || BASIL_IMG)
        }, { quoted: quot1 });
      }
    }
  } catch (err) {
    console.error('[sendV]', err);
  }

  // If videoUrl points to a local file, stream it with upload progress
  try {
    if (typeof videoUrl === 'string' && fs.existsSync(videoUrl)) {
      const progressMsg2 = await conn.sendMessage(target, { text: `⏫ Uploading ${name}: 0%` }, { quoted: quot1 });
      const stats2 = fs.statSync(videoUrl);
      const totalV2 = stats2.size || 0;
      const fileStreamV2 = fs.createReadStream(videoUrl);
      const { PassThrough: PassThroughV2 } = await import('stream');
      const ptV2 = new PassThroughV2();
      let uploadedV2 = 0;
      fileStreamV2.on('data', (chunk) => {
        uploadedV2 += chunk.length;
        const upPercent = totalV2 ? Math.floor((uploadedV2 / totalV2) * 100) : null;
        try { conn.sendMessage(target, { text: `${renderProgress(upPercent, { frames: global.DOWNLOAD_PROGRESS_FRAMES })} - uploading ${name}` }, { edit: progressMsg2.key }); } catch(e){}
      });
      fileStreamV2.pipe(ptV2);

      let sent2;
      if (asDocument) {
        sent2 = await conn.sendMessage(target, {
          document: ptV2,
          mimetype: 'video/mp4',
          fileName: name + '.mp4',
          caption: name,
          contextInfo: adReplyCtx1(adname || groupName, thumb || BASIL_IMG)
        }, { quoted: quot1 });
      } else {
        sent2 = await conn.sendMessage(target, {
          video: ptV2,
          mimetype: 'video/mp4',
          ptv: pt,
          contextInfo: adReplyCtx1(adname || groupName, thumb || BASIL_IMG)
        }, { quoted: quot1 });
      }
      try { await conn.sendMessage(target, { text: `✅ Sent ${name}` }, { edit: progressMsg2.key }); } catch(e){}
      try { fs.unlinkSync(videoUrl); } catch(e){}
      return sent2;
    }
  } catch (e) {
    console.error('[sendV local upload]', e);
    try { await conn.sendMessage(target, { text: `❌ Failed to send video: ${e.message || 'Unknown error'}` }, { quoted: quot1 }); } catch(ex){}
    return;
  }
  // No valid URL or local file matched
  try { await conn.sendMessage(target, { text: `❌ Invalid video source. Provide a valid URL or file path.` }, { quoted: quot1 }); } catch(e){}
};

      const sendI = async (id, imageUrl, caption = '', thumb, adname, quot1 = mek) => {
        return conn.sendMessage(id || from, {
          image: {url: imageUrl},
          caption: caption,
          contextInfo: adReplyCtx1(adname || groupName, thumb || BASIL_IMG)
        }, { quoted: quot1 });
      };

      conn.sendAlbumMessage = async (jid, mediaArray, options = {}) => {
        const { quoted, delay = 1500, contextInfo } = options;
        const results = [];
        
        for (let i = 0; i < mediaArray.length; i++) {
          const media = mediaArray[i];
          let messageContent = {};
          
          if (media.image) {
            messageContent = { 
              image: typeof media.image === 'string' ? { url: media.image } : media.image, 
              caption: media.caption || '' 
            };
          } else if (media.video) {
            messageContent = { 
              video: typeof media.video === 'string' ? { url: media.video } : media.video, 
              caption: media.caption || '',
              mimetype: 'video/mp4'
            };
          } else if (media.audio) {
            messageContent = {
              audio: typeof media.audio === 'string' ? { url: media.audio } : media.audio,
              mimetype: 'audio/mpeg',
              ptt: media.ptt || false
            };
          } else if (media.document) {
            messageContent = {
              document: typeof media.document === 'string' ? { url: media.document } : media.document,
              mimetype: media.mimetype || 'application/octet-stream',
              fileName: media.fileName || 'file',
              caption: media.caption || ''
            };
          }
          
          if (contextInfo) {
            messageContent.contextInfo = contextInfo;
          }
          
          if (Object.keys(messageContent).length > 0) {
            try {
              const result = await conn.sendMessage(jid, messageContent, { 
                quoted: i === 0 ? quoted : undefined 
              });
              results.push(result);
              
              if (i < mediaArray.length - 1 && delay > 0) {
                await new Promise(r => setTimeout(r, delay));
              }
            } catch (err) {
              console.error(`[sendAlbumMessage] Failed to send media ${i + 1}:`, err.message);
            }
          }
        }
        return results;
      };

      if (isCmd && cmdName) {
  const banResult = await banCheck(conn, from, sender, isGroup, sendC);
  if (banResult.banned) {
    // Group banned → total silence
    if (banResult.type === 'group') return;

    // User banned (global or local)
    if (banResult.type === 'global' || banResult.type === 'local') {
      // If DM → silent
      if (!isGroup) return;

      // If group → optionally warn
      const notifyConfig = await (await import('../plugins/ban.js')).getBanConfig('notifyBannedUsersInGroups');
      if (notifyConfig) {
        return sendC(
          `╔═══「 🚫 *ʙᴀɴɴᴇᴅ* 」═══╗\n║\n║  *${pushname}*, you are\n║  banned from this bot!\n║\n║  📄 *Reason:* ${banResult.reason || 'No reason'}\n║  👉 Contact the owner to\n║  request an unban.\n║\n╚═══════════════════════╝`,
          sender
        );
      }
      return; // silent if OFF
    }
  }

 // Free user in DM → enforce warnings/auto-ban
  if (await enforceFreeUserDM(conn, from, sender, isGroup, sendC)) {
  return; // handled
}

  // ... proceed with normal command execution
}


if (isCmd && cmdName) {
  // Completely bypass cooldowns for privileged users: owner, sudo, creator (isMe)
  const isPrivileged = isMe || isOwner || isSudo || creator;
  
  if (!isPrivileged) {
    // Only apply cooldowns to regular users
    const cooldownRes = await cooldowns.checkAndUpdateCooldown(senderNumber, cmdName, 5, 3);
    if (cooldownRes.banned) {
      const mins = Math.ceil((cooldownRes.banUntil - Date.now()) / 60000);
      return sendC(`╔═══「 🚫 *ʀᴀᴛᴇ ʟɪᴍɪᴛ* 」═══╗\n║\n║  *${pushname}*, you've been\n║  temporarily blocked!\n║\n║  🕒 *Unblocked in:* ${mins} min(s)\n║  📌 *Command:* ${cmdName}\n║  ⚠️ Reason: Too many rapid uses\n║\n╚════════════════════════════╝`);
    }
    if (cooldownRes.rateLimited && cooldownRes.reason === 'daily_limit_exceeded') {
      const hours = Math.ceil(cooldownRes.remaining / 3600);
      return sendC(`╔═══「 📊 *ᴅᴀɪʟʏ ʟɪᴍɪᴛ* 」═══╗\n║\n║  Hey *${pushname}*!\n║  You've used all your daily\n║  free commands.\n║\n║  ⏳ *Resets in:* ${hours}h\n║  💎 Upgrade to premium for\n║  unlimited commands!\n║\n╚════════════════════════════╝`);
    }
    if (cooldownRes.cooldown) {
      const secs = Math.ceil((cooldownRes.cooldownUntil - Date.now()) / 1000);
      return sendC(`╔═══「 ⏳ *ᴄᴏᴏʟᴅᴏᴡɴ* 」═══╗\n║\n║  Slow down, *${pushname}*!\n║\n║  🕒 *Wait:* ${secs}s\n║  📌 *Command:* ${cmdName}\n║\n╚════════════════════════════╝`);
    }
  }
}


      
conn.sendFileUrl = async (jid, url, caption, quoted, options = {}) => {
  let res = await axios.head(url);
  let mime = res.headers['content-type'];

  // Set name: BASIL > groupName > pushname
  const name = BASIL || groupName || pushname;

  // Set thumbnail: BASIL_IMG only
  const thumb = BASIL_IMG;

  // Build contextInfo using your adReplyCtx helper
  const contextInfo = adReplyCtx(name, thumb);

  // GIFs sent as videos with gifPlayback
  if (mime.split("/")[1] === "gif") {
    return conn.sendMessage(jid, {
      video: await getBuffer(url),
      caption,
      gifPlayback: true,
      contextInfo,
      ...options
    }, { quoted, ...options });
  }
  // PDF
  if (mime === "application/pdf") {
    return conn.sendMessage(jid, {
      document: await getBuffer(url),
      mimetype: 'application/pdf',
      caption,
      contextInfo,
      ...options
    }, { quoted, ...options });
  }
  // Image
  if (mime.split("/")[0] === "image") {
    return conn.sendMessage(jid, {
      image: await getBuffer(url),
      caption,
      contextInfo,
      ...options
    }, { quoted, ...options });
  }
  // Video
  if (mime.split("/")[0] === "video") {
    return conn.sendMessage(jid, {
      video: await getBuffer(url),
      caption,
      mimetype: 'video/mp4',
      contextInfo,
      ...options
    }, { quoted, ...options });
  }
  // Audio
  if (mime.split("/")[0] === "audio") {
    return conn.sendMessage(jid, {
      audio: await getBuffer(url),
      caption,
      mimetype: 'audio/mpeg',
      contextInfo,
      ...options
    }, { quoted, ...options });
  }
  // Fallback: document
  return conn.sendMessage(jid, {
    document: await getBuffer(url),
    mimetype: mime,
    caption,
    contextInfo,
    ...options
  }, { quoted, ...options });
};
 
 
conn.decodeJid = jid => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      let decode = jidDecode(jid) || {};
      return (
        (decode.user &&
          decode.server &&
          decode.user + '@' + decode.server) ||
        jid
      );
    } else return jid;
  };
  //===================================================
  conn.copyNForward = async (jid, message, forceForward = false, options = {}) => {
  // If reading a view-once message, unwrap it
  if (options.readViewOnce) {
    // Unwrap ephemeral (disappearing) messages if present
    if (message.message && message.message.ephemeralMessage) {
      message.message = message.message.ephemeralMessage.message;
    }
    // Unwrap view-once message if present
    if (message.message && message.message.viewOnceMessage) {
      const vmsg = message.message.viewOnceMessage.message;
      const vtype = Object.keys(vmsg)[0];
      // Remove the viewOnce flag
      if (vmsg[vtype]?.viewOnce) delete vmsg[vtype].viewOnce;
      message.message = vmsg;
    }
  }

  // Prepare content and context
  const mtype = Object.keys(message.message)[0];
  const content = await generateForwardMessageContent(message, forceForward);
  const ctype = Object.keys(content)[0];
  let context = {};
  if (mtype !== 'conversation' && message.message[mtype].contextInfo) {
    context = message.message[mtype].contextInfo;
  }
  content[ctype].contextInfo = {
    ...context,
    ...content[ctype].contextInfo
  };

  // Generate new message and send
  const waMessage = await generateWAMessageFromContent(
    jid,
    content,
    options
      ? {
          ...content[ctype],
          ...options,
          ...(options.contextInfo
            ? { contextInfo: { ...content[ctype].contextInfo, ...options.contextInfo } }
            : {})
        }
      : {}
  );
  await conn.relayMessage(jid, waMessage.message, { messageId: waMessage.key.id });
  return waMessage;
};
      

conn.downloadAndSaveMediaMessage = async (message, filename, opts = {}) => {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1500;
  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB limit
  const DOWNLOAD_TIMEOUT = 60000; // 60 seconds
  
  const { attachExtension = true } = opts;
  
  // Ensure save directory exists
  if (!fs.existsSync(SAVED_DIR)) {
    fs.mkdirSync(SAVED_DIR, { recursive: true });
  }

  // Validate message object upfront
  if (!message) {
    throw new Error('Invalid message object: message is null or undefined');
  }
  
  let quoted = message.msg ? message.msg : message;
  let mime = (message.msg || message).mimetype || '';
  
  if (!quoted) {
    throw new Error('No downloadable content found in message');
  }
  
  // Detect message type with fallback
  let messageType = message.mtype 
    ? message.mtype.replace(/Message/gi, '') 
    : (mime.split('/')[0] || 'document');
  
  let lastError = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let timeoutId = null;
    
    try {
      // Download as buffer with timeout
      let buffer = Buffer.from([]);
      
      const downloadPromise = (async () => {
        const stream = await downloadContentFromMessage(quoted, messageType);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
          if (buffer.length > MAX_FILE_SIZE) {
            throw new Error(`File exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB limit`);
          }
        }
        return buffer;
      })();
      
      // Timeout with cleanup
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Download timeout')), DOWNLOAD_TIMEOUT);
      });
      
      buffer = await Promise.race([downloadPromise, timeoutPromise]);
      clearTimeout(timeoutId);
      
      if (!buffer || buffer.length === 0) {
        throw new Error('Downloaded content is empty');
      }
      
      // Detect extension and mimetype
      let type = await fileTypeFromBuffer(buffer);
      let ext = type ? `.${type.ext}` : '';
      let detectedMime = type ? type.mime : mime;
      
      // Fallback extension from mime
      if (!ext && mime) {
        const mimeExt = mime.split('/')[1];
        if (mimeExt) ext = `.${mimeExt.split(';')[0]}`;
      }

      // Determine base name with sanitization
      let baseName = filename && typeof filename === 'string' && filename.trim()
        ? path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.[^.]+$/, '').substring(0, 100)
        : `${messageType}_${Date.now()}`;
      
      // Final filename
      let finalName = attachExtension && ext ? baseName + ext : baseName;
      let savePath = path.join(SAVED_DIR, finalName);
      
      // Handle duplicates
      if (fs.existsSync(savePath)) {
        finalName = `${baseName}_${Date.now()}${ext}`;
        savePath = path.join(SAVED_DIR, finalName);
      }
      
      // Write and verify
      fs.writeFileSync(savePath, buffer);
      
      return {
        path: savePath,
        filename: finalName,
        mimetype: detectedMime,
        size: buffer.length,
        ext: ext
      };
      
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      lastError = err;
      console.error(`downloadAndSaveMediaMessage attempt ${attempt}/${MAX_RETRIES}:`, err.message);
      
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY * attempt);
      }
    }
  }
  
  // Always throw on failure to maintain expected behavior
  console.error('downloadAndSaveMediaMessage failed after all retries:', lastError);
  throw lastError;
};

conn.sendButtonText = async (jid, buttons = [], text, footer, quoted = '', options = {}) => {
  // Convert legacy button format to native flow format
  const formatButton = (btn, i) => {
    if (btn.name && btn.buttonParamsJson) return btn;
    if (btn.id && btn.text) return btn;
    if (btn.buttonId && btn.buttonText) {
      return { id: btn.buttonId, text: btn.buttonText.displayText || btn.buttonText };
    }
    return btn;
  };
  
  const formattedButtons = buttons.map(formatButton);
  
  // Method 1: Try gifted-btns sendBasilButtons
  try {
    const { sendBasilButtons } = await import('../lib/basilButtonHandler.js');
    await sendBasilButtons(conn, jid, { text, footer, buttons: formattedButtons });
    return;
  } catch (e) { /* continue to fallback */ }
  
  // Method 2: Proto-based template message with proper header
  try {
    const hydratedButtons = formattedButtons.map((btn, i) => ({
      index: i + 1,
      quickReplyButton: {
        displayText: btn.text || btn.buttonText?.displayText || `Option ${i + 1}`,
        id: btn.id || btn.buttonId || `btn_${i}`
      }
    }));
    
    const template = generateWAMessageFromContent(jid, proto.Message.fromObject({
      templateMessage: {
        hydratedTemplate: {
          hydratedContentText: text,
          hydratedFooterText: footer,
          hydratedButtons: hydratedButtons
        }
      }
    }), { quoted: quoted || undefined, ...options });
    
    await conn.relayMessage(jid, template.message, { messageId: template.key.id });
    return;
  } catch (e) { /* continue to fallback */ }
  
  // Method 3: Plain text fallback
  const textButtons = buttons.map((btn, i) => 
    `${i + 1}. ${btn.text || btn.buttonText?.displayText || 'Option'}`
  ).join('\n');
  await conn.sendMessage(jid, { 
    text: `${text}\n\n${textButtons}\n\n${footer}` 
  }, { quoted: quoted || undefined });
};

conn.send5ButImg = async (jid, text = '', footer = '', img, but = [], thumb, options = {}) => {
  // Prepare media first for all methods
  let mediaMessage;
  try {
    const imageSource = Buffer.isBuffer(img) ? img : { url: img };
    mediaMessage = await prepareWAMessageMedia({ 
      image: imageSource, 
      jpegThumbnail: thumb 
    }, { upload: conn.waUploadToServer });
  } catch (prepErr) {
    console.error('[send5ButImg] Media preparation failed:', prepErr.message);
    await conn.sendMessage(jid, { text: `${text}\n\n${footer}` }, options);
    return;
  }
  
  // Format buttons to hydrated format
  const hydratedButtons = but.map((btn, i) => {
    if (btn.quickReplyButton) {
      return { index: i + 1, quickReplyButton: btn.quickReplyButton };
    }
    if (btn.urlButton) {
      return { index: i + 1, urlButton: btn.urlButton };
    }
    if (btn.callButton) {
      return { index: i + 1, callButton: btn.callButton };
    }
    if (btn.id && btn.text) {
      return { index: i + 1, quickReplyButton: { displayText: btn.text, id: btn.id } };
    }
    return btn;
  });
  
  // Send with template message
  try {
    const template = generateWAMessageFromContent(jid, proto.Message.fromObject({
      templateMessage: {
        hydratedTemplate: {
          imageMessage: mediaMessage.imageMessage,
          hydratedContentText: text,
          hydratedFooterText: footer,
          hydratedButtons: hydratedButtons
        }
      }
    }), options);
    await conn.relayMessage(jid, template.message, { messageId: template.key.id });
  } catch (err) {
    console.error('[send5ButImg] Template failed:', err.message);
    // Fallback: image with caption
    await conn.sendMessage(jid, { 
      image: mediaMessage.imageMessage || img, 
      caption: `${text}\n\n${footer}` 
    }, options);
  }
}
  

async function sendCopyButton(conn, jid, tit, text, footer, display = "📋 Copy") {
  const msg = generateWAMessageFromContent(jid, {
    viewOnceMessage: {
      message: {
        messageContextInfo: {
          deviceListMetadata: {},
          deviceListMetadataVersion: 2
        },
        interactiveMessage: proto.Message.InteractiveMessage.create({
          body: proto.Message.InteractiveMessage.Body.create({ text }),
          footer: proto.Message.InteractiveMessage.Footer.create({ text: footer }),
          header: proto.Message.InteractiveMessage.Header.create({
            title: tit,
            hasMediaAttachment: false
          }),
          nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
            buttons: [
              {
                name: "cta_copy",
                buttonParamsJson: JSON.stringify({
                  display_text: display,
                  id: "copy_btn",
                  copy_code: text
                })
              }
            ]
          })
        })
      }
    }
  }, {});

  await conn.relayMessage(msg.key.remoteJid, msg.message, { messageId: msg.key.id });
  return msg;
}


 const reactions = ['😊', '👍', '😂', '💯', '🔥', '🙏', '🎉', '👏', '😎', '🤖', '👫', '👭', '👬', '👮', "🕴️", '💼', '📊', '📈', '📉', '📊', '📝', '📚', '📰', '📱', '💻', '📻', '📺', '🎬', "📽️", '📸', '📷', "🕯️", '💡', '🔦', '🔧', '🔨', '🔩', '🔪', '🔫', '👑', '👸', '🤴', '👹', '🤺', '🤻', '👺', '🤼', '🤽', '🤾', '🤿', '🦁', '🐴', '🦊', '🐺', '🐼', '🐾', '🐿', '🦄', '🦅', '🦆', '🦇', '🦈', '🐳', '🐋', '🐟', '🐠', '🐡', '🐙', '🐚', '🐜', '🐝', '🐞', "🕷️", '🦋', '🐛', '🐌', '🐚', '🌿', '🌸', '💐', '🌹', '🌺', '🌻', '🌴', '🏵', '🏰', '🏠', '🏡', '🏢', '🏣', '🏥', '🏦', '🏧', '🏨', '🏩', '🏪', '🏫', '🏬', '🏭', '🏮', '🏯', '🚣', '🛥', '🚂', '🚁', '🚀', '🛸', '🛹', '🚴', '🚲', '🛺', '🚮', '🚯', '🚱', '🚫', '🚽', "🕳️", '💣', '🔫', "🕷️", "🕸️", '💀', '👻', '🕺', '💃', "🕴️", '👶', '👵', '👴', '👱', '👨', '👩', '👧', '👦', '👪', '👫', '👭', '👬', '👮', "🕴️", '💼', '📊', '📈', '📉', '📊', '📝', '📚', '📰', '📱', '💻', '📻', '📺', '🎬', "📽️", '📸', '📷', "🕯️", '💡', '🔦', '🔧', '🔨', '🔩', '🔪', '🔫', '👑', '👸', '🤴', '👹', '🤺', '🤻', '👺', '🤼', '🤽', '🤾', '🤿', '🦁', '🐴', '🦊', '🐺', '🐼', '🐾', '🐿', '🦄', '🦅', '🦆', '🦇', '🦈', '🐳', '🐋', '🐟', '🐠', '🐡', '🐙', '🐚', '🐜', '🐝', '🐞', "🕷️", '🦋', '🐛', '🐌', '🐚', '🌿', '🌸', '💐', '🌹', '🌺', '🌻', '🌴', '🏵', '🏰', '🏠', '🏡', '🏢', '🏠', '🏡', '🏢', '🏣', '🏥', '🏦', '🏧', '🏨', '🏩', '🏪', '🏫', '🏬', '🏭', '🏮', '🏯', '🚣', '🛥', '🚂', '🚁', '🚀', '🛸', '🛹', '🚴', '🚲', '🛺', '🚮', '🚯', '🚱', '🚫', '🚽', "🕳️", '💣', '🔫', "🕷️", "🕸️", '💀', '👻', '🕺', '💃', "🕴️", '👶', '👵', '👴', '👱', '👨', '👩', '👧', '👦', '👪', '👫', '👭', '👬', '👮', "🕴️", '💼', '📊', '📈', '📉', '📊', '📝', '📚', '📰', '📱', '💻', '📻', '📺', '🎬', "📽️", '📸', '📷', "🕯️", '💡', '🔦', '🔧', '🔨', '🔩', '🔪', '🔫', '👑', '👸', '🤴', '👹', '🤺', '🤻', '👺', '🤼', '🤽', '🤾', '🤿', '🦁', '🐴', '🦊', '🐺', '🐼', '🐾', '🐿', '🦄', '🦅', '🦆', '🦇', '🦈', '🐳', '🐋', '🐟', '🐠', '🐡', '🐙', '🐚', '🐜', '🐝', '🐞', "🕷️", '🦋', '🐛', '🐌', '🐚', '🌿', '🌸', '💐', '🌹', '🌺', '🌻', '🌴', '🏵', '🏰', '🏠', '🏡', '🏢', '🏣', '🏥', '🏦', '🏧', '🏨', '🏩', '🏪', '🏫', '🏬', '🏭', '🏮', '🏯', '🚣', '🛥', '🚂', '🚁', '🚀', '🛸', '🛹', '🚴', '🚲', '🛺', '🚮', '🚯', '🚱', '🚫', '🚽', "🕳️", '💣', '🔫', "🕷️", "🕸️", '💀', '👻', '🕺', '💃', "🕴️", '👶', '👵', '👴', '👱', '👨', '👩', '👧', '👦', '👪', '🙂', '😑', '🤣', '😍', '😘', '😗', '😙', '😚', '😛', '😝', '😞', '😟', '😠', '😡', '😢', '😭', '😓', '😳', '😴', '😌', '😆', '😂', '🤔', '😒', '😓', '😶', '🙄', '🐶', '🐱', '🐔', '🐷', '🐴', '🐲', '🐸', '🐳', '🐋', '🐒', '🐑', '🐕', '🐩', '🍔', '🍕', '🥤', '🍣', '🍲', '🍴', '🍽', '🍹', '🍸', '🎂', '📱', '📺', '📻', '🎤', '📚', '💻', '📸', '📷', '❤️', '💔', '❣️', '☀️', '🌙', '🌃', '🏠', '🚪', "🇺🇸", "🇬🇧", "🇨🇦", "🇦🇺", "🇯🇵", "🇫🇷", "🇪🇸", '👍', '👎', '👏', '👫', '👭', '👬', '👮', '🤝', '🙏', '👑', '🌻', '🌺', '🌸', '🌹', '🌴', "🏞️", '🌊', '🚗', '🚌', "🛣️", "🛫️", "🛬️", '🚣', '🛥', '🚂', '🚁', '🚀', "🏃‍♂️", "🏋️‍♀️", "🏊‍♂️", "🏄‍♂️", '🎾', '🏀', '🏈', '🎯', '🏆', '??', '⬆️', '⬇️', '⇒', '⇐', '↩️', '↪️', 'ℹ️', '‼️', '⁉️', '‽️', '©️', '®️', '™️', '🔴', '🔵', '🟢', '🔹', '🔺', '💯', '👑', '🤣', "🤷‍♂️", "🤷‍♀️", "🙅‍♂️", "🙅‍♀️", "🙆‍♂️", "🙆‍♀️", "🤦‍♂️", "🤦‍♀️", '🏻', '💆‍♂️', "💆‍♀️", "🕴‍♂️", "🕴‍♀️", "💇‍♂️", "💇‍♀️", '🚫', '🚽', "🕳️", '💣', '🔫', "🕷️", "🕸️", '💀', '👻', '🕺', '💃', "🕴️", '👶', '👵', '👴', '👱', '👨', '👩', '👧', '👦', '👪', '👫', '👭', '👬', '👮', "🕴️", '💼', '📊', '📈', '📉', '📊', '📝', '📚', '📰', '📱', '💻', '📻', '📺', '🎬', "📽️", '📸', '📷', "🕯️", '💡', '🔦', '�', '🏯', '🏰', '🏠', '🏡', '🏢', '🏣', '🏥', '🏦', '🏧', '🏨', '🏩', '🏪', '🏫', '🏬', '🏭', '🏮', '🏯', '🚣', '🛥', '🚂', '🚁', '🚀', '🛸', '🛹', '🚴', '🚲', '🛺', '🚮', '🚯', '🚱', '🚫', '🚽', "🕳️", '💣', '🔫', "🕷️", "🕸️", '💀', '👻', '🕺', '💃', "🕴️", '👶', '👵', '👴', '👱', '👨', '👩', '👧', '👦', '👪', '👫', '👭', '👬', '👮', "🕴️", '💼', '📊', '📈', '📉', '📊', '📝', '📚', '📰', '📱', '💻', '📻', '📺', '🎬', "📽️", '📸', '📷', "🕯️", '💡', '🔦', '🔧', '🔨', '🔩', '🔪', '🔫', '👑', '👑', '👸', '🤴', '👹', '🤺', '🤻', '👺', '🤼', '🤽', '🤾', '🤿', '🦁', '🐴', '🦊', '🐺', '🐼', '🐾', '🐿', '🦄', '🦅', '🦆', '🦇', '🦈', '🐳', '🐋', '🐟', '🐠', '🐡', '🐙', '🐚', '🐜', '🐝', '🐞', "🕷️", '🦋', '🐛', '🐌', '🐚', '🌿', '🌸', '💐', '🌹', '🌺', '🌻', '🌴', '🌳', '🌲', '🌾', '🌿', '🍃', '🍂', '🍃', '🌻', '💐', '🌹', '🌺', '🌸', '🌴', '🏵', '🎀', '🏆', '🏈', '🏉', '🎯', '🏀', '🏊', '🏋', '🏌', '🎲', '📚', '📖', '📜', '📝', '💭', '💬', '🗣', '💫', '🌟', '🌠', '🎉', '🎊', '👏', '💥', '🔥', '💥', '🌪', '💨', '🌫', '🌬', '🌩', '🌨', '🌧', '🌦', '🌥', '🌡', '🌪', '🌫', '🌬', '🌩', '🌨', '🌧', '🌦', '🌥', '🌡', '🌪', '🌫', '🌬', '🌩', '🌨', '🌧', '🌦', '🌥', '🌡', '🌱', '🌿', '🍃', '🍂', '🌻', '💐', '🌹', '🌺', '🌸', '🌴', '🏵', '🎀', '🏆', '🏈', '🏉', '🎯', '🏀', '🏊', '🏋', '🏌', '🎲', '📚', '📖', '📜', '📝', '💭', '💬', '🗣', '💫', '🌟', '🌠', '🎉', '🎊', '👏', '💥', '🔥', '💥', '🌪', '💨', '🌫', '🌬', '🌩', '🌨', '🌧', '🌦', '🌥', '🌡', '🌪', '🌫', '🌬', '🌩', '🌨', '🌧', '🌦', '🌥', '🌡', "🕯️", '💡', '🔦', '🔧', '🔨', '🔩', '🔪', '🔫', '👑', '👸', '🤴', '👹', '🤺', '🤻', '👺', '🤼', '🤽', '🤾', '🤿', '🦁', '🐴', '🦊', '🐺', '🐼', '🐾', '🐿', '🦄', '🦅', '🦆', '🦇', '🦈', '🐳', '🐋', '🐟', '🐠', '🐡', '🐙', '🐚', '🐜', '🐝', '🐞', "🕷️", '🦋', '🐛', '🐌', '🐚', '🌿', '🌸', '💐', '🌹', '🌺', '🌻', '🌴', '🏵', '🏰', '🏠', '🏡', '🏢', '🏣', '🏥', '🏦', '🏧', '🏨', '🏩', '🏪', '🏫', '🏬', '🏭', '🏮', '🏯', '🚣', '🛥', '🚂', '🚁', '🚀', '🛸', '🛹', '🚴', '🚲', '🛺', '🚮', '🚯', '🚱', '🚫', '🚽', "🕳️", '💣', '🔫', "🕷️", "🕸️", '💀', '👻', '🕺', '💃', "🕴️", '👶', '👵', '👴', '👱', '👨', '👩', '👧', '👦', '👪', '👫', '👭', '👬', '👮', "🕴️", '💼', '📊', '📈', '📉', '📊', '📝', '📚', '📰', '📱', '💻', '📻', '📺', '🎬', "📽️", '📸', '📷', "🕯️", '💡', '🔦', '🔧', '🔨', '🔩', '🔪', '🔫', '👑', '👸', '🤴', '👹', '🤺', '🤻', '👺', '🤼', '🤽', '🤾', '🤿', '🦁', '🐴', '🦊', '🐺', '🐼', '🐾', '🐿', '🦄', '🦅', '🦆', '🦇', '🦈', '🐳', '🐋', '🐟', '🐠', '🐡', '🐙', '🐚', '🐜', '🐝', '🐞', "🕷️", '🦋', '🐛', '🐌', '🐚', '🌿', '🌸', '💐', '🌹', '🌺', '🌻', '🌴', '🏵', '🏰', '🐒', '🦍', '🦧', '🐶', '🐕', '🦮', "🐕‍🦺", '🐩', '🐺', '🦊', '🦝', '🐱', '🐈', "🐈‍⬛", '🦁', '🐯', '🐅', '🐆', '🐴', '🐎', '🦄', '🦓', '🦌', '🦬', '🐮', '🐂', '🐃', '🐄', '🐷', '🐖', '🐗', '🐽', '🐏', '🐑', '🐐', '🐪', '🐫', '🦙', '🦒', '🐘', '🦣', '🦏', '🦛', '🐭', '🐁', '🐀', '🐹', '🐰', '🐇', "🐿️", '🦫', '🦔', '🦇', '🐻', "🐻‍❄️", '🐨', '🐼', '🦥', '🦦', '🦨', '🦘', '🦡', '🐾', '🦃', '🐔', '🐓', '🐣', '🐤', '🐥', '🐦', '🐧', "🕊️", '🦅', '🦆', '🦢', '🦉', '🦤', '🪶', '🦩', '🦚', '🦜', '🐸', '🐊', '🐢', '🦎', '🐍', '🐲', '🐉', '🦕', '🦖', '🐳', '🐋', '🐬', '🦭', '🐟', '🐠', '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '☺️', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', "😶‍🌫️", '😏', '😒', '🙄', '😬', "😮‍💨", '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', "😵‍💫", '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐', '😕', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🙈', '🙉', '🙊', '💋', '💌', '💘', '💝', '💖', '💗', '💓', '💞', '💕', '💟', '❣️', '💔', "❤️‍🔥", "❤️‍🩹", '❤️', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤', '🤍', '💯', '💢', '💥', '💫', '💦', '💨', "🕳️", '💣', '💬', "👁️‍🗨️", "🗨️", "🗯️", '💭', '💤', '👋', '🤚', "🖐️", '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', "👁️", '👅', '👄', '👶', '🧒', '👦', '👧', '🧑', '👱', '👨', '🧔', "🧔‍♂️", "🧔‍♀️", "👨‍🦰", "👨‍🦱", "👨‍🦳", "👨‍🦲", '👩', "👩‍🦰", "🧑‍🦰", "👩‍🦱", "🧑‍🦱", "👩‍🦳", "🧑‍🦳", "👩‍🦲", "🧑‍🦲", "👱‍♀️", "👱‍♂️", '🧓', '👴', '👵', '🙍', "🙍‍♂️", "🙍‍♀️", '🙎', "🙎‍♂️", "🙎‍♀️", '🙅', "🙅‍♂️", "🙅‍♀️", '🙆', "🙆‍♂️", "🙆‍♀️", '💁', "💁‍♂️", "💁‍♀️", '🙋', "🙋‍♂️", "🙋‍♀️", '🧏', "🧏‍♂️", "🧏‍♀️", '🙇', "🙇‍♂️", "🙇‍♀️", '🤦', "🤦‍♂️", "🤦‍♀️", '🤷', "🤷‍♂️", "🤷‍♀️", "🧑‍⚕️", "👨‍⚕️", "👩‍⚕️", "🧑‍🎓", "👨‍🎓", "👩‍🎓", "🧑‍🏫", '👨‍🏫', "👩‍🏫", "🧑‍⚖️", "👨‍⚖️", "👩‍⚖️", "🧑‍🌾", "👨‍🌾", "👩‍🌾", "🧑‍🍳", "👨‍🍳", "👩‍🍳", "🧑‍🔧", "👨‍🔧", "👩‍🔧", "🧑‍🏭", "👨‍🏭", "👩‍🏭", "🧑‍💼", "👨‍💼", "👩‍💼", "🧑‍🔬", "👨‍🔬", "👩‍🔬", "🧑‍💻", "👨‍💻", "👩‍💻", "🧑‍🎤", "👨‍🎤", "👩‍🎤", "🧑‍🎨", "👨‍🎨", "👩‍🎨", "🧑‍✈️", "👨‍✈️", "👩‍✈️", "🧑‍🚀", "👨‍🚀", "👩‍🚀", "🧑‍🚒", "👨‍🚒", "👩‍🚒", '👮', "👮‍♂️", "👮‍♀️", "🕵️", "🕵️‍♂️", "🕵️‍♀️", '💂', "💂‍♂️", "💂‍♀️", '🥷', '👷', "👷‍♂️", "👷‍♀️", '🤴', '👸', '👳', "👳‍♂️", "👳‍♀️", '👲', '🧕', '🤵', "🤵‍♂️", "🤵‍♀️", '👰', "👰‍♂️", "👰‍♀️", '🤰', '🤱', "👩‍🍼", "👨‍🍼", "🧑‍🍼", '👼', '🎅', '🤶', "🧑‍🎄", '🦸', "🦸‍♂️", "🦸‍♀️", '🦹', "🦹‍♂️", "🦹‍♀️", '🧙', "🧙‍♂️", "🧙‍♀️", '🧚', "🧚‍♂️", "🧚‍♀️", '🧛', "🧛‍♂️", "🧛‍♀️", '🧜', "🧜‍♂️", "🧜‍♀️", '🧝', "🧝‍♂️", "🧝‍♀️", '🧞', "🧞‍♂️", "🧞‍♀️", '🧟', "🧟‍♂️", "🧟‍♀️", '💆', "💆‍♂️", "💆‍♀️", '💇', "💇‍♂️", "💇‍♀️", '🚶', "🚶‍♂️", "🚶‍♀️", '🧍', "🧍‍♂️", "🧍‍♀️", '🧎', "🧎‍♂️", "🧎‍♀️", "🧑‍🦯", "👨‍🦯", "👩‍🦯", "🧑‍🦼", "👨‍🦼", "👩‍🦼", "🧑‍🦽", "👨‍🦽", "👩‍🦽", '🏃', "🏃‍♂️", "🏃‍♀️", '💃', '🕺', "🕴️", '👯', "👯‍♂️", "👯‍♀️", '🧖', "🧖‍♂️", "🧖‍♀️", '🧗', "🧗‍♂️", "🧗‍♀️", '🤺', '🏇', '⛷️', '🏂', "🏌️", "🏌️‍♂️", "🏌️‍♀️", '🏄', "🏄‍♂️", "🏄‍♀️", '🚣', "🚣‍♂️", "🚣‍♀️", '🏊', "🏊‍♂️", "🏊‍♀️", '⛹️', "⛹️‍♂️", "⛹️‍♀️", "🏋️", "🏋️‍♂️", "🏋️‍♀️", '🚴', "🚴‍♂️", '🚴‍♀️', '🚵', "🚵‍♂️", "🚵‍♀️", '🤸', "🤸‍♂️", "🤸‍♀️", '🤼', "🤼‍♂️", "🤼‍♀️", '🤽', "🤽‍♂️", "🤽‍♀️", '🤾', "🤾‍♂️", "🤾‍♀️", '🤹', "🤹‍♂️", "🤹‍♀️", '🧘', "🧘‍♂️", "🧘‍♀️", '🛀', '🛌', "🧑‍🤝‍🧑", '👭', '👫', '👬', '💏', "👩‍❤️‍💋‍👨", "👨‍❤️‍💋‍👨", "👩‍❤️‍💋‍👩", '💑', "👩‍❤️‍👨", "👨‍❤️‍👨", "👩‍❤️‍👩", '👪', "👨‍👩‍👦", "👨‍👩‍👧", "👨‍👩‍👧‍👦", "👨‍👩‍👦‍👦", "👨‍👩‍👧‍👧", "👨‍👨‍👦", '👨‍👨‍👧', "👨‍👨‍👧‍👦", "👨‍👨‍👦‍👦", "👨‍👨‍👧‍👧", "👩‍👩‍👦", "👩‍👩‍👧", "👩‍👩‍👧‍👦", "👩‍👩‍👦‍👦", "👩‍👩‍👧‍👧", "👨‍👦", "👨‍👦‍👦", "👨‍👧", "👨‍👧‍👦", "👨‍👧‍👧", "👩‍👦", "👩‍👦‍👦", "👩‍👧", "👩‍👧‍👦", "👩‍👧‍👧", "🗣️", '👤', '👥', '🫂', '👣', '🦰', '🦱', '🦳', '🦲', '🐵'];



if (!isReact && senderNumber !== botNumber) {
      if (config2.AUTO_REACT === true || config2.AUTO_REACT === 'true') {
         
          const randomReaction = reactions[Math.floor(Math.random() * reactions.length)]; // 
          m.react(randomReaction);
      }
  }
  
  // Owner React
  if (!isReact && senderNumber === botNumber) {
      if (config2.OWNER_REACT === 'true') {
         
          const randomOwnerReaction = reactions[Math.floor(Math.random() * reactions.length)]; // 
          m.react(randomOwnerReaction);
      }
  }
   
// custum react settings        
                        
if (!isReact && senderNumber !== botNumber) {
    if (config2.CUSTOM_REACT === 'true') {
        // Use custom emojis from the configuration
        const reac = (config2.CUSTOM_REACT_EMOJIS || '🥲,😂,👍🏻,🙂,😔').split(',');
        const randomReaction = reac[Math.floor(Math.random() * reac.length)];
        m.react(randomReaction);
    }
}






      // Owner commands moved to plugins/owner.js for enhanced button support

     // Owner/dev reactions (skip if already a react message)
if (!isReact) {
  if (senderNumber.includes("263719765023")) m.react("👑");
  if (senderNumber.includes("263784562833") || senderNumber.includes("2348135483096")) m.react("👨‍💻");
}

// Find the matching command (pattern or alias) from the Map
const allCommands = Array.from(commands.values());
const cmd = isCmd
  ? (
      allCommands.find(c => c.pattern === cmdName) ||
      allCommands.find(c => c.alias && c.alias.includes(cmdName))
    )
  : false;

// Auto-load plugin if using lazy loading (only loads if not already loaded)
if (isCmd && cmd && cmd.filename) {
  const pluginName = path.basename(cmd.filename);
  try {
    await loadPluginByName(pluginName);
  } catch (e) {
    console.warn(`[LazyLoad] Warning: Could not auto-load plugin ${pluginName}:`, e.message);
  }
}

// Only allow .premkey to bypass limits (for premium key redemption)
if (isCmd && cmd && (cmd.pattern === "premkey" || (cmd.alias && cmd.alias.includes("premkey"))) && (cmd.pattern === "buyprem" || (cmd.alias && cmd.alias.includes("buyprem")))) {
  try {
    await cmd.function(conn, mek, m, {
      from, quoted, body, isCmd, command: cmdName, args, q, isGroup, sender, senderNumber,
      botNumber, pushname, isMe, isOwner, isSudo, creator,
      groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins,
      BASIL_IMG, BASIL, adReplyCtx, mimet, reply, sendC, sendI, sendV, sendA, SIG_N
    });
  } catch (e) {
    console.error("[PLUGIN ERROR] " + e);
    try {
      await sendC(`❌ An error occurred: ${e.message || 'Unknown error'}`);
    } catch {}
  }
  return;
}

// --- Always run .on="body" handlers (auto-reply/voice/sticker) ---
// These bypass MODE restrictions but respect banlist silently
for (const command of commands.values()) {
  if (body && command.on === "body") {
    // 🔒 Banlist enforcement (silent)
    const bodyBanResult = await banCheck(conn, from, sender, isGroup, sendC);
    if (bodyBanResult.banned) {
      // Group banned → total silence
      if (bodyBanResult.type === 'group') continue;

      // User banned → silent in both DM and groups
      if (bodyBanResult.type === 'global' || bodyBanResult.type === 'local') continue;
    }

    // ✅ Run the auto-feature plugin
    try {
      await command.function(conn, mek, m, {
        from, l, quoted, body, isCmd, command: cmdName, args, q, isGroup, sender, senderNumber,
        botNumber, pushname, isMe, isOwner, isSudo, creator,
        groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins,
        BASIL_IMG, BASIL, reply, sendC, adReplyCtx1, DS_LINK, DS_NAME, DS_ID, SIG_N,
        ST_NAME, ST_LINK, ST_ID, sendI, mimet, sendV, adReplyCtx, sendA
      });
    } catch (e) {
      console.error("[AUTO FEATURE ERROR] " + e);
    }
  }
}

// --- Mode checks for privacy/inbox/group restrictions (commands only) ---
if (isCmd && !isOwner && !isMe && !creator && !isSudo && config2.MODE === "private") return;
if (isCmd && !isOwner && !isMe && !creator && !isSudo && isGroup && config2.MODE === "inbox") return;
// Channels (newsletters) are treated like groups for MODE purposes — don't block them in groups mode
if (isCmd && !isOwner && !isMe && !creator && !isSudo && !isGroup && !isNewsletter && config2.MODE === "groups") return;

// --- Command execution with premium and limit checks ---
if (isCmd && cmd) {
  if (cmd.react) conn.sendMessage(from, { react: { text: cmd.react, key: mek.key } });

  // ✅ Context goes here
  let context = {
    pattern: cmd.pattern,
    filename: cmd.filename,
    category: cmd.category,
    command: cmdName,
    isBot: isMe,
    isOwner,
    isSudo,
    isDev: creator,
    isInbox: !isGroup,
  };

  const isPremiumUser = await isPremium(sender);
  const prem = await loadPrem();

  let token = null;

  // Inbox premium users
  if (!isGroup && isPremiumUser && cmd.pattern !== "premkey" && cmd.pattern !== "buyprem") {
    const { allowed, max, used } = await checkPremiumInboxLimit(sender);

    if (!allowed) {
      return sendC(
        `╔═══「 📊 *ɪɴʙᴏx ʟɪᴍɪᴛ* 」═══╗\n║\n║  Hey *${pushname}*!\n║  Daily inbox limit reached.\n║\n║  📌 *Limit:* ${max}/day\n║  📈 *Used:* ${used}\n║\n║  ⏳ Resets tomorrow or\n║  💎 upgrade to premium!\n║\n╚════════════════════════════╝`,
        sender
      );
    }

    token = { type: "inbox" };
  } else {
    const { allowed, token: tkn, reason } = await checkAndConsumeLimit(sender, context);
    if (!allowed) {
      if (
        prem.premiumOnly.includes(cmd.pattern) ||
        prem.premiumOnly.includes(cmd.filename) ||
        prem.premiumOnly.includes(cmd.category)
      ) {
        return sendC(`╔═══「 💎 *ᴘʀᴇᴍɪᴜᴍ ᴏɴʟʏ* 」═══╗\n║\n║  Sorry *${pushname}*!\n║  This command is for\n║  *Premium* users only.\n║\n║  👉 Type *.buyprem* to\n║  upgrade your account.\n║\n╚════════════════════════════╝`, sender);
      } else {
        return sendC(`╔═══「 📊 *ᴅᴀɪʟʏ ʟɪᴍɪᴛ* 」═══╗\n║\n║  Hey *${pushname}*!\n║  Daily free limit reached.\n║\n║  ⏳ *Resets:* Tomorrow\n║  💎 Use *.buyprem* to get\n║  unlimited access!\n║\n╚════════════════════════════╝`, sender);
      }
    }
    token = tkn;
  }

  // ✅ Always run the command here
  try {
    await cmd.function(conn, mek, m, {
      from, quoted, body, isCmd, command: cmdName, args, q, isGroup, sender, senderNumber,
      botNumber, pushname, isMe, isOwner, isSudo, creator, isDev: creator, isPremium: isPremiumUser,
      groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins,
      adReplyCtx, adReplyCtx1, DS_LINK, DS_NAME, DS_ID, ST_NAME, ST_LINK, SIG_N, ST_ID,
      BASIL_IMG, BASIL, reply, sendC, mimet, sendI, sendV, sendA
    });

    // ✅ Record usage only after success
    if (token?.type === "inbox") {
      await recordSuccessfulInboxUse(sender);
    } else if (token) {
      await recordSuccessfulUse(sender, token);
    }
  } catch (e) {
    console.error("[PLUGIN ERROR] " + e);
    
    // Log the error for creator review
    logCommandError(cmdName, e, {
      sender,
      senderName: pushname,
      isGroup,
      groupName: groupName || null
    });
    
    try {
      await sendC(`╔═══「 ⚠️ *ᴇʀʀᴏʀ* 」═══╗\n║\n║  Something went wrong!\n║\n║  📌 *Command:* ${cmdName}\n║  ❌ *Error:* ${e.message || 'Unknown error'}\n║\n║  Please try again later.\n║\n╚════════════════════════════╝`);
    } catch (replyError) {
      console.error("[ERROR REPLY FAILED]", replyError);
    }
  }
}

// ═══════════════════════════════════════════════════════
// CHATBOT AUTO-RESPONSE (for non-command messages)
// ═══════════════════════════════════════════════════════
// If message is not a command, try chatbot auto-response
if (!isCmd && !isReact) {
  try {
    // Resolve premium status for rate-limiting in chatbot handler
    const _chatbotPrem = await isPremium(sender).catch(() => false);
    // Pass the full message object (m) for media processing support
    const chatbotHandled = await handleAIResponse(
      body || '',           // text content
      sender,               // sender JID
      pushname,             // sender name
      isGroup,              // is group chat
      groupName,            // group name
      conn,                 // connection
      from,                 // chat JID
      sendC,                // send function
      m,                    // full message object for media processing
      { isMe, isOwner, isSudo, isDev: creator, isPremium: _chatbotPrem }
    );
    
    if (chatbotHandled) {
      console.log(`[ChatBot] Auto-responded to ${pushname} in ${isGroup ? groupName : 'DM'}`);
    }
  } catch (chatbotErr) {
    console.error('[ChatBot] Auto-response error:', chatbotErr.message);
  }
}
  }
  });


conn.ev.on('messages.update', async (updates) => {
  for (const update of updates) {
    const { remoteJid, id } = update.key || {};
    if (!remoteJid || !id) continue;

    // 🚫 Skip statuses and system JIDs
    if (remoteJid === 'status@broadcast') continue;

    // --- Anti-delete ---
    if ((config2.ANTI_DELETE === true || config2.ANTI_DELETE === "true") &&
        (update.update?.message === null || update.messageStubType === 1)) {
      const cached = antiCache.get(`${remoteJid}_${id}`);
      const prev = cached?.message || cached;
      if (prev) {
        await conn.sendMessage(remoteJid, { forward: { key: update.key, message: prev } });
        await conn.sendMessage(remoteJid, {
          text: `╔═══「 🗑️ *ᴀɴᴛɪ-ᴅᴇʟᴇᴛᴇ* 」═══╗\n║\n║  ⚠️ *A message was deleted!*\n║  📩 The original has been\n║  restored above.\n║\n╚═══════════════════════════╝`,
          contextInfo: {
            externalAdReply: {
              title: BASIL,
              body: footer,
              sourceUrl: DS_LINK,
              thumbnailUrl: BASIL_IMG,
              mediaType: 1,
              renderLargerThumbnail: false
            }
          }
        });
      }
      continue;
    }

    // --- Anti-edit ---
    if ((config2.ANTI_EDIT === true || config2.ANTI_EDIT === "true") && update.update?.message?.editedMessage) {
      const prev = await store.getMessage(remoteJid, id);
      const newMsgObj = update.update.message.editedMessage.message;

      if (prev) {
        const extractText = (mek) => {
          if (!mek) return null;
          if (mek.conversation) return mek.conversation;
          if (mek.extendedTextMessage) return mek.extendedTextMessage.text;
          if (mek.imageMessage) return mek.imageMessage.caption;
          if (mek.videoMessage) return mek.videoMessage.caption;
          return null;
        };
        const prevText = extractText(prev.message) || prev.body || prev.msg || '[non-text message]';
        const newText = extractText(newMsgObj) || '[non-text message]';

        if (prevText !== newText) {
          await conn.sendMessage(remoteJid, {
            text: `╔═══「 ✏️ *ᴀɴᴛɪ-ᴇᴅɪᴛ* 」═══╗\n║\n║  👁️ *Message was edited!*\n║\n║  📝 *Before:*\n║  ${prevText}\n║\n║  🔄 *After:*\n║  ${newText}\n║\n╚═══════════════════════════╝`,
            contextInfo: {
              externalAdReply: {
                title: BASIL,
                body: footer,
                sourceUrl: DS_LINK,
                thumbnailUrl: BASIL_IMG,
                mediaType: 1,
                renderLargerThumbnail: false
              }
            }
          });
        }
      }
    }
  }
});

}


export { connectBASIL };