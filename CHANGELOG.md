# Changelog

All notable changes to Portfolio Simplified are documented here.

## [Unreleased]

## [1.3.0] — Indian mutual fund support via MFapi.in
### Added
- Second data source, [MFapi.in](https://www.mfapi.in), for Indian mutual
  fund schemes (e.g. ICICI Pru, HDFC, SBI funds) — free, no API key
  required. Fund search now returns results from both FMP (US
  stocks/ETFs) and MFapi.in (Indian schemes) side by side.
- **NIFTY 50** used as the market benchmark for Beta on Indian funds,
  resolved automatically to a live Nifty 50 index fund on MFapi.in (instead
  of S&P 500/SPY, which isn't a meaningful proxy for Indian equities).
- Automatic category mapping from AMFI scheme categories (Equity, Debt,
  Hybrid, Gold, International, Cash) for Indian funds.
- Currency tracking per fund (USD/INR), with a warning banner if a
  portfolio mixes currencies, since totals are summed as raw numbers
  without FX conversion.
- Currency selector added to the manual-entry fallback form.

### Changed
- Return-series alignment (used for Beta and correlation) switched from
  exact-date matching to calendar-month-period matching (`YYYY-MM`), since
  US and Indian markets don't share trading calendars — exact-date
  alignment would have silently failed for most cross-market pairs.
- Refactored FMP and MFapi data pipelines to share one metrics-calculation
  function (`buildMetrics`), reducing duplicated CAGR/Steadiness/Beta/
  Drawdown logic.

### Known limitations
- No FX conversion — a portfolio with both USD and INR funds shows a
  mixed-currency warning rather than a single converted total.
- Correlation between a US fund and an Indian fund is real (computed from
  actual price history), but has less overlapping data than same-market
  pairs, since it's aligned by calendar month rather than exact trading
  day.

## [1.2.0] — Backend migrated to FMP stable API
### Fixed
- Financial Modeling Prep retired their legacy `/api/v3/...` endpoints for
  accounts created after August 2025 — newer API keys only have access to
  the `/stable/...` endpoints. All backend requests (search, historical
  prices, profile) were migrated accordingly, fixing `403 Forbidden` errors
  on every fund search and add.
- Error messages now include a hint to check `FMP_API_KEY` in Render when a
  403 occurs, to make future auth issues faster to diagnose.
- Response parsing now handles both array and `{ historical: [...] }`
  response shapes, since the stable endpoint's format differs slightly from
  legacy.

## [1.1.0] — Auto-populated fund data, real correlation
### Added
- Adding a fund now only requires **name, amount, and investment mode** —
  everything else is fetched automatically.
- New Express backend (`server.js`) proxies Financial Modeling Prep:
  - Fund search-as-you-type (`/api/search`)
  - Computed metrics from real price history (`/api/fund-data`): Growth
    Rate (CAGR), Steadiness (annualized std. dev.), Downside Deviation,
    Beta (vs. S&P 500), and Worst Drop (max drawdown)
  - Real pairwise correlation between all added funds, computed from actual
    monthly returns (`/api/correlation`), replacing the earlier assumed
    correlation slider
- In-memory 12-hour cache on the backend to stay well within FMP's
  250 requests/day free tier limit.
- Manual-entry fallback per fund if a symbol can't be found or priced
  (e.g. some non-US mutual funds).
- Optional expense ratio field, since fee data isn't reliably available on
  the free data tier.
- Correlation matrix displayed in the UI, with color-coded values and an
  explanation of why shared holdings/co-movement matter for real
  diversification.
- `render.yaml` Blueprint for one-step Render deployment.

### Changed
- Project restructured from a single static frontend into a full-stack app
  (Express backend + Vite/React frontend) served from one Render Web
  Service.
- Portfolio-level Sharpe and Sortino ratios now use real, fund-specific
  correlation data instead of a single assumed correlation value.

## [1.0.0] — Initial hostable version
### Added
- Standalone Vite + React project structure (previously a single-file
  in-chat artifact), ready to deploy.
- Portfolio-wide metrics: amount-weighted Combined Growth Rate, Combined
  Steadiness, Portfolio Sharpe Ratio, Portfolio Sortino Ratio, and
  Portfolio Beta (exact amount-weighted average of fund Betas).
- Assumed-correlation slider (0–1) used to approximate portfolio-level risk
  in the absence of real return history.
- Beta and Downside Deviation added as optional per-fund inputs.
- Overall Health score (0–100): 60% risk-adjusted return quality (Portfolio
  Sharpe) + 40% Balance Score (category concentration).
- Info icons on every metric explaining what it means, how it's
  calculated, and a worked example in plain language.

## [0.1.0] — First version (in-chat artifact)
### Added
- Manual fund entry: name, category, amount, investment mode (SIP / lump
  sum), Growth Rate, Steadiness, Fees, Worst Drop.
- Plain-language ratings (e.g. "Solid", "Bumpy ride") for each metric with
  color-coded chips.
- Overall Health gauge and a pie chart of allocation by category.
- Pension/retirement account tracking, separate from mutual funds.
