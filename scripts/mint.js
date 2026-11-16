#!/usr/bin/env node
// 0xmuse NFT mint — DRY-RUN by default. TESTNET ONLY.
//  - Wallet: BURNER ONLY. Loads key material at runtime from
//    ~/workspace/burners/burner-single-mnemonic-backup.json, derives the
//    address, and ABORTS unless it equals the burner EVM address below.
//    The Privy agent wallet (ARCHIVED) and the Circle agent wallet are NEVER
//    used here — no transactions, no signing, no funding from either.
//    Key material is NEVER printed, logged, copied, or embedded.
//  - Gas rule: every onchain action estimates gas FIRST and shows the
//    per-tx + total cost vs the burner balance BEFORE anything is sent.
//  - Dry-run (default): connects to the testnet, verifies chain id,
//    estimates DEPLOY gas (real, read-only eth_estimateGas on the creation
//    tx) and estimates MINT gas via eth_estimateGas + stateOverride
//    (simulated deployed contract at the predicted CREATE address).
//    Prints calldata + costs. Sends NOTHING.
//  - Broadcast: ONLY with --broadcast AND --contract <deployed-address>.
//    Re-estimates against the live contract, prints costs, then sends
//    mint(to=burner, token #1). Do NOT run with --broadcast without the
//    user's explicit go-ahead for that exact run.
//
// Usage:
//   node scripts/mint.js [--network arc|robinhood|sepolia] [--contract 0x...]
//   node scripts/mint.js --network arc --contract 0x... --broadcast
"use strict";

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const BURNER_ADDRESS = "0xBb87bD789Ca67562F531685e10EB78eC03dE3dEB";
const BACKUP_PATH = "/home/hatch/workspace/burners/burner-single-mnemonic-backup.json";
const EXPECTED_BURNER = BURNER_ADDRESS.toLowerCase();

// TESTNET ALLOWLIST ONLY. Mainnet chain ids are refused outright.
const NETWORKS = {
  arc: {
    chainId: 5042002,
    rpc: "https://rpc.testnet.arc.io",
    symbol: "USDC",
    decimals: 18,
    explorer: "https://explorer.testnet.arc.io",
    note: "USDC is the native gas token on Arc.",
  },
  robinhood: {
    chainId: 46630,
    rpc: "https://rpc.testnet.chain.robinhood.com",
    symbol: "ETH",
    decimals: 18,
    explorer: "https://explorer.testnet.chain.robinhood.com",
    note: "ETH gas on Robinhood Chain testnet.",
  },
  sepolia: {
    chainId: 11155111,
    rpc: "https://ethereum-sepolia-rpc.publicnode.com",
    symbol: "ETH",
    decimals: 18,
    explorer: "https://sepolia.etherscan.io",
    note: "Fallback config only. (rpc.sepolia.org was dead — 404 — on 2026-11-15.)",
  },
};

const ROOT = path.resolve(__dirname, "..");
const BASE_URI = "ipfs://bafybeidg2vxo2ekme2waott6yv6eu4rxbjwxyrkkb2znmy6xlv6wsndjyu/";
const TOKEN_NAME = "0xmuse";
const TOKEN_SYMBOL = "XMUSE";

function parseArgs(argv) {
  const args = { network: "arc", contract: null, broadcast: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--network") args.network = argv[++i];
    else if (a === "--contract") args.contract = argv[++i];
    else if (a === "--broadcast") args.broadcast = true;
    else if (a === "--help" || a === "-h") {
      console.log("usage: node scripts/mint.js [--network arc|robinhood|sepolia] [--contract 0x...] [--broadcast]");
      process.exit(0);
    } else {
      console.error("unknown arg:", a);
      process.exit(1);
    }
  }
  return args;
}

