// scripts/refresh-events.js
// Runs via GitHub Actions daily — no time limit, no rate limit pressure
// Does ALL searches, waits between batches, saves to Upstash Redis

const ANTHROPIC_API_KEY      = process.env.ANTHROPIC_API_KEY;
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function redisSave(events) {
  const r = await fetch(`${UPSTASH_REDIS_REST_URL}/set/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ value: JSON.stringify(events) }),
  });
  await fetch(`${UPSTASH_REDIS_REST_URL}/set/events_updated`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ value: Date.now().toString() }),
  });
  return r.ok;
}

async function searchBatch(searches, batchName) {
  const now    = new Date();
  const today  = now.toISOString().split("T")[0];
  const in3mo  = new Date(Date.now() + 90*24*60*60*1000).toISOString().split("T")[0];
  const dayName = now.toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" });

  console.log(`\n--- ${batchName} ---`);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 5000,
      system: "You are a JSON API. Search the web for real events. ONLY include events you actually find on real websites — never invent or guess. Return ONLY a raw JSON array starting with [ and ending with ]. No markdown, no code fences, no explanation.",
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{
        role: "user",
        content: `Today is ${dayName}. Find REAL upcoming events from ${today} to ${in3mo} in Peoria Heights IL and nearby Peoria IL. ONLY include events you actually find on a webpage — never invent anything.

${searches}

Use the actual URL of each source page in the url field. Never leave url blank.
Return all found events as a JSON array. Each object must have EXACTLY:
{"title":"","date":"YYYY-MM-DD","time":"","loc":"","desc":"max 120 chars","cat":"Music|Community|Dining|Holiday|Nature|Arts|Sports","icon":"emoji","url":"actual source URL","facebook":"","tickets":"","recurring":"weekly|monthly|annually|null","featured":false}`
      }],
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.content) {
    console.log(`${batchName} error: HTTP ${res.status}`, data.error?.message || "");
    return [];
  }

  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  const clean = text.replace(/```json|```/g, "").trim();
  const s = clean.indexOf("["), e = clean.lastIndexOf("]");
  if (s === -1 || e === -1) { console.log(`${batchName}: no JSON array found`); return []; }

  try {
    const today2 = new Date().toISOString().split("T")[0];
    const parsed = JSON.parse(clean.slice(s, e+1));
    const events = parsed
      .filter(ev => ev.title && ev.date && ev.date >= today2)
      .map(ev => ({ ...ev, id: "ai_"+Math.random().toString(36).slice(2), source: "ai", featured: false }));
    console.log(`${batchName}: ${events.length} events found`);
    return events;
  } catch(err) {
    console.log(`${batchName}: JSON parse error`, err.message);
    return [];
  }
}

async function main() {
  if (!ANTHROPIC_API_KEY)      { console.error("Missing ANTHROPIC_API_KEY"); process.exit(1); }
  if (!UPSTASH_REDIS_REST_URL) { console.error("Missing UPSTASH_REDIS_REST_URL"); process.exit(1); }
  if (!UPSTASH_REDIS_REST_TOKEN){ console.error("Missing UPSTASH_REDIS_REST_TOKEN"); process.exit(1); }

  console.log("Starting event refresh...");
  const allEvents = [];

  // BATCH 1: High-priority regional venues
  const b1 = await searchBatch(`Search for events at each of these:
1. "Kenny's Pub" Peoria IL live music events 2026 — ticketed shows
2. "Friendly Valley Tap" Peoria IL live music events 2026
3. "Peoria Civic Center" concerts events 2026
4. "CEFCU Stage" Peoria IL events 2026
5. site:peoriaheightschamber.com events 2026 — St Patrick's Day Parade, Hot in the Heights, After Hours, Bar Stool Open`, "Batch 1: Regional");
  allEvents.push(...b1);

  console.log("Waiting 70s before batch 2...");
  await sleep(90000);

  // BATCH 2: Prospect Rd — group 1
  const b2 = await searchBatch(`Search for events at each of these Peoria Heights Prospect Rd venues:
1. "Pour Bros Craft Taproom" Peoria Heights events 2026
2. "Bust'd Brewing" Peoria Heights events 2026
3. "W.E. Sullivan's" Peoria Heights events 2026
4. "The Publik House" Peoria Heights events 2026
5. "Oliver's in the Heights" Peoria Heights events 2026`, "Batch 2: Prospect Rd A");
  allEvents.push(...b2);

  console.log("Waiting 70s before batch 3...");
  await sleep(90000);

  // BATCH 3: Prospect Rd — group 2
  const b3 = await searchBatch(`Search for events at each of these Peoria Heights Prospect Rd venues:
1. "Brienzo's" OR "Clink Bar" Peoria Heights events 2026
2. "Silver Dollar Tavern" Peoria Heights events 2026
3. "Casa Agave" Peoria Heights events 2026
4. "Joe's Original Italian" Peoria Heights events 2026
5. "Cafe Santa Rosa" OR "Olio Vino" OR "Peoria Pizza Works" OR "Frank's" Peoria Heights events 2026`, "Batch 3: Prospect Rd B");
  allEvents.push(...b3);

  // Deduplicate by title+date
  const seen = new Set();
  const deduped = allEvents
    .filter(ev => {
      const k = (ev.title+ev.date).toLowerCase().replace(/[^a-z0-9]/g,"");
      if (seen.has(k)) return false;
      seen.add(k); return true;
    })
    .sort((a,b) => (a.date||"").localeCompare(b.date||""));

  console.log(`\nTotal unique events: ${deduped.length}`);
  console.log("Saving to Redis...");

  const saved = await redisSave(deduped);
  console.log(saved ? "✅ Saved to Redis successfully" : "❌ Redis save failed");
  console.log("Done.");
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
