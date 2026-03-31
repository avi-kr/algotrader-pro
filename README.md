# 🚀 AlgoTrader Pro

A full-stack personal algorithmic trading platform for **Indian (NSE) stocks** and **Cryptocurrency** markets.

---

## ✨ Features

| Feature | Details |
|---|---|
| 📊 Live Dashboard | Real-time prices for Nifty 50 + Top 20 Crypto via Yahoo Finance & CoinGecko |
| 🔍 Symbol Search | Search any NSE stock or crypto from the dashboard |
| 📈 TradingView-style Charts | Candlestick charts with EMA, SMA, RSI, MACD, Bollinger Bands, ATR, VWAP |
| ⚡ Strategy Builder | Visual UI to build, edit, duplicate & delete strategies (no code needed) |
| 🔬 Backtester | Test strategies on up to 5 years of historical data with full metrics |
| 📋 Detailed Report | Win rate, Sharpe, Sortino, Calmar, Max Drawdown, Monthly P&L, Trade log |
| ℹ️ Learning Mode | Every indicator/concept has an "i" button explaining it in plain English + graphic |
| 📱 Responsive | Works on mobile, tablet, and desktop |

---

## 🛠 Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Charts**: lightweight-charts (TradingView's open-source chart library)
- **Styling**: Tailwind CSS
- **Market Data**: Yahoo Finance API (free) + CoinGecko API (free)
- **Deployment**: Vercel (free tier)
- **Storage**: Browser localStorage (strategies saved client-side)

---

## 🚀 Deploy to Vercel (Free — 5 minutes)

### Option A: GitHub → Vercel (Recommended)

1. Create a GitHub repo and push this project:
```bash
git init
git add .
git commit -m "AlgoTrader Pro"
git remote add origin https://github.com/YOUR_USERNAME/algotrader-pro.git
git push -u origin main
```

2. Go to [vercel.com](https://vercel.com) → **New Project**
3. Import your GitHub repo
4. Click **Deploy** — done! ✅

### Option B: Vercel CLI

```bash
npm install -g vercel
vercel login
vercel --prod
```

---

## 🖥 Run Locally

```bash
npm install
npm run dev
# → http://localhost:3000
```

---

## 📖 How to Use

### 1. Dashboard
- View live prices for all Nifty 50 stocks or top crypto
- Ticker tape at top scrolls live
- Search any symbol in the search bar
- Click **Chart →** to open a symbol's chart

### 2. Charts
- Select symbol from the dropdown or search
- Toggle between NSE and Crypto markets
- Change timeframe (1m → 1W)
- Add/remove indicators from the right panel
- Click Quick Add presets for common combos

### 3. Strategies
- Click **New Strategy**
- Add indicators (EMA, RSI, MACD, etc.)
- Define LONG/SHORT entry and exit conditions
- Set Stop Loss & Take Profit rules
- Save → then Backtest

### 4. Backtest
- Select your strategy
- Choose symbol, timeframe, date range
- Set capital and position size
- Click **Run Backtest**
- View full report: equity curve, monthly P&L, trade log, Sharpe, Drawdown etc.

---

## 📊 Available Indicators

| Indicator | Description |
|---|---|
| EMA | Exponential Moving Average |
| SMA | Simple Moving Average |
| RSI | Relative Strength Index |
| MACD | Moving Average Convergence Divergence |
| BB | Bollinger Bands |
| ATR | Average True Range |
| VWAP | Volume Weighted Average Price |

## 🛡️ Disclaimer

This tool is for **educational and personal research purposes only**. It is not financial advice. Past performance does not guarantee future results. Always consult a SEBI-registered advisor before investing.

---

## 📁 Project Structure

```
trading-app/
├── app/
│   ├── page.js              # Dashboard (live market data)
│   ├── charts/page.js       # Chart viewer with indicators
│   ├── strategies/page.js   # Strategy CRUD
│   ├── backtest/page.js     # Backtesting engine
│   └── api/
│       ├── quotes/          # Live price API (Yahoo + CoinGecko)
│       ├── historical/      # OHLCV data API
│       └── search/          # Symbol search API
├── components/
│   ├── Navbar.js            # Top navigation
│   ├── TradingChart.js      # lightweight-charts wrapper
│   ├── StrategyBuilder.js   # Visual strategy editor
│   ├── BacktestReport.js    # Report with charts
│   └── InfoTooltip.js       # ℹ️ Educational popup
└── lib/
    ├── indicators.js         # EMA, SMA, RSI, MACD, BB, ATR, VWAP
    ├── backtesting.js        # Full backtesting engine
    ├── strategies.js         # localStorage CRUD
    └── constants.js          # Nifty50 list, crypto list, config
```
