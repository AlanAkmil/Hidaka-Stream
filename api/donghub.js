/**
 * Donghub Proxy — Vercel Serverless
 * Wraps the DongHub scraper for browser use (CORS bypass)
 */

const axios   = require("axios");
const cheerio = require("cheerio");

const BASE    = "https://donghub.vip";
const UA      = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const HEADERS = { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" };
const BRAND   = { creator: "BINTANG", proxy: "StarLabs" };

function wrap(data) { return { ...BRAND, ...data }; }

async function get(url) {
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
  return cheerio.load(data);
}

function cardBsx($, el) {
  return {
    title:     $(el).find(".tt h2, .tt h3").text().trim() || "Unknown",
    url:       $(el).find("a").first().attr("href") || null,
    thumbnail: $(el).find("img").attr("src") || null,
    status:    $(el).find(".bt .status").first().text().trim() || null,
    episode:   $(el).find(".bt .epx, .epx").first().text().trim() || null,
  };
}

function cardEgg($, el) {
  return {
    title:     $(el).find(".eggtitle").text().trim() || "Unknown",
    episode:   $(el).find(".eggepisode").text().trim() || null,
    url:       $(el).find("a").attr("href") || null,
    thumbnail: $(el).find("img").attr("src") || null,
  };
}

async function home(page = 1) {
  const $ = await get(page <= 1 ? BASE : `${BASE}/page/${page}/`);
  const latest = [];
  $(".listupd.normal .styleegg").each((_, el) => latest.push(cardEgg($, el)));
  const popular = [];
  $(".serieslist.pop ul li").each((_, el) => {
    const a   = $(el).find(".leftseries h4 a");
    const img = $(el).find(".imgseries img");
    if (a.length) popular.push({ title: a.text().trim(), url: a.attr("href"), thumbnail: img.attr("src") || null });
  });
  let total = 1;
  const lastHref = $(".pagination a.last").last().attr("href") || "";
  const m = lastHref.match(/\/page\/(\d+)\//);
  if (m) { total = parseInt(m[1]); } else {
    const nums = [];
    $(".pagination a").each((_, a) => { const n = parseInt($(a).text()); if (!isNaN(n)) nums.push(n); });
    if (nums.length) total = Math.max(...nums);
  }
  return wrap({ page, total_pages: total, latest_episodes: latest.slice(0, 24), popular_series: popular.slice(0, 10) });
}

async function detail(slug) {
  const $ = await get(`${BASE}/${slug}/`);

  // Title — try multiple selectors
  let title = $(".infox h1").text().trim() || $("h1.entry-title").text().trim() || $("article h1").first().text().trim() || $("h1").first().text().trim();
  if (!title) return wrap({ error: "Series not found" });
  title = title.replace(/\s+/g, " ").trim();

  // Status & total episodes — try .spe span first, fallback to full text regex
  let status = null, totalEp = null;
  $(".spe span").each((_, el) => {
    const t = $(el).text();
    if (t.includes("Status:"))   status  = t.replace("Status:", "").trim();
    if (t.includes("Episodes:")) totalEp = t.replace("Episodes:", "").trim();
  });
  const bodyText = $("body").text();
  if (!status) {
    const sm = bodyText.match(/Status:\s*([A-Za-z]+)/);
    if (sm) status = sm[1].trim();
  }
  if (!totalEp) {
    const em = bodyText.match(/Episodes:\s*(\d+)/);
    if (em) totalEp = em[1].trim();
  }

  // Genres
  let genres = [];
  $(".genxed a").each((_, el) => genres.push($(el).text().trim()));
  if (!genres.length) {
    $("a[href*='/genres/']").each((_, el) => {
      const g = $(el).text().trim();
      if (g && !genres.includes(g)) genres.push(g);
    });
  }
  genres = genres.slice(0, 8);

  // Synopsis
  let synopsis = $(".entry-content p").first().text().trim();
  if (!synopsis || synopsis.length < 20) {
    const sm = bodyText.match(/Synopsis[^]*?\n([^\n]{30,800})/i);
    if (sm) synopsis = sm[1].trim();
  }

  // Poster
  let poster = $(".thumb img").attr("src") || $("img[class*='wp-post-image']").attr("src") || $(".infox img, article img").first().attr("src") || null;

  const rating = $(".num").first().text().trim() || null;

  // Episode list — try .eplister first
  let episodes = [];
  $(".eplister ul li a, .eplister li a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    episodes.push({
      episode:      $(el).find(".epl-num").text().trim() || (href.match(/episode-(\d+)/i) || [])[1] || "0",
      title:        $(el).find(".epl-title").text().trim() || "",
      url:          href,
      release_date: $(el).find(".epl-date").text().trim() || null,
    });
  });

  // Fallback: generate full episode list from slug pattern if scraped list is incomplete or empty
  const totalNum = totalEp ? parseInt(totalEp.replace(/\D/g, "")) : 0;
  if (totalNum > 0 && (episodes.length === 0 || episodes.length < totalNum)) {
    const existingNums = new Set(episodes.map(e => parseInt(e.episode)));
    const generated = [];
    for (let n = totalNum; n >= 1; n--) {
      if (existingNums.has(n)) continue;
      const epPad = String(n).padStart(2, "0");
      generated.push({
        episode: String(n),
        title: "",
        url: `${BASE}/${slug}-episode-${epPad}-subtitle-indonesia/`,
        release_date: null,
      });
    }
    episodes = episodes.concat(generated).sort((a, b) => parseInt(b.episode) - parseInt(a.episode));
  }

  return wrap({ title, status, total_episodes: totalEp, rating, genres, synopsis, poster, result: episodes });
}

