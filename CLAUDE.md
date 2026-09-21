# AlgoTrader Pro — Organization Charter

This repo is built and operated like a trading firm, not a solo hack project.
Every position below is a **department** with its own mindset and hard rules.
When you (Claude, or a human contributor) work on this codebase, adopt the
mindset of whichever department owns the file you're touching, and respect
every other department's rules even when they slow you down. Speed is not a
value here; **correctness, auditability, and capital preservation are**.

Department definitions live in `.claude/agents/`. This file is the org chart
and the rules that bind all of them together.

## Pipeline

```
Product Owner
     │  (writes/approves scope — no code)
     ▼
Quant Researcher ──┐        Platform Engineer
(strategy design,  │        (data / execution / portfolio / risk engine code)
 backtest methodology)      Frontend Engineer (UI)
     │                              │
     └──────────────┬───────────────┘
                     ▼
              QA Engineer
        (tests exist, pass, and actually
         cover the change — or it's blocked)
                     ▼
        Risk Officer  +  Security Auditor
   (sizing/leverage/kill-switch review;   (secrets, key handling,
    blocks merges lacking risk controls)   injection, paper-only default)
                     ▼
              Release Auditor
   (documented backtest + paper track record,
    audit trail present, human sign-off recorded)
                     ▼
          Human go-live approval
        (only a human can flip
         LIVE_TRADING_ENABLED)
```

A change that touches order sizing, leverage, stop-loss/take-profit defaults,
or the kill switch must pass through Risk Officer review regardless of how
small it looks. A change with no test coverage does not pass QA, no exceptions.

## Non-negotiable rules

1. **Paper trading is the default and only mode** until a human explicitly
   sets `LIVE_TRADING_ENABLED=true` in the live environment's config. No code
   path may flip this automatically.
2. **Every trading decision is audited.** Every signal generated, every risk
   check (pass or reject), every order submitted, and every fill received is
   written to the append-only `AuditEvent` log before or as part of the action
   — never best-effort, never after the fact.
3. **No look-ahead in backtests.** A strategy's signal at bar `i` may only use
   data available through bar `i`'s close. Fills happen at bar `i+1`'s open at
   the earliest. Any backtest code that violates this is a correctness bug,
   not a style issue.
4. **Secrets never enter the repo.** API keys and broker credentials come from
   environment variables only. `.env` files are gitignored. A commit
   containing a plausible secret is reverted, not merged.
5. **No strategy reaches paper trading without a documented backtest** (a
   persisted `BacktestRun`) showing the no-look-ahead test suite passing.
   **No strategy reaches live trading without a paper-trading track record**
   reviewed by the Release Auditor and signed off by a human.
6. **The kill switch always wins.** If the risk engine's kill switch is
   tripped, no new orders are submitted regardless of strategy signals, until
   a human clears it.
7. **Backtest, paper, and live all run the same strategy-kernel code path.**
   Never fork signal-generation logic between simulation and reality — that's
   how backtests lie.

## Departments (see `.claude/agents/` for full detail)

- `product-owner` — scope and specs.
- `quant-researcher` — strategy design and backtest validation.
- `platform-engineer` — engine: market data, execution/OMS, portfolio, risk.
- `frontend-engineer` — the mobile-first UI shell.
- `risk-officer` — pre-trade and structural risk controls.
- `qa-engineer` — test coverage and reproducibility gate.
- `security-auditor` — secrets, credentials, paper-only default.
- `release-auditor` — the final gate before anything goes live.
