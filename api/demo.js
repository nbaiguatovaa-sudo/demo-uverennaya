// Демо: один раз на один IP-адрес. IP не хранится открыто — только хэш.
const crypto = require("crypto");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const q = req.query || {};

  // Если база ещё не подключена — не блокируем, работает только защита в браузере
  if (!url || !token) {
    return res.status(200).json({ configured: false, used: false, allowed: true });
  }

  const ip = String(
    req.headers["x-vercel-forwarded-for"] ||
    req.headers["x-forwarded-for"] ||
    (req.socket && req.socket.remoteAddress) || ""
  ).split(",")[0].trim();
  const salt = process.env.DEMO_SALT || "uv-demo-salt";
  const key = "demo:" + crypto.createHash("sha256").update(salt + ip).digest("hex").slice(0, 40);

  const call = async (path, method) => {
    const r = await fetch(url + path, {
      method: method || "GET",
      headers: { Authorization: "Bearer " + token }
    });
    return r.json();
  };

  try {
    if (q.a === "status") {
      const j = await call("/get/" + key);
      const used = j.result !== null && j.result !== undefined;
      return res.status(200).json({ configured: true, used });
    }
    if (q.a === "claim" && req.method === "POST") {
      // Атомарно: запишет только если записи ещё нет. Срок — 30 дней.
      const j = await call("/set/" + key + "/1/NX/EX/2592000", "POST");
      return res.status(200).json({ configured: true, allowed: j.result === "OK" });
    }
    if (q.a === "reset") {
      const admin = process.env.DEMO_ADMIN_KEY;
      if (admin && q.key === admin) {
        await call("/del/" + key, "POST");
        return res.status(200).json({ ok: true });
      }
      return res.status(403).json({ ok: false });
    }
    return res.status(400).json({ error: "bad request" });
  } catch (e) {
    // При сбое базы не ломаем демо
    return res.status(200).json({ configured: false, used: false, allowed: true, error: true });
  }
};
