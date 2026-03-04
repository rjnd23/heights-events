// api/events.js
// Instant read from Upstash Redis — no searching, no timeouts, no rate limits
// Data is refreshed every 12hrs by api/refresh.js (cron job)

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const redisUrl   = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    return res.status(200).json({ events: [], count: 0, log: ["Redis not configured"] });
  }

  try {
    // Read events from Redis
    const r = await fetch(`${redisUrl}/get/events`, {
      headers: { Authorization: `Bearer ${redisToken}` },
      signal: AbortSignal.timeout(5000),
    });
    const data = await r.json();
    const events = data.result ? JSON.parse(data.result) : [];

    // Read last updated timestamp
    const r2 = await fetch(`${redisUrl}/get/events_updated`, {
      headers: { Authorization: `Bearer ${redisToken}` },
      signal: AbortSignal.timeout(5000),
    });
    const data2 = await r2.json();
    const updated = data2.result || null;

    console.log("Events served from Redis:", events.length, "| Updated:", updated ? new Date(parseInt(updated)).toISOString() : "never");

    // Short cache — Redis is fast, 5min is fine
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
    res.status(200).json({ events, count: events.length, updated, log: ["Redis: " + events.length + " events"] });
  } catch (err) {
    console.log("Redis error:", err.message);
    res.status(200).json({ events: [], count: 0, log: ["Redis error: " + err.message] });
  }
};
