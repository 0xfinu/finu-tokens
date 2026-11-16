> Staged for the finu-tokens repo (flattened layout): `config/` → `chains.js`, `deployments/addresses.json` → `addresses.json`, `artifacts/` → repo root, `metadata/0xmuse-1.json` → `0xmuse-1.json`. See README.md.
>
> Status note (Nov 17, 2026): STEST is DEPLOYED and both pools are LIVE; the 10% test-remove PASSED on both chains Nov 16, 2026; the sniper run launched Nov 16, 2026. See README.md for current status. The plan below is the original record.

# LP Run Plan — token + liquidity pool, Arc + Robinhood testnets

**Testnet only. Burner wallet only. Every step needs the user's explicit
go-ahead before it runs. Nothing here has run live yet — all steps below
are dry-run-verified only.**

## Wallet rule

- **Burner EVM only:** `0xBb87bD789Ca67562F531685e10EB78eC03dE3dEB`.
- **NOT Privy — archived, never use.** Privy agent wallet (ETH
  `0x3c0BC553136fD79aE12A6401a18f0B892a0C4AdD`, SOL
  `GEkC94UGzMDYJqLMzurmBmqt5A5TnNjKEtWWcMLLKTcE`): no transactions, no
  signing, no funding, ever, for this build.
- **NOT the Circle agent wallet** (`0xf1bfee7392a18cd9927b84e26560819c4676ae27`) —
  Arc-USDC-claims-only.

## Gas math first (standing rule: estimate before sending)

All figures measured dry-run 2026-11-15 via `scripts/gas.js`
(read-only `eth_estimateGas`, shown before any send). Costs in test
tokens only. Gas prices observed that day: Arc 20.0–23.78 gwei
(varies), Robinhood 0.01 gwei (stable across checks).

### Per-transaction estimates

| Step | Arc testnet (gas / cost) | Robinhood testnet (gas / cost) |
|---|---|---|
| Deploy STEST | 686,037 @ 20 gwei = **0.01372 USDC** | 747,308 @ 0.01 gwei = **0.00000747 ETH** |
| Deploy V2 factory | — (live factory used) | 2,601,550 = **0.00002602 ETH** |
| Deploy V2 router | — | 4,117,561 = **0.00004118 ETH** |
| createPair | 1,581,718 @ 23.78 gwei = **0.03761 USDC** | — (pair created inside addLiquidityETH) |
| approve STEST → router | 22,976 gas¹ | 28,200 gas¹ |
| approve USDC → router | 56,241 @ 23.78 gwei = **0.00134 USDC** (real) | — |
| addLiquidity / addLiquidityETH | estimate unavailable pre-deployment² | 33,116 gas¹ (lower bound) |
| V3 createPool (Synthra, alt) | — | 4,657,328 = **0.00004657 ETH** (real) |
| V2 swap, one leg (planning) | **200,000 gas**³ | **200,000 gas**³ = **0.000002 ETH** |

¹ Lower bound: the token/router did not exist yet when estimated, so
`eth_estimateGas` priced a call to an empty address. Real ERC-20
approve ≈ 46k gas; real V2 addLiquidity ≈ 200–250k gas. The scripts
re-estimate live before sending, so the live run uses real numbers.
² Arc `addLiquidity` estimate reverted `TRANSFER_FROM_FAILED` in
dry-run — correct behaviour: the token is not deployed and nothing is
approved yet. It estimates fine live, after steps 1–3 mine.
³ A live swap estimate needs a router approval first, so no exact swap
figure could be measured pre-deployment. 200,000 gas is the
conservative planning figure (canonical V2 swaps: ~130k–200k gas).
**Measure the real figure on the first live swap on our own pair,
before the 1,000-tx-per-chain run, and re-run the budget below with it.**

### Setup totals (gas only, before the loop)

- **Arc:** deploy 0.01372 + createPair 0.03761 + 2× approve ≈ 0.0027 +
  addLiquidity ≈ 0.006 (250k gas @ 24 gwei) ≈ **0.06 test USDC**.
  Plus liquidity value: 10 test USDC. **Setup ≈ 10.06 test USDC.**
