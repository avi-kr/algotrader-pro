# Architecture

AlgoTrader Pro is organized as departments of a trading firm, both in how the
code is structured and in how it's built (see `CLAUDE.md` and
`.claude/agents/`). This document covers the runtime architecture: what each
department owns, how data flows between them, and what's real today versus
what's scaffolded and needs the user's own broker credentials to finish.

## Department diagram

```
                     ┌────────────────────┐
                     │   Market Data       │  Alpaca (US equities)
                     │  (engine/src/       │  Binance (crypto)
                     │   market-data)      │  normalizes to Candle
                     └─────────┬───────────┘
                               │ Candle[]
                               ▼
                     ┌────────────────────┐
                     │  Strategy Kernel    │  packages/strategy-kernel
                     │  (indicators +      │  — the ONLY place signals
                     │   condition engine) │  are generated. Same code
                     └─────────┬───────────┘  path for backtest/paper/live.
                               │ Signal
                               ▼
                     ┌────────────────────┐
                     │   Risk Engine       │  engine/src/risk
                     │  (position size,    │  kill switch defaults ON,
                     │   daily loss,       │  every order checked here
                     │   exposure, kill    │  BEFORE the broker sees it
                     │   switch)           │
                     └─────────┬───────────┘
                       reject  │  pass
                        ┌──────┴──────┐
                        ▼             ▼
                 ┌───────────┐  ┌─────────────────────┐
                 │Audit Log  │  │  Execution / OMS     │  engine/src/execution
                 │(append-   │◄─┤  (order-manager.ts)  │  idempotent on
                 │ only)     │  │  -> BrokerAdapter     │  clientOrderId
                 └───────────┘  └──────────┬───────────┘
                                            │ fills
                                            ▼
                                 ┌─────────────────────┐
                                 │  Portfolio Ledger    │  engine/src/portfolio
                                 │  (positions, source  │  reconciled against
                                 │   of truth in DB)    │  the broker, not
                                 └─────────────────────┘  trusting it blindly
```

`packages/shared-types` defines the contracts (`Candle`, `StrategyConfig`,
`Order`, `Fill`, `Position`, `AuditEvent`, `BrokerAdapter`,
`MarketDataAdapter`) every department depends on instead of depending on each
other directly or on a specific broker SDK.

## What's real right now

- **Backtesting** — genuinely fixed. `packages/strategy-kernel` computes
  signals using only data through a bar's close and fills at the *next* bar's
  open (see the docstring on `runBacktest` in
  `packages/strategy-kernel/src/backtest.ts`), which the old
  `lib/backtesting.js` did not do — it filled entries/exits on the same bar
  that generated the signal. Every indicator and the fill-timing fix have
  Vitest known-answer and no-look-ahead regression tests.
- **Persistence** — strategies, backtest runs, orders, fills, positions, and
  the audit log live in Postgres (`packages/db`, Prisma), not `localStorage`.
  `docker-compose.yml` runs Postgres locally.
- **Risk engine** — pure, fully unit-tested logic (`engine/src/risk`): kill
  switch, max position size, max daily loss, max per-symbol exposure. It's
  wired into `OrderManager.placeOrder` so an order can't reach a broker
  without passing every check.
- **Broker/market-data adapter code** — written against Alpaca's, Binance's,
  and Dhan's real documented APIs (`engine/src/broker-adapters`,
  `engine/src/market-data`), unit-tested against mocked HTTP.
- **Dhan (NSE equities — `in_equity` asset class)** — see the dedicated
  section below.
