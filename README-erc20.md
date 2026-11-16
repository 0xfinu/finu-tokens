> Staged for the finu-tokens repo (flattened layout): `config/` → `chains.js`, `deployments/addresses.json` → `addresses.json`, `artifacts/` → repo root, `metadata/0xmuse-1.json` → `0xmuse-1.json`. See README.md.

# ERC-20 Launch Kit — 0xmuse sniper toolkit

**Testnet only. Dry-run by default. Nothing broadcasts without `--broadcast`
and the user's explicit go-ahead per step.**

Test token: **Sniper Test Token (STEST)** — 1,000,000 supply minted to the
deployer at construction, owner-mintable for test top-ups. Clearly a test
token; the user renames/replaces it before any real launch.

Chains: **Arc testnet (5042002)** and **Robinhood Chain testnet (46630)**.
Sepolia (11155111) exists in config only as a portability fallback.

## Wallet rule — read this first

- **ONLY the burner EVM wallet signs anything in this kit:**
  `0xBb87bD789Ca67562F531685e10EB78eC03dE3dEB`, on both chains.
- **NOT Privy — archived, never use.** The Privy agent wallet (ETH
  `0x3c0BC553136fD79aE12A6401a18f0B892a0C4AdD`, SOL
  `GEkC94UGzMDYJqLMzurmBmqt5A5TnNjKEtWWcMLLKTcE`) is ARCHIVED: no
  transactions, no signing, no funding from it, ever, for this build.
- **NOT the Circle agent wallet** (`0xf1bfee7392a18cd9927b84e26560819c4676ae27`).
  It stays Arc-testnet-USDC-claims-only.
- Key material is loaded at runtime from
  `~/workspace/burners/burner-single-mnemonic-backup.json` (chmod 600) or
  the `BURNER_PRIVATE_KEY` / `BURNER_MNEMONIC` env vars. It is never
  copied, embedded, printed, or logged. Every script derives the wallet
  and **verifies the address matches the burner address before doing
  anything** — a mismatch aborts the run.

## Gas rule — standing rule, always

**Every onchain action estimates gas BEFORE sending: per-transaction cost
and total cost for the whole run, shown first.** `scripts/gas.js` is the
shared helper (`estimateTx` / `estimateAndPrint` / `printSummary`); both
`deploy.js` and `create-pool.js` use it, and their `--broadcast` paths
re-estimate immediately before sending and refuse to send without a
fresh estimate. Costs are stated in test tokens only (test USDC / test
ETH) — no USD equivalent, test tokens have no market price.

Measured dry-run gas (2026-11-15, see LP-RUN-PLAN.md for the full math):

| Step | Arc testnet | Robinhood testnet |
|---|---|---|
| Deploy STEST | 686,037 gas @ 20 gwei = **0.01372 test USDC** | 747,308 gas @ 0.01 gwei = **0.00000747 test ETH** |
| Deploy V2 factory | n/a (uses live factory) | 2,601,550 gas = **0.00002602 test ETH** |
| Deploy V2 router | n/a | 4,117,561 gas = **0.00004118 test ETH** |
| createPair | 1,581,718 gas @ 23.78 gwei = **0.03761 test USDC** | (inside addLiquidityETH) |
| approve quote | 56,241 gas = **0.00134 test USDC** (real) | — |
| V2 swap (planning figure) | **200,000 gas**/swap (see note) | **200,000 gas**/swap = **0.000002 test ETH** |

Swap-gas note: a live `eth_estimateGas` for a swap reverts
`TRANSFER_FROM_FAILED` until the router is approved, so no exact swap
figure could be measured pre-deployment. 200,000 gas is the conservative
planning figure (canonical V2 swaps run ~130k–200k gas). Measure the real
figure on the first live swap on our own pair, before the 1,000-tx-per-chain run.

**1,000-tx-per-chain loop headline (full math in LP-RUN-PLAN.md):**
- **Arc (1,000 txs): FITS easily** — ≈ 6 test USDC total (user
  working number; this kit's dry-run math says ≈ 3.0 USDC — the user
  number is a ~2× conservative buffer, see LP-RUN-PLAN.md),
  against a 120 test USDC balance. Setup ≈ 10.06 USDC. Total ≈ 16.1 USDC.
- **Robinhood (1,000 txs): FITS easily** — ≈ 0.003 test ETH total
  (user working number; dry-run math ≈ 0.0015 ETH — same 2× buffer),
  setup ≈ 0.00108 ETH, total ≈ 0.0041 test ETH against a 0.01 test ETH
  balance. **No faucet refill needed on either chain.**
