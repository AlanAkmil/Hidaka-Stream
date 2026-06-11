/**
 * Image Proxy — bypass hotlink protection
 * Usage: /api/img?url=https://donghub.vip/wp-content/...
 */

const axios = require("axios");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).send("Missing url param");

  try {
    const decoded = decodeURIComponent(url);
    const response = await axios.get(decoded, {
      responseType: "arraybuffer",
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://donghub.vip/",
        "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });

    const contentType = response.headers["content-type"] || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.status(200).send(Buffer.from(response.data));
  } catch (err) {
    res.status(500).send("Image fetch failed: " + err.message);
  }
};