// Load the burner wallet from the backup file at runtime. Never prints key material.
function loadBurnerWallet() {
  if (!fs.existsSync(BACKUP_PATH)) {
    throw new Error(`burner backup not found: ${BACKUP_PATH}`);
  }
  const data = JSON.parse(fs.readFileSync(BACKUP_PATH, "utf8"));

  const candidates = [];
  const push = (label, value) => {
    if (typeof value === "string" && value.trim()) candidates.push({ label, value: value.trim() });
  };
  // Known shapes first (mnemonic preferred), then a bounded scan.
  push("mnemonic", data.mnemonic);
  push("mnemonic.phrase", data.mnemonic && data.mnemonic.phrase);
  push("seedPhrase", data.seedPhrase);
  push("phrase", data.phrase);
  if (data.evm && typeof data.evm === "object") {
    push("evm.mnemonic", data.evm.mnemonic);
    push("evm.privateKey", data.evm.privateKey);
    push("evm.private_key", data.evm.private_key);
  }
  push("privateKey", data.privateKey);
  push("private_key", data.private_key);
  // Bounded fallback scan: only top-level + one nested level, strings only.
  if (candidates.length === 0) {
    const scan = (obj, depth) => {
      if (!obj || typeof obj !== "object" || depth > 1) return;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string") push(`scan.${k}`, v);
        else if (typeof v === "object") scan(v, depth + 1);
      }
    };
    scan(data, 0);
  }

  for (const { value } of candidates) {
    try {
      // 12/24-word mnemonic (BIP39).
      if (value.split(/\s+/).length >= 12 && ethers.Mnemonic.isValidMnemonic(value)) {
        const w = ethers.Wallet.fromPhrase(value); // default path m/44'/60'/0'/0/0
        if (w.address.toLowerCase() === EXPECTED_BURNER) return w;
      }
    } catch { /* try next candidate */ }
    try {
      // Raw 0x private key (64 hex chars).
      if (/^0x[0-9a-fA-F]{64}$/.test(value)) {
        const w = new ethers.Wallet(value);
        if (w.address.toLowerCase() === EXPECTED_BURNER) return w;
      }
    } catch { /* try next candidate */ }
  }
  throw new Error(
    "ABORT: no key material in the burner backup derived the expected burner address " +
    BURNER_ADDRESS + ". Refusing to continue."
  );
}

