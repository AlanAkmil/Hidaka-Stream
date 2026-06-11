/**
 * LK21 Proxy — Vercel Serverless
 * Source: colliergop.org
 * Commands: home | trending | search | detail | stream
 */

const axios = require("axios");
const cheerio = require("cheerio");
const qs = require("querystring");

const BASE = "https://colliergop.org";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const HEADERS = { "User-Agent": UA };

async function get(url) {
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
  return data;
}

function fixImage(img) {
  if (!img) return "";
  if (img.includes("-60x90")) return img.replace("-60x90", "-170x255");
  if (img.includes("-150x150")) return img.replace("-150x150", "-170x255");
  return img;
}

function parseMovies(html) {
  const $ = cheerio.load(html);
  const movies = [];
  const seen = new Set();

  $("article, .post, .item-infinite, .entry, .gmr-box-content").each((_, el) => {
    const titleEl = $(el).find(".entry-title a, h2 a, h3 a, .title a");
    let title = titleEl.text().trim();
    let link = titleEl.attr("href");

    if (!title) {
      $(el).find("a").each((_, a) => {
        const t = $(a).text().trim();
        if (t && t.length > 5 && !t.includes("HD") && !t.includes("Tonton")) {
          title = t; link = $(a).attr("href");
        }
      });
    }

    const image = fixImage($(el).find("img").first().attr("src") || "");

    if (link && !seen.has(link) &&
        !link.includes("/quality/") && !link.includes("/category/") && !link.includes("/tag/") &&
        title && title.length > 3 && title !== "HD") {
      seen.add(link);
      movies.push({ title: title.replace(/&#[0-9]+;/g, "'"), url: link, image });
    }
  });

  return movies;
}

async function home(page = 1) {
  const url = page <= 1 ? BASE + "/" : `${BASE}/page/${page}/`;
  const html = await get(url);
  const movies = parseMovies(html);
  return { success: true, page, movies };
}

async function trending(page = 1) {
  const url = page <= 1 ? `${BASE}/genre/box-office/` : `${BASE}/genre/box-office/page/${page}/`;
  const html = await get(url);
  const movies = parseMovies(html);
  return { success: true, page, movies };
}

async function search(query) {
  const url = `${BASE}/?s=${encodeURIComponent(query)}&post_type[]=post&post_type[]=tv`;
  const html = await get(url);
  const results = parseMovies(html);
  return { success: true, query, results };
}

async function detail(url) {
  const html = await get(url);

  let title = "";
  const titleMatch = html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([^<]+)<\/h1>/i);
  if (titleMatch) title = titleMatch[1].replace(/&#[0-9]+;/g, "'").trim();

  let synopsis = "";
  const blurayMatch = html.match(/Bluray\s*[–\-]\s*([^.<>]+(?:[^.<>]*\.?[^.<>]*))/i);
  if (blurayMatch) synopsis = blurayMatch[1].trim();
  if (!synopsis) {
    const pMatch = html.match(/<p>([^<]+(?:\.|\!|\?)[^<]{50,})<\/p>/i);
    if (pMatch) synopsis = pMatch[1].trim();
  }
  synopsis = synopsis.replace(/^Download\s+Streaming.*?(?:HD|Bluray)\s*[–\-]\s*/i, "");
  synopsis = synopsis.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d)).substring(0, 500);

  let year = "";
  const yearMatch = html.match(/Tahun:\s*(\d{4})/i);
  if (yearMatch) year = yearMatch[1];
  if (!year && title) { const ym = title.match(/\b(19|20)\d{2}\b/); if (ym) year = ym[0]; }

  let genre = "";
  const genreMatch = html.match(/Genre:\s*([^<\n]+)/i);
  if (genreMatch) genre = genreMatch[1].trim();
  if (!genre) {
    const gLinks = html.match(/<a[^>]*href="[^"]*\/genre\/[^\/]+\/[^"]*"[^>]*>([^<]+)<\/a>/gi);
    if (gLinks) {
      const gs = [];
      for (let i = 0; i < Math.min(gLinks.length, 5); i++) {
        const gm = gLinks[i].match(/>([^<]+)</);
        if (gm && !gm[1].includes("Home") && !gm[1].includes("Beranda")) gs.push(gm[1]);
      }
      genre = gs.join(", ");
    }
  }

  let image = "";
  const imgMatch = html.match(/<img[^>]*class="[^"]*wp-post-image[^"]*"[^>]*src="([^"]+)"/i);
  if (imgMatch) image = imgMatch[1];
  if (!image) { const og = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i); if (og) image = og[1]; }
  image = fixImage(image);

  return { success: true, detail: { title: title || "Tidak diketahui", synopsis: synopsis || "Sinopsis tidak tersedia", year: year || "-", genre: genre || "-", image, url } };
}

async function stream(url) {
  const html = await get(url);
  const match = html.match(/<article[^>]*id="post-(\d+)"/i);
  if (!match) throw new Error("Post ID not found");
  const postId = match[1];

  const body = qs.stringify({ action: "muvipro_player_content", tab: "p3", post_id: postId });
  const { data: embedHtml } = await axios.post(`${BASE}/wp-admin/admin-ajax.php`, body, {
    headers: { ...HEADERS, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "Referer": BASE + "/" },
    timeout: 15000
  });

  const iframeMatch = embedHtml.match(/<iframe[^>]*src=["']([^"']+)["'][^>]*>/i);
  if (!iframeMatch) throw new Error("No embed found");

  return { success: true, embed_url: iframeMatch[1], post_id: postId };
}

// ── HANDLER ──────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { cmd, url, query, page } = req.query;
  const p = parseInt(page) || 1;

  try {
    let data;
    switch (cmd) {
      case "home":     data = await home(p); break;
      case "trending": data = await trending(p); break;
      case "search":   if (!query) throw new Error("query required"); data = await search(query); break;
      case "detail":   if (!url) throw new Error("url required"); data = await detail(url); break;
      case "stream":   if (!url) throw new Error("url required"); data = await stream(url); break;
      default: return res.status(400).json({ error: `Unknown cmd: ${cmd}` });
    }
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
