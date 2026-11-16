> Staged for the finu-tokens repo (flattened layout): `config/` → `chains.js`, `deployments/addresses.json` → `addresses.json`, `artifacts/` → repo root, `metadata/0xmuse-1.json` → `0xmuse-1.json`. See README.md.

# 0xmuse NFT — mint pipeline (TESTNET ONLY)

Mint "0xmuse #1" — the approved 0xmuse logo as an ERC-721 — on BOTH Arc testnet AND Robinhood Chain testnet (user decision 2026-11-15 ~08:27: "RH and ARC"). Same logo, same metadata, one contract deployment per chain. Built 2026-11-15. **Nothing onchain has been deployed or minted yet.** The mints happen in the deploy phase, and every step below that moves value needs the user's explicit go-ahead, one step at a time. Mint gas is shown before sending on both chains and counted in the run accounting (deploy-phase costs, separate from the sniper loop quotas).

## Safety rules (hard — never break)

- **TESTNET ONLY.** Allowlisted chain ids in `scripts/mint.js`: Arc testnet
  5042002, Robinhood testnet 46630, Sepolia 11155111. Any other chain id
  (including all mainnets) aborts. No mainnet RPC is configured anywhere.
- **BURNER WALLET ONLY.** Every transaction signs from the burner EVM wallet
  `0xBb87bD789Ca67562F531685e10EB78eC03dE3dEB`. `scripts/mint.js` loads key
  material at runtime from `~/workspace/burners/burner-single-mnemonic-backup.json`
  (chmod 600), derives the address, and **aborts unless it matches the burner
  address**. Key material is never printed, logged, copied, or embedded.
- **NOT Privy — ARCHIVED, never use.** The Privy agent wallet
  (ETH `0x3c0BC553136fD79aE12A6401a18f0B892a0C4AdD`,
  SOL `GEkC94UGzMDYJqLMzurmBmqt5A5TnNjKEtWWcMLLKTcE`) is archived. No
  transactions, no signing, no funding from it — ever, for this build.
- **NOT Circle.** The Circle agent wallet (`0xf1bfee7392a18cd9927b84e26560819c4676ae27`)
  is Arc-testnet-USDC-claims-only. It is never used for this NFT work.
- **Gas rule: estimate first, show first.** `mint.js` estimates gas and prints
  per-tx + total cost vs the burner balance before anything is sent. No
  transaction goes out without its gas cost calculated and shown first.
- **Dry-run first.** `mint.js` defaults to dry-run (builds txs, estimates gas,
  sends nothing). Broadcast needs `--broadcast` **and** `--contract`, and is
  only run with the user's explicit go-ahead for that exact run.
- **No accounts, no secrets in files.** No pinning-service account was created
  (no Pinata / nft.storage / web3.storage). No mnemonic or private key exists
  in any file, log, or message in this directory.
- **Arc quirks respected:** compiled with `evm_version: "paris"` (PUSH0 is
  rejected on Arc); USDC is the native gas token on Arc; no WETH9; `mint()`
  takes an explicit `to` address and never defaults to `msg.sender`
  (also avoids the CREATE2 `msg.sender` trap).

## Pipeline

```
photo (0xmuse logo) → kubo `ipfs add` (local, pinned)
                    → metadata JSON → kubo `ipfs add` (local, pinned)
                    → metadata directory (file "1") → baseURI
                    → compile (solc-js, paris, optimizer 200)
                    → mint.js dry-run (gas estimates vs burner balance)
                    → [user go-ahead] deploy → mint #1 with --broadcast
```

## The NFT

- **Name:** `0xmuse #1` — token #1 of collection `0xmuse` (symbol `XMUSE`).
- **Artwork:** the approved 0xmuse logo,
  `~/workspace/0xmuse/logo/0xmuse-logo-160x160.jpg` (6,108 bytes).
  SHA-256: `3e6d7e30d859d74ddbe259d2b26a6247a2ccf62871189dcbadfcc13a1d186127`
  (verified: `ipfs cat <image-CID>` hashes back to exactly this value).
- **Image CID (kubo, pinned):** `bafkreib6nv7dbwcz25g5xysz2kzguyshulgpmkdrdco4xlp4ye5b2gdbe4`
  (raw codec, single block). Same content as dag-pb CIDv0
  `QmQiamUHh5QPTcGyxgkVZyq23c2kaVM5eBQfC4EWx6n7GA` — see the CID note below.
- **Metadata CID (kubo, pinned):** `bafkreiawd3ceegu6rjsbke6henvd4lb5z3veetirwf37peabc73zniohpa`
- **Metadata directory CID (kubo, pinned):** `bafybeidg2vxo2ekme2waott6yv6eu4rxbjwxyrkkb2znmy6xlv6wsndjyu`
  (directory containing file `1` = the metadata JSON).
