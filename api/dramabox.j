/**
 * DramaBox Proxy — Vercel Serverless
 * Commands: home | browse | search | detail
 */

const axios = require("axios");

const BASE = "https://www.dramabox.com";
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36";
const LANG = "en";

let cachedBuildId = null;
let cachedAt = 0;

async function getBuildId() {
  if (cachedBuildId && Date.now() - cachedAt < 5 * 60 * 1000) return cachedBuildId;
  const { data } = await axios.get(`${BASE}/${LANG}/search`, { headers: { "user-agent": UA }, timeout: 15000 });
  const match = data.match(/"buildId":"([^"]+)"/);
  cachedBuildId = match?.[1] ?? null;
  cachedAt = Date.now();
  return cachedBuildId;
}

function normalizeBook(v) {
  return {
    id: v.bookId,
    title: v.bookName,
    titleEn: v.bookNameEn,
    cover: v.cover || v.coverWap,
    description: v.introduction,
    tags: v.tags ?? [],
    genres: v.typeTwoNames ?? [],
    chapters: v.chapterCount ?? v.totalChapterNum,
    freeChapters: v.freeChapterNum,
    views: v.viewCountDisplay ?? v.clickNum,
    rating: v.ratings ?? v.commentScore ?? null,
    status: v.lastUpdateTimeDisplay,
    url: `${BASE}/${LANG}/drama/${v.bookId}/${v.bookNameEn}`,
  };
}

async function home() {
  const buildId = await getBuildId();
  if (!buildId) throw new Error("Gagal ambil buildId");
  const { data } = await axios.get(`${BASE}/_next/data/${buildId}/${LANG}.json`, {
    headers: { "x-nextjs-data": "1", "user-agent": UA, referer: `${BASE}/${LANG}` }, timeout: 15000,
  });
  const p = data?.pageProps;
  if (!p) throw new Error("Data tidak ditemukan");
  const featured = (p.bigList ?? []).map(normalizeBook);
  const sections = (p.smallData ?? []).map(section => ({ name: section.name, items: (section.items ?? []).map(normalizeBook) }));
  return { success: true, featured, sections };
}

async function browse(page = 1, typeId = 0) {
  const buildId = await getBuildId();
  if (!buildId) throw new Error("Gagal ambil buildId");
  const { data } = await axios.get(`${BASE}/_next/data/${buildId}/${LANG}/browse.json`, {
    params: { pageNo: page, typeTwoId: typeId },
    headers: { "x-nextjs-data": "1", "user-agent": UA, referer: `${BASE}/${LANG}/browse` }, timeout: 15000,
  });
  const p = data?.pageProps;
  if (!p) throw new Error("Data tidak ditemukan");
  return {
    success: true, page: p.pageNo, totalPages: p.pages, hasNext: p.pageNo < p.pages,
    genre: p.typeTwoName, result: (p.bookList ?? []).map(normalizeBook),
  };
}

async function search(query) {
  const buildId = await getBuildId();
  if (!buildId) throw new Error("Gagal ambil buildId");
  const { data } = await axios.get(`${BASE}/_next/data/${buildId}/${LANG}/search.json`, {
    params: { searchValue: query },
    headers: { "x-nextjs-data": "1", "user-agent": UA, referer: `${BASE}/${LANG}/search?searchValue=${encodeURIComponent(query)}` }, timeout: 15000,
  });
  const result = (data?.pageProps?.bookList ?? []).map(normalizeBook);
  return { success: true, query, result };
}

function normalizeEpisode(ch) {
  return {
    id: ch.id, episode: ch.index + 1, title: ch.name,
    unlocked: ch.unlock, duration: ch.duration, cover: ch.cover,
    stream: ch.unlock ? { mp4: ch.mp4 ?? null, m3u8: ch.m3u8Url ?? null } : null,
  };
}

async function detail(bookId, slug) {
  const buildId = await getBuildId();
  if (!buildId) throw new Error("Gagal ambil buildId");
  const { data } = await axios.get(`${BASE}/_next/data/${buildId}/${LANG}/drama/${bookId}/${slug}.json`, {
    params: { bookId, bookNameEn: slug },
    headers: { "x-nextjs-data": "1", "user-agent": UA, referer: `${BASE}/${LANG}/drama/${bookId}/${slug}` }, timeout: 15000,
  });
  const b = data?.pageProps?.bookInfo;
  if (!b) throw new Error("Drama tidak ditemukan");
  const episodes = (data?.pageProps?.chapterList ?? []).map(normalizeEpisode);
  const unlocked = episodes.filter(e => e.unlocked);
  const locked = episodes.filter(e => !e.unlocked);
  return {
    success: true,
    id: b.bookId, title: b.bookName, slug: b.bookNameEn, cover: b.cover,
    views: b.viewCount, followers: b.followCount, chapters: b.chapterCount,
    language: b.language, labels: b.labels, tags: b.tags, genres: b.typeTwoNames ?? [],
    performers: (b.performerList ?? []).map(p => ({ id: p.performerId, name: p.performerName, avatar: p.performerAvatar })),
    description: b.introduction,
    totalEpisodes: episodes.length, unlockedCount: unlocked.length, lockedCount: locked.length,
    episodes,
  };
}

// ── HANDLER ──────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { cmd, page, typeId, query, bookId, slug } = req.query;
  const p = parseInt(page) || 1;
  const t = parseInt(typeId) || 0;

  try {
    let data;
    switch (cmd) {
      case "home":   data = await home(); break;
      case "browse": data = await browse(p, t); break;
      case "search": if (!query) throw new Error("query required"); data = await search(query); break;
      case "detail": if (!bookId || !slug) throw new Error("bookId & slug required"); data = await detail(bookId, slug); break;
      default: return res.status(400).json({ error: `Unknown cmd: ${cmd}` });
    }
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