- **Historical market data** — Yahoo Finance for US/Indian equities,
  Coinbase Exchange for crypto (`app/api/historical/route.js`; switched
  from Binance, which returns HTTP 451 for requests originating from the
  US — Vercel's build region here). `/api/candles/import` +
  `/data-import` let real owned data (e.g. broker-exported 1-minute NSE
  candles) be cached in Postgres and served ahead of any live fetch,
  since Yahoo's free API caps 1-minute data at 7 days of lookback.
- **Strategy-kernel indicator library** (`packages/strategy-kernel/src`)
  — every indicator type a `StrategyConfig` can reference, all wired
  through the same causal `calculateIndicators`/`checkCondition` path so
  the no-look-ahead guarantee applies uniformly:
  - Classic: EMA, SMA, RSI, MACD, Bollinger Bands, ATR, VWAP, Hull Moving
    Average (`HULL_MA`), rolling High/Low breakout (`DONCHIAN` — fixed
    lookback or an expanding all-time window when `period` is omitted),
    Supertrend, Keltner Channel, Stochastic Oscillator, Parabolic SAR, CCI,
    an Ichimoku Tenkan/Kijun cross, ADX/+DI/-DI, Williams %R, On-Balance
    Volume (with its own moving average), and the Money Flow Index
    (`moreIndicators.ts` — the full 5-line Ichimoku cloud is deliberately
    out of scope, just the TK cross signal retail systems actually
    automate).
  - `Condition` gained `crosses_above_value`/`crosses_below_value` (a
    threshold-crossing EVENT, distinct from `above_value`/`below_value`'s
    continuous STATE check) after building the Williams %R, MFI, and CCI
    breakout strategies exposed exactly this gap: since entry conditions
    only evaluate while flat, an `above_value` "oversold reversal" entry
    fires on the first flat bar the series simply *happens* to already be
    past the threshold, not on a genuine crossing — silently turning a
    reversal strategy into an always-enter-unless-extended one.
  - Market Structure (`MARKET_STRUCTURE`, `smc.ts`) — deterministic,
    close-price swing highs/lows (confirmed N bars after forming, never
    exposed before their own confirmation bar), HH/LH/HL/LL
    classification, Break of Structure (continuation) and Change of
    Character (first reversal, flips bias).
  - Built on Market Structure: `LIQUIDITY_SWEEP` (wick-based, deliberately
    distinct from BOS/CHOCH), `FVG`, `ORDER_BLOCK` (Mitigation/Breaker are
    states on the same block, not separate detectors), `IMBALANCE`,
    `LIQUIDITY_VOID`, `PREMIUM_DISCOUNT`, `BREAKOUT_RETEST`, `ORB`,
    `SR_PRICE_ACTION`.
  - Every one of these has hand-traced Vitest coverage (60 tests total in
    the kernel) — several catch the exact class of bug a chart bug did:
    values leaking before their true confirmation bar. The Supertrend
    initial-trend seed is a case in point: an early version guessed the
    starting trend by comparing price to its own basicLower band, which is
    constructed to sit below price by design — so the guess was "bullish"
    almost regardless of actual direction, producing a spurious flip one
    bar after warmup in genuine downtrends. Fixed by seeding off real
    price movement (current close vs. close one ATR-period back) instead.
  - `TradingChart.js` draws Market Structure's HH/LH/HL/LL, BOS/CHoCH, and
    active support/resistance levels directly on the candles; the newer
    SMC concepts (FVG zones, Order Block zones, etc.) compute correctly
    but don't have chart-visual rendering yet — backtest-only for now.
  - Sharpe/Sortino annualize by the strategy's actual trades-per-year,
    not a fixed daily-return constant — comparing a 1D strategy against
    a 1H one no longer silently favors whichever trades less often.

## Dhan (NSE equity paper/live trading)

Dhan is the broker for the `in_equity` asset class — Indian equities, keyed
by numeric `securityId` rather than by symbol. Researched against DhanHQ API
v2's own docs before writing any code; nothing here is a guess.

- **`engine/src/market-data/dhan-instruments.ts`** — Dhan has no
  symbol-string API. This module fetches and caches Dhan's published
  instrument-master CSV in memory, filters it to NSE cash equity, and maps
  this codebase's existing Yahoo-style tickers (`RELIANCE.NS`, as used
  throughout `lib/constants.js`) onto `(securityId, exchangeSegment)`. It
  throws rather than guessing when a symbol isn't found — a wrong
  `securityId` is a real-money mistake, not a display bug.
