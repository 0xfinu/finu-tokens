# finu-tokens

![0xmuse logo](https://raw.githubusercontent.com/0xfinu/finu.muse/main/0xmuse-logo-160x160.jpg)

**finu.muse test tokens — STEST ERC-20 with real DEX pools on two testnets, plus the 0xmuse logo NFT. DYOR, don't trust — verify, not your keys, not your coins.**

🌐 [Live site](https://0xfinu.github.io/finu.muse/) · 💻 [finu.muse](https://github.com/0xfinu/finu.muse)

---

## What it is

- **STEST (Sniper Test Token)** — OpenZeppelin ERC-20 v5, 1,000,000 supply, 18 decimals. A test token; it will be renamed/replaced before any real launch.
- **Two live pools** (Uniswap V2-style), seeded and proven withdrawable.
- **0xmuse NFT** — the approved logo as an ERC-721 (`0xmuse #1`, symbol `XMUSE`). Contract compiled, metadata pinned locally — **not minted yet** (see IPFS note below).

Layout is flat: `contracts/` + `scripts/` subdirs, everything else at root. `chains.js` is the per-chain config; `addresses.json` is the deployment record (filled in after each live step); the compiled artifacts (`*.json`) sit at root. `README-erc20.md`, `README-nft.md`, and `LP-RUN-PLAN.md` are the original build records — their `artifacts/` / `deployments/` / `metadata/` path references map to the flat layout (see the note at the top of each).

## Status — deployed and live

| Token | Chain | Contract |
| --- | --- | --- |
| STEST | Arc testnet | `0x2B1FB6394461bb9578cDd40fda5C07E774FB4804` |
| STEST | Robinhood Chain testnet | `0x2B1FB6394461bb9578cDd40fda5C07E774FB4804` |
| STEST | LiteForge testnet | `0x34fF4f6F184903d7b5d28de3bcF670FB3E71a073` (via Lester Labs Token Factory) |

Same address on Arc + Robinhood (same deployer, nonce 0 on each). Deployed Nov 15, 2026.

| Pool | Pair | Seeded | Reserves at creation |
| --- | --- | --- | --- |
| Arc `0x78dba0e6bf972f9d68732bbf20bd5e0d9888612b` | STEST / test USDC | 10,000 STEST + 10 test USDC | third-party V2 factory `0xB56B...EF8`, router `0x5459...D18` |
| Robinhood `0x0fF18427301c124115476975fF00a6C6B175Cd09` | STEST / test WETH | 10,000 STEST + 0.001 test WETH | our own V2 factory + **patched** router `0xDb25...63Cb6` |

**Withdrawability — PROVEN Nov 16, 2026:** a 10% test-remove passed on both chains before the sniper run (Arc: 996.84 STEST + 0.9927 USDC back; Robinhood: 999.999… STEST back). LP tokens stay in the burner wallet — never locked, never burned. Removing liquidity is the run's final step.

## Install / compile

```bash
npm install
node scripts/compile.js        # STEST (solc 0.8.38, paris) + V2 core/router (0.5.16/0.6.6, istanbul)
node scripts/compile-nft.js    # ZeroXMuseNFT (solc 0.8.30, paris)
```

`npm install` also brings in `ipfs-only-hash` (used by `prepare-metadata.js`); its transitive dependency `multiformats` provides the CID conversion — no separate install needed.

Compilation record (`compilation-record.json`): SniperTestToken 3,351 bytes, UniswapV2Factory 10,921, UniswapV2Pair 9,176, UniswapV2Router02 18,280 (patched build).

## Usage — token + pool (dry-run by default)

```bash
# 1. Dry-run first (default — no broadcast):
node scripts/deploy.js --chain arc
node scripts/deploy.js --chain robinhood
# 2. After go-ahead for THIS step:
node scripts/deploy.js --chain arc --broadcast
# 3. Verify source (Blockscout UI / Sourcify, no key):
node scripts/verify.js --chain arc --address 0x... [--check]
# 4. Pair + liquidity (dry-run first, then --broadcast after approval):
node scripts/create-pool.js --chain arc
node scripts/create-pool.js --chain robinhood        # own-V2 path (default)
# 5. Withdrawability check — BEFORE any run:
node scripts/remove-liquidity.js --chain robinhood --fraction 0.1 --broadcast
node scripts/remove-liquidity-direct.js --chain arc --fraction 0.1 --broadcast
# 6. Final step after the run:
node scripts/remove-liquidity.js --chain robinhood --all --broadcast
node scripts/remove-liquidity-direct.js --chain arc --all --broadcast
```

Every `--broadcast` path re-estimates gas immediately before sending and refuses to send without a fresh estimate.

## Usage — NFT (deploy + mint later)

```bash
node scripts/prepare-metadata.js   # rebuilds 0xmuse-1.json from the logo + pinned CIDs
node scripts/compile-nft.js        # compiles ZeroXMuseNFT
node scripts/mint.js --network arc                     # dry-run: deploy + mint gas estimates
node scripts/mint.js --network arc --contract 0x... --broadcast   # mint #1, only with go-ahead
```

**IPFS note — do not mint yet.** The image and metadata CIDs are pinned on a local kubo node (`ipfs-cids.json`, baseURI `ipfs://bafybeidg2vxo2ekme2waott6yv6eu4rxbjwxyrkkb2znmy6xlv6wsndjyu/`), but the daemon found 0 DHT peers on the build VM — the content is **not yet announced to the public DHT**. Mint only after the tokenURI resolves publicly (re-provide the pins from a connected node first). Measured dry-run cost: Arc deploy + mint ≈ 0.0278 test USDC; Robinhood ≈ 0.000015 test ETH.

## Safety — the house rules

- **Testnet only.** No mainnet chain ID is accepted by any script.
- **Burner wallet only:** `0xBb87bD789Ca67562F531685e10EB78eC03dE3dEB`. NOT Privy (archived), NOT Circle (Arc-USDC-claims-only). Key material loads at runtime from the burner backup file (or `BURNER_PRIVATE_KEY` / `BURNER_MNEMONIC` env vars) and the derived address is verified before anything runs. It is never copied, embedded, printed, or logged.
- **Always calculate gas costs** — per-tx + total — before any onchain action, and show them first (`scripts/gas.js`).
- **Exact-amount approvals only**, never unlimited. 5% min-amount guard on liquidity adds/removes. 20-minute deadline.
- **Never auto-buy.** No swap is built or sent by this kit; the sniper runner is a separate component ([finu-sniper](https://github.com/0xfinu/finu-sniper)).

## Arc quirks (learned live)

- Compile with `evm_version="paris"` — Arc rejects PUSH0. The V2 contracts predate Shanghai (solc 0.5.16 / 0.6.6, `istanbul`) and cannot emit PUSH0 at all.
- **USDC is the native gas token on Arc.** The ERC-20 view is `0x3600000000000000000000000000000000000000` (6 decimals). No working WETH9 — never use WETH paths on Arc.
- **The third-party Arc router's `removeLiquidity` reverts** (no reason string, even with allowance set and mins at 0). Arc removals go via `scripts/remove-liquidity-direct.js` — transfer LP to the pair, then `burn()`. Proven Nov 16, 2026.
- The same router's `swapExactETHForTokens` reverts too (its `WETH()` points at the Synthra V3 factory). Arc swaps use the token path (`swapExactTokensForTokens`).
- **Robinhood testnet has no canonical Uniswap V2** — the kit deploys its own factory + router. The stock router computed a no-code pair address because our factory's pair init-code hash (`0x8b438ce1…`) differs from the canonical one (`0x96e8ac42…`); the fix is the patched router in `contracts/vendor/v2-periphery` (hash replaced in `UniswapV2Library.pairFor`, original `node_modules` untouched), compiled by `scripts/compile-router-patched.js`. The patched router is `0xDb25B1559DDac052888fE5218FD2819F52A63Cb6`; the old broken one (`0xa946…`) is unused. Any recompile of v2-core with different settings changes the pair hash — recompile the router from the patched vendor copy to match.

## Networks

| | Arc testnet | Robinhood testnet | Sepolia (fallback) |
| --- | --- | --- | --- |
| Chain ID | 5042002 | 46630 | 11155111 |
| RPC | https://rpc.testnet.arc.io | https://rpc.testnet.chain.robinhood.com | https://ethereum-sepolia-rpc.publicnode.com |
| Explorer | https://explorer.testnet.arc.io | https://explorer.testnet.chain.robinhood.com | https://sepolia.etherscan.io |
| Gas token | test USDC | test ETH | test ETH |
| Faucet | https://faucet.circle.com | https://faucet.testnet.chain.robinhood.com | sepoliafaucet.com |
| Quote token | USDC `0x3600...0000` (6 dec) | WETH `0x33e4...0094` (18 dec) | WETH `0x7b79...7f0` |
| DEX | V2 factory `0xB56B...EF8`, router `0x5459...D18` | own V2 (deploy it) / Synthra V3 | canonical V2 |

---

*Built with [finu.muse](https://0xfinu.github.io/finu.muse/) — 0xfinu + muse. Testnet only — no real money, no mainnet funds.*
