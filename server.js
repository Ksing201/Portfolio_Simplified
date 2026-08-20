import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const FMP_KEY = process.env.FMP_API_KEY;
const FMP_BASE = "https://financialmodelingprep.com/stable"; // newer keys (post Aug 2025) only have access to /stable, not legacy /api/v3
const CACHE_TTL = 1000 * 60 * 60 * 12; // 12 hours — keeps us well inside the 250/day free limit

function extractHistorical(data) {
  // stable endpoint sometimes returns a bare array, sometimes { symbol, historical: [...] } — handle both
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.historical)) return data.historical;
  return [];
}

const cache = new Map();

async function cachedFetch(key, url) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;
  const res = await fetch(url);
  if (!res.ok) {
    const hint = res.status === 403 ? " — check that FMP_API_KEY is set correctly in Render's Environment tab" : "";
    throw new Error(`FMP request failed (${res.status}) for ${key}${hint}`);
  }
  const data = await res.json();
  cache.set(key, { ts: Date.now(), data });
  return data;
}

// ---------- math helpers ----------

function monthlyFromDaily(historical) {
  const sorted = [...historical].sort((a, b) => new Date(a.date) - new Date(b.date));
  const monthly = [];
  let lastKey = null;
  for (const point of sorted) {
    const d = new Date(point.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key !== lastKey) {
      monthly.push({ date: point.date, close: point.close });
      lastKey = key;
    } else {
      monthly[monthly.length - 1] = { date: point.date, close: point.close };
    }
  }
  const returns = [];
  for (let i = 1; i < monthly.length; i++) {
    returns.push({ date: monthly[i].date, r: monthly[i].close / monthly[i - 1].close - 1 });
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
  let peak = monthly[0].close;
  let worst = 0;
  for (const m of monthly) {
    if (m.close > peak) peak = m.close;
    const dd = (m.close - peak) / peak;
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

// ---------- FMP-backed data ----------

async function getSeries(symbol) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 1100 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const data = await cachedFetch(
    `HIST_${symbol}`,
    `${FMP_BASE}/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&apikey=${FMP_KEY}`
  );
  const hist = extractHistorical(data);
  if (!hist.length) throw new Error(`No price history found for "${symbol}"`);
  return monthlyFromDaily(hist);
}

async function getMarketReturns() {
  const { returns } = await getSeries("SPY"); // S&P 500 ETF used as the market proxy for Beta
  return returns;
}

// ---------- routes ----------

app.get("/api/search", async (req, res) => {
  try {
    const q = req.query.q;
    if (!q || q.length < 2) return res.json([]);
    const data = await cachedFetch(
      `SEARCH_${q.toLowerCase()}`,
      `${FMP_BASE}/search-name?query=${encodeURIComponent(q)}&limit=8&apikey=${FMP_KEY}`
    );
    res.json((Array.isArray(data) ? data : []).map((d) => ({
      symbol: d.symbol,
      name: d.name,
      exchange: d.exchangeShortName || d.exchange || d.stockExchange || "",
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/fund-data", async (req, res) => {
  try {
    const symbol = req.query.symbol;
    if (!symbol) return res.status(400).json({ error: "symbol is required" });

    const [{ monthly, returns }, profileData, marketReturns] = await Promise.all([
      getSeries(symbol),
      cachedFetch(`PROFILE_${symbol}`, `${FMP_BASE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`).catch(() => null),
      getMarketReturns(),
    ]);

    if (monthly.length < 7) {
      return res.status(422).json({ error: "Not enough price history for a reliable calculation (need 6+ months)." });
    }

    const years = (new Date(monthly[monthly.length - 1].date) - new Date(monthly[0].date)) / (1000 * 60 * 60 * 24 * 365.25);
    const cagr = years > 0 ? ((monthly[monthly.length - 1].close / monthly[0].close) ** (1 / years) - 1) * 100 : 0;

    const rets = returns.map((r) => r.r);
    const annualStdDev = annualize(stdDev(rets));
    const negRets = rets.filter((r) => r < 0);
    const annualDownsideDev = annualize(stdDev(negRets));

    const marketMap = new Map(marketReturns.map((m) => [m.date, m.r]));
    const aligned = returns.filter((r) => marketMap.has(r.date)).map((r) => ({ fund: r.r, market: marketMap.get(r.date) }));
    let beta = null;
    if (aligned.length >= 6) {
      const meanF = aligned.reduce((s, x) => s + x.fund, 0) / aligned.length;
      const meanM = aligned.reduce((s, x) => s + x.market, 0) / aligned.length;
      let cov = 0, varM = 0;
      for (const a of aligned) { cov += (a.fund - meanF) * (a.market - meanM); varM += (a.market - meanM) ** 2; }
      cov /= aligned.length - 1;
      varM /= aligned.length - 1;
      beta = varM > 0 ? cov / varM : null;
    }

    const profile = Array.isArray(profileData) ? profileData[0] : null;

    res.json({
      symbol: symbol.toUpperCase(),
      name: profile?.companyName || symbol.toUpperCase(),
      category: profile?.sector || "Equity",
      cagr: Number(cagr.toFixed(2)),
      stdDev: Number(annualStdDev.toFixed(2)),
      downsideDev: Number(annualDownsideDev.toFixed(2)),
      beta: beta !== null ? Number(beta.toFixed(2)) : null,
      maxDrawdown: Number(maxDrawdown(monthly).toFixed(2)),
      dataPoints: monthly.length,
      asOf: monthly[monthly.length - 1].date,
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
      const { returns } = await getSeries(s);
      seriesMap[s] = new Map(returns.map((r) => [r.date, r.r]));
    }
    const matrix = symbols.map((a) =>
      symbols.map((b) => {
        if (a === b) return 1;
        const common = [...seriesMap[a].keys()].filter((d) => seriesMap[b].has(d));
        if (common.length < 6) return null;
        const av = common.map((d) => seriesMap[a].get(d));
        const bv = common.map((d) => seriesMap[b].get(d));
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
