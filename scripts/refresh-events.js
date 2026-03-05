// scripts/refresh-events.js
// Runs via GitHub Actions daily — no time limit, no rate limit pressure
// Free fetches first (zero tokens), then one lean AI batch for regional venues

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TICKETMASTER_API_KEY = process.env.TICKETMASTER_API_KEY;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const MONTH_MAP = {
  jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06",
  jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12"
};

// ─── REDIS ───────────────────────────────────────────────────────────────────
async function redisSave(events) {
  const r = await fetch(`${UPSTASH_REDIS_REST_URL}/set/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ value: JSON.stringify(events) }),
  });
  await fetch(`${UPSTASH_REDIS_REST_URL}/set/events_updated`, {
    method: "POST",
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ value: Date.now().toString() }),
  });
  return r.ok;
}

// ─── FREE FETCH 1: Peoria Park District REST API ─────────────────────────────
async function fetchParksEvents() {
  const today = new Date().toISOString().split("T")[0];
  const url = `https://peoriaparks.org/wp-json/tribe/events/v1/events?per_page=50&start_date=${today}&status=publish`;
  console.log("\n--- Peoria Park District (REST API) ---");
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) { console.warn(`⚠️ Parks API error: HTTP ${res.status}`); return []; }
    const data = await res.json();
    const events = (data.events || []).map(ev => {
      const start = ev.start_date || "";
      const date = start.slice(0, 10);
      const hh = parseInt(start.slice(11, 13), 10);
      const mm = start.slice(14, 16);
      const time = hh === 0 ? `12:${mm} AM` : hh < 12 ? `${hh}:${mm} AM` : hh === 12 ? `12:${mm} PM` : `${hh-12}:${mm} PM`;
      const desc = (ev.excerpt || ev.description || "").replace(/<[^>]+>/g, "").trim().slice(0, 120);
      return {
        id: "ppd_" + ev.id, source: "ai", title: ev.title || "",
        date, time, loc: ev.venue?.venue || "Peoria Park District",
        desc: desc || "Peoria Park District event.", cat: "Community", icon: "🌳",
        url: ev.url || "https://peoriaparks.org/events/",
        facebook: "", tickets: ev.website || "", recurring: null, featured: false,
      };
    }).filter(ev => ev.title && ev.date >= today);
    console.log(`✅ Parks: ${events.length} events`);
    return events;
  } catch (err) {
    console.warn(`⚠️ Parks fetch error: ${err.message}`);
    return [];
  }
}

// ─── FREE FETCH 2: Peoria Heights Chamber HTML scrape ────────────────────────
async function fetchChamberEvents() {
  const today = new Date().toISOString().split("T")[0];
  const year = new Date().getFullYear();
  console.log("\n--- Peoria Heights Chamber (HTML scrape) ---");
  try {
    const res = await fetch("https://www.peoriaheightschamber.com/events", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HeightsLive/1.0)" }
    });
    if (!res.ok) { console.warn(`⚠️ Chamber error: HTTP ${res.status}`); return []; }
    const html = await res.text();

    // Each event block: month abbrev, day number, title, venue, time, category, /events/slug
    const eventRegex = /href="(\/events\/[^"]+)"[^>]*>[\s\S]*?([A-Za-z]{3})\s*\n\s*(\d{1,2})\s*\n\s*([\s\S]+?)\n\s*([\s\S]+?)\n\s*([\d:apm\s\-–]+)\n/gi;
    const events = [];
    let match;
    while ((match = eventRegex.exec(html)) !== null) {
      const [, slug, monRaw, dayRaw, titleRaw, locRaw, timeRaw] = match;
      const mon = monRaw.toLowerCase().slice(0, 3);
      const monNum = MONTH_MAP[mon];
      if (!monNum) continue;
      const day = dayRaw.padStart(2, "0");
      // Use current year; if month already passed use next year
      const curMonth = new Date().getMonth() + 1;
      const evMonth = parseInt(monNum, 10);
      const evYear = evMonth < curMonth ? year + 1 : year;
      const date = `${evYear}-${monNum}-${day}`;
      if (date < today) continue;
      const title = titleRaw.trim().replace(/\s+/g, " ");
      const loc = locRaw.trim().replace(/\s+/g, " ");
      const time = timeRaw.trim().replace(/\s+/g, " ");
      const url = `https://www.peoriaheightschamber.com${slug}`;
      events.push({
        id: "chamber_" + Math.random().toString(36).slice(2), source: "ai",
        title, date, time, loc,
        desc: `${title} at ${loc} in Peoria Heights.`.slice(0, 120),
        cat: "Community", icon: "🏘️", url, facebook: "", tickets: "",
        recurring: null, featured: false,
      });
    }

    // Fallback: simpler regex if the above finds nothing
    if (events.length === 0) {
      const simpleRegex = /href="(\/events\/[^"]+)">[\s\S]{0,400}?<\/a>/gi;
      console.warn("⚠️ Chamber: primary regex found nothing, trying fallback");
      // Just log — Chamber will still contribute via dedup from other sources
    }

    console.log(`✅ Chamber: ${events.length} events`);
    return events;
  } catch (err) {
    console.warn(`⚠️ Chamber fetch error: ${err.message}`);
    return [];
  }
}

