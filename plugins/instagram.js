import { cmd } from "../command.js";
import { safeDeleteMsg } from "./messages.js";
import { igdl } from "btch-downloader";
import nayanMediaDownloaders from "nayan-media-downloaders";
import { getFilename } from "../lib/path-helpers.js";
import { sendBasilButtons, parseBasilResponse, createBasilButton, sendCarousel } from "../lib/basilButtonHandler.js";
import axios from "axios";
import { sendSelectionMenu, waitForSelection } from "../lib/interactiveMenu.js";

const { instagram: nayanInstagram, ndown, instagramSearch } = nayanMediaDownloaders;
const __filename = getFilename(import.meta.url);

// ── Download helpers (multi-source fallback) ─────────────────────────────────

async function downloadWithBackup(url) {
  // Primary: btch-downloader
  try {
    const result = await igdl(url);
    if (result?.length > 0) {
      const item = result[0] || result;
      const videoUrl = item.url || item.urls?.[0]?.url;
      if (videoUrl) {
        return { success: true, source: "btch-downloader", video: videoUrl, caption: item.caption || "Instagram Reel", thumbnail: item.thumbnail || null, allMedia: result };
      }
    }
  } catch (e) { console.log("[IG Primary] Failed:", e.message); }

  // Backup 1: nayan instagram
  try {
    console.log("[IG Backup 1] Trying nayan instagram...");
    const res = await nayanInstagram(url);
    if (res?.status && res?.data) {
      const d = res.data;
      const videoUrl = d.url || d.video || (Array.isArray(d) && d[0]?.url);
      if (videoUrl) {
        return { success: true, source: "nayan-instagram", video: videoUrl, caption: d.caption || "Instagram Reel", thumbnail: d.thumbnail || null, allMedia: Array.isArray(d) ? d : [d] };
      }
    }
  } catch (e) { console.log("[IG Backup 1] nayan instagram failed:", e.message); }

  // Backup 2: ndown
  try {
    console.log("[IG Backup 2] Trying ndown...");
    const res = await ndown(url);
    if (res?.status && res?.data?.length > 0) {
      const first = res.data[0];
      return { success: true, source: "ndown", video: first?.url, caption: "Instagram Reel", thumbnail: first?.thumbnail || null, allMedia: res.data };
    }
  } catch (e) { console.log("[IG Backup 2] ndown failed:", e.message); }

  return { success: false, error: "All download methods failed" };
}

async function searchInstagramVideos(query, limit = 10) {
  let results = [];

  try {
    if (instagramSearch) {
      const res = await instagramSearch(query);
      if (res?.status && res?.data) {
        const data = Array.isArray(res.data) ? res.data : [res.data];
        results = data.map(item => ({
          url: item.url || item.video || item.image,
          thumbnail: item.thumbnail || item.image || item.url,
          caption: item.caption || item.title || "Instagram Video",
          username: item.username || item.author || ""
        })).filter(r => r.url).slice(0, limit);
      }
    }
  } catch (e) { console.log("[Instagram Search Primary]", e.message); }

  if (results.length === 0) {
    try {
      const apiUrl = "https://apis.davidcyril.name.ng/search/instagram?text=" + encodeURIComponent(query);
      const res = await axios.get(apiUrl, { timeout: 30000 });
      if (res.data?.result && Array.isArray(res.data.result)) {
        results = res.data.result.map(item => ({
          url: item.url || item.video,
          thumbnail: item.thumbnail || item.image || item.url,
          caption: item.caption || "Instagram Video",
          username: item.username || ""
        })).filter(r => r.url).slice(0, limit);
      }
    } catch (e) { console.log("[Instagram Search API]", e.message); }
  }

  return results;
}

// ── Shared reaction helper ───────────────────────────────────────────────────

async function react(conn, from, key, emoji) {
  await conn.sendMessage(from, { react: { text: emoji, key } });
}

// ── Media type detection ─────────────────────────────────────────────────────