- Loop structure: 1,000 txs per chain (2,000 total) = ~333 rounds of
  buy + approve + sell per chain. Duration at 12 tx/min ≈ 83 minutes
  per chain.

## Arc quirks (critical)

- Compile with `evm_version="paris"` — Arc rejects PUSH0 (Shanghai
  opcode). The token is compiled paris; the V2 contracts predate Shanghai
  (solc 0.5.16 / 0.6.6, `istanbul`) and cannot emit PUSH0 at all.
- **USDC is the native gas token on Arc.** The ERC-20 view is
  `0x3600000000000000000000000000000000000000` (6 decimals, symbol USDC
  — verified live). Gas is paid in USDC; the quote pair is STEST/USDC.
- **No working WETH9 on Arc.** Never use WETH paths on Arc. (Uniswap's
  Arc deployment wires WETH9 to an `UnsupportedProtocol` placeholder.)
- Permit2 on Arc is `F6B`, not `F7B` (relevant only if Permit2 flows are
  added later).
- Never mint to `msg.sender` in a CREATE2 deploy. This kit uses normal
  CREATE deploys; the constructor mints to the deployer explicitly.

## Robinhood testnet quirks

- Arbitrum Orbit L2, ETH gas. Gas price observed: **0.01 gwei** (very
  cheap — 1,000,000,000 gas units per 0.01 test ETH).
- **No canonical Uniswap V2 exists on this testnet.** The mainnet V2/V3
  addresses return `NO_CODE` here — never copy them. The kit deploys its
  own canonical V2 factory + router (compiled here, paris-safe) and pairs
  STEST with native test ETH via `addLiquidityETH` (no WETH wrapping).
- A Synthra V3 fork IS live (factory
  `0x911b4000d3422f482f4062a913885f7b035382df`, router
  `0x3Ce954107b1A675826B33bF23060Dd655e3758fE`, WETH
  `0x33e4191705c386532ba27cBF171Db86919200B94`), usable for pool creation
  only — its NonfungiblePositionManager address is unverified, so the kit
  does not build V3 liquidity adds. V4 PoolManager (canonical
  `0x8366a39CC670B4001A1121B8F6A443A643e40951`) has code on testnet but is
  not used by this kit.
- Faucet: https://faucet.testnet.chain.robinhood.com — 0.01 test ETH +
  5 test stock tokens per 24h, needs Google Sign-In + Cloudflare
  Turnstile (cannot be scripted; user step).

## Files

```
~/workspace/sniper/erc20/
  contracts/SniperTestToken.sol   OpenZeppelin ERC20 v5 + Ownable, 1M STEST
  scripts/compile.js              solc-js, paris (+0.5.16/0.6.6 for V2)
  scripts/deploy.js               deploy token (dry-run default)
  scripts/create-pool.js          pair + liquidity (dry-run default)
  scripts/remove-liquidity.js       remove liquidity / withdrawability check (dry-run default)
  scripts/verify.js               Blockscout/Sourcify verify instructions
  scripts/wallet.js               burner loader (runtime only, address check)
  scripts/gas.js                  shared gas estimation helper
  config/chains.js                per-chain config + verified addresses
  artifacts/                      ABI + bytecode + sha256 per contract
  deployments/addresses.json      filled in after each live step
  README-erc20.md                 this file
  LP-RUN-PLAN.md                  ordered run plan + 1,000-per-chain gas math
```

## Install / compile (proven 2026-11-15)

```bash
cd ~/workspace/sniper/erc20
npm install --no-audit --no-fund   # 22 packages, solc + ethers + OZ + V2 core/periphery
node scripts/compile.js            # token (solc 0.8.38, paris) + V2 (0.5.16/0.6.6, istanbul)
```

Compilation record (`artifacts/compilation-record.json`):

| Contract | Compiler | EVM | Bytecode | sha256 |
|---|---|---|---|---|
| SniperTestToken | solc 0.8.38 | paris | 3,351 B | `e35d1715895fc134464b9967a1b8e727f7e45069182a8a7a8f69b7f9619b6874` |
| UniswapV2Factory | solc 0.5.16 | istanbul | 10,921 B | `9f171528556581a4418210ac4d566f062ea2d05fe68acb1d0cee2d70b389917f` |
| UniswapV2Pair | solc 0.5.16 | istanbul | 9,176 B | `39b1ae004847c911b03a664c4132b1667f03df6bf050e7741a0a6f0bbedf8534` |
| UniswapV2Router02 | solc 0.6.6 | istanbul | 18,280 B | `aa437599a430e2c44c56aa0639baab7cd0f05dc5f6c6f362dff6732fdfd855d3` |