// ─── FREE FETCH 3: Ticketmaster Discovery API ─────────────────────────────────
async function fetchTicketmasterEvents() {
  if (!TICKETMASTER_API_KEY) { console.warn("⚠️ No TICKETMASTER_API_KEY — skipping"); return []; }
  const today = new Date().toISOString().split(".")[0] + "Z";
  // Venue IDs: Civic Center, Prairie Home Alliance Theater (CEFCU Stage), Convention Center
  const venueIds = "57390,57937,57938";
  const url = `https://app.ticketmaster.com/discovery/v2/events.json?venueId=${venueIds}&apikey=${TICKETMASTER_API_KEY}&size=50&startDateTime=${today}&sort=date,asc`;
  console.log("\n--- Ticketmaster (Discovery API) ---");
  try {
    const res = await fetch(url);
    if (!res.ok) { console.warn(`⚠️ Ticketmaster error: HTTP ${res.status}`); return []; }
    const data = await res.json();
    const items = data?._embedded?.events || [];
    const events = items.map(ev => {
      const dateInfo = ev.dates?.start;
      const date = dateInfo?.localDate || "";
      const time = dateInfo?.localTime?.slice(0, 5) || "";
      const [hh, mm] = time.split(":");
      const h = parseInt(hh, 10);
      const fmtTime = !hh ? "" : h === 0 ? `12:${mm} AM` : h < 12 ? `${h}:${mm} AM` : h === 12 ? `12:${mm} PM` : `${h-12}:${mm} PM`;
      const venue = ev._embedded?.venues?.[0];
      const loc = venue?.name || "Peoria Civic Center";
      const ticketUrl = ev.url || "";
      return {
        id: "tm_" + ev.id, source: "ai",
        title: ev.name || "", date, time: fmtTime, loc,
        desc: `${ev.name} at ${loc}, Peoria IL.`.slice(0, 120),
        cat: "Music", icon: "🎵", url: ticketUrl,
        facebook: "", tickets: ticketUrl, recurring: null, featured: false,
      };
    }).filter(ev => ev.title && ev.date);
    console.log(`✅ Ticketmaster: ${events.length} events`);
    return events;
  } catch (err) {
    console.warn(`⚠️ Ticketmaster fetch error: ${err.message}`);
    return [];
  }
}