function detectMediaType(item) {
  if (item.type === "image" || item.image) return "image";
  if (item.type === "video" || item.video) return "video";
  if (item.mimetype) {
    if (item.mimetype.startsWith("image/")) return "image";
    if (item.mimetype.startsWith("video/")) return "video";
  }
  const url = item.url || item.video || item.image || (typeof item === "string" ? item : "");
  if (!url) return "video";
  const path = url.split("?")[0].toLowerCase();
  if (path.match(/\.(jpg|jpeg|png|webp|gif|heic)$/)) return "image";
  return "video";
}

function getMediaUrl(item) {
  return item.url || item.video || item.image || (typeof item === "string" ? item : null);
}

// ── Send media to DM with group notification ─────────────────────────────────

async function sendMediaToDM(conn, from, dmJid, msg, isGroup, pushname, type, BASIL, BASIL_IMG, adReplyCtx) {
  if (isGroup) {
    await conn.sendMessage(from, {
      text: `*${pushname}* your ${type} is being sent to your DM hang tight`,
      contextInfo: adReplyCtx(BASIL, BASIL_IMG)
    }, { quoted: msg });
    await react(conn, from, msg.key, "📤");
  }
}

// ═══════════════════════════════════════════════════════════════
// COMMAND 1: INSTAGRAM DOWNLOAD
// ═══════════════════════════════════════════════════════════════

