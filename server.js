import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const FMP_KEY = process.env.FMP_API_KEY;
const FMP_BASE = "https://financialmodelingprep.com/stable"; // newer keys (post Aug 2025) only have access to /stable, not legacy /api/v3
const MFAPI_BASE = "https://api.mfapi.in"; // Indian mutual funds — free, no key required
const CACHE_TTL = 1000 * 60 * 60 * 12; // 12 hours

const cache = new Map();

async function cachedFetch(key, url) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;
  const res = await fetch(url);
  if (!res.ok) {
    const hint = res.status === 403 ? " — check that FMP_API_KEY is set correctly in Render's Environment tab" : "";
    throw new Error(`Request failed (${res.status}) for ${key}${hint}`);
  }
  const data = await res.json();
  cache.set(key, { ts: Date.now(), data });
  return data;
}

// ---------- generic math helpers (source-agnostic: works on {date, value} points) ----------

// Resamples raw daily/points into one point per calendar month, keyed by "YYYY-MM" so
// series from different markets/calendars (e.g. US vs India) can still be aligned for
// correlation and Beta, even though their exact trading dates differ.
function monthlyFromPoints(points) {
  const sorted = [...points].sort((a, b) => new Date(a.date) - new Date(b.date));
  const monthly = [];
  let lastPeriod = null;
  for (const p of sorted) {
    const d = new Date(p.date);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (period !== lastPeriod) {
      monthly.push({ period, date: p.date, value: p.value });
      lastPeriod = period;
    } else {
      monthly[monthly.length - 1] = { period, date: p.date, value: p.value };
    }
  }
  const returns = [];
  for (let i = 1; i < monthly.length; i++) {
    returns.push({ period: monthly[i].period, r: monthly[i].value / monthly[i - 1].value - 1 });
  }
  return { monthly, returns };
}

function stdDev(arr) {
  const n = arr.length;
  if (n < 2) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / n;
  const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}
const annualize = (monthlyStd) => monthlyStd * Math.sqrt(12) * 100;

function maxDrawdown(monthly) {
  let peak = monthly[0].value;
  let worst = 0;
  for (const m of monthly) {
    if (m.value > peak) peak = m.value;
    const dd = (m.value - peak) / peak;
    if (dd < worst) worst = dd;
  }
  return worst * 100;
}

function pearson(a, b) {
  const n = a.length;
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - meanA) * (b[i] - meanB);
    denA += (a[i] - meanA) ** 2;
    denB += (b[i] - meanB) ** 2;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

function betaAgainst(fundReturns, marketReturns) {
  const marketMap = new Map(marketReturns.map((m) => [m.period, m.r]));
  const aligned = fundReturns.filter((r) => marketMap.has(r.period)).map((r) => ({ fund: r.r, market: marketMap.get(r.period) }));
  if (aligned.length < 6) return null;
  const meanF = aligned.reduce((s, x) => s + x.fund, 0) / aligned.length;
  const meanM = aligned.reduce((s, x) => s + x.market, 0) / aligned.length;
  let cov = 0, varM = 0;
  for (const a of aligned) { cov += (a.fund - meanF) * (a.market - meanM); varM += (a.market - meanM) ** 2; }
  cov /= aligned.length - 1;
  varM /= aligned.length - 1;
  return varM > 0 ? cov / varM : null;
}

function buildMetrics(monthly, returns, marketReturns) {
  if (monthly.length < 7) throw new Error("Not enough price history for a reliable calculation (need 6+ months).");
  const years = (new Date(monthly[monthly.length - 1].date) - new Date(monthly[0].date)) / (1000 * 60 * 60 * 24 * 365.25);
  const cagr = years > 0 ? ((monthly[monthly.length - 1].value / monthly[0].value) ** (1 / years) - 1) * 100 : 0;
  const rets = returns.map((r) => r.r);
  const annualStdDev = annualize(stdDev(rets));
  const negRets = rets.filter((r) => r < 0);
  const annualDownsideDev = annualize(stdDev(negRets));
  const beta = marketReturns ? betaAgainst(returns, marketReturns) : null;
  return {
    cagr: Number(cagr.toFixed(2)),
    stdDev: Number(annualStdDev.toFixed(2)),
    downsideDev: Number(annualDownsideDev.toFixed(2)),
    beta: beta !== null ? Number(beta.toFixed(2)) : null,
    maxDrawdown: Number(maxDrawdown(monthly).toFixed(2)),
    dataPoints: monthly.length,
    asOf: monthly[monthly.length - 1].date,
  };
}

