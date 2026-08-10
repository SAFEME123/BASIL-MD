import { cmd } from '../command.js';
import { getFilename } from '../lib/path-helpers.js';
import { sendBasilButtons, parseBasilResponse, createBasilButton } from '../lib/basilButtonHandler.js';
import { extractSenderInfo } from '../lib/jid-lid-helper.js';
import { safeDeleteMsg } from './messages.js';
import axios from 'axios';
import { fmtBytes, getMimetype, truncateText, titleToSlug, formatGenres } from '../lib/formatUtils.js';
import { safeGet, safePost } from '../lib/apiHelper.js';
import { sendSelectionMenu, waitForSelection } from '../lib/interactiveMenu.js';

const __filename = getFilename(import.meta.url);

// ── API constants ────────────────────────────────────────────────────────────
const ANILIST_GQL = 'https://graphql.anilist.co';
const GOGO_API    = 'https://gogoanime.consumet.stream';
const JIKAN_API   = 'https://api.jikan.moe/v4';
const CONSUMET_API = 'https://api.consumet.org';
const DEFAULT_IMAGE = 'https://i.ibb.co/ZYgMz3v/basil-md.jpg';
const _ANI_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';

// ── AniList GraphQL helper ───────────────────────────────────────────────────
async function anilistQuery(query, variables = {}) {
  const data = await safePost(ANILIST_GQL, { query, variables }, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    timeout: 12000
  }, '[AniList GQL]');
  return data?.data || null;
}

// ── AniNeko.to scraper ───────────────────────────────────────────────────────
async function aninekoGetInfo(slug) {
  const data = await safeGet(`https://anineko.to/watch/${slug}`, {
    timeout: 12000,
    headers: { 'User-Agent': _ANI_UA }
  }, '[AniNeko Info]');
  if (!data) return null;
  const html = data;
  const epMatches = [...html.matchAll(/href="\/watch\/[^/]+\/ep-(\d+)"/g)];
  const maxEp = epMatches.reduce((m, x) => Math.max(m, parseInt(x[1]) || 0), 0);
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const pageTitle = titleMatch?.[1]?.trim() || slug;
  return { slug, title: pageTitle, episodes: maxEp, url: `https://anineko.to/watch/${slug}` };
}

async function aninekoGetDownloadLinks(slug, epNum) {
  const data = await safeGet(`https://anineko.to/download/${slug}/ep-${epNum}`, {
    timeout: 12000,
    headers: { 'User-Agent': _ANI_UA }
  }, '[AniNeko DL]');
  if (!data) return [];
  const linkMatches = [...data.matchAll(/href="(https?:\/\/(?:playmogo|otakuhg|otakuvid)[^"]+)"/g)];
  return [...new Set(linkMatches.map(m => m[1]))].slice(0, 8);
}