- **Robinhood:** deploy 0.00000747 + factory 0.00002602 + router
  0.00004118 + approve ≈ 0.0000005 + addLiquidityETH ≈ 0.0000025 ≈
  **0.000078 test ETH gas**. Plus liquidity value: 0.001 test ETH.
  **Setup ≈ 0.00108 test ETH.**

### 1,000-transactions-per-chain loop — gas budget vs burner balances

**Corrected target (user, 2026-11-15): 1,000 txs PER CHAIN — Arc 1,000
+ Robinhood 1,000 = 2,000 total.** (Earlier figures of 10,000 and of
500/500 were both wrong.) Loop structure per chain: ~333 rounds of
**buy + approve + sell** (3 txs per round ≈ 999 txs), i.e. per chain
≈ 666 swap legs + 333 approves.

Working numbers (user, final) vs this kit's dry-run estimates:

| Chain (1,000 txs) | User working number | Dry-run math | Check |
|---|---|---|---|
| Arc testnet | **≈ 6 test USDC** | 666 swap legs × 200k gas @ 20 gwei ≈ 2.66 USDC + 333 approves × ~50k gas ≈ 0.33 USDC ≈ **3.0 USDC** | ⚠️ User number is **~2× this kit's math** — equals my math at 40 gwei, or with a 400k gas/swap assumption. Conservative buffer, not a conflict: both fit easily. No material difference to the verdict; use 6 USDC as the planning number. |
| Robinhood testnet | **≈ 0.003 test ETH** | 666 swap legs × 200k gas @ 0.01 gwei = 0.00133 ETH + 333 approves ≈ 0.00017 ETH ≈ **0.0015 ETH** | ⚠️ User number is **~2× this kit's math** — same 2× conservative buffer. Both fit easily; use 0.003 ETH as the planning number. |

Totals including setup (liquidity value + setup gas), using the user's
(conservative) working numbers:

| Chain | Loop gas (working) | Setup | Total needed | Burner balance | Verdict |
|---|---|---|---|---|---|
| Arc testnet | ≈ 6.0 USDC | 10.06 USDC | **≈ 16.1 USDC** | **120 USDC** | ✅ FITS easily (~104 spare) |
| Robinhood testnet | ≈ 0.003 ETH | 0.00108 ETH | **≈ 0.0041 ETH** | **0.01 ETH** | ✅ FITS easily (~0.0059 spare) |

**Robinhood faucet refill: NOT needed** on either chain. The earlier
refill blocker (from the 10,000 figure) is removed. Scaling note only:
a 10,000-leg loop would need ≈ 0.021 ETH on Robinhood and would NOT
fit — revisit only if the target ever grows back to 10k.

**User-set gas quotas (hard caps — these replace the planning budgets above):** Arc testnet **6.66666 test USDC** (raised 2026-11-15 ~08:26 from 5 USDC — covers the full 1,000-tx Arc leg at measured gas with margin), Robinhood testnet **0.00333 test ETH** (unchanged). The runner MUST stop a chain's leg when its quota is hit — never exceed it. At measured gas prices 1,000 Arc txs costs roughly 5–6 USDC, so the full Arc leg now fits inside the 6.66666 quota; **the quota still wins over the count** if gas prices spike. RH 1,000 txs at ≈0.003 ETH fits inside its 0.00333 quota. Runner defaults: `--gas-budget arc 6.66666 USDC`, `--gas-budget robinhood 0.00333 ETH`.

**Duration:** 1,000 txs per chain at 12 tx/min ≈ **83 minutes per
chain** (2,000 txs total ≈ 167 min if run sequentially, ~83 min
wall-clock if the two chains run in parallel).

**Correction history (so the versions are not confused):**
1. First stated: 10,000 txs (2026-11-15 ~08:18).
2. Corrected ~08:23: 1,000 txs TOTAL, split 500 Arc / 500 RH.
3. **Final (this plan): 1,000 txs EACH chain — Arc 1,000 + RH 1,000 =
   2,000 total.** The 500/500 version is superseded; do not use it.