async function watch(slug) {
  const $ = await get(`${BASE}/${slug}`);
  const title = $("h1.entry-title").text().trim() || slug;
  const video_url = $("#embed_holder iframe").attr("src") || null;
  const servers = [];
  $(".mirror option").each((_, el) => {
    const val = $(el).attr("value") || "";
    if (!val) return;
    try {
      const dec   = Buffer.from(val, "base64").toString("utf-8");
      const match = dec.match(/src="([^"]+)"/);
      servers.push({ name: $(el).text().trim(), url: match ? match[1] : dec });
    } catch { servers.push({ name: $(el).text().trim(), url: val }); }
  });
  let prev = null, next = null;
  $(".naveps .nvs a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const txt  = $(el).text().toLowerCase();
    if (txt.includes("next") || txt.includes("›")) next = href;
    else if (txt.includes("prev") || txt.includes("‹")) prev = href;
  });
  return wrap({ title, video_url, servers, prev_episode: prev, next_episode: next });
}

async function search(query) {
  const $ = await get(`${BASE}/?s=${encodeURIComponent(query)}`);
  const result = [];
  $(".listupd .bsx").each((_, el) => { if ($(el).find("a").length) result.push(cardBsx($, el)); });
  return wrap({ query, result });
}

async function schedule() {
  const $ = await get(`${BASE}/schedule/`);
  const DAYS = {
    sch_sunday: "Minggu", sch_monday: "Senin", sch_tuesday: "Selasa",
    sch_wednesday: "Rabu", sch_thursday: "Kamis", sch_friday: "Jumat", sch_saturday: "Sabtu",
  };
  const result = {};
  for (const [cls, day] of Object.entries(DAYS)) {
    const block = $(`.bixbox.${cls}`);
    if (!block.length) continue;
    const entries = [];
    block.find(".bs .bsx").each((_, el) => {
      const a = $(el).find("a");
      if (!a.length) return;
      entries.push({
        title:     $(el).find(".tt h2, .tt h3").text().trim() || a.text().trim(),
        url:       a.attr("href"),
        thumbnail: $(el).find("img").attr("src") || null,
        episode:   $(el).find(".bt .epx, .epx").first().text().trim() || null,
      });
    });
    result[day] = entries;
  }
  return wrap({ result });
}

async function newSeries(page = 1) {
  const $ = await get(`${BASE}/anime?status=&order=latest&page=${page}`);
  const result = [];
  $(".listupd .bsx").each((_, el) => { if ($(el).find("a").length) result.push(cardBsx($, el)); });
  return wrap({ page, has_next: !!$(".pagination a[rel='next']").length, result });
}

async function completed(page = 1) {
  const $ = await get(`${BASE}/anime?status=completed&order=update&page=${page}`);
  const result = [];
  $(".listupd .bsx").each((_, el) => { if ($(el).find("a").length) result.push(cardBsx($, el)); });
  return wrap({ page, has_next: !!$(".pagination a[rel='next']").length, result });
}

// ─── HANDLER ───────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { cmd, slug, query, page } = req.query;
  const p = parseInt(page) || 1;

  try {
    let data;
    switch (cmd) {
      case "home":       data = await home(p); break;
      case "detail":     if (!slug) throw new Error("slug required"); data = await detail(slug); break;
      case "watch":      if (!slug) throw new Error("slug required"); data = await watch(slug); break;
      case "search":     if (!query) throw new Error("query required"); data = await search(query); break;
      case "schedule":   data = await schedule(); break;
      case "new-series": data = await newSeries(p); break;
      case "completed":  data = await completed(p); break;
      default: return res.status(400).json({ error: `Unknown cmd: ${cmd}`, ...BRAND });
    }
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message, ...BRAND });
  }
};