## Deploy later (only with user go-ahead per step)

```bash
# 1. Dry-run first (default — no broadcast):
node scripts/deploy.js --chain arc
node scripts/deploy.js --chain robinhood
# 2. After the user approves THIS step:
node scripts/deploy.js --chain arc --broadcast
# 3. Record the address (the script writes deployments/addresses.json),
#    then verify source:
node scripts/verify.js --chain arc --address 0x... [--check]
# 4. Pair + liquidity (dry-run first, then --broadcast after approval):
node scripts/create-pool.js --chain arc
node scripts/create-pool.js --chain robinhood        # own-V2 path (default)
node scripts/create-pool.js --chain robinhood --dex v3  # pool creation only
```

Predicted token address (CREATE, deployer nonce 0 — same on both chains
if the token is the first tx from the burner on each):
`0x2B1FB6394461bb9578cDd40fda5C07E774FB4804`. The scripts recompute it
from the live nonce at runtime; if the burner has already transacted on
a chain, the prediction shifts — trust the script, not this note.

## Networks

| | Arc testnet | Robinhood testnet | Sepolia (fallback) |
|---|---|---|---|
| Chain ID | 5042002 | 46630 | 11155111 |
| RPC | https://rpc.testnet.arc.io | https://rpc.testnet.chain.robinhood.com | https://ethereum-sepolia-rpc.publicnode.com |
| Explorer | https://explorer.testnet.arc.io | https://explorer.testnet.chain.robinhood.com | https://sepolia.etherscan.io |
| Gas token | test USDC | test ETH | test ETH |
| Faucet | https://faucet.circle.com | https://faucet.testnet.chain.robinhood.com | sepoliafaucet.com |
| Quote token | USDC `0x3600...0000` (6 dec) | WETH `0x33e4...0094` (18 dec) | WETH `0x7b79...7f0` |
| DEX | V2 factory `0xB56B...EF8`, router `0x5459...D18` | own V2 (deploy it) / Synthra V3 | canonical V2 (unverified on publicnode) |

## Safety rules

- Testnet only. No mainnet anywhere in this kit — the scripts refuse
  mainnet chain IDs outright.
- Exact-amount approvals only, never unlimited. Every `approve` in
  `create-pool.js` is for the exact liquidity amount.
- Never auto-buy. No swap is built or sent by this kit; the sniper
  runner is a separate component with its own approvals.
- Every trade needs the user's go-ahead. The 1,000-tx loop starts only
  after the user approves the run plan (see LP-RUN-PLAN.md).
- Simulate a sell before buying (honeypot check), scan for mint/pause/
  blacklist/max-tx/tax setters, minimum-out guard on every swap — rules
  adopted from 0xlinu's docs; they belong to the sniper runner, not this kit.
- DYOR every link and contract before use; never trust a token by its
  symbol alone — verify the contract onchain.

## Open decisions / items

1. **Sepolia RPC unverified** — the publicnode endpoint returned the
   right chain ID but `eth_getCode` returned `0x` for known contracts.
   Treat Sepolia canonical V2 addresses as unverified until a healthy
   Sepolia RPC is used. (Sepolia is fallback-only anyway.)
2. **Synthra V3 NonfungiblePositionManager** — no verified address on
   either testnet, so V3 liquidity adds are not built. Own-V2 is the
   Robinhood path; V3 stays pool-creation-only.
3. **Exact V2 swap gas** — planning figure 200,000 gas/swap; measure the
   real figure on the first live swap on our own pair before the 1,000-tx-per-chain run.
4. **Robinhood refill — NOT needed.** The corrected 1,000-tx target
   (1,000 txs RH ≈ 0.003 test ETH) fits the 0.01 test ETH balance with
   ~0.0059 spare. No faucet claim required for this run. (Scaling note:
   a 10,000-leg loop would need ≈ 0.021 ETH and would NOT fit.)
5. **Arc gas-price sensitivity — relaxed at 1k.** At 1,000 txs the Arc
   loop costs ≈ 6 USDC by the user's number (≈ 3 USDC by dry-run math)
   at ~20–40 gwei, and ≈ 30 USDC even at 100 gwei, so the 30 gwei cap
   is a safety habit, not a binding constraint. Still re-check the live
   gas price before the run.
6. **Token name** — STEST is a placeholder until the user names the token.