// ---------- FMP (US stocks/ETFs/funds) ----------

async function getFmpSeries(symbol) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 1100 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const data = await cachedFetch(
    `HIST_${symbol}`,
    `${FMP_BASE}/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&apikey=${FMP_KEY}`
  );
  const hist = Array.isArray(data) ? data : (data?.historical || []);
  if (!hist.length) throw new Error(`No price history found for "${symbol}"`);
  const points = hist.map((h) => ({ date: h.date, value: h.close }));
  return monthlyFromPoints(points);
}

async function getSpyReturns() {
  const { returns } = await getFmpSeries("SPY");
  return returns;
}

// ---------- MFapi.in (Indian mutual funds) — free, no key required ----------

function parseIndianDate(d) {
  // MFapi dates come as "dd-mm-yyyy"
  const [dd, mm, yyyy] = d.split("-");
  return `${yyyy}-${mm}-${dd}`;
}

async function getMfapiSeries(schemeCode) {
  const data = await cachedFetch(`MFAPI_HIST_${schemeCode}`, `${MFAPI_BASE}/mf/${schemeCode}`);
  const hist = data?.data || [];
  if (!hist.length) throw new Error(`No NAV history found for scheme ${schemeCode}`);
  const points = hist.map((h) => ({ date: parseIndianDate(h.date), value: Number(h.nav) })).filter((p) => !isNaN(p.value));
  return { ...monthlyFromPoints(points), meta: data.meta };
}

