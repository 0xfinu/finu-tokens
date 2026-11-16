// Create the trading pair + add initial liquidity — DRY-RUN BY DEFAULT.
//   node scripts/create-pool.js --chain arc
//   node scripts/create-pool.js --chain robinhood
//   node scripts/create-pool.js --chain robinhood --dex v3
//   node scripts/create-pool.js --chain arc --broadcast   (only with the
//     user's explicit go-ahead for THIS step, after the token is deployed)
//
// Per-chain DEX (all verified live on-chain 2026-11-15 unless flagged):
//   arc:       Uniswap V2-style factory 0xB56B... / router 0x5459...,
//              pair STEST / test-USDC (ERC-20 view 0x3600...0000).
//   robinhood: NO pre-deployed V2 exists (mainnet addresses = NO_CODE).
//              Default --dex own-v2: deploy our own canonical V2 factory
//              + router (compiled here, paris), then addLiquidityETH
//              (STEST / native test ETH — no WETH wrapping needed).
//              --dex v3: Synthra V3 createPool + initialize only; adding
//              V3 liquidity needs a NonfungiblePositionManager address
//              that is NOT verified, so this script refuses that step.
//   sepolia:   canonical V2 (UNVERIFIED on the publicnode endpoint).
//
// TESTNET ONLY. Burner EVM wallet ONLY. NOT Privy (archived). NOT Circle.
'use strict';

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { CHAINS, BURNER_ADDRESS, SUGGESTED_LIQUIDITY } = require('../chains');
const { loadBurnerWallet } = require('./wallet');
const { estimateTx, printSummary } = require('./gas');

const V2_FACTORY_ABI = [
  'function getPair(address,address) view returns (address)',
  'function createPair(address,address) returns (address)',
  'function feeTo() view returns (address)',
  'function allPairsLength() view returns (uint256)',
];
const V2_ROUTER_ABI = [
  'function factory() view returns (address)',
  'function WETH() view returns (address)',
  'function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) returns (uint amountA, uint amountB, uint liquidity)',
  'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)',
];
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];
const V3_FACTORY_ABI = [
  'function getPool(address,address,uint24) view returns (address)',
  'function createPool(address,address,uint24) returns (address)',
  'function owner() view returns (address)',
];