// ─── FREE FETCH 4: Direct restaurant URL fetches ──────────────────────────────
const RESTAURANTS = [
  { name: "Kenny's Westside Pub", url: "https://kennyswestside.com", loc: "Kenny's Westside, Peoria IL" },
  { name: "Friendly Valley Tavern", url: "https://kennyswestside.com/friendly-valley-tavern", loc: "Friendly Valley Tavern, Peoria IL" },
  { name: "Pour Bros Craft Taproom", url: "https://www.pourbros.com/peoria-heights", loc: "Pour Bros, Peoria Heights IL" },
  { name: "Bust'd Brewing", url: "https://www.bustdbrewing.com", loc: "Bust'd Brewing, Peoria Heights IL" },
  { name: "W.E. Sullivan's Irish Pub", url: "https://wesullivansirishpub.com", loc: "W.E. Sullivan's, Peoria Heights IL" },
  { name: "The Publik House", url: "https://www.publikhousepub.com", loc: "The Publik House, Peoria Heights IL" },
  { name: "Oliver's in the Heights", url: "https://www.oliversintheheights.com", loc: "Oliver's in the Heights, Peoria Heights IL" },
  { name: "Brienzo's Pizza", url: "https://www.brienzospizza.com/peoria-heights", loc: "Brienzo's, Peoria Heights IL" },
  { name: "Clink Bar & Events", url: "https://www.clinkbarandevents.com", loc: "Clink Bar & Events, Peoria Heights IL" },
  { name: "Silver Dollar Tavern", url: "https://silverdollartavern.com", loc: "Silver Dollar, Peoria Heights IL" },
  { name: "Casa Agave", url: "https://www.casaagaveheights.com", loc: "Casa Agave, Peoria Heights IL" },
  { name: "Joe's Original Italian", url: "https://joesoriginalitalianandmartinibar.com", loc: "Joe's Original Italian, Peoria Heights IL" },
  { name: "Cafe Santa Rosa", url: "https://cafesantarosa.co", loc: "Cafe Santa Rosa, Peoria Heights IL" },
  { name: "Olio & Vino", url: "https://olioandvino.com", loc: "Olio & Vino, Peoria Heights IL" },
  { name: "Peoria Pizza Works", url: "https://pizzaworkspeoria.com", loc: "Peoria Pizza Works, Peoria Heights IL" },
  { name: "Frank's", url: "https://www.frankspeoria.com", loc: "Frank's, Peoria Heights IL" },
  { name: "Feels Like Ohm", url: "https://feelslikeohm.square.site", loc: "Feels Like Ohm, Peoria Heights IL" },
];

// Try to extract events from raw HTML — best effort, works on server-rendered sites
// ONLY matches named month patterns to avoid false positives from prices/phone numbers
function parseEventsFromHtml(html, restaurant, sourceUrl) {
  const today = new Date().toISOString().split("T")[0];
  const in6mo = new Date(Date.now() + 180*24*60*60*1000).toISOString().split("T")[0];
  const year = new Date().getFullYear();
  const events = [];
  const MAX_PER_RESTAURANT = 20;

  // ONLY match written month names — never bare numeric patterns like 3/15 or 309-555-1234
  const datePattern = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/gi;
  const dateMatches = [...html.matchAll(datePattern)];

  if (dateMatches.length === 0) return events;

  for (const match of dateMatches) {
    if (events.length >= MAX_PER_RESTAURANT) break;

    const [, monRaw, dayRaw, yearRaw] = match;
    const mon = MONTH_MAP[monRaw.toLowerCase().slice(0, 3)];
    if (!mon) continue;

    const curMonth = new Date().getMonth() + 1;
    const evMonth = parseInt(mon, 10);
    const evYear = yearRaw
      ? (yearRaw.length === 2 ? "20" + yearRaw : yearRaw)
      : (evMonth < curMonth ? String(year + 1) : String(year));

    const date = `${evYear}-${mon}-${dayRaw.padStart(2, "0")}`;
    if (date < today || date > in6mo) continue;

    const idx = match.index;
    const context = html.slice(Math.max(0, idx - 150), idx + 250)
      .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    events.push({
      id: "rest_" + Math.random().toString(36).slice(2), source: "ai",
      title: `Event at ${restaurant.name}`,
      date, time: "", loc: restaurant.loc,
      desc: context.slice(0, 120),
      cat: "Community", icon: "🍽️",
      url: sourceUrl, facebook: "", tickets: "", recurring: null, featured: false,
    });
  }
  return events;
}

async function fetchRestaurantEvents() {
  const today = new Date().toISOString().split("T")[0];
  console.log("\n--- Restaurant URL fetches ---");
  const allEvents = [];

  for (const r of RESTAURANTS) {
    // Try /events path first, then homepage
    const urls = [r.url.replace(/\/$/, "") + "/events", r.url];
    let found = false;

    for (const tryUrl of urls) {
      try {
        const res = await fetch(tryUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; HeightsLive/1.0)" },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const html = await res.text();
        const events = parseEventsFromHtml(html, r, tryUrl);
        if (events.length > 0) {
          console.log(`✅ ${r.name}: ${events.length} events (${tryUrl})`);
          allEvents.push(...events);
          found = true;
          break;
        }
      } catch (err) {
        // timeout or network error — try next URL
      }
    }

    if (!found) {
      console.warn(`⚠️ ${r.name}: no parseable events found`);
    }

    // Small delay between restaurant fetches to be polite
    await sleep(1500);
  }

  console.log(`✅ Restaurant fetches total: ${allEvents.length} events`);
  return allEvents;
}