function fmt(amountWei, symbol) {
  return `${ethers.formatUnits(amountWei, 18)} ${symbol}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const net = NETWORKS[args.network];
  if (!net) {
    console.error(`unknown network: ${args.network} (arc | robinhood | sepolia)`);
    process.exit(1);
  }
  if (args.broadcast && !args.contract) {
    console.error("ABORT: --broadcast requires --contract <deployed-address> (deploy first, with user go-ahead).");
    process.exit(1);
  }
  if (args.contract && !ethers.isAddress(args.contract)) {
    console.error("ABORT: --contract is not a valid address:", args.contract);
    process.exit(1);
  }

  console.log("=== 0xmuse NFT mint — " + (args.broadcast ? "BROADCAST MODE" : "DRY-RUN (nothing will be sent)") + " ===");
  console.log("network:", args.network, "| chain id:", net.chainId, "| rpc:", net.rpc);
  console.log("gas token:", net.symbol, "—", net.note);
  console.log("wallet rule: BURNER ONLY (" + BURNER_ADDRESS + "). Privy = ARCHIVED, never used. Circle agent wallet = claims-only, never used.");

  const wallet = loadBurnerWallet();
  console.log("derived burner address:", wallet.address, "(verified == expected burner address)");

  const provider = new ethers.JsonRpcProvider(net.rpc);
  const chainId = Number((await provider.getNetwork()).chainId);
  console.log("connected chain id:", chainId);
  if (chainId !== net.chainId) {
    console.error(`ABORT: RPC chain id ${chainId} != expected ${net.chainId}. Refusing to continue.`);
    process.exit(1);
  }
  const block = await provider.getBlockNumber();
  console.log("latest block:", block);

  const balance = await provider.getBalance(wallet.address);
  console.log(`burner balance: ${fmt(balance, net.symbol)}`);

  const fee = await provider.getFeeData();
  const gasPrice = fee.gasPrice ?? fee.maxFeePerGas;
  if (!gasPrice) {
    console.error("ABORT: RPC returned no gas price.");
    process.exit(1);
  }
  console.log("gas price:", ethers.formatUnits(gasPrice, "gwei"), "gwei");

  const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, "ZeroXMuseNFT.json"), "utf8"));
  const iface = new ethers.Interface(artifact.abi);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  // ---- 1. DEPLOY estimate (real, read-only) ----
  const deployTx = await factory.getDeployTransaction(TOKEN_NAME, TOKEN_SYMBOL, BASE_URI);
  deployTx.from = wallet.address;
  const deployGas = await provider.estimateGas(deployTx);
  const deployCost = deployGas * gasPrice;
  console.log("\n--- DEPLOY (ZeroXMuseNFT) — estimate ---");
  console.log("  name/symbol/baseURI:", TOKEN_NAME, "/", TOKEN_SYMBOL, "/", BASE_URI);
  console.log("  deploy gas estimate:", deployGas.toString());
  console.log("  deploy cost:", fmt(deployCost, net.symbol));

  const nonce = await provider.getTransactionCount(wallet.address);
  const predicted = ethers.getCreateAddress({ from: wallet.address, nonce });
  console.log("  predicted contract address (from nonce", nonce + "):", predicted);

  // ---- 2. MINT estimate ----
  const mintData = iface.encodeFunctionData("mint", [wallet.address]);
  console.log("\n--- MINT token #1 -> burner — calldata ---");
  console.log("  mint(address) calldata:", mintData);
  console.log("  tokenURI(1) will be:", BASE_URI + "1");

  let mintGas = null;
  if (args.contract) {
    // Live contract: estimate against real onchain code.
    const contract = new ethers.Contract(args.contract, artifact.abi, provider);
    mintGas = await contract.mint.estimateGas(wallet.address, { from: wallet.address });
    console.log("  mint gas estimate (live contract " + args.contract + "):", mintGas.toString());
  } else {
    // No deployed contract yet: simulate via stateOverride at the predicted address.
    // Storage layout (from solc storageLayout, saved in storage-layout.json):
    //   slot 6 = _owner (Ownable, plain var in OZ 5.4.0), slot 7 = _nextTokenId.
    // (OZ 5.4.0 non-upgradeable contracts use plain storage, NOT ERC-7201 slots.)
    const ownerSlot = "0x" + "6".padStart(64, "0");
    const ownerValue = "0x" + wallet.address.slice(2).padStart(64, "0");
    const nextIdSlot = "0x" + "7".padStart(64, "0"); // _nextTokenId = 1 (pre-mint state)
    const nextIdValue = "0x" + "1".padStart(64, "0");
    try {
      const est = await provider.send("eth_estimateGas", [
        { from: wallet.address, to: predicted, data: mintData },
        "latest",
        {
          [predicted]: {
            code: artifact.deployedBytecode,
            stateDiff: { [ownerSlot]: ownerValue, [nextIdSlot]: nextIdValue },
          },
        },
      ]);
      mintGas = BigInt(est);
      console.log("  mint gas estimate (stateOverride simulation at predicted address):", mintGas.toString());
    } catch (e) {
      console.log("  mint gas estimate: UNAVAILABLE — this RPC does not support eth_estimateGas stateOverride.");
      console.log("    reason:", (e.info && e.info.error && e.info.error.message) || e.message);
      console.log("    Mint gas will be estimated against the live contract right after deploy, before any mint is sent.");
    }
  }

  // ---- 3. COSTS vs BALANCE (gas rule: estimate first, show first) ----
  console.log("\n--- GAS COSTS vs BURNER BALANCE ---");
  if (mintGas !== null) {
    const mintCost = mintGas * gasPrice;
    const total = deployCost + mintCost;
    console.log("  per-tx: deploy", fmt(deployCost, net.symbol), `(${deployGas} gas)`);
    console.log("  per-tx: mint #1", fmt(mintCost, net.symbol), `(${mintGas} gas)`);
    console.log("  TOTAL (deploy + mint #1):", fmt(total, net.symbol));
    console.log("  burner balance:", fmt(balance, net.symbol));
    console.log("  balance after deploy+mint:", fmt(balance - total, net.symbol));
    if (total > balance) {
      console.log("  WARNING: total cost EXCEEDS burner balance — fund the burner first (testnet faucet).");
    } else {
      console.log("  OK: burner balance covers deploy + mint #1.");
    }
  } else {
    console.log("  per-tx: deploy", fmt(deployCost, net.symbol), `(${deployGas} gas)`);
    console.log("  per-tx: mint #1 — estimate pending (needs deployed contract; see above)");
    console.log("  burner balance:", fmt(balance, net.symbol));
    console.log("  balance after deploy:", fmt(balance - deployCost, net.symbol));
  }

  if (!args.broadcast) {
    console.log("\nDRY-RUN complete. Nothing was sent, nothing was signed.");
    console.log("Next (needs user go-ahead each step): deploy -> record contract address -> re-run with --contract -> mint with --broadcast.");
    return;
  }

  // ---- BROADCAST (only reached with --broadcast --contract) ----
  console.log("\n*** BROADCAST MODE: sending mint tx to " + args.contract + " ***");
  const contract = new ethers.Contract(args.contract, artifact.abi, wallet.connect(provider));
  const liveMintGas = await contract.mint.estimateGas(wallet.address);
  const liveMintCost = liveMintGas * gasPrice;
  console.log("re-estimated mint gas:", liveMintGas.toString(), "| cost:", fmt(liveMintCost, net.symbol));
  if (liveMintCost > balance) {
    console.error("ABORT: mint cost exceeds burner balance.");
    process.exit(1);
  }
  const tx = await contract.mint(wallet.address);
  console.log("mint tx sent:", tx.hash);
  console.log("explorer:", `${net.explorer}/tx/${tx.hash}`);
  const receipt = await tx.wait();
  console.log("confirmed in block", receipt.blockNumber, "| gas used:", receipt.gasUsed.toString(), "| status:", receipt.status);
}

main().catch((e) => {
  console.error("FAILED:", e.message || e);
  process.exit(1);
});