- **baseURI:** `ipfs://bafybeidg2vxo2ekme2waott6yv6eu4rxbjwxyrkkb2znmy6xlv6wsndjyu/`
- **tokenURI(1):** `ipfs://bafybeidg2vxo2ekme2waott6yv6eu4rxbjwxyrkkb2znmy6xlv6wsndjyu/1`
- **Metadata file:** `metadata/0xmuse-1.json` (name, description, image
  `ipfs://<image-CID>`, attributes: Collection / Token / Network / Artwork /
  Image SHA-256). All CIDs recorded in `ipfs-cids.json`.

## IPFS route — what worked

**Kubo worked (route A).** No account, no hosted pinning service.

- Kubo v0.35.0, downloaded as a plain release tarball. Note:
  `dist.ipfs.tech` is **unreachable from this VM** (connection fails), so the
  binary came from the GitHub release mirror
  (`github.com/ipfs/kubo/releases/download/v0.35.0/kubo_v0.35.0_linux-amd64.tar.gz`,
  51.9 MB, gzip-verified). Binary at `kubo/kubo/ipfs`, repo at
  `ipfs-repo/` (lowpower profile), peer id
  `12D3KooWLb9pDqCs15jb1GEkCAPDeRTVSz9DK8hzRiUxqeRXVQSx`.
- `ipfs add --cid-version=1` (no daemon needed for add) pinned the image,
  the metadata JSON, and the metadata directory. `ipfs pin ls` confirms all
  three recursive pins; `ipfs cat` round-trips byte-identical.
- **Not yet announced to the public DHT — open item.** The daemon was started
  and ran ~90 s, but found **0 swarm peers** and logged
  `failed to bootstrap (no peers found)`. The VM's egress to the libp2p swarm
  appears blocked (same reason `dist.ipfs.tech` is unreachable). So the CIDs
  are **pinned locally but not retrievable from the public network yet**.
  Before the tokenURI will resolve publicly, either (a) run the daemon on a
  machine with working p2p egress until it connects and re-provides the pins
  (`IPFS_PATH=<repo> ipfs daemon`, then `ipfs dht provide <CID>`), or
  (b) re-add the same files on a connected node (same bytes → same CIDs).
  The daemon was stopped after the test; the repo and pins are intact.
- **Offline-CID fallback (route B) was NOT needed** — but it is ready:
  `ipfs-only-hash` is installed, and `scripts/prepare-metadata.js` falls back
  to an offline-computed CID (with a loud warning) if no pinned CID is found
  in `ipfs-cids.json`.
- **CID note (raw vs dag-pb).** Kubo v0.35 defaults to raw leaves, so a
  single-chunk file's root is a raw-codec CID (`bafkrei…`). `ipfs-only-hash`
  computes the dag-pb form (`Qm…` / `bafybei…`). Same bytes, different CID —
  **always use the kubo CID**, because that is what is actually pinned here.
  The metadata JSON's own offline dag-pb CIDv1 is
  `bafybeihgovffyxfwlkpsh4q76lwh3fmdft7kyxzjlnmrsys745jydsrt7y`
  (for reference only — the pinned kubo CID is the `bafkrei…` one above).

## Contract

- `contracts/ZeroXMuseNFT.sol` — OpenZeppelin ERC-721 (v5.4.0) + Ownable,
  Solidity `^0.8.20`. Owner-only `mint(address to)` (explicit recipient,
  token ids start at 1), `setBaseURI`, `nextTokenId`. No token URI override —
  `tokenURI(id)` is OpenZeppelin's `baseURI + tokenId`.
- Compile: `node scripts/compile.js` — solc-js 0.8.30, `evmVersion: "paris"`,
  optimizer 200 runs. **Proof:** compiled OK, bytecode 5,778 bytes,
  deployed 4,860 bytes, 35 ABI entries. Artifact:
  `artifacts/ZeroXMuseNFT.json` (ABI + bytecode + deployed bytecode).
  Storage layout (solc): slot 0–5 ERC-721 (`_name`, `_symbol`, `_owners`,
  `_balances`, `_tokenApprovals`, `_operatorApprovals`), slot 6 `_owner`,
  slot 7 `_nextTokenId`, slot 8 `_baseTokenURI` — saved in
  `artifacts/storage-layout.json`. (OZ 5.4.0 non-upgradeable contracts use
  plain storage, not ERC-7201 slots — verified from source + layout output.)

## Gas estimates (measured 2026-11-15, dry-run, read-only)

Gas price varies run to run; the table below is the measured run. `mint.js`
re-estimates live on every run and refuses to proceed if the total exceeds
the burner balance.

| Network | Deploy gas | Mint #1 gas | Gas price | Deploy cost | Mint cost | TOTAL | Burner balance |
|---|---|---|---|---|---|---|---|
| **Arc testnet** (5042002, USDC gas) | 1,312,382 | 77,166 | 20 gwei | 0.02624764 USDC | 0.00154332 USDC | **0.02779096 USDC** | 120.0 USDC ✅ |
| **Robinhood testnet** (46630, ETH gas) | 1,422,071 | 82,414 | 0.01 gwei | 0.00001422071 ETH | 0.00000082414 ETH | **0.00001504485 ETH** | 0.01 ETH ✅ |
| Sepolia (11155111, fallback) | 8,693,573 ⚠️ | 256,800 ⚠️ | ~0 gwei ⚠️ | ~0 ETH ⚠️ | ~0 ETH ⚠️ | ~0 ETH ⚠️ | 0.05 ETH |