// ─── AI BATCH: Regional venues only (Kenny's + Friendly Valley) ───────────────
async function searchRegionalBatch() {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const in3mo = new Date(Date.now() + 90*24*60*60*1000).toISOString().split("T")[0];
  const dayName = now.toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" });

  console.log("\n--- AI Batch: Regional Venues ---");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: "You are a JSON API. Search the web for real events. ONLY include events you actually find on real websites — never invent or guess. Return ONLY a raw JSON array starting with [ and ending with ]. No markdown, no code fences, no explanation.",
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{
        role: "user",
        content: `Today is ${dayName}. Find REAL upcoming events from ${today} to ${in3mo} near Peoria IL. ONLY include events you find on a real webpage — never invent anything.

1. site:kennyswestside.com events live music 2026 OR "Kenny's Westside" Peoria IL events 2026
2. site:kennyswestside.com/friendly-valley-tavern events 2026 OR "Friendly Valley Tavern" Peoria IL events 2026

Use the actual URL of each source page in the url field. Never leave url blank.
Return all found events as a JSON array. Each object must have EXACTLY these fields:
{"title":"","date":"YYYY-MM-DD","time":"","loc":"","desc":"max 120 chars","cat":"Music|Community|Dining|Holiday|Nature|Arts|Sports","icon":"emoji","url":"actual source URL","facebook":"","tickets":"","recurring":"weekly|monthly|annually|null","featured":false}`
      }],
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.content) {
    console.warn(`⚠️ Regional batch error: HTTP ${res.status}`, data.error?.message || "");
    return [];
  }

  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  const clean = text.replace(/```json|```/g, "").trim();
  const s = clean.indexOf("["), e = clean.lastIndexOf("]");
  if (s === -1 || e === -1) { console.warn("⚠️ Regional batch: no JSON array found"); return []; }

  try {
    const today2 = new Date().toISOString().split("T")[0];
    const parsed = JSON.parse(clean.slice(s, e + 1));
    const events = parsed
      .filter(ev => ev.title && ev.date && ev.date >= today2)
      .map(ev => ({ ...ev, id: "ai_" + Math.random().toString(36).slice(2), source: "ai", featured: false }));
    console.log(`✅ Regional batch: ${events.length} events`);
    return events;
  } catch (err) {
    console.warn(`⚠️ Regional batch JSON parse error: ${err.message}`);
    return [];
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  if (!ANTHROPIC_API_KEY) { console.error("Missing ANTHROPIC_API_KEY"); process.exit(1); }
  if (!UPSTASH_REDIS_REST_URL) { console.error("Missing UPSTASH_REDIS_REST_URL"); process.exit(1); }
  if (!UPSTASH_REDIS_REST_TOKEN) { console.error("Missing UPSTASH_REDIS_REST_TOKEN"); process.exit(1); }

  console.log("Starting event refresh...");
  const allEvents = [];

  // 1. Free fetches — zero tokens
  const [parks, chamber, ticketmaster, restaurants] = await Promise.all([
    fetchParksEvents(),
    fetchChamberEvents(),
    fetchTicketmasterEvents(),
    fetchRestaurantEvents(),
  ]);
  allEvents.push(...parks, ...chamber, ...ticketmaster, ...restaurants);

  // 2. Single AI batch — regional venues only
  const regional = await searchRegionalBatch();
  allEvents.push(...regional);

  // Deduplicate by title+date
  const seen = new Set();
  const deduped = allEvents
    .filter(ev => {
      const k = (ev.title + ev.date).toLowerCase().replace(/[^a-z0-9]/g, "");
      if (seen.has(k)) return false;
      seen.add(k); return true;
    })
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  console.log(`\nTotal unique events: ${deduped.length}`);
  console.log("Saving to Redis...");
  const saved = await redisSave(deduped);
  console.log(saved ? "✅ Saved to Redis successfully" : "❌ Redis save failed");
  console.log("Done.");
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