4. Gas quotas set ~08:25 (Arc 5 USDC), raised ~08:26 to **Arc 6.66666 USDC**
   (RH 0.00333 ETH unchanged) — full Arc leg fits inside quota at measured
   gas; quota still wins over the count if gas prices spike.

**Arc gas-price rule for the runner:** keep the 30 gwei cap as a
safety habit and re-check the live gas price immediately before the
run. At 1,000 txs/chain it is not binding: even at 100 gwei the Arc
loop would cost ≈ 15 USDC, still far inside the 120 USDC balance.

## Liquidity sizing for the 1,000-tx-per-chain loop

Suggested initial liquidity (what `create-pool.js` uses by default;
user approves final numbers):

| Chain | STEST | Quote | Implied price | Pool value |
|---|---|---|---|---|
| Arc | 10,000 STEST | 10 test USDC | 0.001 USDC / STEST | ~20 USDC |
| Robinhood | 10,000 STEST | 0.001 test ETH | 0.0000001 ETH / STEST | ~0.002 ETH |

**Per-leg trade size the pool can absorb:** keep each leg **≤ 0.5% of
the quote side** (Arc ≤ 0.05 USDC, Robinhood ≤ 0.000005 ETH);
**recommended 0.1%** (Arc **0.01 USDC**, Robinhood **0.000001 ETH**).
At 0.1% depth the price impact per leg is negligible and the pool
stays stable across the ~666 swap legs per chain. Larger legs (≥1% of depth) would move
the price visibly leg-over-leg and distort the sniper's own signals.

Why not bigger liquidity? At the corrected 1,000-tx target the gas
is only ~6 USDC, so 100 USDC of liquidity + ~6 gas ≈ 106 USDC would
now fit the 120 USDC balance. The 10 USDC default is kept anyway:
a smaller pool makes the sniper's own price signals visible leg over
leg, and it leaves a large gas/price-spike margin. If the user wants a
deeper pool, raise it — re-run this sizing section with the new
numbers first.

**Fees:** V2 charges 0.3% per swap to LPs. The burner owns the LP
tokens, so fees accrue back to the pool (recoverable on liquidity
removal). Per chain: 666 legs × 0.01 USDC × 0.3% ≈ 0.02 USDC total —
negligible, but the runner must not count it as spendable balance
mid-run.

**Numbers the sniper's run plan should assume** (from this kit):
Arc pool STEST/USDC, 10k STEST + 10 USDC, leg 0.01 USDC, 200k gas/leg,
cap 30 gwei, 1,000 txs ≈ 6 USDC gas. Robinhood pool STEST/ETH (own
V2), 10k STEST + 0.001 ETH, leg 0.000001 ETH, 200k gas/leg, 0.01 gwei,
1,000 txs ≈ 0.003 ETH gas. Both pools' LP tokens are held by the
burner. Loop: ~333 rounds of buy + approve + sell per chain.

## Withdrawability — pools must be removable (user requirement 2026-11-15)

LP tokens stay in the burner wallet (never sent to a dead address, never
locked, no renounced ownership that blocks withdrawal). Only standard
Uniswap V2 `removeLiquidity` / `removeLiquidityETH` is used, via
`scripts/remove-liquidity.js` (exact-amount LP approval, 5% min-out guard,
20-minute deadline, gas estimated before sending).

- **Check (pre-run gate):** after pool creation, test-remove 10% of the LP
  (`--fraction 0.1`) and verify the underlying tokens return to the burner.
  The 1,000-tx loop does NOT start until this passes (steps A4.5 / R4.5).
- **Final step:** after the loop, remove ALL liquidity (`--all`) — steps
  A7 / R7. Planning gas ≈ 0.01 USDC (Arc) / ≈ 0.000005 ETH (RH),
  re-estimated live before sending; the sniper runner also checks removal
  affordability before the loop starts.