cmd({
  pattern: "instagram",
  alias: ["ig", "insta", "reels", "igreel", "igvideo", "igdoc", "ig-video", "ig-doc"],
  react: "📸",
  desc: "Download Instagram reels/videos with format selection",
  category: "downloader",
  filename: __filename
}, async (conn, mek, m, {
  from, q, pushname, reply, isGroup, sender, BASIL, SIG_N, BASIL_IMG, adReplyCtx, sendC, sendV
}) => {
  try {
    if (!q) {
      return reply("\n📸 *INSTAGRAM DOWNLOADER*\n\nUsage: instagram <url>\n\nFeatures:\n- Download reels & videos\n- HD quality support\n- Video & Document format\n- Get video metadata\n- Multiple backup sources\n\nExample: instagram https://www.instagram.com/reel/xxxxx\n      ");
    }
    if (!q.includes("instagram.com")) return reply("Invalid Instagram URL");

    await react(conn, from, m.key, "⏳");
    reply("Downloading Instagram reel...");

    const dlResult = await downloadWithBackup(q);
    if (!dlResult.success) {
      await react(conn, from, m.key, "❌");
      return reply("Failed to download. Check if reel is public");
    }

    const { video, caption, thumbnail, source, allMedia } = dlResult;
    if (!video) {
      await react(conn, from, m.key, "❌");
      return reply("Could not extract video");
    }

    const hasMultiple = allMedia && allMedia.length > 1;
    const mode = global.BOT_MENUMODE || "reply";
    const dateNow = Date.now();

    const menuText = `
> 📸 ${BASIL} 𝗜𝗡𝗦𝗧𝗔𝗚𝗥𝗔𝗠 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥

╭━━━━━━━━━━━━━━━━━━━━━━
❒ 📝 *Caption:* ${caption.substring(0, 80)}...
❒ 🔧 *Source:* ${source}
❒ 📊 *Media Count:* ${allMedia?.length || 1}
╰━━━━━━━━━━━━━━━━━━━━━━

${mode === "button" ? "*Select Download Option:*" :
`> *ᖇEᑭᒪY ᗷEᒪOᗯ TO ᗪOᗯᑎᒪOᗪ*
╭━━━━━━━━━━━━━━━━━━━━━━
❍ 1️⃣ - 🎬 ᴅᴏᴡɴʟᴏᴀᴅ ᴠɪᴅᴇᴏ
│┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉
❍ 2️⃣ - 📁 ᴠɪᴅᴇᴏ ᴀꜱ ᴅᴏᴄᴜᴍᴇɴᴛ
│┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉
❍ 3️⃣ - 🔗 ɢᴇᴛ ʟɪɴᴋ ᴏɴʟʏ${hasMultiple ? `
│┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉
❍ 4️⃣ - 📦 ᴅᴏᴡɴʟᴏᴀᴅ ᴀʟʟ ᴍᴇᴅɪᴀ` : ""}
╰━━━━━━━━━━━━━━━━━━━━━━`}

▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
> ${SIG_N}
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
`;

    let sentMsg = null;

    if (mode === "button") {
      try {
        const buttons = [
          createBasilButton("ig_video_" + dateNow, "🎬 Video"),
          createBasilButton("ig_doc_" + dateNow, "📁 Document"),
          createBasilButton("ig_link_" + dateNow, "🔗 Link Only")
        ];
        if (hasMultiple) buttons.push(createBasilButton("ig_all_" + dateNow, "📦 All Media"));

        sentMsg = await sendBasilButtons(conn, from, {
          title: BASIL + " 📸 INSTAGRAM",
          text: "📝 Caption: " + caption.substring(0, 40) + "...\n\n*Select Download Option:*",
          footer: SIG_N,
          image: thumbnail,
          buttons
        });
      } catch (e) {
        console.error("[InstagramButtons]", e);
        sentMsg = await _sendIgMenu(conn, from, mek, menuText, thumbnail, BASIL, BASIL_IMG, adReplyCtx);
      }
    } else {
      sentMsg = await _sendIgMenu(conn, from, mek, menuText, thumbnail, BASIL, BASIL_IMG, adReplyCtx);
    }

    // Event handler for user's selection
    const igHandler = async (ev) => {
      const v = ev.messages[0];
      if (!v?.message) return;

      const userJid = v.key.fromMe
        ? (conn.user.id.split(":")[0] + "@s.whatsapp.net" || conn.user.id)
        : v.key.participant || v.key.remoteJid || v.key.participant_pn;
      const pushName = v.pushName || "No Name Available";

      const parsed = parseBasilResponse(v.message);
      if (!parsed) return;

      let choice = null;
      if (parsed.type === "button" && parsed.selectedId) {
        const id = parsed.selectedId;
        if (id.includes("ig_video") && !id.includes("doc")) choice = "1";
        else if (id.includes("ig_doc")) choice = "2";
        else if (id.includes("ig_link")) choice = "3";
        else if (id.includes("ig_all")) choice = "4";
      } else if (parsed.type === "text") {
        choice = parsed.selectedText;
      }

      const isOurMsg = sentMsg?.key?.id && v.message?.extendedTextMessage?.contextInfo?.stanzaId === sentMsg.key.id;
      const isBtnMatch = parsed.type === "button" && parsed.selectedId?.includes(String(dateNow));
      if (!choice || (!isOurMsg && !isBtnMatch)) return;

      const validChoices = ["1", "2", "3", "4"];
      if (!validChoices.includes(choice)) {
        await react(conn, from, v.key, "❌");
        await sendC(pushName + " ᴘʟᴇᴀꜱᴇ ʀᴇᴘʟʏ ᴡɪᴛʜ `( 1, 2, 3" + (hasMultiple ? ", 4" : "") + " )` ᴛᴏ ᴅᴏᴡɴʟᴏᴀᴅ");
        return;
      }

      conn.ev.off("messages.upsert", igHandler);
      clearTimeout(timer);
      safeDeleteMsg(conn, from, sentMsg.key).catch(() => {});
      await react(conn, from, v.key, "⬇️");

      try {
        switch (choice) {
          case "1":
            await sendMediaToDM(conn, from, userJid, v, isGroup, pushName, "video", BASIL, BASIL_IMG, adReplyCtx);
            try {
              await conn.sendMessage(userJid, {
                video: { url: video }, caption: "📸 Instagram Reel\n\n" + caption.substring(0, 100) + "...\n\n🔧 Source: " + source,
                mimetype: "video/mp4", gifPlayback: false
              }, { quoted: v });
              await react(conn, from, v.key, "✅");
            } catch (e) {
              console.error("[IG Video Send]", e);
              await sendC("🔗 Video Link:\n" + video);
            }
            break;

          case "2":
            await sendMediaToDM(conn, from, userJid, v, isGroup, pushName, "document", BASIL, BASIL_IMG, adReplyCtx);
            try {
              await conn.sendMessage(userJid, {
                document: { url: video }, fileName: "Instagram_Reel.mp4", mimetype: "video/mp4",
                caption: "📸 Instagram Reel\n\n" + caption.substring(0, 100) + "..."
              }, { quoted: v });
              await react(conn, from, v.key, "✅");
            } catch (e) {
              console.error("[IG Doc Send]", e);
              await sendC("🔗 Video Link:\n" + video);
            }
            break;

          case "3":
            await sendC(`\n📸 *INSTAGRAM REEL INFO*\n\n*📝 Caption:* ${caption}\n*🔧 Source:* ${source}\n*📊 Media Count:* ${allMedia?.length || 1}\n\n*🔗 Direct Link:*\n${video}\n            `);
            await react(conn, from, v.key, "✅");
            break;

          case "4":
            if (!hasMultiple) {
              await react(conn, from, v.key, "❌");
              return sendC("*" + pushName + "* ᴏɴʟʏ ᴏɴᴇ ᴍᴇᴅɪᴀ ᴀᴠᴀɪʟᴀʙʟᴇ");
            }
            await sendMediaToDM(conn, from, userJid, v, isGroup, pushName, "media", BASIL, BASIL_IMG, adReplyCtx);
            try {
              await _sendAllMedia(conn, userJid, from, v, allMedia);
              await react(conn, from, v.key, "✅");
            } catch (e) {
              console.error("[IG All Media Send]", e);
              await sendC("❌ Failed to send all media. Try downloading individually.");
            }
            break;
        }
      } catch (e) {
        console.error("[IGHandler]", e);
        await react(conn, from, v.key, "❌");
      }
    };

    conn.ev.on("messages.upsert", igHandler);
    const timer = setTimeout(() => {
      conn.ev.off("messages.upsert", igHandler);
      safeDeleteMsg(conn, from, sentMsg.key).catch(() => {});
    }, 120000);

  } catch (e) {
    console.error("[Instagram Download Error]", e);
    reply("Download failed: " + e.message);
  }
});

