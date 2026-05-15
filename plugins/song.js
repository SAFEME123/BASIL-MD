import { cmd, commands } from '../command.js';
import yts from 'yt-search';
import pkg from 'nayan-media-downloaders';
const { ytdown } = pkg;
import { fetchJson, toSmallCaps } from '../lib/functions.js';
import { sendBasilButtons, parseBasilResponse, createBasilButton } from '../lib/basilButtonHandler.js';
import { getFilename } from '../lib/path-helpers.js';
import { extractSenderInfo } from '../lib/jid-lid-helper.js'; // kept for other utils if needed
const __filename = getFilename(import.meta.url);
const w2 = "`";


cmd({
pattern: "song", 
alias: ["play", "music"],
react: "🎵",
desc: "Download songs - works with button or reply",
category: "download",
filename: __filename
},
async (conn, mek, m, { from, quoted, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply, sendC, adReplyCtx, adReplyCtx1, BASIL, BASIL_IMG, sendA, sendV, SIG_N}) => {

try {

if (!q) return sendC(`*${pushname}* ɢɪᴠᴇ ᴍᴇ ᴀ ᴛɪᴛʟᴇ`);

// Use global menumode set by owner/creator/sudo (no user-specific mode)
const mode = global.BOT_MENUMODE || 'reply';

const search = await yts(q);
const data = search?.videos?.[0];

if(!data){
  await mek.react(`❌`);
  return sendC(`ꜱᴏʀʀʏ *${pushname}* ${toSmallCaps(`No results found for `)} ${q}`)
}
const url = data.url;
const thumb = data.image || data.thumbnail || BASIL_IMG; // yts uses .image

// Primary: Koyeb API fo=2 (audio)
let v11 = null;
try {
  const encodedUrl = encodeURIComponent(url);
  const newApiUrl = `https://foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app/api/ytapi?url=${encodedUrl}&fo=2&qu=1080&apiKey=a1a720d8311e91dabb9c7edfb705039c272dde060a53d26f18502030e1e575a2`;
  const newDown = await fetchJson(newApiUrl);
  if (newDown?.downloadData?.url) {
    v11 = newDown.downloadData.url;
    console.log('[Song] Koyeb API success');
  } else {
    throw new Error('API response invalid');
  }
} catch (e) {
  console.error('[Song] Koyeb API failed:', e.message);
}

// Fallback: ytdown
if (!v11) {
  console.log('[Song] Falling back to ytdown...');
  try {
    const ytRes = await ytdown(url);
    if (ytRes?.url) v11 = ytRes.url;
    else if (ytRes?.formats?.length) v11 = ytRes.formats[0].url;
    else if (ytRes?.link) v11 = ytRes.link;
  } catch (e) {
    console.error('[Song] ytdown fallback failed:', e.message);
  }
}

if (!v11) {
    await mek.react('⚠️')
    return sendC(`ꜱᴏʀʀʏ *${pushname}* ᴄᴏᴜʟᴅɴ'ᴛ ɢᴇᴛ ᴅᴏᴡɴʟᴏᴀᴅ ʟɪɴᴋ. ᴘʟᴇᴀꜱᴇ ᴛʀʏ ᴀɢᴀɪɴ ʟᴀᴛᴇʀ.`,);
}

let desc = `
> 🔥 ${BASIL} 𝗦𝗢𝗡𝗚-𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥 🔥 

╭━━━━━━━━━━━━━━━━━━━━━━
❒ ➰ *TITLE:* ${data.title}
❒ 🚹 *AUTHOR:* ${data.author.name}
❒ 📃 *DESC:* ${data.description || 'N/A'}
❒ 📆 *AGO:* ${data.ago}
❒ 🕤 *TIME:* ${data.timestamp}
❒ ⏲ *DURATION:* ${data.duration}
❒ 👁 *VIEWS:* ${data.views}
╰━━━━━━━━━━━━━━━━━━━━━━

${mode === 'button' ? '*Select Download Format:*' : `> *ᖇEᑭᒪY ᗷEᒪOᗯ TO ᗪOᗯᑎᒪOᗩᗪ*
╭━━━━━━━━━━━━━━━━━━━━━━
❍ 1️⃣ - 🎤 ᴀᴜᴅɪᴏ ꜰɪʟᴇ
│┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉
❍ 2️⃣ - 📁 ᴅᴏᴄᴜᴍᴇɴᴛ ꜰɪʟᴇ
│┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉
❍ 3️⃣ - 🎙 ᴠᴏɪᴄᴇ ɴᴏᴛᴇ
╰━━━━━━━━━━━━━━━━━━━━━━`}

▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
> ${SIG_N}
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
`;

const dateNow = Date.now();
let v78 = null;

if (mode === 'button') {
  try {
    v78 = await sendBasilButtons(conn, from, {
      title: `> 🔥 ${BASIL} 𝗦𝗢𝗡𝗚-𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥 🔥`,
      text: `⟻ *Title:* ${data.title}\n⟻ *Artist:* ${data.author.name}\n⟻ *Duration:* ${data.duration}\n⟻ *Views:* ${data.views}\n\n*Select Format:*`,
      footer: SIG_N,
      image: thumb,
      buttons: [
        createBasilButton(`song_audio_${dateNow}`, '🎤 Audio File'),
        createBasilButton(`song_doc_${dateNow}`, '📁 Document'),
        createBasilButton(`song_voice_${dateNow}`, '🎙️ Voice Note')
      ]
    });
  } catch (e) {
    console.error('[Song ButtonSend]', e);
    v78 = await conn.sendMessage(from, { image: { url: thumb }, caption: desc, contextInfo: adReplyCtx(BASIL, BASIL_IMG) }, { quoted: m });
  }
} else {
  v78 = await conn.sendMessage(from, { image: { url: thumb }, caption: desc, contextInfo: adReplyCtx(BASIL, BASIL_IMG) }, { quoted: m });
}
    
const songMessageHandler = async (p39) => {
  const v80 = p39.messages[0];
  if (!v80?.message) return;

  const parsed = parseBasilResponse(v80.message);
  if (!parsed) return;

  const isOurMessage = v78?.key?.id && v80.message?.extendedTextMessage?.contextInfo?.stanzaId === v78.key.id;
  const isButtonResponse = parsed.type === 'button' && parsed.selectedId?.includes(String(dateNow));
  if (!(isOurMessage || isButtonResponse)) return;

  let v81 = null;
  if (parsed.type === 'button') {
    const buttonId = parsed.selectedId;
    if (buttonId.includes('song_audio')) v81 = '1';
    else if (buttonId.includes('song_doc')) v81 = '2';
    else if (buttonId.includes('song_voice')) v81 = '3';
  } else if (parsed.type === 'text') {
    v81 = (v80.message?.conversation || v80.message?.extendedTextMessage?.text || '').trim();
  }

  if (!['1','2','3'].includes(v81)) return;

  // Remove listener immediately to prevent stacking
  conn.ev.off('messages.upsert', songMessageHandler);
  clearTimeout(songTimeout);

  const pname = v80.pushName || 'Unknown';
  const send = v80.key.fromMe
    ? (conn.user.id.split(':')[0] + '@s.whatsapp.net' || conn.user.id)
    : (v80.key.participant || v80.key.remoteJid || v80.key.participant_pn);

  await conn.sendMessage(from, { react: { text: '⬇️', key: v80.key } });

  try {
    switch (v81) {
      case '1':
        if (isGroup) {
          await conn.sendMessage(from, { text: `*${pname}* ʏᴏᴜʀ ꜱᴏɴɢ ɪꜱ ʙᴇɪɴɢ ꜱᴇɴᴛ ᴛᴏ ʏᴏᴜʀ ᴅᴍ ʜᴀɴɢ ᴛɪɢʜᴛ`, contextInfo: adReplyCtx(BASIL, BASIL_IMG) }, { quoted: v80 });
          await conn.sendMessage(from, { react: { text: '📤', key: v80.key } });
        }
        await sendA(send, v11, data.title, false, false, thumb, data.title);
        await conn.sendMessage(from, { react: { text: '✅', key: v80.key } });
        break;

      case '2':
        if (isGroup) {
          await sendC(`*${pname}* ʏᴏᴜʀ ꜱᴏɴɢ ɪꜱ ʙᴇɪɴɢ ꜱᴇɴᴛ ᴛᴏ ʏᴏᴜʀ ᴅᴍ ʜᴀɴɢ ᴛɪɢʜᴛ`, send, BASIL_IMG, BASIL, v80);
          await conn.sendMessage(from, { react: { text: '📤', key: v80.key } });
        }
        await sendA(send, v11, data.title, true, false, thumb, data.title);
        await conn.sendMessage(from, { react: { text: '✅', key: v80.key } });
        break;

      case '3':
        if (isGroup) {
          await sendC(`*${pname}* ʏᴏᴜʀ ꜱᴏɴɢ ɪꜱ ʙᴇɪɴɢ ꜱᴇɴᴛ ᴛᴏ ʏᴏᴜʀ ᴅᴍ ʜᴀɴɢ ᴛɪɢʜᴛ`, send, BASIL_IMG, BASIL, v80);
          await conn.sendMessage(from, { react: { text: '📤', key: v80.key } });
        }
        await sendA(send, v11, data.title, false, true, thumb, data.title);
        await conn.sendMessage(from, { react: { text: '✅', key: v80.key } });
        break;

      default:
        await conn.sendMessage(from, { react: { text: '❌', key: v80.key } });
        await sendC(`${pname} ᴘʟᴇᴀꜱᴇ ʀᴇᴘʟʏ ᴡɪᴛʜ ${w2}( 1, 2, 3 )${w2} ᴛᴏ ᴅᴏᴡɴʟᴏᴀᴅ`, send, BASIL_IMG, BASIL, v80);
    }
  } catch (e) {
    console.error('[SongHandler]', e);
    await conn.sendMessage(from, { react: { text: '❌', key: v80.key } });
  }
};

conn.ev.on('messages.upsert', songMessageHandler);
const songTimeout = setTimeout(() => { conn.ev.off('messages.upsert', songMessageHandler); }, 120000);

}catch(e){
console.log(e);
return sendC(`${e}`);
}
});

