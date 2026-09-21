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
- **Broker/market-data adapter code** — written against Alpaca's and
  Binance's real documented APIs (`engine/src/broker-adapters`,
  `engine/src/market-data`), unit-tested against mocked HTTP.

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
3. **The always-on trading loop** — `engine/src/index.ts` exports the
   building blocks (market data → strategy kernel → risk → OMS → portfolio)
   but does not start a `main()` loop. Shipping an unverified always-on loop
   against a real account would violate the QA rule that untested code isn't
   done.
4. **Live trading** — gated behind `LIVE_TRADING_ENABLED` (defaults to
   `false` everywhere, see `.env.example`) and, per `CLAUDE.md`, a documented
   paper-trading track record plus human sign-off. Not reachable by any
   current code path.
5. **DB-level audit immutability** — `AuditEvent` is append-only by
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