// ═══════════════════════════════════════════════════════════════
// COMMAND 2: IG STORY
// ═══════════════════════════════════════════════════════════════

cmd({
  pattern: "igstory",
  alias: ["instastory", "ig-story"],
  react: "📖",
  desc: "Download Instagram stories with format selection",
  category: "downloader",
  filename: __filename
}, async (conn, mek, m, {
  from, q, pushname, reply, isGroup, BASIL, SIG_N, BASIL_IMG, adReplyCtx, sendC
}) => {
  try {
    if (!q) {
      return reply("\n📖 *INSTAGRAM STORY DOWNLOADER*\n\nUsage: igstory <username or story url>\n\nExample: igstory https://www.instagram.com/stories/username/xxx\n      ");
    }

    await react(conn, from, m.key, "⏳");
    reply("Fetching story...");

    const dlResult = await downloadWithBackup(q);
    if (!dlResult.success) {
      await react(conn, from, m.key, "❌");
      return reply("Could not fetch story. Make sure the account is public");
    }

    const { video, source } = dlResult;
    const mode = global.BOT_MENUMODE || "reply";
    const dateNow = Date.now();

    const menuText = `
> 📖 ${BASIL} 𝗜𝗚 𝗦𝗧𝗢𝗥𝗬 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥

╭━━━━━━━━━━━━━━━━━━━━━━
❒ 🔧 *Source:* ${source}
╰━━━━━━━━━━━━━━━━━━━━━━

${mode === "button" ? "*Select Download Option:*" :
`> *ᖇEᑭᒪY ᗷEᒪOᗯ TO ᗪOᗯᑎᒪOᗪ*
╭━━━━━━━━━━━━━━━━━━━━━━
❍ 1️⃣ - 🎬 ᴅᴏᴡɴʟᴏᴀᴅ ᴠɪᴅᴇᴏ
│┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉
❍ 2️⃣ - 📁 ᴠɪᴅᴇᴏ ᴀꜱ ᴅᴏᴄᴜᴍᴇɴᴛ
│┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉
❍ 3️⃣ - 🔗 ɢᴇᴛ ʟɪɴᴋ ᴏɴʟʏ
╰━━━━━━━━━━━━━━━━━━━━━━`}

▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
> ${SIG_N}
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
`;

    let sentMsg = null;
    if (mode === "button") {
      try {
        sentMsg = await sendBasilButtons(conn, from, {
          title: BASIL + " 📖 IG STORY",
          text: "🔧 Source: " + source + "\n\n*Select Download Option:*",
          footer: SIG_N,
          buttons: [
            createBasilButton("igs_video_" + dateNow, "🎬 Video"),
            createBasilButton("igs_doc_" + dateNow, "📁 Document"),
            createBasilButton("igs_link_" + dateNow, "🔗 Link Only")
          ]
        });
      } catch (e) {
        console.error("[IGStoryButtons]", e);
        sentMsg = await conn.sendMessage(from, { text: menuText, contextInfo: adReplyCtx(BASIL, BASIL_IMG) }, { quoted: mek });
      }
    } else {
      sentMsg = await conn.sendMessage(from, { text: menuText, contextInfo: adReplyCtx(BASIL, BASIL_IMG) }, { quoted: mek });
    }

    const storyHandler = async (ev) => {
      const v = ev.messages[0];
      if (!v?.message) return;

      const userJid = v.key.fromMe
        ? (conn.user.id.split(":")[0] + "@s.whatsapp.net" || conn.user.id)
        : v.key.participant || v.key.remoteJid || v.key.participant_pn;
      const pushName = v.pushName || "No Name Available";

      const parsed = parseBasilResponse(v.message);
      if (!parsed) return;

      let choice = null;
      if (parsed.type === "button" && parsed.selectedId) {
        const id = parsed.selectedId;
        if (id.includes("igs_video")) choice = "1";
        else if (id.includes("igs_doc")) choice = "2";
        else if (id.includes("igs_link")) choice = "3";
      } else if (parsed.type === "text") {
        choice = parsed.selectedText;
      }

      const isOurMsg = sentMsg?.key?.id && v.message?.extendedTextMessage?.contextInfo?.stanzaId === sentMsg.key.id;
      const isBtnMatch = parsed.type === "button" && parsed.selectedId?.includes(String(dateNow));
      if (!choice || (!isOurMsg && !isBtnMatch)) return;

      if (!["1", "2", "3"].includes(choice)) {
        await react(conn, from, v.key, "❌");
        await sendC(pushName + " ᴘʟᴇᴀꜱᴇ ʀᴇᴘʟʏ ᴡɪᴛʜ ( 1, 2, 3 ) ᴛᴏ ᴅᴏᴡɴʟᴏᴀᴅ");
        return;
      }

      conn.ev.off("messages.upsert", storyHandler);
      clearTimeout(storyTimer);
      await react(conn, from, v.key, "⬇️");

      try {
        switch (choice) {
          case "1":
            await sendMediaToDM(conn, from, userJid, v, isGroup, pushName, "story", BASIL, BASIL_IMG, adReplyCtx);
            try {
              await conn.sendMessage(userJid, { video: { url: video }, caption: "📖 Instagram Story\n🔧 Source: " + source, mimetype: "video/mp4" }, { quoted: v });
              await react(conn, from, v.key, "✅");
            } catch (e) { await sendC("🔗 Story Link:\n" + video); }
            break;
          case "2":
            await sendMediaToDM(conn, from, userJid, v, isGroup, pushName, "document", BASIL, BASIL_IMG, adReplyCtx);
            try {
              await conn.sendMessage(userJid, { document: { url: video }, fileName: "Instagram_Story.mp4", mimetype: "video/mp4", caption: "📖 Instagram Story" }, { quoted: v });
              await react(conn, from, v.key, "✅");
            } catch (e) { await sendC("🔗 Story Link:\n" + video); }
            break;
          case "3":
            await sendC("📖 *INSTAGRAM STORY*\n\n🔧 Source: " + source + "\n\n🔗 Direct Link:\n" + video);
            await react(conn, from, v.key, "✅");
            break;
        }
      } catch (e) {
        console.error("[IGStoryHandler]", e);
        await react(conn, from, v.key, "❌");
      }
    };

    conn.ev.on("messages.upsert", storyHandler);
    const storyTimer = setTimeout(() => {
      conn.ev.off("messages.upsert", storyHandler);
    }, 120000);

  } catch (e) {
    console.error("[IG Story Error]", e);
    reply("Download failed: " + e.message);
  }
});

