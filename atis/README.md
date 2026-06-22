# ATIS — Autonomous Trading Intelligence System
## Phase 1: Research Dashboard

---

## DEPLOYMENT STEPS

### Step 1 — Push to GitHub

1. Create a new GitHub repository named `atis`
2. Push this entire folder to the repo root
3. Go to **Settings → Pages → Source: Deploy from branch → main → / (root)**
4. Your dashboard will be live at: `https://yourusername.github.io/atis`

---

### Step 2 — Deploy the Cloudflare Worker

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Click **Workers & Pages → Create Application → Create Worker**
3. Name it: `atis-worker`
4. Click **Edit Code** and paste the contents of `workers/api-gateway.js`
5. Click **Save and Deploy**
6. Copy your Worker URL (e.g. `https://atis-worker.yourname.workers.dev`)

**Set the ALLOWED_ORIGIN secret:**
1. In your Worker → **Settings → Variables**
2. Add Environment Variable:
   - Name: `ALLOWED_ORIGIN`
   - Value: `https://yourusername.github.io`
3. Click **Save and Deploy**

---

### Step 3 — Connect the Worker to your Dashboard

1. Open your live dashboard at `https://yourusername.github.io/atis`
2. Click **↻ Refresh** on the Market tab
3. When prompted, enter your Worker URL:
   `https://atis-worker.yourname.workers.dev`
4. Click OK — the URL is saved to localStorage

---

### Step 4 — Test Everything

Run this checklist:

- [ ] Market tab loads index prices (SPY, QQQ, IWM, VIX)
- [ ] Sector grid shows all 11 sectors with change percentages
- [ ] Macro tab loads and shows a regime classification
- [ ] Macro score breakdown shows all 5 categories scored
- [ ] Watchlist tab: add AAPL, click Refresh Prices, price appears
- [ ] Portfolio tab: click Manual Entry, set value to $500
- [ ] Journal tab: log a test trade, stats calculate correctly
- [ ] Agents tab: System Health shows Yahoo and FRED as Live
- [ ] Export backup, clear data, import backup — all work
- [ ] Emergency banner does NOT appear (account above $250)

---

## FILE STRUCTURE

```
atis/
├── index.html              — App shell
├── css/
│   └── styles.css          — Full stylesheet
├── js/
│   ├── app.js              — Tab router, initialization
│   ├── utils.js            — Shared utilities
│   ├── storage.js          — localStorage interface
│   ├── risk.js             — Risk engine
│   ├── indicators.js       — RSI, MACD, MA calculations
│   ├── scoring.js          — 60-point scoring model
│   ├── options.js          — Black-Scholes calculator
│   ├── dashboard.js        — Market Overview tab
│   ├── watchlist.js        — Watchlist + Macro + Portfolio tabs
│   ├── journal.js          — Journal + Reports + Agents tabs
│   └── app.js              — Entry point
└── workers/
    └── api-gateway.js      — Cloudflare Worker (deploy separately)
```

---

## PHASE ROADMAP

| Phase | What Gets Built | Status |
|-------|----------------|--------|
| **Phase 1** | Research Dashboard (this) | ← YOU ARE HERE |
| Phase 2 | Robinhood MCP read integration, live portfolio sync | Next |
| Phase 3 | Core AI agents (Macro, Risk, CIO, pipeline) | Future |
| Phase 4 | All 17 agents, backtesting engine, options analysis | Future |
| Phase 5 | Paper trading (90-day validation) | Future |
| Phase 6 | Live assisted trading with Robinhood MCP write | Future |
| Phase 7 | Automation evaluation | Future |

---

## ACCOUNT RULES (always active)

- Hard floor: **$250** — trading halted if account reaches this value
- Daily loss limit: **-3%**
- Weekly loss limit: **-7%**
- Monthly loss limit: **-15%**
- Max position size: **20%** (default 7.5%)
- Max positions: **5**
- Max sector exposure: **25%**

These rules are enforced in `risk.js` and will be enforced by the agent pipeline in Phase 3.

---

## DATA SOURCES (Phase 1)

| Source | Data | Cost |
|--------|------|------|
| Yahoo Finance (unofficial) | Prices, volume, financials, options | Free |
| FRED API | Yields, CPI, unemployment, fed funds | Free |

No API keys required in Phase 1.

---

## KNOWN LIMITATIONS (Phase 1)

- Yahoo Finance unofficial API — can break without notice. Worker handles errors gracefully.
- FRED data is sometimes 1-2 days delayed for some series.
- Options data and backtesting engine: Phase 4.
- All agent AI analysis: Phase 3+.
- Macro score uses daily index change as a breadth proxy — real breadth data (advance/decline lines) requires a paid data source. This is an acceptable approximation for Phase 1.