async function getFullMfapiSchemeList() {
  const cached = cache.get("MFAPI_FULL_LIST");
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  // MFapi.in's own /mf/search endpoint appears to truncate results for common queries
  // (e.g. "SBI" alone won't surface every SBI scheme). Instead, pull the full scheme
  // list once via pagination and search it ourselves — deterministic and complete.
  let all = [];
  let offset = 0;
  const limit = 2000;
  for (let i = 0; i < 30; i++) {
    const page = await fetch(`${MFAPI_BASE}/mf?limit=${limit}&offset=${offset}`).then((r) => (r.ok ? r.json() : []));
    if (!Array.isArray(page) || page.length === 0) break;
    all = all.concat(page);
    if (page.length < limit) break;
    offset += limit;
  }
  cache.set("MFAPI_FULL_LIST", { ts: Date.now(), data: all });
  return all;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function mfapiSmartSearch(query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const full = await getFullMfapiSchemeList();

  // Score every scheme instead of requiring a perfect match — handles abbreviations
  // ("Pru" vs "Prudential"), spacing differences ("Midcap" vs "Mid Cap"), and near-typos
  // gracefully, falling back to the closest matches rather than returning nothing.
  const scored = [];
  for (const item of full) {
    const name = (item.schemeName || "").toLowerCase();
    const nameCompact = name.replace(/\s+/g, "");
    let score = 0;
    let matchedAll = true;
    for (const w of words) {
      const wCompact = w.replace(/\s+/g, "");
      if (name.includes(w) || nameCompact.includes(wCompact)) {
        score += 1;
        if (new RegExp(`\\b${escapeRegex(w)}`).test(name)) score += 0.5; // word-boundary match is a stronger signal
      } else {
        matchedAll = false;
      }
    }
    if (score > 0) scored.push({ item, score, matchedAll });
  }

  const complete = scored.filter((s) => s.matchedAll);
  const pool = complete.length > 0 ? complete : scored; // fall back to best partial matches rather than zero results
  return pool
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .map((s) => s.item);
}

async function getNiftyBenchmarkCode() {
  const cached = cache.get("NIFTY_BENCHMARK_CODE");
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  const results = await mfapiSmartSearch("nifty 50 index fund");
  const pick = (results || []).find((r) => /direct/i.test(r.schemeName) && /growth/i.test(r.schemeName)) || (results || [])[0];
  if (!pick) throw new Error("Could not resolve a Nifty 50 benchmark fund from MFapi.in");
  cache.set("NIFTY_BENCHMARK_CODE", { ts: Date.now(), data: pick.schemeCode });
  return pick.schemeCode;
}

async function getNiftyReturns() {
  const code = await getNiftyBenchmarkCode();
  const { returns } = await getMfapiSeries(code);
  return returns;
}

function mapIndianCategory(schemeCategory = "") {
  const s = schemeCategory.toLowerCase();
  if (s.includes("gold")) return "Gold";
  if (s.includes("international") || s.includes("global") || s.includes("overseas") || s.includes("us equity")) return "International";
  if (s.includes("liquid") || s.includes("overnight") || s.includes("money market")) return "Cash";
  if (s.includes("hybrid") || s.includes("balanced")) return "Hybrid";
  if (s.includes("debt") || s.includes("income") || s.includes("bond") || s.includes("gilt")) return "Debt";
  return "Equity";
}

// ---------- routes ----------

app.get("/api/search", async (req, res) => {
  try {
    const q = req.query.q;
    if (!q || q.length < 2) return res.json([]);

    const [fmpResults, mfapiResults] = await Promise.all([
      cachedFetch(`SEARCH_${q.toLowerCase()}`, `${FMP_BASE}/search-name?query=${encodeURIComponent(q)}&limit=6&apikey=${FMP_KEY}`).catch(() => []),
      mfapiSmartSearch(q).catch(() => []),
    ]);

    const fmpMapped = (Array.isArray(fmpResults) ? fmpResults : []).slice(0, 6).map((d) => ({
      symbol: d.symbol,
      name: d.name,
      exchange: d.exchangeShortName || d.exchange || d.stockExchange || "",
      currency: "USD",
      source: "fmp",
    }));

    const mfapiMapped = (Array.isArray(mfapiResults) ? mfapiResults : []).slice(0, 6).map((d) => ({
      symbol: `MF:${d.schemeCode}`,
      name: d.schemeName,
      exchange: "India · Mutual Fund",
      currency: "INR",
      source: "mfapi",
    }));

    res.json([...mfapiMapped, ...fmpMapped]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/fund-data", async (req, res) => {
  try {
    const symbol = req.query.symbol;
    if (!symbol) return res.status(400).json({ error: "symbol is required" });

    if (symbol.startsWith("MF:")) {
      const schemeCode = symbol.slice(3);
      const [{ monthly, returns, meta }, niftyReturns] = await Promise.all([
        getMfapiSeries(schemeCode),
        getNiftyReturns().catch(() => null),
      ]);
      const metrics = buildMetrics(monthly, returns, niftyReturns);
      return res.json({
        symbol,
        name: meta?.scheme_name || "Unknown fund",
        category: mapIndianCategory(meta?.scheme_category),
        currency: "INR",
        benchmark: "NIFTY 50",
        ...metrics,
      });
    }

    const [{ monthly, returns }, profileData, spyReturns] = await Promise.all([
      getFmpSeries(symbol),
      cachedFetch(`PROFILE_${symbol}`, `${FMP_BASE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`).catch(() => null),
      getSpyReturns().catch(() => null),
    ]);
    const metrics = buildMetrics(monthly, returns, spyReturns);
    const profile = Array.isArray(profileData) ? profileData[0] : null;
    res.json({
      symbol: symbol.toUpperCase(),
      name: profile?.companyName || symbol.toUpperCase(),
      category: profile?.sector || "Equity",
      currency: "USD",
      benchmark: "S&P 500",
      ...metrics,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/correlation", async (req, res) => {
  try {
    const symbols = [...new Set(req.body.symbols || [])];
    const seriesMap = {};
    for (const s of symbols) {
      const { returns } = s.startsWith("MF:") ? await getMfapiSeries(s.slice(3)) : await getFmpSeries(s);
      seriesMap[s] = new Map(returns.map((r) => [r.period, r.r]));
    }
    const matrix = symbols.map((a) =>
      symbols.map((b) => {
        if (a === b) return 1;
        const common = [...seriesMap[a].keys()].filter((p) => seriesMap[b].has(p));
        if (common.length < 6) return null;
        const av = common.map((p) => seriesMap[a].get(p));
        const bv = common.map((p) => seriesMap[b].get(p));
        return Number(pearson(av, bv).toFixed(2));
      })
    );
    res.json({ symbols, matrix });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true, cachedSymbols: cache.size }));

// ---------- serve built frontend ----------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, "client", "dist");
app.use(express.static(clientDist));
app.get("*", (req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

app.listen(PORT, () => console.log(`Portfolio Simplified running on port ${PORT}`));