- **`engine/src/broker-adapters/dhan.ts`** (`DhanBrokerAdapter`) — orders,
  cancellation, status, positions, and account equity against Dhan's REST
  API. Two things make it meaningfully different from `AlpacaBrokerAdapter`:
  - Dhan's `correlationId` is a user-defined *lookup tag*, not a
    server-enforced idempotency key the way Alpaca's `client_order_id` is —
    submitting the same one twice creates two separate orders. The adapter
    closes this gap itself: before submitting, it checks
    `GET /orders/external/{correlationId}` and returns the existing order if
    one is already there, so a caller retrying after a network failure can't
    double-submit (platform-engineer.md rule #3).
  - Order placement/modification/cancellation require a **static IP**
    whitelisted on the Dhan account (a SEBI requirement) — register the box
    running `engine/` at web.dhan.co or via `POST /v2/ip/setIP` before going
    live. A non-whitelisted IP fails with Dhan error `DH-905`; this adapter
    doesn't special-case it, it just surfaces as an ordinary thrown error.
    Fetching orders/trades/positions does not need this.
- **`engine/src/market-data/dhan.ts`** (`DhanMarketDataAdapter`) —
  - `getHistoricalCandles`: `/charts/historical` for daily/weekly (weekly is
    real ISO-calendar-week aggregation of daily bars, not a fixed 7-count
    grouping, since NSE trading weeks have holidays), `/charts/intraday`
    (1/5/15/60-min) paginated in 89-day windows since Dhan caps a single
    request at 90 days. `4h` has no native Dhan interval and is built by
    aggregating four real 60-minute candles (true high/low/summed volume,
    the same non-synthetic aggregation already used for crypto in
    `app/api/historical/route.js`).
  - `subscribeLive`: Dhan's WebSocket streams individual ticks (LTP +
    cumulative day volume), not pre-formed candles the way Binance's kline
    stream does — this adapter aggregates ticks into 1-minute candles itself,
    only ever emitting one once its minute has fully elapsed. `parseDhanFeedPacket`
    is a standalone, unit-tested parser for the documented little-endian
    binary packet layout (Ticker/code 2, Quote/code 4 — Full/depth and
    OI/PrevClose packets are intentionally not parsed, since price is all
    candle aggregation needs). Structurally complete against the documented
    spec but — like `BinanceMarketDataAdapter`'s WS code — not yet exercised
    against Dhan's real feed; that needs the user's own access token.