## Ordered steps (each needs user go-ahead)

### Arc testnet — STEST / test-USDC on live V2

| # | Step | Command | Needs |
|---|---|---|---|
| A1 | Deploy STEST | `node scripts/deploy.js --chain arc --broadcast` | Go-ahead #1. Cost ≈ 0.01372 USDC. |
| A2 | Verify source | `node scripts/verify.js --chain arc --address <token> [--check]` | After A1 mines. No key needed (Blockscout UI / Sourcify). |
| A3 | Create pair + add liquidity | `node scripts/create-pool.js --chain arc --broadcast` | Go-ahead #2. Steps: createPair → approve STEST (exact) → approve USDC (exact) → addLiquidity (10k STEST + 10 USDC, 5% min guard). Cost ≈ 0.05 USDC gas. |
| A4 | Record pair address | Read from the A3 receipt / `factory.getPair`; write to `deployments/addresses.json` | Sniper component points at this pair. |
| A4.5 | Withdrawability check (test-remove 10% LP) | `node scripts/remove-liquidity.js --chain arc --fraction 0.1 --broadcast` | Go-ahead #2b, AFTER A3 mines and BEFORE the loop. Verifies STEST + USDC come back to the burner; run does not start until this passes. Cost ≈ 0.01 USDC gas (re-estimated live). |
| A5 | First live swap (measure gas) | Sniper runner, one small leg | Measure real swap gas; update the budget above before the loop. |
| A6 | 1,000-tx loop (this chain) | Sniper run plan | Go-ahead #3 + gas-price check (≤30 gwei). |
| A7 | FINAL STEP: remove all liquidity | `node scripts/remove-liquidity.js --chain arc --all --broadcast` | Go-ahead #4, after the loop. Removes the burner's whole LP position; gas estimated live first (planning ≈ 0.01 USDC). |

### Robinhood testnet — STEST / test-ETH on our own V2

| # | Step | Command | Needs |
|---|---|---|---|
| R1 | Deploy STEST | `node scripts/deploy.js --chain robinhood --broadcast` | Go-ahead #1. Cost ≈ 0.00000747 ETH. |
| R2 | Verify source | `node scripts/verify.js --chain robinhood --address <token> [--check]` | After R1 mines (Blockscout). |
| R3 | Deploy V2 factory + router, add liquidity | `node scripts/create-pool.js --chain robinhood --broadcast` | Go-ahead #2. Steps: deploy factory (feeToSetter=burner) → deploy router(factory, WETH) → approve STEST (exact) → addLiquidityETH (10k STEST + 0.001 ETH, 5% min guard). Cost ≈ 0.000078 ETH gas. |
| R4 | Record factory / router / pair | From R3 receipts; write to `deployments/addresses.json` | Sniper component points at this pair. |
| R4.5 | Withdrawability check (test-remove 10% LP) | `node scripts/remove-liquidity.js --chain robinhood --fraction 0.1 --broadcast` | Go-ahead #2b, AFTER R3 mines and BEFORE the loop. Verifies STEST + ETH come back to the burner; run does not start until this passes. Cost ≈ 0.000005 ETH gas (re-estimated live). |
| R5 | First live swap (measure gas) | Sniper runner, one small leg | Measure real swap gas; update budget. |
| R6 | 1,000-tx loop (this chain) | Sniper run plan | Go-ahead #3. No refill needed (see budget above). |
| R7 | FINAL STEP: remove all liquidity | `node scripts/remove-liquidity.js --chain robinhood --all --broadcast` | Go-ahead #4, after the loop. Removes the burner's whole LP position; gas estimated live first (planning ≈ 0.000005 ETH). |

### Alt path — Robinhood Synthra V3 (pool creation only)

`node scripts/create-pool.js --chain robinhood --dex v3` builds only
`createPool(STEST, WETH, 0.3%)` (measured 4,657,328 gas =
0.00004657 ETH). Adding V3 liquidity is **not** built: the
NonfungiblePositionManager address is unverified and this kit will not
guess it. Use the own-V2 path (R3) for the loop.

