/**
 * Wattpad Proxy — Vercel Serverless
 * Commands: home | search | detail | read
 */

const axios = require("axios");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function cleanText(text) {
  if (!text) return "";
  return text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

const CATEGORY_NAMES = {
  1: "Teen Fiction", 2: "Poetry", 3: "Fantasy", 4: "Romance", 5: "Science Fiction",
  6: "Fanfiction", 7: "Humor", 8: "Mystery/Thriller", 9: "Horror", 10: "Classics",
  11: "Adventure", 12: "Paranormal", 13: "Spiritual", 14: "Action", 16: "Non-Fiction",
  17: "Short Stories", 18: "Vampire", 19: "Random", 21: "General Fiction", 22: "Werewolf",
  23: "Historical Fiction", 24: "Chick Lit",
};

async function home(limit = 20) {
  const params = new URLSearchParams({
    limit, fields: "stories(id,title,user(name),cover,description,readCount,voteCount,commentCount,numParts,url,completed,tags,categories)"
  });
  const { data } = await axios.get(`https://api.wattpad.com/v4/stories?${params}`, {
    headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://www.wattpad.com/" },
    timeout: 15000,
  });
  const stories = (data.stories || []).map(s => ({
    id: s.id,
    title: cleanText(s.title),
    author: s.user?.name || "Unknown",
    cover: s.cover || "",
    description: cleanText(s.description || "").substring(0, 200),
    reads: s.readCount || 0,
    votes: s.voteCount || 0,
    parts: s.numParts || 0,
    status: s.completed ? "Completed" : "Ongoing",
    tags: (s.tags || []).slice(0, 5),
    category: s.categories?.[0] ? (CATEGORY_NAMES[s.categories[0]] || "General") : "General",
    url: s.url || `https://www.wattpad.com/story/${s.id}`,
  }));
  return { success: true, total: stories.length, stories };
}

async function search(query, limit = 20) {
  const params = new URLSearchParams({
    query, limit, offset: 0,
    fields: "stories(id,title,user(name),cover,description,readCount,voteCount,commentCount,numParts,url)"
  });
  const { data } = await axios.get(`https://api.wattpad.com/v4/stories?${params}`, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
    timeout: 15000,
  });
  const stories = (data.stories || []).slice(0, limit).map(s => ({
    id: s.id,
    title: cleanText(s.title),
    author: s.user?.name || "Unknown",
    description: cleanText(s.description || "").substring(0, 200),
    reads: s.readCount || 0,
    votes: s.voteCount || 0,
    comments: s.commentCount || 0,
    parts: s.numParts || 0,
    url: s.url || `https://www.wattpad.com/story/${s.id}`,
    cover: s.cover || "",
  }));
  return { success: true, query, total: stories.length, stories };
}