- Mint gas on Arc/RH is estimated by `eth_estimateGas` with a `stateOverride`
  simulation (deployed bytecode + owner slot set at the predicted CREATE
  address). After deploy, `mint.js --contract <addr>` re-estimates against
  the live contract instead.
- ⚠️ **Sepolia numbers are NOT trustworthy:** the PublicNode endpoint returned
  a deploy estimate ~6.6× the Arc/RH figure for identical bytecode and a
  ~zero gas price. Chain id (11155111) and balance (0.05 ETH) verified fine,
  but re-estimate Sepolia gas on a reliable RPC before any Sepolia action.
  (`rpc.sepolia.org` was dead — HTTP 404 — on 2026-11-15; the fallback now
  uses `https://ethereum-sepolia-rpc.publicnode.com`.)
- Predicted contract address (burner nonce 0, same on all three chains):
  `0x2B1FB6394461bb9578cDd40fda5C07E774FB4804` — this is only the address the
  contract *will* have if deployed next from the burner; it changes if the
  burner nonce moves first.
- Mint calldata (token #1 → burner):
  `0x6a627842000000000000000000000000bb87bd789ca67562f531685e10eb78ec03de3deb`

## How to deploy + mint later (needs user go-ahead at EACH step)

1. **Announce the IPFS content first** (see "Not yet announced" above) so
   `tokenURI(1)` resolves publicly. Verify with a gateway or a second node.
2. **Deploy** (separate step, user go-ahead): deploy `ZeroXMuseNFT` with
   constructor args `("0xmuse", "XMUSE", "ipfs://bafybeidg2vxo2ekme2waott6yv6eu4rxbjwxyrkkb2znmy6xlv6wsndjyu/")`
   from the burner on Arc testnet. Record the deployed address.
3. **Dry-run the mint against the live contract:**
   `node scripts/mint.js --network arc --contract <deployed-address>`
   — check the re-estimated gas + cost vs the burner balance.
4. **Mint (user go-ahead for that exact run):**
   `node scripts/mint.js --network arc --contract <deployed-address> --broadcast`
   — mints token #1 to the burner. Verify on
   `https://explorer.testnet.arc.io` and `tokenURI(1)`.
5. **Robinhood Chain testnet — same flow, second chain** (user decision 2026-11-15: mint on RH and ARC). Deploy with `--network robinhood`, record the deployed address (predicted: same `0x2B1FB6394461bb9578cDd40fda5C07E774FB4804` — same deployer, nonce 0 on both chains), dry-run the mint, then mint with `--broadcast` — each step with its own go-ahead. ETH gas, explorer `https://explorer.testnet.chain.robinhood.com`. Dry-run measured 2026-11-15: deploy 1,444,359 gas = 0.00001444359 ETH, mint 83,482 gas = 0.00000083482 ETH, total 0.00001527841 ETH.

## Files

- `contracts/ZeroXMuseNFT.sol` — the ERC-721 contract
- `scripts/compile.js` — solc-js compile (paris, optimizer 200)
- `scripts/prepare-metadata.js` — logo SHA-256 + metadata JSON builder
- `scripts/mint.js` — dry-run / broadcast mint (ethers v6, burner-only)
- `artifacts/ZeroXMuseNFT.json` — ABI + bytecode + deployed bytecode
- `artifacts/storage-layout.json` — solc storage layout
- `metadata/0xmuse-1.json` — ERC-721 metadata for token #1
- `metadata-dir/1` — same metadata JSON, filed as `1` for the directory CID
- `ipfs-cids.json` — image / metadata / directory CIDs, baseURI, peer id
- `ipfs-repo/` — local kubo repo (pins live here; keep it)
- `kubo/kubo/ipfs` — kubo v0.35.0 binary (no install, no account)
- `package.json` / `package-lock.json` / `node_modules/` — solc, @openzeppelin/contracts, ethers v6, ipfs-only-hash

## Open items / decisions for the user

1. **IPFS announcement pending** (see above): CIDs are pinned locally but the
   daemon found 0 DHT peers on this VM. Needs a connected node before the
   tokenURI resolves publicly. Do not mint until this is resolved, or the NFT
   will point at content nobody can fetch.
2. **Contract not deployed, NFT not minted — on either chain.** Each deploy and each mint needs a separate go-ahead. Deploy + mint cost on Arc is ~0.028 USDC total (measured) — trivial vs the 120 USDC burner balance. On Robinhood it is ~0.0000153 ETH total (measured 2026-11-15) — trivial vs the 0.01 ETH burner balance.
3. **Sepolia gas numbers unreliable** (PublicNode endpoint) — re-estimate on a
   good RPC if Sepolia is ever used for real.
4. Nothing else is blocked: compile, metadata, CIDs, and dry-runs on Arc +
   Robinhood are all proven offchain.