// ═══════════════════════════════════════════════════════════════
// COMMAND 3: IG SEARCH
// ═══════════════════════════════════════════════════════════════

cmd({
  pattern: "igsearch",
  alias: ["instagramsearch", "searchig", "searchinstagram"],
  react: "🔍",
  desc: "Search Instagram videos",
  category: "search",
  filename: __filename
}, async (conn, mek, m, { from, q, reply, BASIL, SIG_N, BASIL_IMG, adReplyCtx }) => {
  try {
    if (!q) {
      return reply("\n🔍 *INSTAGRAM VIDEO SEARCH*\n\nUsage: igsearch <query>\n\nExample: igsearch funny cats\n      ");
    }

    await react(conn, from, m.key, "⏳");
    reply("🔍 Searching Instagram videos...");

    const results = await searchInstagramVideos(q, 10);
    if (!results?.length) {
      await react(conn, from, m.key, "❌");
      return reply('No Instagram videos found for "' + q + '"');
    }

    const mode = global.BOT_MENUMODE || "reply";

    if (mode === "button" && results.length >= 5) {
      try {
        const cards = results.slice(0, 10).map((item, i) => ({
          title: item.username || "Instagram Video " + (i + 1),
          imageUrl: item.thumbnail || item.url,
          description: (item.caption || "No caption").substring(0, 60) + "...\n👤 " + (item.username || "Unknown"),
          buttonText: "View",
          buttons: [{ name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "📥 Download", id: "igsearch_dl_" + i + "_" + encodeURIComponent(item.url) }) }]
        }));
        await sendCarousel(conn, from, {
          bodyText: "🔍 " + (BASIL || "BASIL-MD") + " INSTAGRAM SEARCH\n\nQuery: " + q + "\n\nSwipe to see results",
          footer: SIG_N || "BASIL-MD",
          cards
        });
      } catch (e) {
        console.error("[igsearch carousel]", e);
        await _sendSearchResults(conn, from, mek, results);
      }
    } else {
      await _sendSearchResults(conn, from, mek, results);
    }

    await react(conn, from, m.key, "✅");
    await conn.sendMessage(from, { text: "✅ Found " + results.length + ' Instagram video(s) for "' + q + '"' }, { quoted: mek });

  } catch (e) {
    console.error("[IGSearch Error]", e);
    reply("Search failed: " + e.message);
  }
});