//==========================VIDEO COMMAND=====44444 
cmd({
pattern: "video", 
alias: ["vid"],
react: "🎬",
desc: "Download Videos with Quality Selection",
category: "download",
filename: __filename
},
async (conn, mek, m, { from, quoted, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply, sendC, BASIL, BASIL_IMG, SIG_N, adReplyCtx, adReplyCtx1, sendV}) => {

try {

if (!q) return sendC(`*${pushname}* ɢɪᴠᴇ ᴍᴇ ᴀ ᴛɪᴛʟᴇ`);

// Use global menumode set by owner/creator/sudo (no user-specific mode)
const mode = global.BOT_MENUMODE || 'reply';

const search = await yts(q);
const data = search.videos[0];
if(!data) return sendC(`*${pushname}* ɴᴏ ᴠɪᴅᴇᴏꜱ ꜰᴏᴜɴᴅ ꜰᴏʀ ${w2}${q}${w2}`)

const url = data.url;

let qualityMenu = `
> 🔥 ${BASIL} 𝗩𝗜𝗗𝗘𝗢-𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥 🔥 

╭━━━━━━━━━━━━━━━━━━━━━━
❒ ➰ *TITLE:* ${data.title}
❒ 🚹 *AUTHOR:* ${data.author.name}
❒ 📃 *DESC:* ${data.description}
❒ ⏲ *DURATION:* ${data.duration}
❒ 👁 *VIEWS:* ${data.views} 
╰━━━━━━━━━━━━━━━━━━━━━━

${mode === 'button' ? '*Select Quality:*' : `> *ᖇEᑭᒪY ᗷEᒪOᗯ TO ꜱᴇʟᴇᴄᴛ QᴜAʟɪᴛY*
╭━━━━━━━━━━━━━━━━━━━━━━
❍ 1️⃣ - 144p (ᴛɪɴʏ)
│┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉
❍ 2️⃣ - 240p (ʟᴏw)                      
│┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉
❍ 3️⃣ - 360p (ɢᴏᴏᴅ)
│┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉
❍ 4️⃣ - 480p (ʙᴇᴛᴛᴇʀ)
│┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉
❍ 5️⃣ - 720p (ʜᴅ)
│┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉
❍ 6️⃣ - 1080p (ꜰʜᴅ)
╰━━━━━━━━━━━━━━━━━━━━━━`}

▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
> ${SIG_N}
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
`;

let strike;
let v78 = null;
const dateNow = Date.now();

if (mode === 'button') {
  // BUTTON MODE: Send ONLY buttons (no text menu)
  try {
    v78 = await sendBasilButtons(conn, from, {
      title: `> ${BASIL} 𝗩𝗜𝗗𝗘𝗢-𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥`,
      text: `⟻ *Title:* ${data.title}\n⟻ *Author:* ${data.author.name}\n⟻ *Duration:* ${data.duration}\n⟻ *Views* ${data.views}\n⟻ *Description:* ${data.description}\n\n*Select Quality:*`,
      footer: SIG_N,
      image: data.thumbnail || BASIL_IMG,
      buttons: [
        createBasilButton(`qual_144_${dateNow}`, '144p Tiny'),
        createBasilButton(`qual_240_${dateNow}`, '240p Low'),
        createBasilButton(`qual_360_${dateNow}`, '360p Good'),
        createBasilButton(`qual_480_${dateNow}`, '480p Better'),
        createBasilButton(`qual_720_${dateNow}`, '720p HD'),
        createBasilButton(`qual_1080_${dateNow}`, '1080p FHD')
      ]
    });
  } catch (e) {
    console.error('[VideoQualityButtonSend]', e);
    // Fallback to reply mode if button send fails
    strike = { image: { url: data.thumbnail || BASIL_IMG }, caption: qualityMenu, contextInfo: adReplyCtx(BASIL, BASIL_IMG)};
  }
} else {
  // REPLY MODE: Send ONLY text menu (no buttons)
  strike = { image: { url: data.thumbnail || BASIL_IMG }, caption: qualityMenu, contextInfo: adReplyCtx(BASIL, BASIL_IMG)};
}

if (strike) {
  v78 = await conn.sendMessage(from, strike, { quoted: m });
}

const videoQualHandler = async (p39) => {
  const v80 = p39.messages[0];
  if (!v80?.message) return;

  const parsed = parseBasilResponse(v80.message);
  if (!parsed) return;

  const isOurMessage = v78?.key?.id && v80.message?.extendedTextMessage?.contextInfo?.stanzaId === v78.key.id;
  const isButtonResponse = parsed.type === 'button' && parsed.selectedId?.includes(String(dateNow));
  if (!(isOurMessage || isButtonResponse)) return;

  let selectedQuality = null;
  if (parsed.type === 'button') {
    const buttonId = parsed.selectedId;
    if (buttonId.includes('qual_144')) selectedQuality = '144';
    else if (buttonId.includes('qual_240')) selectedQuality = '240';
    else if (buttonId.includes('qual_360')) selectedQuality = '360';
    else if (buttonId.includes('qual_480')) selectedQuality = '480';
    else if (buttonId.includes('qual_720')) selectedQuality = '720';
    else if (buttonId.includes('qual_1080')) selectedQuality = '1080';
  } else if (parsed.type === 'text') {
    const inputText = (v80.message?.conversation || v80.message?.extendedTextMessage?.text || '').trim();
    const qualArray = ['144', '240', '360', '480', '720', '1080'];
    const idx = parseInt(inputText) - 1;
    if (idx >= 0 && idx < qualArray.length) selectedQuality = qualArray[idx];
  }

  if (!selectedQuality) return;

  // Remove quality listener immediately
  conn.ev.off('messages.upsert', videoQualHandler);
  clearTimeout(videoQualTimeout);

  const pname = v80.pushName || 'No Name Available';
  const send = v80.key.fromMe
    ? (conn.user.id.split(':')[0] + '@s.whatsapp.net' || conn.user.id)
    : (v80.key.participant || v80.key.remoteJid || v80.key.participant_pn);

  await conn.sendMessage(from, { react: { text: '⬇️', key: v80.key } });

  try {
    // Fetch download URL
    let downloadUrl = null;
    try {
      const encodedUrl = encodeURIComponent(url);
      const newApiUrl = `https://foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app/api/ytapi?url=${encodedUrl}&fo=1&qu=${selectedQuality}&apiKey=a1a720d8311e91dabb9c7edfb705039c272dde060a53d26f18502030e1e575a2`;
      const newDown = await fetchJson(newApiUrl);
      if (newDown?.downloadData?.url) {
        downloadUrl = newDown.downloadData.url;
        console.log(`[Video] Koyeb success ${selectedQuality}p`);
      } else {
        throw new Error('API response invalid');
      }
    } catch (e) {
      console.error('[Video] API failed:', e.message);
    }

    if (!downloadUrl) {
      await conn.sendMessage(from, { react: { text: '❌', key: v80.key } });
      return sendC(`${pname} ᴄᴏᴜʟᴅɴ'ᴛ ɢᴇᴛ ${selectedQuality}ᴘ ᴅᴏᴡɴʟᴏᴀᴅ ʟɪɴᴋ. ᴛʀʏ ʟᴏᴡᴇʀ Qᴜᴀʟɪᴛʏ.`, send, BASIL_IMG, BASIL, v80);
    }

    // Type selection step
    const vidThumb = data.image || data.thumbnail || BASIL_IMG;
    const typeMenu = `
> 📥 *${selectedQuality}p — Sᴇʟᴇᴄᴛ Tʏᴘᴇ*

╭━━━━━━━━━━━━━━━━━━━━━━
❍ 1️⃣ - 🎥 ᴠɪᴅᴇᴏ ꜰɪʟᴇ
│┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉┉
❍ 2️⃣ - 📁 ᴅᴏᴄᴜᴍᴇɴᴛ ꜰɪʟᴇ
╰━━━━━━━━━━━━━━━━━━━━━━
`.trim();

    const dateNow2 = Date.now();
    let v79 = null;
    if (mode === 'button') {
      try {
        v79 = await sendBasilButtons(conn, from, {
          title: `> ${BASIL} 𝗩𝗜𝗗𝗘𝗢-𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥`,
          text: `⟻ *Quality:* ${selectedQuality}p\n\n*Select Type:*`,
          footer: SIG_N,
          image: vidThumb,
          buttons: [
            createBasilButton(`type_video_${dateNow2}`, '🎥 Video File'),
            createBasilButton(`type_doc_${dateNow2}`, '📁 Document')
          ]
        });
      } catch (e) {
        console.error('[VideoTypeButtonSend]', e);
        v79 = await conn.sendMessage(from, { image: { url: vidThumb }, caption: typeMenu, contextInfo: adReplyCtx(BASIL, BASIL_IMG) }, { quoted: v80 });
      }
    } else {
      v79 = await conn.sendMessage(from, { image: { url: vidThumb }, caption: typeMenu, contextInfo: adReplyCtx(BASIL, BASIL_IMG) }, { quoted: v80 });
    }

    // Named type handler with cleanup
    const videoTypeHandler = async (p40) => {
      const v81 = p40.messages[0];
      if (!v81?.message) return;

      const parsed2 = parseBasilResponse(v81.message);
      if (!parsed2) return;

      const isOurTypeMessage = v79?.key?.id && v81.message?.extendedTextMessage?.contextInfo?.stanzaId === v79.key.id;
      const isTypeButtonResponse = parsed2.type === 'button' && parsed2.selectedId?.includes(String(dateNow2));
      if (!(isOurTypeMessage || isTypeButtonResponse)) return;

      let selectedType = null;
      if (parsed2.type === 'button') {
        const buttonId = parsed2.selectedId;
        if (buttonId.includes('type_video')) selectedType = '1';
        else if (buttonId.includes('type_doc')) selectedType = '2';
      } else if (parsed2.type === 'text') {
        const t = (v81.message?.conversation || v81.message?.extendedTextMessage?.text || '').trim();
        if (['1', '2'].includes(t)) selectedType = t;
      }

      if (!selectedType) return;

      conn.ev.off('messages.upsert', videoTypeHandler);
      clearTimeout(videoTypeTimeout);

      const pname2 = v81.pushName || 'No Name Available';
      const send2 = v81.key.fromMe
        ? (conn.user.id.split(':')[0] + '@s.whatsapp.net' || conn.user.id)
        : (v81.key.participant || v81.key.remoteJid || v81.key.participant_pn);

      await conn.sendMessage(from, { react: { text: '⬇️', key: v81.key } });

      try {
        const isDoc = selectedType === '2';
        if (isGroup) {
          await conn.sendMessage(from, { text: `*${pname2}* ʏᴏᴜʀ ${selectedQuality}ᴘ ᴠɪᴅᴇᴏ ɪꜱ ʙᴇɪɴɢ ꜱᴇɴᴛ ᴛᴏ ʏᴏᴜʀ ᴅᴍ ʜᴀɴɢ ᴛɪɢʜᴛ`, contextInfo: adReplyCtx(BASIL, BASIL_IMG) }, { quoted: v81 });
          await conn.sendMessage(from, { react: { text: '📤', key: v81.key } });
        }
        await sendV(send2, downloadUrl, data.title, isDoc, false, vidThumb, data.title, v81);
        await conn.sendMessage(from, { react: { text: '✅', key: v81.key } });
      } catch (e) {
        console.error('[VideoTypeHandler]', e);
        await conn.sendMessage(from, { react: { text: '❌', key: v81.key } });
      }
    };

    conn.ev.on('messages.upsert', videoTypeHandler);
    const videoTypeTimeout = setTimeout(() => { conn.ev.off('messages.upsert', videoTypeHandler); }, 90000);

  } catch (e) {
    console.error('[VideoQualityHandler]', e);
    await conn.sendMessage(from, { react: { text: '❌', key: v80.key } });
  }
};

conn.ev.on('messages.upsert', videoQualHandler);
const videoQualTimeout = setTimeout(() => { conn.ev.off('messages.upsert', videoQualHandler); }, 90000);

}catch(e){
console.log(e);
return sendC(`${e}`);
}
});
