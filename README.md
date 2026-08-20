# Portfolio Simplified

Track mutual funds and pensions for your family. Type a fund name and its
growth rate, risk, market sensitivity, and real correlation with your other
funds are pulled automatically from live market data (Financial Modeling Prep).

## Architecture

- `server.js` — Express backend. Proxies Financial Modeling Prep, computes
  CAGR / Steadiness / Beta / Downside Deviation / Max Drawdown / real
  pairwise correlation from actual price history, and serves the built
  frontend.
- `client/` — Vite + React frontend.

One Render Web Service runs both — the Express server serves the API
under `/api/*` and the built React app for everything else.

## Local development

1. `cp .env.example .env` and put your FMP API key in it.
2. Terminal 1: `npm install && npm start` (runs the server on :10000)
3. Terminal 2: `cd client && npm install && npm run dev` (runs Vite on :5173
   with a proxy to :10000 for `/api` calls)
4. Open http://localhost:5173

To test the production build locally instead:
```bash
npm install && npm run build && npm start
```
Then open http://localhost:10000 — this is what Render actually runs.

## Deploying on Render

See the step-by-step instructions provided separately. In short:
- New → Web Service (or Blueprint using `render.yaml`)
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Environment variable: `FMP_API_KEY` = your key

## API call budget

Financial Modeling Prep's free tier allows 250 requests/day. Each fund
costs about 2 calls the first time it's added (price history + profile),
cached for 12 hours server-side — so re-visiting the app or re-adding the
same fund doesn't burn extra calls. A 5–10 fund family portfolio comfortably
fits within the daily limit.

## What's computed vs. what you enter

You only enter: **fund name, amount, investment mode.**

Auto-computed from real price history:
- Growth Rate (CAGR)
- Steadiness (annualized standard deviation)
- Downside Deviation
- Beta (vs. S&P 500)
- Worst Drop (max drawdown)
- Real pairwise correlation between every fund you've added

Not reliably available on the free data tier, so it stays optional/manual:
- Expense ratio (fees) — enter it yourself if you know it from the factsheet

If a fund can't be found or priced (e.g. some smaller / non-US mutual
funds), the app falls back to a manual-entry form for that one fund.
