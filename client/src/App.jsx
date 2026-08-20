import React, { useState, useMemo, useEffect, useRef } from "react";
import { Plus, Info, X, Trash2, Coins, PiggyBank, Sprout, Search, Loader2, RefreshCcw } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const CATEGORY_META = {
  Equity: { color: "#1F6F5C", label: "Equity (Stocks)" },
  Debt: { color: "#C88A2E", label: "Debt (Bonds)" },
  Hybrid: { color: "#7C9070", label: "Hybrid (Mixed)" },
  Gold: { color: "#D4AF37", label: "Gold" },
  International: { color: "#4A6FA5", label: "International" },
  Cash: { color: "#9B9B93", label: "Cash / Liquid" },
  "Financial Services": { color: "#4A6FA5", label: "Financial Services" },
  Technology: { color: "#1F6F5C", label: "Technology" },
  Healthcare: { color: "#7C9070", label: "Healthcare" },
  "Consumer Cyclical": { color: "#C88A2E", label: "Consumer" },
  Industrials: { color: "#9B9B93", label: "Industrials" },
};
function catMeta(name) {
  return CATEGORY_META[name] || { color: "#8A8578", label: name || "Other" };
}

const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmtMoney = (n) => "$" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

const TONE_COLOR = ["#B54B3A", "#C88A2E", "#3E7A5A"];
const TONE_BG = ["#F8E9E5", "#F8EFDD", "#E6F0E8"];

function growthRating(cagr) { const t = cagr < 6 ? 0 : cagr < 12 ? 1 : 2; return { tone: t, label: ["Modest", "Solid", "Strong"][t] }; }
function steadinessRating(sd) { if (sd < 8) return { tone: 2, label: "Very steady" }; if (sd < 15) return { tone: 1, label: "Some ups & downs" }; return { tone: 0, label: "Bumpy ride" }; }
function rewardRating(sharpe) { if (sharpe < 0.3) return { tone: 0, label: "Low reward for the risk" }; if (sharpe < 0.7) return { tone: 1, label: "Decent trade-off" }; return { tone: 2, label: "Great trade-off" }; }
function feesRating(er) { if (er == null) return { tone: 1, label: "Unknown" }; if (er < 0.5) return { tone: 2, label: "Low cost" }; if (er < 1.5) return { tone: 1, label: "Average cost" }; return { tone: 0, label: "Pricey" }; }
function dropRating(dd) { const v = Math.abs(dd); if (v < 10) return { tone: 2, label: "Mild dips" }; if (v < 25) return { tone: 1, label: "Moderate dips" }; return { tone: 0, label: "Severe dips" }; }
function betaRating(beta) { if (beta < 0.8) return { tone: 2, label: "More defensive than the market" }; if (beta <= 1.2) return { tone: 1, label: "Moves with the market" }; return { tone: 0, label: "Swings harder than the market" }; }

const METRIC_INFO = {
  growth: { title: "Growth Rate", plain: "How much the fund has grown, on average, each year — calculated from real historical prices.", formula: "CAGR from actual monthly closing prices: (End Value / Start Value)^(1/years) − 1.", example: "Computed automatically from the fund's price history — no manual entry." },
  steadiness: { title: "Steadiness", plain: "How much the fund's value bounces around month to month.", formula: "Standard deviation of monthly returns, annualized (× √12). Lower = smoother ride.", example: "Computed from the same monthly price history used for Growth Rate." },
  reward: { title: "Reward for Risk (Sharpe Ratio)", plain: "Whether the ups and downs were worth it, vs. a safe bank rate.", formula: "Sharpe = (Return − Risk-free rate) ÷ Standard deviation.", example: "Higher = more reward earned per unit of bumpiness." },
  sortino: { title: "Reward for Bad Risk (Sortino Ratio)", plain: "Like Sharpe, but only counts downside swings.", formula: "Sortino = (Return − Risk-free rate) ÷ Downside deviation (std. dev. of only the negative months).", example: "Two funds with the same Sharpe can have different Sortino if one fund's volatility mostly comes from good months." },
  fees: { title: "Fees", plain: "The yearly cost the fund charges to manage your money.", formula: "Expense Ratio as % of your investment, charged automatically each year. Free data doesn't reliably expose this for every fund — enter it yourself if you know it.", example: "On $10,000, a 1.5% fee costs about $150/year." },
  drop: { title: "Worst Drop", plain: "The biggest fall from a high point to a low point, historically.", formula: "Maximum Drawdown: largest % decline from a peak to the lowest point that followed, computed from real monthly prices.", example: "A worst drop of -30% means a $10,000 investment would have temporarily fallen to $7,000." },
  beta: { title: "Market Sensitivity (Beta)", plain: "How much the fund tends to move when the overall market (S&P 500) moves.", formula: "β = Covariance(fund monthly returns, S&P 500 monthly returns) ÷ Variance(S&P 500 returns). Computed automatically.", example: "β = 0.6 might mean the fund drops ~6% when the market drops 10%." },
  correlation: { title: "How funds move together", plain: "Whether two funds tend to rise and fall at the same time — this is what actually captures \"same stocks\" risk, even without seeing the holdings.", formula: "Real Pearson correlation of monthly returns, computed from each fund's actual price history: ranges from -1 (move oppositely) to +1 (move identically). 0 means no relationship.", example: "Two funds at 0.9 correlation offer very little diversification benefit — a bad month for one is a bad month for both, even if their names and categories look different." },
  portfolioSharpe: { title: "Portfolio Reward for Risk", plain: "The Reward for Risk score for everything combined.", formula: "Combined return is the amount-weighted average of each fund's Growth Rate. Combined risk uses: σₚ² = Σ(wᵢ²σᵢ²) + Σ(wᵢwⱼσᵢσⱼ·ρᵢⱼ) using the REAL correlation between each pair of funds (computed from price history), not an assumption. Portfolio Sharpe = (combined return − risk-free rate) ÷ √(σₚ²).", example: "If your funds are highly correlated, the portfolio doesn't get much diversification benefit even if the category labels look different." },
  portfolioBeta: { title: "Portfolio Market Sensitivity", plain: "How much the whole portfolio moves when the market moves.", formula: "Portfolio Beta = Σ(wᵢ · βᵢ) — exact amount-weighted average, no correlation assumption needed.", example: "50% in β=1.2 and 50% in β=0.4 gives portfolio Beta of 0.8." },
  diversification: { title: "Balance Score", plain: "How evenly spread the money is across different types of investments.", formula: "Balance Score = (1 − largest single category's share of total money) × 100.", example: "80% in one category → score ~20. Spread 30/30/25/15 → score ~70." },
  health: { title: "Overall Health Score", plain: "One number (0–100) combining risk-adjusted return quality and balance.", formula: "Health = 60% × Reward Score + 40% × Balance Score.\nReward Score maps Portfolio Sharpe from -0.5 (worst) to 1.5 (best) onto 0–100.\nA simplified index — a conversation-starter, not a verdict.", example: "Portfolio Sharpe 0.5 (Reward Score 50) + Balance Score 70 → Health = 0.6×50 + 0.4×70 = 58." },
};