async function detail(storyUrl) {
  const path = storyUrl.replace("https://www.wattpad.com", "");
  const { data } = await axios.get(`https://www.wattpad.com${path}`, {
    headers: { "User-Agent": UA }, timeout: 15000,
  });

  let title = "", author = "", description = "", cover = "", genre = "", status = "Ongoing";

  const jsonLdMatch = data.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  if (jsonLdMatch) {
    try {
      const ld = JSON.parse(jsonLdMatch[1]);
      title = ld.name || ld.headline || "";
      author = ld.author?.name || "";
      description = ld.description || "";
      cover = ld.image || ld.thumbnailUrl || "";
      genre = ld.about || "";
      if (ld.completed === true || data.includes("Complete")) status = "Completed";
    } catch {}
  }

  if (!title) { const m = data.match(/<meta property="og:title" content="([^"]+)"/); if (m) title = m[1].replace(" - Wattpad", ""); }
  if (!author) { const m = data.match(/<meta name="author" content="([^"]+)"/); if (m) author = m[1]; }
  if (!cover) { const m = data.match(/<meta property="og:image" content="([^"]+)"/); if (m) cover = m[1]; }
  if (!description) { const m = data.match(/<meta property="og:description" content="([^"]+)"/); if (m) description = m[1]; }

  // Chapter links
  const chapters = [];
  const partLinks = data.match(/https:\/\/www\.wattpad\.com\/(\d+)-[^\s"']+/g);
  const seen = new Set();
  if (partLinks) {
    for (const link of partLinks) {
      const cleanLink = link.split("?")[0];
      const idMatch = cleanLink.match(/\/(\d+)-/);
      const id = idMatch ? idMatch[1] : "";
      if (id && !seen.has(id)) { seen.add(id); chapters.push({ id, url: cleanLink, title: `Chapter ${chapters.length + 1}` }); }
    }
  }

  let reads = 0, votes = 0;
  const readMatch = data.match(/(\d+(?:\.\d+)?[Kk]?)\s*(?:reads|membaca)/i);
  if (readMatch) { let n = readMatch[1]; if (n.toLowerCase().includes("k")) n = parseFloat(n) * 1000; reads = Math.floor(n) || 0; }
  const voteMatch = data.match(/(\d+(?:\.\d+)?[Kk]?)\s*(?:votes|vote)/i);
  if (voteMatch) { let n = voteMatch[1]; if (n.toLowerCase().includes("k")) n = parseFloat(n) * 1000; votes = Math.floor(n) || 0; }

  return {
    success: true,
    title: cleanText(title), author: cleanText(author), cover,
    description: cleanText(description).substring(0, 500),
    genre: cleanText(genre), status,
    reads, votes, parts: chapters.length,
    chapters, url: storyUrl,
  };
}

async function readChapter(chapterUrl) {
  const cleanUrl = chapterUrl.split("/page/")[0];
  const path = cleanUrl.replace("https://www.wattpad.com", "");
  const { data } = await axios.get(`https://www.wattpad.com${path}`, {
    headers: { "User-Agent": UA }, timeout: 15000,
  });

  let chapterTitle = "", storyTitle = "", author = "";
  let content = [];

  const prefetchedMatch = data.match(/window\.prefetched\s*=\s*({.*?});\s*<\/script>/s);
  if (prefetchedMatch) {
    try {
      const prefetched = JSON.parse(prefetchedMatch[1]);
      for (const key in prefetched) {
        if (key.includes(".metadata")) {
          const partData = prefetched[key]?.data;
          if (partData) {
            chapterTitle = partData.title || "";
            storyTitle = partData.group?.title || "";
            author = partData.group?.user?.name || "";
            const storyText = prefetched[key]?.storyText || "";
            if (storyText) {
              const textMatches = storyText.match(/<p[^>]*data-p-id="[^"]*"[^>]*>(.*?)<\/p>/gs);
              if (textMatches) {
                for (const p of textMatches) {
                  const text = cleanText(p.replace(/<[^>]*>/g, ""));
                  if (text && text.length > 5) content.push(text);
                }
              }
            }
            break;
          }
        }
      }
    } catch {}
  }

  if (content.length === 0) {
    const preMatch = data.match(/<pre>([\s\S]*?)<\/pre>/);
    if (preMatch) {
      const pMatches = preMatch[1].match(/<p[^>]*>(.*?)<\/p>/gs);
      if (pMatches) {
        for (const p of pMatches) {
          const text = cleanText(p.replace(/<[^>]*>/g, ""));
          if (text && text.length > 5 && !text.includes("div class")) content.push(text);
        }
      }
    }
  }

  if (!chapterTitle) { const m = data.match(/<h1[^>]*>(.*?)<\/h1>/); if (m) chapterTitle = cleanText(m[1]); }
  if (!storyTitle) {
    const m = data.match(/<h2[^>]*class="title[^"]*"[^>]*>(.*?)<\/h2>/);
    if (m) storyTitle = cleanText(m[1]);
    if (!storyTitle) { const og = data.match(/<meta property="og:title" content="([^"]+)"/); if (og) storyTitle = og[1].replace(" - Wattpad", ""); }
  }
  if (!author) {
    const m = data.match(/oleh <a[^>]*>(.*?)<\/a>/);
    if (m) author = cleanText(m[1]);
    if (!author) { const ma = data.match(/<meta name="author" content="([^"]+)"/); if (ma) author = ma[1]; }
  }

  return {
    success: true,
    chapter_title: chapterTitle || "Chapter",
    story_title: storyTitle || "Unknown",
    author: author || "Unknown",
    content, url: cleanUrl,
  };
}

// ── HANDLER ──────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { cmd, url, query, limit } = req.query;
  const lim = parseInt(limit) || 20;

  try {
    let data;
    switch (cmd) {
      case "home":   data = await home(lim); break;
      case "search": if (!query) throw new Error("query required"); data = await search(query, lim); break;
      case "detail": if (!url) throw new Error("url required"); data = await detail(url); break;
      case "read":   if (!url) throw new Error("url required"); data = await readChapter(url); break;
      default: return res.status(400).json({ error: `Unknown cmd: ${cmd}` });
    }
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
