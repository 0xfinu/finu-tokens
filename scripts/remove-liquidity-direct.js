// Remove liquidity DIRECTLY via the pair (transfer LP -> pair, then burn)
// — bypasses the router. DRY-RUN BY DEFAULT.
//   node scripts/remove-liquidity-direct.js --chain arc [--fraction 0.1]
//   node scripts/remove-liquidity-direct.js --chain arc --fraction 0.1 --broadcast
//     (only with the user's explicit go-ahead for THIS step)
//
// WHY THIS EXISTS (2026-11-16): the third-party Arc testnet router
// 0x54599C3e0bcb99ca37b286242b5eC5D331AB9D18 (unverified, MINEPAD docs)
// reverts on removeLiquidity even with the exact LP allowance set and
// min-outs at 0 — the call reverts with no reason string, in both
// estimateGas and eth_call. The pair itself is fine: a direct
// transfer+burn probe returned 31.622776601715509416 STEST + 0.027041
// USDC for 1e12 LP (txs 0xcf222ce2... / 0x7f389654..., blocks
// 72574412/72574414). So on Arc, liquidity leaves via the pair's
// standard V2 burn, not via the router. The RH pool keeps using the
// (working, patched) router script remove-liquidity.js.
//
// Safety mirrors remove-liquidity.js: fraction of the burner's LP
// balance (default 10%), expected amounts computed pro-rata from
// reserves, 95% min-out guard verified AFTER the burn (STEST back and
// quote back must both be >= min), gas estimated BEFORE any send.
// The burn sends the underlying straight to the burner; LP tokens are
// never locked or burned to a dead address.
//
// TESTNET ONLY. Burner EVM wallet ONLY. NOT Privy (archived). NOT Circle.
'use strict';

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { CHAINS, BURNER_ADDRESS } = require('../chains');
const { loadBurnerWallet } = require('./wallet');
const { estimateTx, estimateAndPrint, printSummary } = require('./gas');

const PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function burn(address to) returns (uint256 amount0, uint256 amount1)',
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
];

