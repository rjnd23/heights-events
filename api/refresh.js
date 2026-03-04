// api/refresh.js
// Single Anthropic call with web_search — fits within Vercel Hobby 60s limit
// Saves results to Upstash Redis
// Triggered by: cron (daily 8am) OR manually via /api/refresh?secret=heights2026

async function redisSet(url, token, key, value) {
  await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ value: JSON.stringify(value) }),
    signal: AbortSignal.timeout(5000),
  });
}

module.exports = async function handler(req, res) {
  const isCron = req.headers["x-vercel-cron"] === "1";
  if (!isCron && req.query.secret !== "heights2026") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const aiKey      = process.env.ANTHROPIC_API_KEY;
  const redisUrl   = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!aiKey)      return res.status(500).json({ error: "No ANTHROPIC_API_KEY" });
  if (!redisUrl)   return res.status(500).json({ error: "No UPSTASH_REDIS_REST_URL" });
  if (!redisToken) return res.status(500).json({ error: "No UPSTASH_REDIS_REST_TOKEN" });

  const now     = new Date();
  const today   = now.toISOString().split("T")[0];
  const in3mo   = new Date(Date.now() + 90*24*60*60*1000).toISOString().split("T")[0];
  const dayName = now.toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" });

  let events = [], log = [];

  try {
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(50000),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": aiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 5000,
        system: "You are a JSON API. Search the web for real events. ONLY include events you actually find on real websites — never invent or guess. Return ONLY a raw JSON array starting with [ and ending with ]. No markdown, no code fences, no explanation.",
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: `Today is ${dayName}. Find REAL upcoming events from ${today} to ${in3mo} in Peoria Heights IL and nearby Peoria IL. ONLY include events you find on actual webpages — never invent anything.

Do these 4 searches:
1. "Kenny's Pub" OR "Friendly Valley Tap" Peoria IL live music events 2026
2. "Peoria Civic Center" OR site:peoriaheightschamber.com events 2026
3. "Pour Bros" OR "Bust'd Brewing" OR "W.E. Sullivan's" Peoria Heights events 2026
4. "Oliver's in the Heights" OR "Brienzo's" OR "Clink Bar" OR "Silver Dollar" OR "Casa Agave" OR "Publik House" Peoria Heights events 2026

Use the actual source page URL in the url field. Never leave url blank.
Return all found events as a JSON array. Each object must have EXACTLY:
{"title":"","date":"YYYY-MM-DD","time":"","loc":"","desc":"max 120 chars","cat":"Music|Community|Dining|Holiday|Nature|Arts|Sports","icon":"emoji","url":"actual source URL","facebook":"","tickets":"","recurring":"weekly|monthly|annually|null","featured":false}` }],
      }),
    });

    const aiData = await aiRes.json();
    log.push("HTTP " + aiRes.status);

    if (aiRes.ok && aiData.content) {
      const text = aiData.content.filter(b => b.type === "text").map(b => b.text).join("");
      const clean = text.replace(/```json|```/g, "").trim();
      const s = clean.indexOf("["), e = clean.lastIndexOf("]");
      if (s !== -1 && e !== -1) {
        const parsed = JSON.parse(clean.slice(s, e+1));
        events = parsed.filter(ev => ev.title && ev.date && ev.date >= today).map(ev => ({
          ...ev, id: "ai_"+Math.random().toString(36).slice(2), source: "ai", featured: false
        }));
        // Sort by date
        events.sort((a,b) => (a.date||"").localeCompare(b.date||""));
        log.push("Found: " + events.length + " real events");
      } else {
        log.push("No JSON array in response");
      }
    } else {
      log.push("Error: " + JSON.stringify(aiData.error?.message || "").slice(0, 150));
    }
  } catch (err) {
    log.push("Exception: " + err.message);
  }

  // Save to Redis even if 0 events (clears stale data)
  if (events.length > 0) {
    await redisSet(redisUrl, redisToken, "events", events);
    await redisSet(redisUrl, redisToken, "events_updated", Date.now().toString());
  }

  console.log("Refresh:", log.join(" | "), "| Saved:", events.length);
  res.status(200).json({ ok: true, total: events.length, log });
};