function InfoDot({ metricKey }) {
  const [open, setOpen] = useState(false);
  const info = METRIC_INFO[metricKey];
  return (
    <span className="fp-info-wrap">
      <button type="button" className="fp-info-btn" aria-label={`About ${info.title}`} onClick={() => setOpen((o) => !o)}><Info size={13} strokeWidth={2.4} /></button>
      {open && (
        <div className="fp-info-card" role="dialog">
          <div className="fp-info-head"><span>{info.title}</span><button onClick={() => setOpen(false)} aria-label="Close"><X size={14} /></button></div>
          <p className="fp-info-plain">{info.plain}</p>
          <p className="fp-info-formula" style={{ whiteSpace: "pre-line" }}><strong>How it's worked out: </strong>{info.formula}</p>
          <p className="fp-info-example"><strong>Example: </strong>{info.example}</p>
        </div>
      )}
    </span>
  );
}

function MetricChip({ metricKey, rating, value, unit }) {
  return (
    <div className="fp-chip" style={{ background: TONE_BG[rating.tone] }}>
      <div className="fp-chip-top"><span className="fp-chip-label">{METRIC_INFO[metricKey].title}</span><InfoDot metricKey={metricKey} /></div>
      <div className="fp-chip-value" style={{ color: TONE_COLOR[rating.tone] }}>{rating.label}</div>
      <div className="fp-chip-raw">{value}{unit}</div>
    </div>
  );
}

// ---------- portfolio math using REAL correlation matrix ----------

function corrLookup(matrix, symA, symB) {
  if (!matrix || !symA || !symB) return 0.4; // fallback assumption when data is missing
  const i = matrix.symbols.indexOf(symA);
  const j = matrix.symbols.indexOf(symB);
  if (i === -1 || j === -1) return 0.4;
  const v = matrix.matrix[i][j];
  return v === null || v === undefined ? 0.4 : v;
}

function computePortfolioStats(funds, riskFree, correlationMatrix) {
  const total = funds.reduce((s, f) => s + Number(f.amount || 0), 0);
  if (total === 0 || funds.length === 0) {
    return { total: 0, portfolioReturn: 0, portfolioStdDev: 0, portfolioDownsideDev: 0, portfolioSharpe: 0, portfolioSortino: 0, portfolioBeta: null, betaCoverage: 0 };
  }
  const weights = funds.map((f) => Number(f.amount || 0) / total);
  const portfolioReturn = funds.reduce((s, f, i) => s + weights[i] * Number(f.cagr || 0), 0);

  let variance = 0, downsideVariance = 0;
  const downsideDevs = funds.map((f) => f.downsideDev != null ? Number(f.downsideDev) : Number(f.stdDev || 0) * 0.7);
  for (let i = 0; i < funds.length; i++) {
    variance += weights[i] ** 2 * Number(funds[i].stdDev || 0) ** 2;
    downsideVariance += weights[i] ** 2 * downsideDevs[i] ** 2;
  }
  for (let i = 0; i < funds.length; i++) {
    for (let j = 0; j < funds.length; j++) {
      if (i === j) continue;
      const rho = corrLookup(correlationMatrix, funds[i].symbol, funds[j].symbol);
      variance += weights[i] * weights[j] * Number(funds[i].stdDev || 0) * Number(funds[j].stdDev || 0) * rho;
      downsideVariance += weights[i] * weights[j] * downsideDevs[i] * downsideDevs[j] * rho;
    }
  }
  const portfolioStdDev = Math.sqrt(Math.max(variance, 0));
  const portfolioDownsideDev = Math.sqrt(Math.max(downsideVariance, 0));
  const portfolioSharpe = portfolioStdDev > 0 ? (portfolioReturn - riskFree) / portfolioStdDev : 0;
  const portfolioSortino = portfolioDownsideDev > 0 ? (portfolioReturn - riskFree) / portfolioDownsideDev : 0;

  const betaFunds = funds.map((f, i) => ({ w: weights[i], beta: f.beta })).filter((x) => x.beta !== null && x.beta !== undefined);
  const betaCoverage = betaFunds.reduce((s, x) => s + x.w, 0);
  const portfolioBeta = betaCoverage > 0 ? betaFunds.reduce((s, x) => s + x.w * Number(x.beta), 0) / betaCoverage : null;

  return { total, portfolioReturn, portfolioStdDev, portfolioDownsideDev, portfolioSharpe, portfolioSortino, portfolioBeta, betaCoverage };
}

