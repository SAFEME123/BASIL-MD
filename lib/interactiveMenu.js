/**
 * Shared interactive menu utilities for button/reply selection flows.
 *
 * Many plugins present a numbered list of results, then listen for the user's
 * reply (either a button press or a text number). This module extracts that
 * boilerplate into reusable helpers.
 */
import { sendBasilButtons, parseBasilResponse, createBasilButton } from './basilButtonHandler.js';
import { extractSenderInfo } from './jid-lid-helper.js';
import { safeDeleteMsg } from '../plugins/messages.js';

/**
 * Send a selection menu that adapts to the current BOT_MENUMODE (button | reply).
 *
 * @param {object}   conn        - WhatsApp connection
 * @param {string}   from        - chat JID
 * @param {object}   mek         - quoted message
 * @param {object}   options
 * @param {string}   options.title       - menu title
 * @param {string}   options.desc        - full menu text
 * @param {string}   [options.footer]    - footer text (buttons mode)
 * @param {string}   [options.imageUrl]  - header image URL
 * @param {Array<{id: string, label: string}>} options.items - selectable items
 * @param {string}   options.idPrefix    - button-id prefix (e.g. 'anime_sel')
 * @param {object}   ctx         - { BASIL, BASIL_IMG, adReplyCtx, SIG_N }
 * @returns {Promise<{sentMsg: object, dateNow: number}>}
 */
export async function sendSelectionMenu(conn, from, mek, options, ctx) {
  const { title, desc, footer, imageUrl, items, idPrefix } = options;
  const { BASIL, BASIL_IMG, adReplyCtx, SIG_N } = ctx;
  const mode = global.BOT_MENUMODE || 'reply';
  const dateNow = Date.now();

  let sentMsg = null;

  if (mode === 'button') {
    try {
      const buttons = items.map((item, idx) =>
        createBasilButton(`${idPrefix}_${idx}_${dateNow}`, item.label.substring(0, 20))
      );
      sentMsg = await sendBasilButtons(conn, from, {
        title: `${BASIL} ${title}`,
        text: desc.trim(),
        footer: footer || SIG_N,
        image: imageUrl,
        buttons
      });
    } catch (e) {
      console.error(`[${idPrefix}Buttons]`, e);
      sentMsg = await _sendFallback(conn, from, mek, desc, imageUrl, { BASIL, BASIL_IMG, adReplyCtx });
    }
  } else {
    sentMsg = await _sendFallback(conn, from, mek, desc, imageUrl, { BASIL, BASIL_IMG, adReplyCtx });
  }

  return { sentMsg, dateNow };
}

/**
 * Wait for a user to select an item from a menu sent with `sendSelectionMenu`.
 * Resolves with the zero-based index of the chosen item, or -1 on timeout.
 *
 * @param {object}  conn
 * @param {string}  from
 * @param {string}  sender        - expected user JID
 * @param {object}  sentMsg       - message object returned by sendSelectionMenu
 * @param {number}  dateNow       - timestamp returned by sendSelectionMenu
 * @param {string}  idPrefix      - same prefix passed to sendSelectionMenu
 * @param {number}  itemCount     - total selectable items
 * @param {number}  [timeoutMs=120000]
 * @returns {Promise<{selectedIdx: number, message: object}>}
 */
export function waitForSelection(conn, from, sender, sentMsg, dateNow, idPrefix, itemCount, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const handler = async (ev) => {
      const v = ev.messages[0];
      if (!v?.message) return;

      const senderInfo = extractSenderInfo(v.key, conn.user?.id);
      if (senderInfo.jid !== sender) return;

      const parsed = parseBasilResponse(v.message);
      if (!parsed) return;

      let selectedIdx = null;

      if (parsed.type === 'button') {
        const match = parsed.selectedId.match(new RegExp(`${idPrefix}_(\\d+)_`));
        if (match) selectedIdx = parseInt(match[1]);
      } else if (parsed.type === 'text') {
        const num = parseInt(parsed.selectedText.trim());
        if (num >= 1 && num <= itemCount) {
          selectedIdx = num - 1;
        }
      }

      const isOurMessage = sentMsg?.key?.id &&
        v.message?.extendedTextMessage?.contextInfo?.stanzaId === sentMsg.key.id;
      const isButtonResponse = parsed.type === 'button' &&
        parsed.selectedId?.includes(String(dateNow));

      if (selectedIdx === null || !(isOurMessage || isButtonResponse)) return;

      conn.ev.off('messages.upsert', handler);
      clearTimeout(timer);
      resolve({ selectedIdx, message: v });
    };

    conn.ev.on('messages.upsert', handler);

    const timer = setTimeout(() => {
      conn.ev.off('messages.upsert', handler);
      if (sentMsg?.key) safeDeleteMsg(conn, from, sentMsg.key).catch(() => {});
      resolve({ selectedIdx: -1, message: null });
    }, timeoutMs);
  });
}

async function _sendFallback(conn, from, mek, desc, imageUrl, { BASIL, BASIL_IMG, adReplyCtx }) {
  const content = imageUrl
    ? { image: { url: imageUrl }, caption: desc, contextInfo: adReplyCtx(BASIL, BASIL_IMG) }
    : { text: desc, contextInfo: adReplyCtx(BASIL, BASIL_IMG) };
  return conn.sendMessage(from, content, { quoted: mek });
}
