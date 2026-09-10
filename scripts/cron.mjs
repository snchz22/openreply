// Node port of scripts/cron.sh for hosts without a scheduler (e.g. Railway).
// Runs as its own service: `node scripts/cron.mjs`.
const BASE_URL = (process.env.CRON_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET || "";
if (!SECRET) { console.error("[cron] neither CRON_SECRET nor NEXTAUTH_SECRET is set"); process.exit(1); }

async function call(route) {
  const stamp = new Date().toISOString();
  try {
    const res = await fetch(`${BASE_URL}/api/cron/${route}`, {
      headers: { Authorization: `Bearer ${SECRET}` },
      signal: AbortSignal.timeout(180000),
    });
    const body = await res.text();
    console.log(`[cron] ${stamp} ${route} ${res.ok ? "ok" : "FAILED " + res.status} ${body.slice(0, 300)}`);
  } catch (e) {
    console.error(`[cron] ${stamp} ${route} FAILED ${e.message}`);
  }
}

console.log(`[cron] scheduler started, target ${BASE_URL}`);
let lastSlot = "", lastDaily = "";
setInterval(async () => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const hh = now.getUTCHours(), mm = now.getUTCMinutes();
  const slot = `${today} ${hh}:${mm}`;
  if (mm % 5 === 0 && lastSlot !== slot) { lastSlot = slot; await call("attach-next-reel"); }
  if (hh === 5 && lastDaily !== today) { lastDaily = today; await call("refresh-tokens"); await call("snapshot-followers"); }
}, 30000);