// ---------- main app ----------

export default function App() {
  const [riskFree, setRiskFree] = useState(7);
  const [funds, setFunds] = useState([]);
  const [pensions, setPensions] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showPensionForm, setShowPensionForm] = useState(false);
  const [correlationMatrix, setCorrelationMatrix] = useState(null);
  const [corrLoading, setCorrLoading] = useState(false);

  const symbols = useMemo(() => funds.map((f) => f.symbol).filter(Boolean), [funds]);

  useEffect(() => {
    if (symbols.length < 2) { setCorrelationMatrix(null); return; }
    let cancelled = false;
    setCorrLoading(true);
    fetch("/api/correlation", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbols }),
    }).then((r) => r.json()).then((data) => { if (!cancelled) setCorrelationMatrix(data); })
      .catch(() => {}).finally(() => { if (!cancelled) setCorrLoading(false); });
    return () => { cancelled = true; };
  }, [symbols.join(",")]);

  const stats = useMemo(() => computePortfolioStats(funds, riskFree, correlationMatrix), [funds, riskFree, correlationMatrix]);
  const lumpPensionTotal = useMemo(() => pensions.filter((p) => p.type === "Lump Sum / Corpus").reduce((s, p) => s + Number(p.amount || 0), 0), [pensions]);
  const totalFamilyWealth = stats.total + lumpPensionTotal;

  const allocationData = useMemo(() => {
    const byCat = {};
    funds.forEach((f) => { byCat[f.category] = (byCat[f.category] || 0) + Number(f.amount || 0); });
    if (lumpPensionTotal > 0) byCat["Pension"] = lumpPensionTotal;
    return Object.entries(byCat).map(([name, value]) => ({ name, value, color: catMeta(name).color }));
  }, [funds, lumpPensionTotal]);

  const diversificationScore = useMemo(() => {
    if (totalFamilyWealth === 0) return 0;
    const maxShare = Math.max(...allocationData.map((d) => d.value)) / totalFamilyWealth;
    return clamp((1 - maxShare) * 100, 0, 100);
  }, [allocationData, totalFamilyWealth]);

  const diversificationLabel = funds.length === 0 ? "Add a fund to see this" : diversificationScore < 35 ? "Mostly in one basket" : diversificationScore < 65 ? "Getting there" : "Well spread out";
  const diversificationTone = diversificationScore < 35 ? 0 : diversificationScore < 65 ? 1 : 2;

  const rewardScore = useMemo(() => clamp((stats.portfolioSharpe - (-0.5)) / (1.5 - (-0.5)), 0, 1) * 100, [stats.portfolioSharpe]);
  const healthScore = useMemo(() => Math.round(0.6 * rewardScore + 0.4 * diversificationScore), [rewardScore, diversificationScore]);

  function addFund(fund) { setFunds((f) => [...f, { ...fund, id: uid() }]); setShowForm(false); }
  function removeFund(id) { setFunds((f) => f.filter((x) => x.id !== id)); }
  function addPension(p) { setPensions((arr) => [...arr, { ...p, id: uid() }]); setShowPensionForm(false); }
  function removePension(id) { setPensions((arr) => arr.filter((x) => x.id !== id)); }

  const gaugeCircumference = Math.PI * 90;
  const gaugeFraction = (healthScore / 100) * gaugeCircumference;

  return (
    <div className="fp-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
        * { box-sizing: border-box; }
        .fp-root { --bg:#F3F5F0; --card:#FFFFFF; --ink:#23281F; --ink-soft:#5B5F54; --line:#E2E4DA; --teal:#1F3B33; --amber:#C88A2E; --sage:#6E8B6C; font-family:'Inter',sans-serif; background:var(--bg); color:var(--ink); min-height:100vh; padding:28px 20px 60px; }
        .fp-shell { max-width: 960px; margin: 0 auto; }
        .fp-hero { margin-bottom: 24px; }
        .fp-eyebrow { font-family:'IBM Plex Mono',monospace; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:var(--sage); font-weight:600; margin-bottom:6px; display:block; }
        .fp-title { font-family:'Fraunces',serif; font-weight:600; font-size:34px; line-height:1.15; color:var(--teal); margin:0 0 8px; }
        .fp-sub { color:var(--ink-soft); font-size:15px; max-width:620px; line-height:1.5; margin:0; }
        .fp-grid { display:grid; grid-template-columns:1.1fr 1fr; gap:18px; margin-bottom:18px; }
        @media (max-width:760px){ .fp-grid{grid-template-columns:1fr;} }
        .fp-card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:22px; box-shadow:0 1px 2px rgba(35,40,31,0.04); }
        .fp-card-title { font-family:'Fraunces',serif; font-weight:600; font-size:17px; color:var(--teal); margin:0 0 14px; display:flex; align-items:center; gap:8px; justify-content:space-between; }
        .fp-card-title-left { display:flex; align-items:center; gap:8px; }
        .fp-gauge-wrap { display:flex; flex-direction:column; align-items:center; }
        .fp-gauge-score { font-family:'Fraunces',serif; font-size:40px; font-weight:700; color:var(--teal); margin-top:-46px; }
        .fp-gauge-label { font-size:13px; color:var(--ink-soft); margin-top:2px; }
        .fp-gauge-scale { font-size:11px; color:#9A9C8F; margin-top:2px; }
        .fp-gauge-row { display:flex; justify-content:space-between; width:100%; margin-top:18px; padding-top:14px; border-top:1px solid var(--line); flex-wrap:wrap; gap:10px; }
        .fp-gauge-stat { text-align:center; flex:1; min-width:80px; }
        .fp-gauge-stat b { display:block; font-family:'IBM Plex Mono',monospace; font-size:15px; color:var(--ink); }
        .fp-gauge-stat span { font-size:11.5px; color:var(--ink-soft); }
        .fp-pie-legend { display:flex; flex-wrap:wrap; gap:10px 16px; margin-top:10px; }
        .fp-pie-legend-item { display:flex; align-items:center; gap:6px; font-size:12.5px; color:var(--ink-soft); }
        .fp-dot { width:9px; height:9px; border-radius:50%; display:inline-block; }
        .fp-diversify-note { margin-top:14px; padding:10px 12px; border-radius:10px; font-size:13px; }
        .fp-section-head { display:flex; align-items:center; justify-content:space-between; margin:26px 0 14px; }
        .fp-section-title { font-family:'Fraunces',serif; font-size:21px; font-weight:600; color:var(--teal); margin:0; }
        .fp-add-btn { display:flex; align-items:center; gap:6px; background:var(--teal); color:#fff; border:none; padding:9px 16px; border-radius:999px; font-size:13.5px; font-weight:600; cursor:pointer; }
        .fp-add-btn:hover { background:#16302A; }
        .fp-fund-card { margin-bottom:14px; }
        .fp-fund-head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; flex-wrap:wrap; gap:8px; }
        .fp-fund-name { font-family:'Fraunces',serif; font-size:19px; font-weight:600; color:var(--ink); margin:0 0 4px; }
        .fp-fund-meta { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
        .fp-badge { font-size:11.5px; font-weight:600; padding:3px 9px; border-radius:999px; font-family:'IBM Plex Mono',monospace; }
        .fp-fund-amount { font-family:'IBM Plex Mono',monospace; font-size:14px; color:var(--ink-soft); }
        .fp-del-btn { background:none; border:none; cursor:pointer; color:#B0AC9E; padding:4px; }
        .fp-del-btn:hover { color:#B54B3A; }
        .fp-chips { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; }
        .fp-chip { border-radius:12px; padding:12px; }
        .fp-chip-top { display:flex; justify-content:space-between; align-items:center; gap:6px; }
        .fp-chip-label { font-size:11px; font-weight:600; color:var(--ink-soft); text-transform:uppercase; letter-spacing:0.02em; }
        .fp-chip-value { font-family:'Fraunces',serif; font-weight:600; font-size:14.5px; margin-top:4px; }
        .fp-chip-raw { font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--ink-soft); margin-top:2px; }
        .fp-info-wrap { position:relative; display:inline-block; }
        .fp-info-btn { width:18px; height:18px; border-radius:50%; border:1px solid #C7C4B6; background:#fff; color:var(--ink-soft); display:flex; align-items:center; justify-content:center; cursor:pointer; padding:0; flex-shrink:0; }
        .fp-info-btn:hover { border-color:var(--teal); color:var(--teal); }
        .fp-info-card { position:absolute; z-index:30; top:24px; right:-8px; width:290px; background:var(--teal); color:#F3F5F0; border-radius:12px; padding:14px; box-shadow:0 8px 24px rgba(0,0,0,0.18); font-size:12.5px; line-height:1.5; }
        .fp-info-head { display:flex; justify-content:space-between; align-items:center; font-weight:700; font-family:'Fraunces',serif; font-size:14px; margin-bottom:8px; }
        .fp-info-head button { background:none; border:none; color:#C9CFC4; cursor:pointer; }
        .fp-info-plain { margin:0 0 8px; }
        .fp-info-formula { margin:0 0 8px; color:#D8DCCF; }
        .fp-info-example { margin:0; color:#BFC7B3; font-style:italic; }
        .fp-form-overlay { position:fixed; inset:0; background:rgba(35,40,31,0.45); display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; overflow-y:auto; z-index:50; }
        .fp-form-card { background:#fff; border-radius:18px; padding:26px; width:100%; max-width:480px; }
        .fp-form-title { font-family:'Fraunces',serif; font-size:20px; font-weight:600; color:var(--teal); margin:0 0 4px; }
        .fp-form-sub { font-size:13px; color:var(--ink-soft); margin:0 0 18px; }
        .fp-field { margin-bottom:14px; position: relative; }
        .fp-field label { display:block; font-size:12.5px; font-weight:600; color:var(--ink-soft); margin-bottom:5px; }
        .fp-field input, .fp-field select { width:100%; border:1px solid var(--line); border-radius:9px; padding:9px 11px; font-size:14px; font-family:'Inter',sans-serif; background:#FBFBF9; color:var(--ink); }
        .fp-field input:focus, .fp-field select:focus { outline:2px solid var(--sage); border-color:var(--sage); }
        .fp-field-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .fp-field-hint { font-size:11.5px; color:#8F9385; margin-top:3px; }
        .fp-form-actions { display:flex; gap:10px; margin-top:18px; }
        .fp-btn-primary { flex:1; background:var(--teal); color:#fff; border:none; padding:11px; border-radius:9px; font-weight:600; font-size:14px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; }
        .fp-btn-secondary { background:#fff; border:1px solid var(--line); color:var(--ink-soft); padding:11px 16px; border-radius:9px; font-weight:600; font-size:14px; cursor:pointer; }
        .fp-btn-link { background:none; border:none; color:var(--sage); font-size:12.5px; font-weight:600; cursor:pointer; padding:0; text-decoration:underline; }
        .fp-empty { text-align:center; padding:30px 20px; color:var(--ink-soft); font-size:14px; }
        .fp-pension-row { display:flex; justify-content:space-between; align-items:center; padding:12px 14px; background:#FAFAF6; border:1px solid var(--line); border-radius:11px; margin-bottom:10px; flex-wrap:wrap; gap:8px; }
        .fp-pension-left { display:flex; align-items:center; gap:10px; }
        .fp-pension-icon { width:34px; height:34px; border-radius:50%; background:#EFEBDD; display:flex; align-items:center; justify-content:center; color:var(--amber); }
        .fp-pension-name { font-weight:600; font-size:14px; }
        .fp-pension-type { font-size:12px; color:var(--ink-soft); }
        .fp-pension-amount { font-family:'IBM Plex Mono',monospace; font-size:14px; }
        .fp-settings { display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--ink-soft); margin-top:10px; flex-wrap:wrap; }
        .fp-settings input[type=number] { width:60px; padding:4px 6px; border-radius:6px; border:1px solid var(--line); font-family:'IBM Plex Mono',monospace; }
        .fp-portfolio-metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-top:6px; }
        .fp-pm-card { background:#FAFAF6; border:1px solid var(--line); border-radius:12px; padding:12px; }
        .fp-pm-top { display:flex; justify-content:space-between; align-items:center; }
        .fp-pm-label { font-size:11px; font-weight:600; color:var(--ink-soft); text-transform:uppercase; letter-spacing:0.02em; }
        .fp-pm-value { font-family:'Fraunces',serif; font-weight:700; font-size:20px; color:var(--teal); margin-top:4px; }
        .fp-pm-sub { font-size:11px; color:#9A9C8F; margin-top:2px; }
        .fp-coverage-note { font-size:11.5px; color:#9A9C8F; margin-top:8px; }
        .fp-suggest-list { position:absolute; top:100%; left:0; right:0; background:#fff; border:1px solid var(--line); border-radius:10px; margin-top:4px; box-shadow:0 6px 18px rgba(0,0,0,0.08); z-index:10; max-height:220px; overflow-y:auto; }
        .fp-suggest-item { padding:9px 12px; cursor:pointer; font-size:13.5px; border-bottom:1px solid #F0F0EA; }
        .fp-suggest-item:last-child { border-bottom:none; }
        .fp-suggest-item:hover { background:#F6F5F1; }
        .fp-suggest-sym { font-family:'IBM Plex Mono',monospace; font-weight:600; color:var(--teal); margin-right:8px; }
        .fp-suggest-name { color:var(--ink-soft); font-size:12.5px; }
        .fp-selected-fund { display:flex; align-items:center; gap:8px; background:#E6F0E8; border-radius:9px; padding:8px 11px; font-size:13.5px; color:var(--teal); font-weight:600; }
        .fp-form-error { background:#F8E9E5; color:#B54B3A; border-radius:9px; padding:10px 12px; font-size:13px; margin-bottom:14px; }
        .fp-corr-table { width:100%; border-collapse:collapse; font-size:12.5px; margin-top:10px; }
        .fp-corr-table th, .fp-corr-table td { padding:6px 8px; text-align:center; font-family:'IBM Plex Mono',monospace; }
        .fp-corr-table th { color:var(--ink-soft); font-weight:600; font-size:11px; }
        .fp-corr-table td.fp-corr-label { text-align:left; font-family:'Inter',sans-serif; font-weight:600; color:var(--ink); }
      `}</style>

      <div className="fp-shell">
        <div className="fp-hero">
          <span className="fp-eyebrow">Family Portfolio Check-in</span>
          <h1 className="fp-title">See where the money stands.</h1>
          <p className="fp-sub">Type a fund name — growth, risk, and how it moves with your other funds are pulled automatically from real market data.</p>
        </div>

        <div className="fp-grid">
          <div className="fp-card">
            <h3 className="fp-card-title"><span className="fp-card-title-left"><Sprout size={17} /> Overall Health</span><InfoDot metricKey="health" /></h3>
            <div className="fp-gauge-wrap">
              <svg viewBox="0 0 200 110" width="220" height="120">
                <path d="M10,100 A90,90 0 0,1 190,100" stroke="#E7E5D9" strokeWidth="14" fill="none" strokeLinecap="round" />
                <path d="M10,100 A90,90 0 0,1 190,100" stroke={healthScore >= 66 ? "#3E7A5A" : healthScore >= 40 ? "#C88A2E" : "#B54B3A"} strokeWidth="14" fill="none" strokeLinecap="round" strokeDasharray={`${gaugeFraction} ${gaugeCircumference}`} />
              </svg>
              <div className="fp-gauge-score">{funds.length ? healthScore : "–"}</div>
              <div className="fp-gauge-label">{funds.length === 0 ? "Add a fund to get a score" : healthScore >= 66 ? "Looking healthy" : healthScore >= 40 ? "Room to improve" : "Worth a closer look"}</div>
              <div className="fp-gauge-scale">Scale: 0 (needs work) — 100 (excellent)</div>
              <div className="fp-gauge-row">
                <div className="fp-gauge-stat"><b>{fmtMoney(totalFamilyWealth)}</b><span>Total tracked</span></div>
                <div className="fp-gauge-stat"><b>{funds.length}</b><span>Funds</span></div>
                <div className="fp-gauge-stat"><b>{diversificationLabel === "Add a fund to see this" ? "–" : diversificationLabel}</b><span>Balance</span></div>
              </div>
            </div>
            <div className="fp-settings"><span>Safe/bank rate:</span><input type="number" value={riskFree} onChange={(e) => setRiskFree(Number(e.target.value))} /> %</div>
          </div>

          <div className="fp-card">
            <h3 className="fp-card-title"><span className="fp-card-title-left"><Coins size={17} /> Where the money sits</span></h3>
            {allocationData.length === 0 ? <div className="fp-empty">Nothing added yet.</div> : (
              <>
                <div style={{ width: "100%", height: 190 }}>
                  <ResponsiveContainer><PieChart>
                    <Pie data={allocationData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2}>
                      {allocationData.map((d, i) => <Cell key={i} fill={d.color} stroke="none" />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmtMoney(v)} />
                  </PieChart></ResponsiveContainer>
                </div>
                <div className="fp-pie-legend">
                  {allocationData.map((d) => <div className="fp-pie-legend-item" key={d.name}><span className="fp-dot" style={{ background: d.color }} />{d.name} · {Math.round((d.value / totalFamilyWealth) * 100)}%</div>)}
                </div>
                <div className="fp-diversify-note" style={{ background: TONE_BG[diversificationTone], color: TONE_COLOR[diversificationTone] }}>
                  {diversificationTone === 0 && "Most of the money is concentrated in one type of investment."}
                  {diversificationTone === 1 && "The mix is reasonably spread, but leans toward one category."}
                  {diversificationTone === 2 && "The money is spread across several types of investments."}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="fp-card">
          <h3 className="fp-card-title"><span className="fp-card-title-left">Portfolio-wide numbers</span></h3>
          <div className="fp-portfolio-metrics">
            <div className="fp-pm-card"><div className="fp-pm-top"><span className="fp-pm-label">Combined Growth Rate</span></div><div className="fp-pm-value">{stats.portfolioReturn.toFixed(2)}%</div><div className="fp-pm-sub">amount-weighted</div></div>
            <div className="fp-pm-card"><div className="fp-pm-top"><span className="fp-pm-label">Combined Steadiness</span></div><div className="fp-pm-value">{stats.portfolioStdDev.toFixed(2)}%</div><div className="fp-pm-sub">using real fund correlations</div></div>
            <div className="fp-pm-card"><div className="fp-pm-top"><span className="fp-pm-label">Portfolio Sharpe</span><InfoDot metricKey="portfolioSharpe" /></div><div className="fp-pm-value">{stats.portfolioSharpe.toFixed(2)}</div><div className="fp-pm-sub">{rewardRating(stats.portfolioSharpe).label}</div></div>
            <div className="fp-pm-card"><div className="fp-pm-top"><span className="fp-pm-label">Portfolio Sortino</span><InfoDot metricKey="sortino" /></div><div className="fp-pm-value">{stats.portfolioSortino.toFixed(2)}</div><div className="fp-pm-sub">downside-only</div></div>
            <div className="fp-pm-card"><div className="fp-pm-top"><span className="fp-pm-label">Portfolio Beta</span><InfoDot metricKey="portfolioBeta" /></div><div className="fp-pm-value">{stats.portfolioBeta != null ? stats.portfolioBeta.toFixed(2) : "—"}</div><div className="fp-pm-sub">{stats.portfolioBeta != null ? betaRating(stats.portfolioBeta).label : "no beta data yet"}</div></div>
            <div className="fp-pm-card"><div className="fp-pm-top"><span className="fp-pm-label">Balance Score</span><InfoDot metricKey="diversification" /></div><div className="fp-pm-value">{Math.round(diversificationScore)}</div><div className="fp-pm-sub">0=concentrated, 100=spread</div></div>
          </div>

          {funds.length >= 2 && (
            <>
              <div className="fp-card-title" style={{ marginTop: 20, marginBottom: 6 }}>
                <span className="fp-card-title-left">How your funds move together {corrLoading && <Loader2 size={14} className="fp-spin" style={{ animation: "spin 1s linear infinite" }} />}</span>
                <InfoDot metricKey="correlation" />
              </div>
              {correlationMatrix ? (
                <table className="fp-corr-table">
                  <thead><tr><th></th>{funds.map((f) => <th key={f.id}>{f.symbol}</th>)}</tr></thead>
                  <tbody>
                    {funds.map((rowFund, i) => (
                      <tr key={rowFund.id}>
                        <td className="fp-corr-label">{rowFund.symbol}</td>
                        {funds.map((colFund, j) => {
                          const v = corrLookup(correlationMatrix, rowFund.symbol, colFund.symbol);
                          const tone = i === j ? null : v > 0.7 ? 0 : v > 0.4 ? 1 : 2;
                          return <td key={colFund.id} style={i === j ? {} : { color: TONE_COLOR[tone], fontWeight: 600 }}>{i === j ? "—" : v.toFixed(2)}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="fp-coverage-note">Calculating…</div>}
            </>
          )}
        </div>

        <div className="fp-section-head"><h2 className="fp-section-title">Mutual Funds</h2><button className="fp-add-btn" onClick={() => setShowForm(true)}><Plus size={15} /> Add a fund</button></div>
        {funds.length === 0 && <div className="fp-card fp-empty">No funds added yet. Add the first one above.</div>}
        {funds.map((f) => {
          const sharpe = f.stdDev > 0 ? (Number(f.cagr) - riskFree) / Number(f.stdDev) : 0;
          const g = growthRating(Number(f.cagr));
          const s = steadinessRating(Number(f.stdDev));
          const r = rewardRating(sharpe);
          const fe = feesRating(f.expenseRatio);
          const d = dropRating(Number(f.maxDrawdown));
          const cm = catMeta(f.category);
          return (
            <div className="fp-card fp-fund-card" key={f.id}>
              <div className="fp-fund-head">
                <div>
                  <h3 className="fp-fund-name">{f.name} {f.symbol && <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 13, color: "#9A9C8F" }}>({f.symbol})</span>}</h3>
                  <div className="fp-fund-meta">
                    <span className="fp-badge" style={{ background: cm.color + "22", color: cm.color }}>{cm.label}</span>
                    <span className="fp-badge" style={{ background: "#EEEDE6", color: "#5B5F54" }}>{f.mode === "SIP" ? `SIP · ${fmtMoney(f.sip)}/mo` : "One-time"}</span>
                    <span className="fp-fund-amount">{fmtMoney(f.amount)} invested</span>
                  </div>
                </div>
                <button className="fp-del-btn" onClick={() => removeFund(f.id)} aria-label="Remove fund"><Trash2 size={16} /></button>
              </div>
              <div className="fp-chips">
                <MetricChip metricKey="growth" rating={g} value={f.cagr} unit="% / yr" />
                <MetricChip metricKey="steadiness" rating={s} value={f.stdDev} unit="%" />
                <MetricChip metricKey="reward" rating={r} value={sharpe.toFixed(2)} unit="" />
                <MetricChip metricKey="fees" rating={fe} value={f.expenseRatio != null ? f.expenseRatio : "?"} unit={f.expenseRatio != null ? "%" : ""} />
                <MetricChip metricKey="drop" rating={d} value={f.maxDrawdown} unit="%" />
                {f.beta != null && <MetricChip metricKey="beta" rating={betaRating(Number(f.beta))} value={f.beta} unit="" />}
              </div>
            </div>
          );
        })}

        <div className="fp-section-head"><h2 className="fp-section-title">Pension &amp; Retirement Funds</h2><button className="fp-add-btn" onClick={() => setShowPensionForm(true)}><Plus size={15} /> Add pension</button></div>
        {pensions.length === 0 && <div className="fp-card fp-empty">No pension or retirement accounts added yet.</div>}
        {pensions.map((p) => (
          <div className="fp-pension-row" key={p.id}>
            <div className="fp-pension-left"><div className="fp-pension-icon"><PiggyBank size={17} /></div><div><div className="fp-pension-name">{p.name}</div><div className="fp-pension-type">{p.type}</div></div></div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span className="fp-pension-amount">{p.type === "Monthly Pension" ? `${fmtMoney(p.amount)}/mo` : fmtMoney(p.amount)}</span>
              <button className="fp-del-btn" onClick={() => removePension(p.id)} aria-label="Remove pension"><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>

      {showForm && <FundForm onCancel={() => setShowForm(false)} onSave={addFund} />}
      {showPensionForm && <PensionForm onCancel={() => setShowPensionForm(false)} onSave={addPension} />}
    </div>
  );
}

// ---------- fund form: name search + auto-fill, with manual fallback ----------

function FundForm({ onCancel, onSave }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [selected, setSelected] = useState(null); // {symbol, name}
  const [showSuggest, setShowSuggest] = useState(false);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("Lump Sum");
  const [sip, setSip] = useState("");
  const [expenseRatio, setExpenseRatio] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [manual, setManual] = useState({ name: "", category: "Equity", cagr: "", stdDev: "", maxDrawdown: "", beta: "" });
  const debounceRef = useRef(null);

  useEffect(() => {
    if (selected || query.length < 2) { setSuggestions([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`).then((r) => r.json()).then((data) => { setSuggestions(data); setShowSuggest(true); }).catch(() => setSuggestions([]));
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [query, selected]);

  const canSave = amount && (selected || (manualMode && manual.name && manual.cagr !== "" && manual.stdDev !== "" && manual.maxDrawdown !== ""));

  async function handleSave() {
    if (!canSave) return;
    setError("");
    if (manualMode || !selected) {
      onSave({
        name: manual.name, symbol: null, category: manual.category, amount: Number(amount), mode, sip: Number(sip || 0),
        cagr: Number(manual.cagr), stdDev: Number(manual.stdDev), maxDrawdown: Number(manual.maxDrawdown),
        beta: manual.beta === "" ? null : Number(manual.beta), downsideDev: null,
        expenseRatio: expenseRatio === "" ? null : Number(expenseRatio),
      });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/fund-data?symbol=${encodeURIComponent(selected.symbol)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Couldn't fetch data for this fund.");
      }
      const data = await res.json();
      onSave({
        name: data.name || selected.name, symbol: data.symbol, category: data.category, amount: Number(amount), mode, sip: Number(sip || 0),
        cagr: data.cagr, stdDev: data.stdDev, downsideDev: data.downsideDev, maxDrawdown: data.maxDrawdown, beta: data.beta,
        expenseRatio: expenseRatio === "" ? null : Number(expenseRatio),
      });
    } catch (e) {
      setError(e.message + " You can enter the details manually instead.");
      setManualMode(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fp-form-overlay" onClick={onCancel}>
      <div className="fp-form-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="fp-form-title">Add a fund</h3>
        <p className="fp-form-sub">Search for the fund by name or ticker — growth, risk, and market sensitivity are pulled automatically.</p>
        {error && <div className="fp-form-error">{error}</div>}

        {!manualMode && (
          <div className="fp-field">
            <label>Fund name or ticker</label>
            {selected ? (
              <div className="fp-selected-fund"><Search size={14} />{selected.name} ({selected.symbol})
                <button className="fp-btn-link" style={{ marginLeft: "auto" }} onClick={() => { setSelected(null); setQuery(""); }}>change</button>
              </div>
            ) : (
              <>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Vanguard Total Stock Market" onFocus={() => suggestions.length && setShowSuggest(true)} />
                {showSuggest && suggestions.length > 0 && (
                  <div className="fp-suggest-list">
                    {suggestions.map((s) => (
                      <div key={s.symbol} className="fp-suggest-item" onClick={() => { setSelected(s); setShowSuggest(false); }}>
                        <span className="fp-suggest-sym">{s.symbol}</span><span className="fp-suggest-name">{s.name}{s.exchange ? ` · ${s.exchange}` : ""}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            <div className="fp-field-hint">
              Can't find it? <button className="fp-btn-link" type="button" onClick={() => setManualMode(true)}>Enter details manually instead</button>
            </div>
          </div>
        )}

        {manualMode && (
          <>
            <div className="fp-field"><label>Fund name</label><input value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} placeholder="e.g. Balanced Growth Fund" /></div>
            <div className="fp-field-row">
              <div className="fp-field"><label>Category</label>
                <select value={manual.category} onChange={(e) => setManual({ ...manual, category: e.target.value })}>
                  {["Equity", "Debt", "Hybrid", "Gold", "International", "Cash"].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="fp-field"><label>Beta (optional)</label><input type="number" value={manual.beta} onChange={(e) => setManual({ ...manual, beta: e.target.value })} placeholder="0.9" /></div>
            </div>
            <div className="fp-field-row">
              <div className="fp-field"><label>Growth rate</label><input type="number" value={manual.cagr} onChange={(e) => setManual({ ...manual, cagr: e.target.value })} placeholder="10.5" /><div className="fp-field-hint">% per year</div></div>
              <div className="fp-field"><label>Steadiness</label><input type="number" value={manual.stdDev} onChange={(e) => setManual({ ...manual, stdDev: e.target.value })} placeholder="9" /><div className="fp-field-hint">% std. dev.</div></div>
            </div>
            <div className="fp-field"><label>Worst drop</label><input type="number" value={manual.maxDrawdown} onChange={(e) => setManual({ ...manual, maxDrawdown: e.target.value })} placeholder="-14" /><div className="fp-field-hint">% max drawdown</div></div>
            <div className="fp-field-hint" style={{ marginBottom: 14 }}><button className="fp-btn-link" type="button" onClick={() => setManualMode(false)}>Back to search</button></div>
          </>
        )}

        <div className="fp-field-row">
          <div className="fp-field"><label>Investment mode</label><select value={mode} onChange={(e) => setMode(e.target.value)}><option>Lump Sum</option><option>SIP</option></select></div>
          <div className="fp-field"><label>Amount invested so far</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="8000" /></div>
        </div>
        {mode === "SIP" && <div className="fp-field"><label>Monthly SIP amount</label><input type="number" value={sip} onChange={(e) => setSip(e.target.value)} placeholder="300" /></div>}
        <div className="fp-field"><label>Fees / expense ratio (optional)</label><input type="number" value={expenseRatio} onChange={(e) => setExpenseRatio(e.target.value)} placeholder="0.9" /><div className="fp-field-hint">% per year — not reliably available from free data, add if you know it</div></div>

        <div className="fp-form-actions">
          <button className="fp-btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="fp-btn-primary" disabled={!canSave || loading} style={{ opacity: canSave && !loading ? 1 : 0.5 }} onClick={handleSave}>
            {loading && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
            {loading ? "Fetching data…" : "Add fund"}
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function PensionForm({ onCancel, onSave }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("Lump Sum / Corpus");
  const [amount, setAmount] = useState("");
  const canSave = name && amount;
  return (
    <div className="fp-form-overlay" onClick={onCancel}>
      <div className="fp-form-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="fp-form-title">Add a pension or retirement account</h3>
        <p className="fp-form-sub">Tracked alongside the funds for the full family picture.</p>
        <div className="fp-field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Employer Pension, Social Security" /></div>
        <div className="fp-field"><label>Type</label><select value={type} onChange={(e) => setType(e.target.value)}><option>Lump Sum / Corpus</option><option>Monthly Pension</option></select></div>
        <div className="fp-field"><label>{type === "Monthly Pension" ? "Monthly amount" : "Current value / corpus"}</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={type === "Monthly Pension" ? "1200" : "50000"} /></div>
        <div className="fp-form-actions">
          <button className="fp-btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="fp-btn-primary" disabled={!canSave} style={{ opacity: canSave ? 1 : 0.5 }} onClick={() => canSave && onSave({ name, type, amount: Number(amount) })}>Save</button>
        </div>
      </div>
    </div>
  );
}