function parseArgs() {
  const args = { chain: 'arc', broadcast: false, fraction: '0.1', all: false, pair: null, token: null };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--chain') args.chain = process.argv[++i];
    else if (a === '--pair') args.pair = process.argv[++i];
    else if (a === '--token') args.token = process.argv[++i];
    else if (a === '--fraction') args.fraction = process.argv[++i];
    else if (a === '--all') args.all = true;
    else if (a === '--broadcast') args.broadcast = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/remove-liquidity-direct.js --chain arc [--pair 0x...] [--token 0x...] [--fraction 0.1|--all] [--broadcast]');
      console.log('Default --fraction 0.1 removes 10% of the burner LP balance via direct pair burn.');
      console.log('Default is DRY-RUN (no broadcast). --broadcast only with user go-ahead for this step.');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function loadAddresses() {
  const p = path.join(__dirname, '..', 'addresses.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

function fractionToBps(s) {
  if (!/^(0(\.\d+)?|1(\.0+)?)$/.test(s)) throw new Error(`--fraction must be between 0 and 1 (got "${s}").`);
  const [whole, frac = ''] = s.split('.');
  const padded = (frac + '0000').slice(0, 4);
  return BigInt(whole) * 10000n + BigInt(padded);
}

async function main() {
  const args = parseArgs();
  const cfg = CHAINS[args.chain];
  if (!cfg) throw new Error(`Unknown chain "${args.chain}".`);
  const addrs = loadAddresses();
  const chainAddrs = addrs[args.chain] || {};
  const token = args.token || chainAddrs.token;
  if (!token || !ethers.isAddress(token)) {
    throw new Error('No token address. Deploy first (scripts/deploy.js) or pass --token 0x....');
  }
  const pairAddr = args.pair || chainAddrs.pair;
  if (!pairAddr || !ethers.isAddress(pairAddr)) {
    throw new Error('No pair address — create the pool first.');
  }

  const bps = args.all ? 10000n : fractionToBps(args.fraction);
  const label = args.all ? 'ALL LP' : `${(Number(bps) / 100).toFixed(2)}% of LP`;

  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== cfg.chainId) throw new Error(`RPC chainId mismatch: expected ${cfg.chainId}, got ${net.chainId}.`);
  console.log(`Chain: ${cfg.name} (chainId ${cfg.chainId}) — direct-burn remove ${label}`);
  console.log(`Token: ${token}`);
  console.log(`Pair: ${pairAddr} (direct transfer + burn, router bypassed)`);

  const wallet = loadBurnerWallet(provider);
  console.log(`LP holder (burner, verified): ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Burner native balance: ${ethers.formatEther(balance)}`);
  const gasSym = cfg.gasToken.split(' ')[0];

  const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);
  const token0 = await pair.token0();
  const reserves = await pair.getReserves();
  const totalSupply = await pair.totalSupply();
  const lpBalance = await pair.balanceOf(wallet.address);
  console.log(`LP totalSupply: ${totalSupply} — burner LP balance: ${lpBalance}`);
  if (lpBalance === 0n) {
    console.log('Burner holds no LP tokens for this pair — nothing to remove.');
    return;
  }
  const liquidity = (lpBalance * bps) / 10000n;
  if (liquidity === 0n) throw new Error(`Fraction ${args.fraction} of ${lpBalance} LP rounds to 0 — use a larger fraction.`);
  console.log(`Removing ${liquidity} LP (${(Number(bps) / 100).toFixed(2)}% of burner balance)`);

  // Expected underlying amounts (pro-rata share of reserves), 5% guard.
  const reserve0 = BigInt(reserves[0]);
  const reserve1 = BigInt(reserves[1]);
  const out0 = (reserve0 * liquidity) / totalSupply;
  const out1 = (reserve1 * liquidity) / totalSupply;
  const min0 = (out0 * 95n) / 100n;
  const min1 = (out1 * 95n) / 100n;
  const isToken0 = token.toLowerCase() === token0.toLowerCase();
  const tokenOut = isToken0 ? out0 : out1;
  const quoteOut = isToken0 ? out1 : out0;
  const tokenMin = isToken0 ? min0 : min1;
  const quoteMin = isToken0 ? min1 : min0;
  const quoteDecimals = cfg.quoteDecimals;
  const quoteFmt = (v) => cfg.quoteSymbol === 'ETH' || args.chain === 'robinhood'
    ? ethers.formatEther(v)
    : ethers.formatUnits(v, quoteDecimals);
  console.log(`Expected back (before 5% guard): ${ethers.formatUnits(tokenOut, 18)} STEST + ${quoteFmt(quoteOut)} ${cfg.quoteSymbol}`);
  console.log(`Min-out guard (95%): ${ethers.formatUnits(tokenMin, 18)} STEST + ${quoteFmt(quoteMin)} ${cfg.quoteSymbol}`);

  const steps = [];
  steps.push({
    name: '1. transfer LP -> pair (EXACT removal amount)',
    tx: {
      to: pairAddr,
      data: pair.interface.encodeFunctionData('transfer', [pairAddr, liquidity]),
    },
    note: `Moves exactly ${liquidity} LP into the pair so burn() can redeem it. LP never leaves burner control except into the pair for the burn.`,
  });
  steps.push({
    name: '2. burn(burner) — pair sends STEST + quote straight to burner',
    tx: {
      to: pairAddr,
      data: pair.interface.encodeFunctionData('burn', [wallet.address]),
    },
    note: 'Standard V2 burn; underlying tokens go directly to the burner, no router involved.',
  });

  console.log('\n--- Steps (built, not sent) ---');
  console.log('STANDING RULE: every step below is gas-estimated BEFORE any send.');
  const estimates = [];
  for (const s of steps) {
    const est = await estimateAndPrint(provider, wallet.address, s.name, s.tx, gasSym);
    estimates.push({ label: s.name, est });
    console.log(`\n[${s.name}]`);
    console.log(`  to: ${s.tx.to}  value: 0`);
    console.log(`  note: ${s.note}`);
  }
  await printSummary(provider, estimates, balance, gasSym);

  if (!args.broadcast) {
    console.log('\n*** DRY-RUN ONLY — nothing was broadcast. ***');
    console.log('Run again with --broadcast ONLY after the user approves this step.');
    return;
  }

  // --- Broadcast path: fresh estimate before EACH send, then verify ---
  const tokenC = new ethers.Contract(token, ERC20_ABI, provider);
  const quoteC = new ethers.Contract(cfg.quoteToken, ERC20_ABI, provider);
  const isNativeQuote = args.chain === 'robinhood';
  const balBefore = {
    stest: await tokenC.balanceOf(wallet.address).catch(() => 0n),
    quote: isNativeQuote
      ? await provider.getBalance(wallet.address)
      : await quoteC.balanceOf(wallet.address).catch(() => 0n),
  };
  console.log('\n*** --broadcast passed: sending steps IN ORDER, waiting for each receipt ***');
  const pairW = new ethers.Contract(pairAddr, PAIR_ABI, wallet);
  for (const s of steps) {
    const fresh = await estimateTx(provider, wallet.address, s.tx, gasSym);
    if (!fresh.ok) throw new Error(`No gas estimate for "${s.name}" — refusing to send without a calculated gas cost: ${fresh.error}`);
    console.log(`Sending: ${s.name} — gas ${fresh.gas} @ ${fresh.gasPrice} wei = ${fresh.costFormatted}`);
    const tx = await wallet.sendTransaction({ ...s.tx, gasLimit: (fresh.gas * 120n) / 100n });
    console.log(`  tx: ${tx.hash} — ${cfg.explorer}/tx/${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  mined block ${receipt.blockNumber}, gas used ${receipt.gasUsed}`);
  }
  const balAfter = {
    stest: await tokenC.balanceOf(wallet.address).catch(() => 0n),
    quote: isNativeQuote
      ? await provider.getBalance(wallet.address)
      : await quoteC.balanceOf(wallet.address).catch(() => 0n),
  };
  const stestBack = balAfter.stest - balBefore.stest;
  // Note: on a native-quote chain the quote side includes gas spent; the
  // check below uses the STEST side plus the quote delta where meaningful.
  const quoteBack = isNativeQuote ? null : (balAfter.quote - balBefore.quote);
  console.log(`\nWithdrawability check: STEST back ${ethers.formatUnits(stestBack, 18)} (min ${ethers.formatUnits(tokenMin, 18)})`);
  if (!isNativeQuote) console.log(`Quote back ${quoteFmt(quoteBack)} ${cfg.quoteSymbol} (min ${quoteFmt(quoteMin)})`);
  const pass = stestBack >= tokenMin && (isNativeQuote || quoteBack >= quoteMin);
  if (pass) {
    console.log('WITHDRAWABILITY CHECK: PASS — underlying tokens returned to the burner.');
  } else {
    console.log('WITHDRAWABILITY CHECK: FAIL — fewer tokens returned than the min-out guard. Investigate before continuing.');
    process.exitCode = 2;
  }
  console.log('Record the remaining LP balance in addresses.json if this was a partial removal.');
}

main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