## Recorded addresses (verified live on-chain 2026-11-15)

| What | Address | How verified |
|---|---|---|
| Burner (deployer/LP, both chains) | `0xBb87bD789Ca67562F531685e10EB78eC03dE3dEB` | Derived from backup file at runtime in every dry-run |
| Arc V2 factory | `0xB56B00C38EF85633A789644415A16b4C8ea12EF8` | `eth_getCode` + `feeTo()=0x0`, `allPairsLength()=46` |
| Arc V2 router | `0x54599C3e0bcb99ca37b286242b5eC5D331AB9D18` | `eth_getCode` |
| Arc USDC (ERC-20 view) | `0x3600000000000000000000000000000000000000` | `decimals()=6`, `symbol()="USDC"` |
| Arc Synthra V3 factory / router | `0x0fB6EEDA6e90E90797083861A75D15752a27f59c` / `0xA545bCB1Bd7985c59ea162aB1748A0803434C31b` | `eth_getCode` + factory `owner()` returns address |
| RH Synthra V3 factory / router | `0x911b4000d3422f482f4062a913885f7b035382df` / `0x3Ce954107b1A675826B33bF23060Dd655e3758fE` | `eth_getCode` |
| RH V3 SwapRouter02 / QuoterV2 | `0x05FaE28A5917DA56D464fcfC13Ee9141B4FC057c` / `0xd9613Dd50dD035FB630181811dD65191791BeFB6` | `eth_getCode` |
| RH WETH | `0x33e4191705c386532ba27cBF171Db86919200B94` | `eth_getCode` |
| RH V4 PoolManager (canonical) | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | `eth_getCode` (not used by this kit) |
| RH existing WETH/NFLX pool | `0x9640afcbc2310d011b7b71a76975e919d9b6fa4a` | `eth_getCode` |

**NOT on testnet (verified `NO_CODE`, never use):** official Uniswap
mainnet addresses on Arc testnet (V2 factory
`0x89e5DB8B5aA49aA85AC63f691524311AEB649eba`, router
`0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`); mainnet V2/V3
addresses on Robinhood testnet (`0x8bce...`, `0x89e5...`,
`0x1f7d...`).

Predicted token address (CREATE, deployer nonce 0 — same on both
chains if the token is the first tx from the burner on each):
`0x2B1FB6394461bb9578cDd40fda5C07E774FB4804`. Scripts recompute from
the live nonce; trust the script. (Consequence: after the token
deploys on Robinhood, the own-V2 factory/router predictions shift to
nonces 1 and 2 — the script computes this live.)

## Safety rules (repeat from README)

- Exact-amount approvals only, never unlimited. 5% min-amount guard on
  `addLiquidity` / `addLiquidityETH`. Deadline 20 minutes.
- No auto-buy; no swap is sent by this kit. Every trade needs the
  user's go-ahead; the 1,000-tx-per-chain loop starts only after the run plan is approved.
- Gas is estimated before every send (scripts/gas.js); the `--broadcast`
  paths refuse to send without a fresh estimate.
- Testnet only. No mainnet chain ID is accepted by any script.

## Open items

1. Exact V2 swap gas — measure on first live swap (A5/R5), then
   re-run the budget with the real figure. Note the user's working
   numbers (≈ 6 USDC / ≈ 0.003 ETH per 1,000 txs) are ~2× this kit's
   dry-run math (≈ 3.0 USDC / ≈ 0.0015 ETH) — a conservative buffer;
   the measured figure decides which one the runner uses.
2. Robinhood refill — NOT needed for the 1,000-per-chain target.
   (Only a return to a 10,000-leg target would need one.)
3. Synthra V3 position manager — unverified; V3 liquidity adds not built.
4. Sepolia fallback — canonical V2 addresses unverified on the
   publicnode endpoint; re-verify on a healthy RPC before any Sepolia run.
5. Token name — STEST is a placeholder until the user names the token.