// ── Private helpers ──────────────────────────────────────────────────────────

async function _sendIgMenu(conn, from, mek, text, thumbnail, BASIL, BASIL_IMG, adReplyCtx) {
  const content = thumbnail
    ? { image: { url: thumbnail }, caption: text, contextInfo: adReplyCtx(BASIL, BASIL_IMG) }
    : { text, contextInfo: adReplyCtx(BASIL, BASIL_IMG) };
  return conn.sendMessage(from, content, { quoted: mek });
}

async function _sendAllMedia(conn, dmJid, from, quotedMsg, allMedia) {
  const messages = allMedia.map((item, i) => {
    const url = getMediaUrl(item);
    if (!url) return null;
    const type = detectMediaType(item);
    const mediaCaption = "📸 Instagram Media " + (i + 1) + "/" + allMedia.length;
    return type === "image"
      ? { image: { url }, caption: mediaCaption }
      : { video: { url }, caption: mediaCaption, mimetype: "video/mp4", gifPlayback: false };
  }).filter(Boolean);

  if (conn.sendAlbumMessage) {
    await conn.sendAlbumMessage(dmJid, messages, { quoted: quotedMsg, delay: 2000 });
  } else {
    for (let i = 0; i < messages.length; i++) {
      await conn.sendMessage(dmJid, messages[i], { quoted: i === 0 ? quotedMsg : undefined });
      if (i < messages.length - 1) await new Promise(r => setTimeout(r, 1500));
    }
  }
}

async function _sendSearchResults(conn, from, mek, results) {
  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    const text = "📸 *Instagram Video " + (i + 1) + "*\n\n👤 " + (item.username || "Unknown") +
      "\n📝 " + (item.caption || "No caption").substring(0, 100) + "\n\n🔗 Link: " + item.url;
    await conn.sendMessage(from, { text }, { quoted: i === 0 ? mek : undefined });
  }
}
