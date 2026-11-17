# Gaugecraft

[Open the dashboard](https://gaugecraft.sh/) · [Source repository](https://github.com/provatidis/gaugecraft)

A read-only research workspace for Aero MetaDEX03 predictive allocation and a Base liquidity pilot, available on GitHub Pages or locally. Compare pool rewards, inspect incentive expiry, model your share after dilution, and collect evidence about whether an APR persists.

The first live run on October 22, 2026 retrieved **474 allocator pools across seven networks**. These are genuine contract observations. Historical coverage begins when your collector runs; the application does not manufacture earlier history. Counts and price coverage will change.

## How to use Gaugecraft effectively

**Start in Opportunities** to decide which pools to investigate. Choose a network and enter the total allocation power you could direct. Each row models that whole amount in one pool. **Markets** is the searchable directory for finding a specific pool, checking one that did not qualify or maintaining a watchlist.

Open a pool name for **Pool analysis**, or an earnings figure for **Simulator**. Choose **Compare two pools** in Opportunities, select a first pool and then **Test split** beside a compatible second pool. Simulator opens with both selections. Adjust the percentage to see how much more or less the split earns than the higher single-pool alternative in the estimate and stress scenarios. Both use the same total power, timing and forecast period. See the [shortlist](https://gaugecraft.sh/#opportunities) and the [pool directory](https://gaugecraft.sh/#markets).

For a token deposit, open **Provide liquidity** to compare WETH/USDC or cbBTC/USDC positions on Base with holding the same tokens. Open **How to use** for a guide to both workflows. The optional Markets introduction can be dismissed; the full guide remains available on desktop and mobile. Dismissal is stored only in this browser. Each research screen also has an expandable help prompt.

Choose **System**, **Dark** or **Light** in the header’s theme selector. System follows your device’s appearance, including changes while the app is open. Your choice is stored only in this browser. Blue identifies controls and selection; green, amber and coral accompany positive changes, warnings and negative changes. Headline APRs remain neutral.

To learn the controls, select **Sample fixtures** in the header. Every figure in that mode is synthetic. Switch back to **Live observations** before researching actual pools.

### Install on your phone or desktop

Open [gaugecraft.sh](https://gaugecraft.sh/) and select **Install app** in the header. Supporting browsers offer an **Install Gaugecraft** button; otherwise the panel explains the browser’s installation menu. On iPhone or iPad, use **Share → Add to Home Screen → Add** (leave **Open as Web App** enabled if shown). The home-screen icon opens Gaugecraft in its own window. Installation prompts and timing depend on the browser. The install control is hidden when running as an installed app.

An internet connection is required to load observations. Installation adds no background collector, offline data cache, notifications or tracking. Observation requests still check the network; installing cannot fix delayed collection. Your watchlist, appearance and simulator inputs remain local to that browser or installed app, which may have separate storage on some platforms.

### A repeatable research routine

1. **Check the evidence is current.** Read **Latest retrieval** and **Data health** before comparing pools. Times are UTC. Expand Data health to inspect each network; a successful read on one network does not establish freshness elsewhere. Observations older than 75 minutes are marked stale and excluded from Opportunities. A configured schedule is not proof that collection succeeded.

2. **Browse the full directory in Markets.** Enter **Intended allocation power** to compare earnings for your total power in each pool. A blank input uses **1,000 additional reference power**. Markets defaults to **Estimated earnings** descending within separate evidence groups: history-based estimates first, then full-window baselines. **Stress-case earnings** and **Pool-wide rewards** are alternative sorts; your selection is remembered. Partial fee windows, stale observations and incomplete inputs stay visible with comparable earnings withheld. Use the evidence filter to examine one group. **Returns** shows earnings, stress, evidence and revenue composition; **All metrics** adds Stake APR, TVL, volume and six-hour changes. Filter by network and star candidates for your browser-local watchlist. Identify a pool by its network and contract address, since identical token pairs can appear in multiple pools. The **Pool rewards / 48h** column is shared revenue for the entire pool; **Earnings / 48h** models your share. If no comparable earnings are available yet, use pool-wide rewards to shortlist while genuine fee history accumulates.

3. **Inspect the source of the APR in Pool analysis.** Find pools with the searchable picker in Pool analysis or Simulator: combine terms such as `USDC Base`, paste a pool/token address or full pool ID, or filter to your watchlist. Compare eligible fee revenue, scheduled incentives and allocation power together. Read the actual fee-window duration: an eight-hour observation is not a measured 48-hour total, and different window lengths weaken direct comparisons. Check incentive expiration within your intended holding window; the estimate already stops each program at its scheduled end and assumes no renewal. An APR jump with flat revenue and falling allocation can be a denominator change rather than increased revenue. The **Forecast readiness** panel reports observation count, span, largest gap, priced fee observations and the actual source fee window. Expand its missing-periods list for UTC gap boundaries. These diagnostics always use the latest snapshot’s rolling 48 hours, independently of the chart range. Longer chart ranges reveal only the history actually collected.

4. **Size the idea in Simulator.** Enter the **total allocation power you intend to direct to this pool**, then enter any power of yours already included in its current allocation. For example, moving from 10,000 to 15,000 power means entering **15,000 Allocation power** and **10,000 Already allocated**. Enter your own capital value in USD only if you want a personal capital APR. Optional remaining days models fixed-stake decay; leaving it blank models perpetual power. Activation delay is your timing assumption and does not establish protocol eligibility. Opening an earnings or stress figure carries that starting scenario into Simulator. With immediate allocation and constant power, the amount matches Markets. **Current competition** is available as a separate assumption; additional competition and revenue shocks apply to the selected starting scenario. Intended power is shared across Markets, Opportunities and Simulator. Existing power is saved separately for each pool and source mode, and defaults to zero; older shared existing-power settings must be re-entered for the correct pool. Capital and timing fields still carry between pools, so review them when switching. Clearing intended power restores a 1,000-additional-power reference scenario and ignores saved existing allocations.

5. **Read the Opportunities ranking.** If no pool on the selected network qualifies for the history ranking, the list shows up to ten comparable full-window baselines when available. Opportunities requires positive modeled earnings and a priced current fee total. Markets includes pools with zero earnings or missing inputs. Persistence ranking requires approximately 48 hours of coverage, at least 80 priced fee observations, no gap over 75 minutes and a near-full fee window. Qualified candidates are ranked by stressed earnings for **your selected power**, including own dilution and saved existing allocation; a blank input uses **1,000 additional reference power**. Select **If allocators return** to see how the ranking changes if competing power returns to its past 48-hour median where that exceeds standard stress. Only history-qualified forecasts with a recorded median appear in this scenario. The calculation is nonlinear in size and does not multiply the reference result. Use Simulator to explore timing and decay. Markets, Opportunities and the Simulator’s **Markets estimate** and **Markets stress** cases use the same projected competing power and forecast cutoff. Timing or stake decay can change the simulated amount and are called out alongside the result.

6. **Review the reasoning, then evaluate it later.** Return to your watchlist and compare fee changes, incentive runway and incoming allocation before revising an assumption. After forecast windows mature, use **Performance** to see whether revenue was overestimated or allocation pressure underestimated. For each benchmark, Performance shows the shortlist and benchmark means over their matched 48-hour windows and explains excluded windows. Read the sample size beside each result. For saved Base WETH/USDC CL50 picks, Performance can recover a short fee window using verified opening and closing pool counters. The benchmark shows how many matches used those counters, and each affected ledger entry identifies its blocks. Expand the four-way comparison to hold the cohort constant across all strategies. These are observed-data return proxies for a standard reference allocation, not a record of your actual positions or claims. Collection gaps can leave a mature forecast unevaluable; waiting longer does not recreate missing observations.

### The 30-hold comparison

The live Performance page tracks whether choosing a pool under **Returning competition** improves earnings over choosing the default top pool. Both use 1,000 additional voting power across all networks and the same observations available at decision time. The comparison also freezes the highest eligible fees, highest estimated rewards and highest stake APR picks.

The first entry window opens November 17, 2026 at 22:00 UTC. Subsequent windows open every 48 hours, for 30 scheduled slots in total. Within each two-hour window the collector saves the first eligible decision whose frozen forecast periods clear the previous enrolled hold. Each pool’s 48 hours begin at its own frozen forecast time. A missing choice stays empty. A missed window counts toward the 30 and cannot be filled later.

Allow 45 minutes after the latest selected forecast matures for its closing observation. Performance reports matched outcomes and missing evidence for each pair. Wins, median differences and worst differences use holds where the two rules picked different pools. Same-pool selections appear separately. All earnings use Gaugecraft’s observed-data proxy, including its assumptions about fee timing and sampled competing power. The trial uses the existing collector, SQLite backup and historical fee-read budget.

### Read the estimates in context

| Display                               | What it means                                                                                                                                                       | How to use it                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Pool rewards / 48h**                | Pool-wide revenue estimate, using the observed eligible-fee level and incentives overlapping the next 48 hours. At launch the fee input may cover a shorter period. | Find pools worth inspecting, then check the source window and simulate your share.                                        |
| **Stake APR** in Markets              | Annualized revenue relative to allocation power valued at the AERO spot estimate.                                                                                   | A headline comparison using that denominator; do not treat it as your personal capital APR.                               |
| **Personal capital APR** in Simulator | Annualized scenario earnings divided by the stake value in USD you entered.                                                                                         | Compare with its underlying 48-hour USD earnings. It is an annualization, without compounding.                            |
| **Opportunities stress**              | A 50% decline in forecast fees and 50% more competing allocation, on top of the model's projected allocation. Scheduled incentives retain their modeled USD value.  | A declared stress case used for ranking, not a probability or confidence interval.                                        |
| **Simulator scenarios**               | Competing-power shocks start from the selected scenario. The revenue-down scenario halves all modeled USD revenue, including incentives.                            | Isolate dilution or lower revenue at your size. Opening a stress figure starts with the Opportunities stress assumptions. |

Markets compares immediate, constant-power allocations using `power / (projected other power + power) × forecast revenue`. Existing power is removed from the current pool total before projecting competing growth and adding the intended total once. Its stress case reduces forecast fees by 50% and increases projected other power by 50%, retaining scheduled incentive USD value. Comparable fee windows must span 47–49 hours; shorter windows are never silently annualized or extrapolated. History-based forecasts and constant-condition baselines are distinct evidence groups, not one unconditional ranking.

The simulator’s selected starting scenario holds other power constant at its chosen level; it is not a prediction that competitors will stay away. Neither ranking nor simulation includes every price move, liquidity change, gas cost or contract-accounting detail. Metric information icons and [SOURCES.md](SOURCES.md) explain the formulas and approximations.

### Worked example: pool rewards versus your earnings

**Illustrative arithmetic only: these invented figures do not describe a live pool.** Assume a pool has 1,000,000 existing allocation power, none of it yours, and $5,000 of modeled revenue paid uniformly over the next 48 hours. You add 10,000 power, with no activation delay or decay.

```text
Your post-allocation share = 10,000 / (1,000,000 + 10,000) ≈ 0.9901%
Your baseline earnings    = that share × $5,000 ≈ $49.50 over 48 hours
```

| Assumption                                                 | Estimated earnings / 48h |
| ---------------------------------------------------------- | -----------------------: |
| No new competing allocation                                |                   $49.50 |
| 25% more competing allocation                              |                   $39.68 |
| 50% more competing allocation                              |                   $33.11 |
| 100% more competing allocation                             |                   $24.88 |
| 50% less total USD revenue, unchanged competing allocation |                   $24.75 |

This is why the largest pool reward total or highest headline APR may not produce the largest earnings for your allocation. Actual incentive timing, stake decay and activation delay require the time-dependent calculation used by the app.

### Common states and mistakes

| What you see                 | Interpretation and next step                                                                                                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Insufficient history**     | The persistence model has not met its data gate. Inspect baseline scenarios and collect more complete observations; do not read the absence of a ranking as a negative pool score.                                                                                           |
| **—**                        | A required input, price or comparison is unavailable. Check pool warnings and methodology; do not substitute zero.                                                                                                                                                           |
| **Stale observations**       | Current comparison evidence is too old. Open Data health to inspect the affected network and its last collection run. Refresh checks for a newer observation. For the public Railway service, check [data health](https://gaugecraft-production.up.railway.app/health/data). |
| **No evaluated returns yet** | The 48-hour horizon has not closed, or the required observations are incomplete. Performance cannot assess forecast accuracy from pending predictions.                                                                                                                       |

Do not sum eligible-fee or volume values across CSV rows: their trailing windows overlap. Export observations to preserve timestamps and source-window boundaries for your own analysis. Hosted charts and CSV contain up to 30 days; full retained history is in the collector database. Watchlists and simulator inputs stay in this browser; the app does not track your actual stake positions or execute reallocations.

## Run locally

Requires **Node.js 24 or newer** (for built-in SQLite). No account, wallet, API key or paid service is required.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://127.0.0.1:4317**. `npm install` and `npm run dev` also work. The server binds to loopback only, collects immediately, and then collects at UTC half-hour boundaries while running. The first collection can take several minutes. Existing observations appear immediately.

For this Mac, `Start Gaugecraft.command` also launches the app using an installed Node or Codex's bundled Node runtime. Dependencies must already be installed. Keep the terminal running; Ctrl+C stops it. Computer sleep and closed terminals create collection gaps, which the analysis exposes.

For the production build:

```sh
pnpm build
pnpm start
```

## Persistent hosting and storage migration

The public frontend runs on GitHub Pages and reads observations from the Railway collector. The collector stores SQLite on a persistent volume and backs it up to private R2 object storage. Storage v4 uses lossless per-record dictionaries and preserves frozen forecast inputs, raw observations and historical timestamps. Existing v3 databases can open directly. For v2, migrate into a separate file before starting a writer. Operational commands, recovery and storage measurements are in the [deployment guide](DEPLOYMENT.md).

## GitHub Pages

The Pages workflow builds the frontend on pushes to `main` and on manual dispatch. With `COLLECTOR_HOSTING=railway`, it uses `VITE_API_ORIGIN` and skips scheduled builds and collection. Check the public [collector data health](https://gaugecraft-production.up.railway.app/health/data) and [storage and backup health](https://gaugecraft-production.up.railway.app/health/storage) for current status.

In standalone static mode, the same workflow runs collection at the configured GitHub schedules, restores the newest complete SQLite backup from the collector-state release, freezes forecasts, backs up the new state and exports the dashboard. Its first deployment uses the genuine launch observations in `config/launch-history.sqlite.gz`. GitHub scheduling delays can affect the age of a static export. The separate GitHub-to-R2 backup workflow applies when GitHub is the authoritative collector. See the [static collector backup instructions](DEPLOYMENT.md#r2-backups-while-the-collector-remains-on-github).

In both hosting modes, personal inputs and watchlists stay in the browser. Charts and HTTP CSV cover up to 30 days. The collector retains the full observation and forecast history.

To build the same static export locally, after collecting data:

```sh
VITE_DATA_MODE=static pnpm build
pnpm export:pages
python3 -m http.server 4318 --directory dist --bind 127.0.0.1
```

Relative asset URLs support the repository subpath and an inherited user-site domain. `pnpm build` without `VITE_DATA_MODE` still builds the local server version. Public hosting has GitHub's ordinary access logging; Gaugecraft adds no telemetry.

## Data and configuration

Copy `.env.example` to `.env` if you want overrides. Package scripts load it with Node's built-in environment-file support. Data lives at `data/gaugecraft.sqlite`, including WAL files while running, and is ignored by Git. Back up the SQLite database with SQLite's backup API, or stop the app before copying it.

| Setting           | Default / purpose                                                              |
| ----------------- | ------------------------------------------------------------------------------ |
| `CHAINS`          | All supported networks: `8453,10,42161,1,57073,4663,5042`                      |
| `RPC_<chainId>`   | Override the corresponding public RPC; for example `RPC_8453`                  |
| `RPC_INTERVAL_MS` | `200`, minimum interval between RPC requests; retries have exponential backoff |
| `GAUGECRAFT_DB`   | `data/gaugecraft.sqlite`, relative to the repository working directory         |
| `PORT`            | `4317`, bound to `127.0.0.1`                                                   |
| `COLLECT`         | `0` disables the web server's collector; default enabled                       |
| `SAVE_FORECASTS`  | `0` disables new forecast records; default enabled                             |

Use `CHAINS=8453` for a smaller Base-only collection. Public RPCs can rate-limit, fail or change policy. You can supply your own legitimate RPC endpoint without changing source code. Provider URLs are not returned to the browser; do not commit `.env`.

### Collector and CSV

```sh
pnpm collect                   # One collection, useful for an external scheduler
pnpm collector                 # Continuous collector without the web UI
pnpm --silent export > observations.csv # Live observations only
pnpm --silent export --demo > demo.csv   # Explicit synthetic namespace
```

The dashboard also exports CSV. UTC source/retrieval times and actual fee-window boundaries are included. Fields that spreadsheet software could interpret as formulas are neutralized.

Only one collector can own a database at a time. A renewable lease prevents overlapping UI/CLI runs and recovers after interruption. Each `(source mode, chain-aware pool ID, 30-minute UTC source-time bucket)` is stored once; retries preserve the first observation and its frozen forecast. A failed network does not erase its last successful data. Read collector status in the dashboard for errors and coverage.

For an OS scheduler, run `pnpm collect` in this repository every 30 minutes, with an absolute Node/pnpm path if the scheduler has a different PATH. Do not also keep a separate watcher running unless you intentionally want the lease to skip duplicate jobs. No system service or recurring Codex automation is installed by this project.

### Explicit demo

```sh
pnpm demo
COLLECT=0 pnpm dev
```

Select **Sample fixtures** in the header to explore five invented pools with seven days of deterministic synthetic observations in a separate namespace. The banner stays visible throughout charts, simulations and performance. Seeding is idempotent. Each fixture’s chart ranges and dashboard CSV window end at its last recorded observation, and preserve the original UTC timestamps. Live chart ranges and the live dashboard CSV follow the current time.

## Research limits

- The official launch article is dated **October 21, 2026**. Current documentation and live reads specify a **47-hour allocation cooldown**; our forecasting horizon is 48 hours. Cooldown is per stake and network, and this app cannot establish a particular stake's transaction eligibility without stake information.
- Market Stake APR is reconstructed using Aero's display formula and our prices. It is not an official API quote, LP APR, or personal capital APR. Pool reward power multiplied by AERO price is not your invested principal.
- Eligible historical fees use current staked liquidity as an approximation. Several launch observations contain only 7–11 hours of activity. They are shown with their actual windows and are not scaled into fictitious 48-hour observations. The launch baseline uses that partial fee level, so it is not a fully measured 48-hour revenue forecast.
- USD prices are local spot estimates anchored to the configured USDC address (USDG on Robinhood) at $1. There is no independent oracle or depeg protection. Unknown or conflicting prices block totals. This intentionally leaves many pools partially unpriced.
- No persistence ranking appears until roughly 48 hours of sufficiently continuous, priced history exists. Descriptive signals do not imply calibrated confidence or causal allocator behavior.
- Evaluation approximates the realized revenue window from observed snapshots. It does not reconstruct every fee/checkpoint event, simulate exact integer contract accounting, or measure claims from an actual sAERO position.

[SOURCES.md](SOURCES.md) records sources, addresses, reliability, formulas, pricing rules, model assumptions and validation evidence. [PLAN.md](PLAN.md) records the review of the original brief.

## Development

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm format:check
```

Financial tests cover incentive units/expiry, own dilution, existing allocation, decay, delay, zero/missing inputs, forecast cutoff, incomplete windows and error denominators. Integration tests cover atomic ingestion, idempotence, failure recovery, lease ownership, chain/mode isolation, CSV safety, lossless storage migration, corrupt backup rejection, object-storage round trips and read-only HTTP behavior. They run offline with explicit fixtures; normal tests never claim to be a live-chain validation.

| Directory             | Responsibility                                                                 |
| --------------------- | ------------------------------------------------------------------------------ |
| `config/`             | Verified app-used deployment addresses, read ABI and source provenance         |
| `server/sources/`     | Public RPC reads, pinned-block collection and transparent spot prices          |
| `server/store.ts`     | SQLite observations, immutable forecasts, saved benchmark decisions and leases |
| `server/collector.ts` | Network orchestration, recovery and half-hour schedule                         |
| `src/analysis/`       | Pure reward, scenario, persistence and evaluation calculations                 |
| `src/client/`         | React interface; personal inputs stay in the browser                           |
| `tests/`              | Offline financial and ingestion checks                                         |

React/Vite provides a small local UI, viem handles EVM ABI reads, Recharts renders time series, and Node's built-in SQLite avoids a native database dependency or external service. There is no wallet library, signing path, transaction endpoint, telemetry, external font or price-tracking account.

MIT licensed. Gaugecraft is independent research software and is not affiliated with Aero.

### Research on a phone and shareable links

On phones, **Returns** presents pool cards with tappable earnings, stress amounts and metric explanations. **All metrics** keeps the detailed comparison table available. Secondary controls live under **View options**, and network, evidence and watchlist filters expand under **Filters**.

Search accepts combined terms such as `USDC Base` in both Markets and the pool picker. Section, pool, scenario and Markets filters/page are included in the URL. Browser Back and section navigation preserve your shortlist and scroll position. Shared links never contain your allocation size, existing power, capital or timing inputs; those remain on the device.

Observation age advances even when a refresh fails, and the app retries when the connection returns or the tab becomes visible. The 75-minute freshness threshold is unchanged. Performance labels its displayed sample separately from the full archive and explains which missing selections or observations prevent matched benchmark comparisons.