async function resolveAninekoLink(linkUrl) {
  try {
    const res = await axios.get(linkUrl, {
      headers: { 'User-Agent': _ANI_UA, Accept: '*/*' },
      maxRedirects: 10,
      timeout: 25000,
      validateStatus: () => true
    });
    const finalUrl = res.request?.res?.responseUrl || res.request?.path
      ? (res.request?.protocol + '//' + res.request?.host + res.request?.path) : linkUrl;
    const cd  = res.headers['content-disposition'] || '';
    const cl  = res.headers['content-length'];
    const sizeBytes = cl ? parseInt(cl) : 0;
    let filename = 'episode.mp4';
    const cdMatch = cd.match(/filename[^;=\n]*=\s*["']?([^"';\n]+)/i);
    if (cdMatch) filename = cdMatch[1].trim().replace(/^"|"$/g, '');
    else {
      const urlPart = (finalUrl || linkUrl).split('/').pop().split('?')[0];
      if (urlPart && urlPart.includes('.')) filename = decodeURIComponent(urlPart);
    }
    return { url: finalUrl || linkUrl, filename, sizeBytes, contentType: res.headers['content-type'] || 'video/mp4' };
  } catch (e) {
    console.log('[AniNeko Resolve]', e.message);
    return null;
  }
}

async function aninekoDeliver(conn, from, quotedMsg, linkUrl, label) {
  await conn.sendMessage(from, { text: `⏳ Preparing *${label}*...` }, { quoted: quotedMsg });
  const resolved = await resolveAninekoLink(linkUrl);
  if (!resolved?.url) {
    return conn.sendMessage(from, { text: `❌ Could not fetch *${label}*. Try again later.` }, { quoted: quotedMsg });
  }
  const { url, filename, sizeBytes } = resolved;
  const sizeStr = fmtBytes(sizeBytes);
  const caption  = `🌏 *${label}*${sizeStr ? `\n📦 ${sizeStr}` : ''}`;
  try {
    await conn.sendMessage(from, {
      document: { url },
      mimetype: getMimetype(filename),
      fileName: filename,
      caption
    }, { quoted: quotedMsg });
    await conn.sendMessage(from, { react: { text: '✅', key: quotedMsg.key } });
  } catch (e) {
    await conn.sendMessage(from, {
      text: `❌ Failed to send *${label}*. Try a different server.\n\n🔗 ${url}`
    }, { quoted: quotedMsg });
  }
}

// ── API helpers ──────────────────────────────────────────────────────────────
async function gogoApiGet(path) {
  const url = `${GOGO_API}${path}`;
  const res = await axios.get(url, { timeout: 15000 });
  return res.data;
}

function jikanRequest(endpoint, params = {}) {
  return safeGet(`${JIKAN_API}${endpoint}`, { params, timeout: 15000 }, '[Jikan API]');
}

async function consumetSearch(query, provider = 'gogoanime') {
  const data = await safeGet(
    `${CONSUMET_API}/anime/${provider}/${encodeURIComponent(query)}`,
    { timeout: 15000 },
    '[Consumet Search]'
  );
  return data?.results || null;
}

async function consumetInfo(id, provider = 'gogoanime') {
  return safeGet(
    `${CONSUMET_API}/anime/${provider}/info/${id}`,
    { timeout: 15000 },
    '[Consumet Info]'
  );
}

async function consumetEpisodeSources(episodeId, provider = 'gogoanime') {
  return safeGet(
    `${CONSUMET_API}/anime/${provider}/watch/${episodeId}`,
    { timeout: 15000 },
    '[Consumet Sources]'
  );
}

// ── Formatting ───────────────────────────────────────────────────────────────
function formatAnimeInfo(anime, baseData) {
  const title    = anime.title || baseData.title || 'Unknown';
  const type     = anime.type || baseData.type || 'N/A';
  const episodes = anime.episodes || baseData.episodes || '?';
  const status   = anime.status || baseData.status || 'N/A';
  const score    = anime.score || baseData.score || 'N/A';
  const genres   = anime.genres || baseData.genres || [];
  const synopsis = anime.synopsis || anime.description || baseData.synopsis || 'No description available.';

  return `
🎌 *${title}*

📺 *Type:* ${type}
📊 *Episodes:* ${episodes}
📡 *Status:* ${status}
⭐ *Score:* ${score}

🎭 *Genres:* ${formatGenres(genres)}

📝 *Synopsis:*
${truncateText(synopsis, 600)}
  `.trim();
}

function getAnimeImage(item) {
  return item?.image || item?.images?.jpg?.large_image_url || DEFAULT_IMAGE;
}

// ═══════════════════════════════════════════════════════════════
// SHARED UI HANDLER: INFO + EPISODES -> DOWNLOAD
// ═══════════════════════════════════════════════════════════════

async function handleAnimeSelection(conn, mek, m, from, sender, selectedAnime, pushname, BASIL, BASIL_IMG, adReplyCtx, SIG_N, mode) {
  try {
    const animeId = selectedAnime.id || selectedAnime.mal_id || selectedAnime.title;

    let fullInfo = null;
    let episodes = [];
    let isAnineko = selectedAnime.anineko;

    if (!isAnineko && selectedAnime.id) {
      try {
        const cInfo = await consumetInfo(selectedAnime.id, 'gogoanime');
        if (cInfo) { fullInfo = cInfo; if (cInfo.episodes) episodes = cInfo.episodes; }
      } catch(e){}
    }

    if (episodes.length === 0) {
      isAnineko = true;
      const slug = titleToSlug(selectedAnime.title || selectedAnime.english || selectedAnime.romaji || '');
      const aInfo = await aninekoGetInfo(slug);
      if (aInfo && aInfo.episodes > 0) {
        for(let i=1; i<=aInfo.episodes; i++) episodes.push({ id: `anineko_${slug}_${i}`, number: i });
      }
    }

    if (!fullInfo) {
      if (selectedAnime.mal_id) {
        try { fullInfo = (await jikanRequest(`/anime/${selectedAnime.mal_id}/full`))?.data; } catch(e){}
      }
      if (!fullInfo) {
        const gqlInfo = `query ($id: Int) { Media(id: $id) { title { english romaji } episodes status averageScore genres description coverImage { large } } }`;
        const alInfo = await anilistQuery(gqlInfo, { id: animeId });
        if (alInfo?.Media) fullInfo = {
          title: alInfo.Media.title.english || alInfo.Media.title.romaji,
          episodes: alInfo.Media.episodes, status: alInfo.Media.status, score: alInfo.Media.averageScore,
          genres: alInfo.Media.genres, synopsis: alInfo.Media.description,
          images: { jpg: { large_image_url: alInfo.Media.coverImage?.large } }
        };
      }
    }

    const infoMsg = formatAnimeInfo(fullInfo || selectedAnime, selectedAnime);
    const infoImage = getAnimeImage(fullInfo) !== DEFAULT_IMAGE ? getAnimeImage(fullInfo) : getAnimeImage(selectedAnime);

    if (episodes.length === 0) {
      const noEpDesc = infoMsg + `\n\n────────────────────────\n\n❌ No episodes found for download.\n`;
      return await conn.sendMessage(from, { image: { url: infoImage }, caption: noEpDesc, contextInfo: adReplyCtx(BASIL, BASIL_IMG) }, { quoted: mek });
    }

    const limitedEps = episodes.length > 30 ? episodes.slice(-30) : episodes;
    let episodeDesc = infoMsg + `\n\n────────────────────────\n\n📥 *SELECT EPISODE TO DOWNLOAD*\n`;
    if (episodes.length > 30) episodeDesc += `(Showing last 30 episodes out of ${episodes.length})\n\n`;
    else episodeDesc += `\n`;
    limitedEps.forEach((ep, i) => { episodeDesc += `${i+1}. Episode ${ep.number || ep.id.split('-').pop()}\n`; });
    episodeDesc += `\n_Reply with a number to download_`;

    const ctx = { BASIL, BASIL_IMG, adReplyCtx, SIG_N };
    const epItems = limitedEps.map((ep) => ({ label: `Ep ${ep.number || ep.id.split('-').pop()}` }));
    const { sentMsg: sentMsg2, dateNow } = await sendSelectionMenu(conn, from, mek, {
      title: 'ANIME DOWNLOAD', desc: episodeDesc, imageUrl: infoImage,
      items: epItems.slice(0, 10), idPrefix: 'anidl_ep'
    }, ctx);

    const { selectedIdx: selectedEpIdx, message: v2 } = await waitForSelection(
      conn, from, sender, sentMsg2, dateNow, 'anidl_ep', limitedEps.length, 180000
    );

    if (selectedEpIdx < 0 || !v2) return;
    await conn.sendMessage(from, { react: { text: "⬇️", key: v2.key } });

    try {
      const selectedEp = limitedEps[selectedEpIdx];
      const epLabel = `${selectedAnime.title || fullInfo?.title} Ep ${selectedEp.number || selectedEp.id.split('-').pop()}`;

      if (from.endsWith('@g.us')) await conn.sendMessage(from, { text: `*${pushname}* sending to your DM ⏳` }, { quoted: v2 });

      if (isAnineko || String(selectedEp.id).startsWith('anineko_')) {
        const slug = titleToSlug(selectedAnime.title || selectedAnime.english || selectedAnime.romaji || '');
        const links = await aninekoGetDownloadLinks(slug, selectedEp.number);
        if (!links.length) {
          await conn.sendMessage(from, { react: { text: "❌", key: v2.key } });
          return conn.sendMessage(sender, { text: `❌ No sources for ${epLabel}` });
        }
        await aninekoDeliver(conn, sender, v2, links[0], epLabel);
        await conn.sendMessage(from, { react: { text: "✅", key: v2.key } });
        return;
      }

      const sources = await consumetEpisodeSources(selectedEp.id, 'gogoanime');
      const videoUrl = sources?.sources?.[0]?.url;
      if (!videoUrl) {
        await conn.sendMessage(from, { react: { text: "❌", key: v2.key } });
        return conn.sendMessage(sender, { text: "❌ Could not extract video URL" }, { quoted: v2 });
      }

      try {
        await conn.sendMessage(sender, { document: { url: videoUrl }, mimetype: 'video/mp4', fileName: `${epLabel}.mp4`, caption: `🌏 *${epLabel}*` }, { quoted: v2 });
      } catch (_) {
        await conn.sendMessage(sender, { video: { url: videoUrl }, caption: `🌏 *${epLabel}*`, mimetype: 'video/mp4' }, { quoted: v2 });
      }
      await conn.sendMessage(from, { react: { text: "✅", key: v2.key } });
    } catch (e) { await conn.sendMessage(from, { react: { text: "❌", key: v2.key } }); }

  } catch (e) {
    console.error(e);
    await conn.sendMessage(from, { text: `❌ Error processing anime: ${e.message}` });
  }
}

// ═══════════════════════════════════════════════════════════════
// Generic list-and-select command factory
// ═══════════════════════════════════════════════════════════════

async function animeListCommand(conn, mek, m, { reply, from, sender, BASIL, BASIL_IMG, adReplyCtx, SIG_N, pushname, isGroup }, {
  fetchResults, title, emoji, idPrefix, onSelect, maxItems = 15, timeoutMs = 120000
}) {
  try {
    const mode = global.BOT_MENUMODE || 'reply';
    const results = await fetchResults();

    if (!results?.length) {
      return reply(`❌ Could not fetch ${title.toLowerCase()}`);
    }

    const itemCount = Math.min(maxItems, results.length);
    let desc = `${emoji} *${title}*\n\n`;
    results.slice(0, itemCount).forEach((a, i) => {
      desc += `${i+1}. ${a.title || a.mal_id || `Anime ${i+1}`}\n`;
    });
    desc += `\n_Reply with a number to view info & download_`;

    const imageUrl = getAnimeImage(results[0]);
    const items = results.slice(0, itemCount).map(a => ({
      label: (a.title || a.mal_id || 'Anime').substring(0, 20)
    }));
    const ctx = { BASIL, BASIL_IMG, adReplyCtx, SIG_N };

    const { sentMsg, dateNow } = await sendSelectionMenu(conn, from, mek, {
      title, desc, imageUrl, items, idPrefix
    }, ctx);

    const { selectedIdx, message: v } = await waitForSelection(
      conn, from, sender, sentMsg, dateNow, idPrefix, itemCount, timeoutMs
    );

    if (selectedIdx < 0 || !v) return;
    await conn.sendMessage(from, { react: { text: "⏳", key: v.key } });

    if (onSelect) {
      await onSelect(conn, v, m, from, sender, results[selectedIdx], pushname, BASIL, BASIL_IMG, adReplyCtx, SIG_N, mode, results, imageUrl);
    } else {
      await handleAnimeSelection(conn, v, m, from, sender, results[selectedIdx], pushname, BASIL, BASIL_IMG, adReplyCtx, SIG_N, mode);
    }
  } catch (e) {
    reply(`❌ Error: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// COMMAND 1: ANIME (SEARCH, INFO & DOWNLOAD)
// ═══════════════════════════════════════════════════════════════

cmd({
  pattern: "anime",
  alias: ["anisearch", "animedl", "anidl", "animeinfo", "downloadanime"],
  react: "🎌",
  desc: "Search, get info and download anime",
  category: "anime",
  filename: __filename
},
async (conn, mek, m, params) => {
  const { q, reply } = params;
  if (!q) return reply(`🎌 *ANIME CENTER*\n\nUsage: ${global.prefix}anime <title>\nExample: ${global.prefix}anime Naruto`);
  await reply("🔍 Searching anime...");

  await animeListCommand(conn, mek, m, params, {
    title: 'ANIME SEARCH RESULTS',
    emoji: '🎌',
    idPrefix: 'ani_sel',
    maxItems: 10,
    fetchResults: async () => {
      let results = null;
      try { results = await consumetSearch(q, 'gogoanime'); } catch (e) {}
      if (!results?.length) {
        const jikan = await jikanRequest('/anime', { q, limit: 10, sfw: true });
        if (jikan?.data) results = jikan.data.map(a => ({ id: a.mal_id, mal_id: a.mal_id, title: a.title, image: a.images?.jpg?.large_image_url, anineko: true }));
      }
      if (!results?.length) {
        const gql = `query ($search: String) { Page(page: 1, perPage: 10) { media(search: $search, type: ANIME) { id title { english romaji } coverImage { large } } } }`;
        const al = await anilistQuery(gql, { search: q });
        if (al?.Page?.media) results = al.Page.media.map(a => ({ title: a.title.english || a.title.romaji, mal_id: a.id, image: a.coverImage?.large, anineko: true }));
      }
      return results || [];
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// COMMAND 2: TRENDING & POPULAR ANIME
// ═══════════════════════════════════════════════════════════════

cmd({
  pattern: 'trendinganime',
  alias: ['animetrending', 'popularanime', 'animehot'],
  react: '🔥',
  desc: 'Trending & Popular anime',
  category: 'anime',
  filename: __filename
},
async (conn, mek, m, params) => {
  await params.reply("⏳ Fetching trending anime...");

  await animeListCommand(conn, mek, m, params, {
    title: 'TRENDING & POPULAR ANIME',
    emoji: '🔥',
    idPrefix: 'ani_trnd',
    fetchResults: async () => {
      let results = [];
      try { const res = await gogoApiGet('/home'); if (res?.trending) results = res.trending; } catch (e) {}
      if (!results.length) {
        const jikan = await jikanRequest('/top/anime', { limit: 15 });
        if (jikan?.data) results = jikan.data.map(a => ({ id: a.mal_id, mal_id: a.mal_id, title: a.title, image: a.images?.jpg?.large_image_url, anineko: true }));
      }
      return results;
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// COMMAND 3: LATEST & ONGOING ANIME
// ═══════════════════════════════════════════════════════════════

cmd({
  pattern: 'latestanime',
  alias: ['animerecent', 'animeupcoming', 'airing'],
  react: '📺',
  desc: 'Recent and Airing anime',
  category: 'anime',
  filename: __filename
},
async (conn, mek, m, params) => {
  await params.reply("⏳ Fetching latest anime...");

  await animeListCommand(conn, mek, m, params, {
    title: 'LATEST & AIRING ANIME',
    emoji: '📺',
    idPrefix: 'ani_lat',
    fetchResults: async () => {
      let results = [];
      try { const res = await gogoApiGet('/recent/1'); if (Array.isArray(res)) results = res; } catch (e) {}
      if (!results.length) {
        const jikan = await jikanRequest('/seasons/now', { limit: 15 });
        if (jikan?.data) results = jikan.data.map(a => ({ id: a.mal_id, mal_id: a.mal_id, title: a.title, image: a.images?.jpg?.large_image_url, anineko: true }));
      }
      return results;
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// COMMAND 4: ANILIST SEARCH — via GraphQL
// ═══════════════════════════════════════════════════════════════

cmd({
  pattern: 'anilist',
  alias: ['alsearch', 'anisearch2'],
  react: '🌸',
  desc: 'Search anime via AniList (rich metadata)',
  category: 'anime',
  filename: __filename,
  use: '<title>'
}, async (conn, mek, m, { q, reply, from, BASIL, BASIL_IMG, adReplyCtx }) => {
  try {
    if (!q) return reply('Usage: .anilist <anime title>\nExample: .anilist Attack on Titan');
    await reply('🔍 Searching AniList...');

    const gql = `
      query ($search: String) {
        Page(page: 1, perPage: 5) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id title { english romaji native }
            episodes status averageScore popularity genres format
            season seasonYear
            description(asHtml: false)
            coverImage { large }
            siteUrl
            studios(isMain: true) { nodes { name } }
            nextAiringEpisode { episode airingAt }
          }
        }
      }
    `;

    const data = await anilistQuery(gql, { search: q });
    const list = data?.Page?.media || [];

    if (!list.length) return reply(`❌ No AniList results for: *${q}*`);

    const line = '─'.repeat(28);
    let msg = `🌸 *AniList Search — ${q}*\n${line}\n\n`;

    for (const a of list) {
      const title = a.title.english || a.title.romaji || a.title.native || 'Unknown';
      const score = a.averageScore ? `${a.averageScore}/100` : 'N/A';
      const eps   = a.episodes || '?';
      const genres = (a.genres || []).slice(0, 3).join(', ') || 'N/A';
      const studio = a.studios?.nodes?.[0]?.name || 'N/A';
      const airing = a.nextAiringEpisode
        ? `\n⏳ *Next Ep ${a.nextAiringEpisode.episode}:* ${new Date(a.nextAiringEpisode.airingAt * 1000).toDateString()}`
        : '';
      const desc = a.description
        ? a.description.replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n').slice(0, 300) + '...'
        : 'No description.';

      msg += `🎌 *${title}*\n`;
      msg += `📺 ${a.format || 'TV'} • ${eps} eps • ${a.seasonYear || ''}\n`;
      msg += `⭐ Score: ${score} • 👥 ${a.popularity?.toLocaleString() || 'N/A'} fans\n`;
      msg += `🎭 ${genres} • 🏢 ${studio}${airing}\n`;
      msg += `📝 ${desc}\n`;
      msg += `🔗 ${a.siteUrl}\n${line}\n\n`;
    }

    const cover = list[0]?.coverImage?.large;
    if (cover) {
      await conn.sendMessage(from, {
        image: { url: cover }, caption: msg, contextInfo: adReplyCtx(BASIL, BASIL_IMG)
      }, { quoted: mek });
    } else {
      await conn.sendMessage(from, { text: msg }, { quoted: mek });
    }
  } catch (e) {
    console.error('[AniList Search]', e.message);
    reply(`❌ AniList search failed: ${e.message}`);
  }
});

// ═══════════════════════════════════════════════════════════════
// COMMAND 5: CURRENTLY AIRING — via AniList
// ═══════════════════════════════════════════════════════════════

cmd({
  pattern: 'airingnow',
  alias: ['currentanime', 'nowaired'],
  react: '📡',
  desc: 'Currently airing anime from AniList',
  category: 'anime',
  filename: __filename
}, async (conn, mek, m, { reply, from, BASIL, BASIL_IMG, adReplyCtx }) => {
  try {
    await reply('📡 Fetching currently airing anime...');

    const gql = `
      query {
        Page(page: 1, perPage: 15) {
          media(status: RELEASING, type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
            id title { english romaji }
            episodes averageScore genres format seasonYear
            coverImage { medium }
            nextAiringEpisode { episode airingAt }
          }
        }
      }
    `;

    const data = await anilistQuery(gql);
    const list = data?.Page?.media || [];

    if (!list.length) {
      const jikan = await jikanRequest('/seasons/now', { limit: 15 });
      const results = jikan?.data || [];
      if (!results.length) return reply('❌ Could not fetch airing anime.');
      let fb = `📡 *Currently Airing Anime*\n${'─'.repeat(28)}\n\n`;
      results.forEach((a, i) => { fb += `${i + 1}. *${a.title}* — Score: ${a.score || 'N/A'}\n`; });
      return reply(fb);
    }

    const line = '─'.repeat(28);
    let msg = `📡 *Currently Airing Anime*\n${line}\n\n`;

    list.slice(0, 15).forEach((a, i) => {
      const title = a.title.english || a.title.romaji || 'Unknown';
      const score = a.averageScore ? `${a.averageScore}/100` : '?';
      const next  = a.nextAiringEpisode
        ? `Ep ${a.nextAiringEpisode.episode} — ${new Date(a.nextAiringEpisode.airingAt * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`
        : 'Ongoing';
      msg += `${i + 1}. *${title}* ⭐${score}\n   📺 ${a.format} • ${next}\n\n`;
    });

    msg += `_Use .anilist <title> for full info_`;

    const cover = list[0]?.coverImage?.medium;
    if (cover) {
      await conn.sendMessage(from, {
        image: { url: cover }, caption: msg, contextInfo: adReplyCtx(BASIL, BASIL_IMG)
      }, { quoted: mek });
    } else {
      await conn.sendMessage(from, { text: msg }, { quoted: mek });
    }
  } catch (e) {
    console.error('[Airing]', e.message);
    reply(`❌ Failed: ${e.message}`);
  }
});

// ═══════════════════════════════════════════════════════════════
// COMMAND 6: ANINEKO DOWNLOAD — scrape episode download links
// ═══════════════════════════════════════════════════════════════

cmd({
  pattern: 'aninekodl',
  alias: ['anidlep', 'animedownload', 'nekodl'],
  react: '📥',
  desc: 'Download anime episode from AniNeko',
  category: 'anime',
  filename: __filename,
  use: '<anime title> <episode>'
}, async (conn, mek, m, { q, reply, from, sender, BASIL, BASIL_IMG, adReplyCtx, SIG_N }) => {
  try {
    if (!q) return reply(
      `🌏 *Anime Episode Downloader*\n\nUsage: *.aninekodl <title> <episode>*\n\nExamples:\n• .aninekodl naruto 1\n• .aninekodl one piece 1050\n• .aninekodl attack on titan 1`
    );

    const parts    = q.trim().split(/\s+/);
    const lastPart = parts[parts.length - 1];
    if (!/^\d+$/.test(lastPart) || parts.length < 2)
      return reply('❌ Include episode number at end.\nExample: .aninekodl naruto 5');

    const epNum      = parseInt(lastPart);
    let titleQuery   = parts.slice(0, -1).join(' ');
    let slug         = titleToSlug(titleQuery);

    await reply(`🔍 Fetching Episode *${epNum}* of *${titleQuery}*...`);

    const info = await aninekoGetInfo(slug);
    if (!info || info.episodes === 0) {
      const jikan = await jikanRequest('/anime', { q: titleQuery, limit: 1, sfw: true });
      const best  = jikan?.data?.[0];
      if (best) { slug = titleToSlug(best.title_english || best.title); titleQuery = best.title_english || best.title; }
    }

    const animeTitle = info?.title || titleQuery;
    const label      = `${animeTitle} Ep ${epNum}`;
    const links      = await aninekoGetDownloadLinks(slug, epNum);

    if (!links.length) {
      return conn.sendMessage(from, {
        text: `❌ No download sources found for\n*${label}*\n\nTry a slightly different title spelling.`
      }, { quoted: mek });
    }

    if (links.length === 1) {
      return aninekoDeliver(conn, from, mek, links[0], label);
    }

    const ctx = { BASIL, BASIL_IMG, adReplyCtx, SIG_N };
    let desc = `🌏 *${animeTitle}*\n📺 Episode ${epNum}\n${'─'.repeat(24)}\n\n*Select a server:*\n\n`;
    links.forEach((_, i) => { desc += `${i + 1}. Server ${i + 1}\n`; });
    desc += `\n_Reply with number to download_`;

    const serverItems = links.slice(0, 6).map((_, i) => ({ label: `Server ${i + 1}` }));
    const { sentMsg: sentMenu, dateNow } = await sendSelectionMenu(conn, from, mek, {
      title: animeTitle, desc, items: serverItems, idPrefix: 'ank_srv'
    }, ctx);

    const { selectedIdx: idx, message: v } = await waitForSelection(
      conn, from, sender, sentMenu, dateNow, 'ank_srv', links.length, 120000
    );

    if (idx < 0 || !v) return;
    if (sentMenu?.key) safeDeleteMsg(conn, from, sentMenu.key).catch(() => {});
    await aninekoDeliver(conn, from, v, links[idx], label);

  } catch (e) {
    console.error('[AniNeko DL]', e.message);
    reply(`❌ ${e.message}`);
  }
});