function parseArgs() {
  const args = { chain: 'arc', broadcast: false, dex: null, token: null, tokenAmount: null, quoteAmount: null };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--chain') args.chain = process.argv[++i];
    else if (a === '--dex') args.dex = process.argv[++i];
    else if (a === '--token') args.token = process.argv[++i];
    else if (a === '--token-amount') args.tokenAmount = process.argv[++i];
    else if (a === '--quote-amount') args.quoteAmount = process.argv[++i];
    else if (a === '--broadcast') args.broadcast = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/create-pool.js --chain arc|robinhood|sepolia [--dex own-v2|v2|v3] [--token 0x...] [--token-amount N] [--quote-amount N] [--broadcast]');
      console.log('Default is DRY-RUN (no broadcast). --broadcast only with user go-ahead.');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function loadArtifact(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', `${name}.json`), 'utf8'));
}

function loadAddresses() {
  const p = path.join(__dirname, '..', 'addresses.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

async function tryEstimate(provider, wallet, step) {
  // Shared gas helper (scripts/gas.js): estimate first, show the cost.
  const gasSym = step.gasSym || 'ETH';
  return estimateTx(provider, wallet.address, step.tx, gasSym);
}

async function main() {
  const args = parseArgs();
  const cfg = CHAINS[args.chain];
  if (!cfg) throw new Error(`Unknown chain "${args.chain}".`);
  const dexKindRaw = args.dex || cfg.dex.kind;
  const dexKind = dexKindRaw === 'uniswap-v2' ? 'v2' : dexKindRaw === 'own-uniswap-v2' ? 'own-v2' : dexKindRaw;
  const suggested = SUGGESTED_LIQUIDITY[args.chain] || SUGGESTED_LIQUIDITY.arc;

  const addrs = loadAddresses();
  const token = args.token || (addrs[args.chain] && addrs[args.chain].token);
  if (!token || !ethers.isAddress(token)) {
    throw new Error('No token address. Deploy first (scripts/deploy.js) or pass --token 0x....');
  }
  const tokenAmount = ethers.parseUnits(args.tokenAmount || suggested.tokenAmount, 18);
  const quoteAmount = args.chain === 'arc'
    ? ethers.parseUnits(args.quoteAmount || suggested.quoteAmount, cfg.quoteDecimals)
    : ethers.parseEther(args.quoteAmount || suggested.quoteAmount);

  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== cfg.chainId) throw new Error(`RPC chainId mismatch: expected ${cfg.chainId}, got ${net.chainId}.`);
  console.log(`Chain: ${cfg.name} (chainId ${cfg.chainId}) — DEX mode: ${dexKind}`);
  console.log(`Token: ${token} — pair: STEST / ${cfg.quoteSymbol}`);
  console.log(`Planned liquidity: ${ethers.formatUnits(tokenAmount, 18)} STEST + ${args.chain === 'arc' ? ethers.formatUnits(quoteAmount, 6) : ethers.formatEther(quoteAmount)} ${cfg.quoteSymbol}`);
  console.log('(These are suggested test amounts — the user approves final numbers before any live step.)');

  const wallet = loadBurnerWallet(provider);
  console.log(`Liquidity provider (burner, verified): ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Burner native balance: ${ethers.formatEther(balance)}`);
  const tokenC = new ethers.Contract(token, ERC20_ABI, provider);
  try {
    console.log(`Burner STEST balance: ${ethers.formatUnits(await tokenC.balanceOf(wallet.address), 18)}`);
  } catch (e) {
    console.log('Burner STEST balance: (token not deployed yet — balance check skipped in dry-run)');
  }
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;

  const steps = [];
  const push = (name, tx, note) => steps.push({ name, tx, note });

  if (dexKind === 'v2') {
    // --- Arc (or Sepolia): pre-deployed V2 factory/router ---
    const factory = new ethers.Contract(cfg.dex.factory, V2_FACTORY_ABI, provider);
    const router = new ethers.Contract(cfg.dex.router, V2_ROUTER_ABI, provider);
    const existingPair = await factory.getPair(token, cfg.quoteToken);
    console.log(`Existing pair at factory: ${existingPair}`);
    if (existingPair === ethers.ZeroAddress) {
      push('1. createPair(STEST, quote)', {
        to: cfg.dex.factory,
        data: factory.interface.encodeFunctionData('createPair', [token, cfg.quoteToken]),
      }, 'Creates the V2 pair. After it mines, the pair address is deterministic (CREATE2).');
    } else {
      console.log('Pair already exists — skipping createPair.');
    }
    const routerAddr = cfg.dex.router;
    push('2. approve STEST -> router (EXACT amount)', {
      to: token,
      data: tokenC.interface.encodeFunctionData('approve', [routerAddr, tokenAmount]),
    }, `Exact-amount approval only: ${ethers.formatUnits(tokenAmount, 18)} STEST. Never unlimited.`);
    const quoteC = new ethers.Contract(cfg.quoteToken, ERC20_ABI, provider);
    push('3. approve quote -> router (EXACT amount)', {
      to: cfg.quoteToken,
      data: quoteC.interface.encodeFunctionData('approve', [routerAddr, quoteAmount]),
    }, `Exact-amount approval only: ${ethers.formatUnits(quoteAmount, cfg.quoteDecimals)} ${cfg.quoteSymbol}.`);
    push('4. addLiquidity(STEST, quote)', {
      to: routerAddr,
      data: router.interface.encodeFunctionData('addLiquidity', [
        token, cfg.quoteToken, tokenAmount, quoteAmount,
        (tokenAmount * 95n) / 100n, (quoteAmount * 95n) / 100n, // 5% slippage guard
        wallet.address, deadline,
      ]),
    }, 'Mints LP tokens to the burner. 5% min-amount guard; never auto-buy.');
  } else if (dexKind === 'own-v2') {
    // --- Robinhood testnet: deploy our own canonical V2 factory + router ---
    const factoryArt = loadArtifact('UniswapV2Factory');
    const routerArt = loadArtifact('UniswapV2Router02');
    const factoryFactory = new ethers.ContractFactory(factoryArt.abi, factoryArt.bytecode, wallet);
    const factoryTx = await factoryFactory.getDeployTransaction(wallet.address);
    push('1. deploy UniswapV2Factory (feeToSetter = burner)', { ...factoryTx }, 'Canonical v2-core, compiled paris. Deterministic pair addresses follow from this factory.');
    const predictedFactory = ethers.getCreateAddress({ from: wallet.address, nonce: await provider.getTransactionCount(wallet.address) });
    console.log(`Predicted factory address: ${predictedFactory}`);
    const routerFactory = new ethers.ContractFactory(routerArt.abi, routerArt.bytecode, wallet);
    const routerTx = await routerFactory.getDeployTransaction(predictedFactory, cfg.quoteToken);
    push('2. deploy UniswapV2Router02 (factory, WETH)', { ...routerTx }, 'Canonical v2-periphery, compiled paris. WETH arg is the testnet WETH (needed by the router even for addLiquidityETH).');
    const predictedRouter = ethers.getCreateAddress({ from: wallet.address, nonce: (await provider.getTransactionCount(wallet.address)) + 1 });
    console.log(`Predicted router address: ${predictedRouter} (nonce+1; re-check after step 1 mines)`);
    push('3. approve STEST -> router (EXACT amount)', {
      to: token,
      data: tokenC.interface.encodeFunctionData('approve', [predictedRouter, tokenAmount]),
    }, `Exact-amount approval only: ${ethers.formatUnits(tokenAmount, 18)} STEST.`);
    const routerIface = new ethers.Interface(V2_ROUTER_ABI);
    push('4. addLiquidityETH(STEST, ETH)', {
      to: predictedRouter,
      value: quoteAmount,
      data: routerIface.encodeFunctionData('addLiquidityETH', [
        token, tokenAmount,
        (tokenAmount * 95n) / 100n, (quoteAmount * 95n) / 100n,
        wallet.address, deadline,
      ]),
    }, `Sends ${ethers.formatEther(quoteAmount)} test ETH as the pair's ETH side; pair is created inside this call. 5% min-amount guard.`);
  } else if (dexKind === 'v3') {
    // --- Synthra V3 (Arc alt / Robinhood alt): pool creation only ---
    const alt = cfg.dexAlt;
    const factory = new ethers.Contract(alt.factory, V3_FACTORY_ABI, provider);
    const fee = 3000; // 0.3% tier
    const existing = await factory.getPool(token, cfg.quoteToken, fee);
    console.log(`Existing V3 pool (0.3% tier): ${existing}`);
    if (existing === ethers.ZeroAddress) {
      push('1. createPool(STEST, quote, 0.3%)', {
        to: alt.factory,
        data: factory.interface.encodeFunctionData('createPool', [token, cfg.quoteToken, fee]),
      }, 'Creates the V3 pool. initialize() + liquidity need the pool address, read from getPool after this mines.');
    }
    console.log('NOTE: V3 add-liquidity is NOT built here — the NonfungiblePositionManager address is unverified, and this script will not guess it. See LP-RUN-PLAN.md open items.');
  } else {
    throw new Error(`Unknown dex mode "${dexKind}". Use v2, own-v2, or v3.`);
  }

  console.log('\n--- Steps (built, not sent) ---');
  console.log('STANDING RULE: every step below is gas-estimated BEFORE any send.');
  const gasSym = cfg.gasToken.split(' ')[0];
  const estimates = [];
  for (const s of steps) {
    s.gasSym = gasSym;
    const est = await tryEstimate(provider, wallet, s);
    estimates.push({ label: s.name, est });
    console.log(`\n[${s.name}]`);
    console.log(`  to: ${s.tx.to || '(contract creation)'}  value: ${s.tx.value ? ethers.formatEther(s.tx.value) : '0'}`);
    console.log(`  calldata: ${String(s.tx.data).slice(0, 160)}...`);
    console.log(`  note: ${s.note}`);
    if (!est.ok) console.log(`  gas estimate: UNAVAILABLE in dry-run (${est.error}) — expected until prior steps are mined; re-estimate live before sending.`);
    else console.log(`  [gas] ${s.name}: ${est.gas} gas @ ${est.gasPrice} wei = ${est.costFormatted}`);
  }
  await printSummary(provider, estimates, balance, gasSym);

  if (!args.broadcast) {
    console.log('\n*** DRY-RUN ONLY — nothing was broadcast. ***');
    console.log('Run again with --broadcast ONLY after the user approves this step (and the token is deployed).');
    return;
  }
  console.log('\n*** --broadcast passed: sending steps IN ORDER, waiting for each receipt ***');
  for (const s of steps) {
    // STANDING RULE: re-estimate immediately before sending each step.
    const fresh = await estimateTx(provider, wallet.address, s.tx, gasSym);
    if (!fresh.ok) throw new Error(`No gas estimate for "${s.name}" — refusing to send without a calculated gas cost: ${fresh.error}`);
    console.log(`Sending: ${s.name} — gas ${fresh.gas} @ ${fresh.gasPrice} wei = ${fresh.costFormatted}`);
    const tx = await wallet.sendTransaction({ ...s.tx, gasLimit: (fresh.gas * 120n) / 100n });
    console.log(`  tx: ${tx.hash} — ${cfg.explorer}/tx/${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  mined block ${receipt.blockNumber}, gas used ${receipt.gasUsed}`);
  }
  console.log('All steps sent. Record pair/router addresses in addresses.json.');
}

main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