- **Auth**: an access token is valid 24h. This app deliberately does **not**
  automate minting a brand-new one — that requires either an interactive
  browser login or the account's trading PIN + TOTP, a bigger secret than
  this app should ever hold. Instead, `DHAN_ACCESS_TOKEN` is a token you
  generate once via web.dhan.co, and `DhanBrokerAdapter.renewToken()` (GET
  `/v2/RenewToken`) extends an *already-active* token — call it periodically
  from a long-running engine process. A restart after >24h down needs a
  freshly generated token. It goes in the **repo-root `.env`** alongside
  `DATABASE_URL` etc. — not a separate `engine/.env` — since a standalone
  Node script has no built-in `.env` loading the way `next dev`/`next build`
  do; `engine/scripts/backfill-dhan-history.ts` loads the root `.env`
  explicitly (resolved relative to the script's own file, so it works
  regardless of the invoking shell's working directory). A future `engine/`
  `main()` loop should follow the same pattern rather than inventing a
  second env file.
- **Paper trading**: Dhan's own Sandbox exists but fills every order at a
  flat price of 100 with no live quotes — unusable for a realistic paper
  track record. `createBrokerAdapter` routes `in_equity` paper mode through
  the same `SimulatedPaperAdapter` crypto already uses, fed by
  `DhanMarketDataAdapter`'s real prices; only live mode talks to the real
  `DhanBrokerAdapter`, gated behind `LIVE_TRADING_ENABLED` exactly like
  Alpaca (CLAUDE.md non-negotiable #1).
- **3-year historical backfill — two ways in**:
  - **`app/api/dhan/backfill/route.js`** — the one actually meant to be used:
    a Vercel API route (imports `DhanMarketDataAdapter` from
    `@algotrader/engine` directly), triggered from a browser-console script
    the same way every strategy in this app was created. Vercel has normal
    internet egress and already holds the deployment's real production
    `DATABASE_URL` — a local machine or sandboxed dev container may have
    neither (network policy blocking `*.dhan.co`, or a `.env` still pointed
    at a local dev database nobody else can see). One call = one Dhan
    request's worth of data (the full range for daily/weekly, a single
    caller-chunked ≤90-day window for intraday); the browser script chunks
    a 3-year intraday backfill into windows itself and calls this once per
    window per symbol, logging progress, safe to re-run (`skipDuplicates`).
  - **`engine/scripts/backfill-dhan-history.ts`** — a standalone script for
    when `engine/` itself is running somewhere with real network access and
    a real `DATABASE_URL` (e.g. once it has an actual deployed host and
    `main()` loop) — not useful before then.
  - Both write into the same `Candle` table `/api/candles/import`'s CSV
    upload uses, so `/api/historical` serves the result ahead of any live
    fetch regardless of which path filled it.

## What's scaffolded but NOT verified end-to-end

Nothing in this session could call a real broker or exchange — that needs the
user's own API keys. Specifically still open:

1. **Alpaca paper/live trading** — `AlpacaBrokerAdapter` and
   `AlpacaMarketDataAdapter` are written against Alpaca's documented REST/WS
   APIs and unit-tested with a mocked `fetch`, but have never made a real
   request. Set `ALPACA_API_KEY_ID`/`ALPACA_API_SECRET_KEY` (paper keys first)
   in `.env` and exercise them against `https://paper-api.alpaca.markets`
   before trusting them.
2. **Crypto paper trading** — `SimulatedPaperAdapter` fills against whatever
   price `getLastPrice` returns; wiring that to `BinanceMarketDataAdapter`'s
   live stream so paper crypto trades use real-time prices is not done.
3. **Dhan paper/live trading** — `DhanBrokerAdapter`, `DhanMarketDataAdapter`,
   and the instrument-master lookup are written against Dhan's documented
   API v2 and unit-tested with a mocked `fetch`, but have never made a real
   request or opened a real WebSocket connection. Needs, in order: (1) a
   `DHAN_ACCESS_TOKEN` generated via web.dhan.co, (2) the engine's outbound
   IP registered as static and whitelisted on the Dhan account before any
   live order (paper mode doesn't need this — it never calls Dhan's order
   API at all), (3) one `getHistoricalCandles` call against a real symbol to
   confirm the instrument-master CSV parse and chart-endpoint pagination
   actually match production data, (4) one real WebSocket connection to
   confirm the binary packet layout this adapter assumes from the docs is
   what Dhan's feed actually sends.
4. **The always-on trading loop** — `engine/src/index.ts` exports the
   building blocks (market data → strategy kernel → risk → OMS → portfolio)
   but does not start a `main()` loop. Shipping an unverified always-on loop
   against a real account would violate the QA rule that untested code isn't
   done.
5. **Live trading** — gated behind `LIVE_TRADING_ENABLED` (defaults to
   `false` everywhere, see `.env.example`) and, per `CLAUDE.md`, a documented
   paper-trading track record plus human sign-off. Not reachable by any
   current code path.
6. **DB-level audit immutability** — `AuditEvent` is append-only by
   *application* convention (`AuditLog` only exposes `record`). Enforcing it
   at the database level means creating a restricted Postgres role for the
   app that has `INSERT` but not `UPDATE`/`DELETE` on `audit_events`, and
   isn't set up yet.

## Phased rollout

1. ~~Org scaffolding + genuine, tested backtester~~ — this pass.
2. Wire `AlpacaBrokerAdapter`/`AlpacaMarketDataAdapter` against real paper
   keys; get one strategy running the full signal → risk → order → fill →
   audit loop against Alpaca's paper account.
3. Wire crypto paper trading (`BinanceMarketDataAdapter` → `SimulatedPaperAdapter`).
4. Run paper trading for a meaningful, unbroken period on a fixed strategy
   version; the `release-auditor` agent's job is to confirm this track record
   exists before recommending live.
5. Risk Officer + Security Auditor sign-off on live limits and credential
   handling; a human sets `LIVE_TRADING_ENABLED=true` in the live
   deployment's own config.
6. Live trading, same code path, tighter limits than paper until a live track
   record justifies raising them.

## Deployment shape

- The Next.js app (`app/`, `components/`, `lib/`) stays at the repo root and
  keeps deploying to Vercel unchanged — it's a thin client over Postgres and
  the backtest API route.
- `engine/` is a long-running Node process and is **not** deployable to
  Vercel: it needs to hold broker/market-data WebSocket connections and run a
  continuous loop, which serverless functions can't do. It needs a
  conventional host (a VM, Fly.io, Railway, etc.) — not set up in this pass.
