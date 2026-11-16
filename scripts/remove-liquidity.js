// Remove liquidity (standard Uniswap V2 removeLiquidity only) — DRY-RUN
// BY DEFAULT.
//   node scripts/remove-liquidity.js --chain arc [--fraction 0.1]
//   node scripts/remove-liquidity.js --chain robinhood --fraction 0.1
//   node scripts/remove-liquidity.js --chain arc --all
//   node scripts/remove-liquidity.js --chain arc --fraction 0.1 --broadcast
//     (only with the user's explicit go-ahead for THIS step)
//
// WITHDRAWABILITY RULE (user, 2026-11-15): the pools must be
// withdrawable. LP tokens stay in the burner wallet (never sent to a
// dead address, never locked, no renounced ownership that blocks
// withdrawal). This script is the only way liquidity leaves a pool:
// standard V2 removeLiquidity / removeLiquidityETH, LP tokens approved
// to the router in the EXACT amount being removed, 5% min-out guard,
// 20-minute deadline, gas estimated BEFORE sending.
//
// Two uses:
//   1. Withdrawability check (pre-run checklist): after pool creation,
//      test-remove a SMALL slice (default --fraction 0.1 = 10% of the
//      burner's LP balance) and verify the underlying STEST + quote
//      tokens come back to the burner. The 1k run does NOT start until
//      this check passes.
//   2. Final step of the run: --all removes the burner's whole LP
//      position on that chain after the loop finishes.
//
// TESTNET ONLY. Burner EVM wallet ONLY. NOT Privy (archived). NOT Circle.
'use strict';

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { CHAINS, BURNER_ADDRESS } = require('../chains');
const { loadBurnerWallet } = require('./wallet');
const { estimateTx, estimateAndPrint, printSummary } = require('./gas');

// Planning figure when no live estimate is possible yet (same
// conservative figure the kit uses for V2 swaps: canonical V2
// removeLiquidity is ~130k-200k gas).
const PLANNING_GAS_REMOVE = 200000n;

const V2_FACTORY_ABI = [
  'function getPair(address,address) view returns (address)',
];
const V2_ROUTER_ABI = [
  'function removeLiquidity(address tokenA, address tokenB, uint liquidity, uint amountAMin, uint amountBMin, address to, uint deadline) returns (uint amountA, uint amountB)',
  'function removeLiquidityETH(address token, uint liquidity, uint amountTokenMin, uint amountETHMin, address to, uint deadline) returns (uint amountToken, uint amountETH)',
];
const PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

function parseArgs() {
  const args = { chain: 'arc', broadcast: false, fraction: '0.1', all: false, pair: null, token: null, router: null };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--chain') args.chain = process.argv[++i];
    else if (a === '--pair') args.pair = process.argv[++i];
    else if (a === '--token') args.token = process.argv[++i];
    else if (a === '--router') args.router = process.argv[++i];
    else if (a === '--fraction') args.fraction = process.argv[++i];
    else if (a === '--all') args.all = true;
    else if (a === '--broadcast') args.broadcast = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/remove-liquidity.js --chain arc|robinhood|sepolia [--pair 0x...] [--token 0x...] [--router 0x...] [--fraction 0.1|--all] [--broadcast]');
      console.log('Default --fraction 0.1 removes 10% of the burner LP balance (the withdrawability test-remove).');
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

/** Parse a 0..1 fraction string into basis points (integer math, no floats). */
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

  // Router: explicit flag > recorded address > pre-deployed config.
  // Robinhood own-V2 has no router until create-pool.js deploys it.
  const routerAddr = args.router || chainAddrs.router || cfg.dex.router;
  if (!routerAddr) {
    throw new Error('No router address for this chain yet — deploy the V2 factory+router first (scripts/create-pool.js --chain robinhood) or pass --router 0x....');
  }

  const bps = args.all ? 10000n : fractionToBps(args.fraction);
  const label = args.all ? 'ALL LP' : `${(Number(bps) / 100).toFixed(2)}% of LP`;

  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== cfg.chainId) throw new Error(`RPC chainId mismatch: expected ${cfg.chainId}, got ${net.chainId}.`);
  console.log(`Chain: ${cfg.name} (chainId ${cfg.chainId}) — remove ${label}`);
  console.log(`Token: ${token}`);

  const wallet = loadBurnerWallet(provider);
  console.log(`LP holder (burner, verified): ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Burner native balance: ${ethers.formatEther(balance)}`);
  const gasSym = cfg.gasToken.split(' ')[0];
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;

  // --- Resolve the pair ---
  let pairAddr = args.pair || chainAddrs.pair || null;
  if (!pairAddr) {
    const factoryAddr = chainAddrs.factory || cfg.dex.factory;
    if (!factoryAddr) throw new Error('No factory address to look up the pair — create the pool first.');
    const factory = new ethers.Contract(factoryAddr, V2_FACTORY_ABI, provider);
    pairAddr = await factory.getPair(token, cfg.quoteToken);
  }
  console.log(`Pair: ${pairAddr}`);

  if (pairAddr === ethers.ZeroAddress) {
    // Honest dry-run outcome: nothing to remove yet. Show the plan and
    // the planning gas figure; refuse to broadcast.
    console.log('\nPair does not exist yet (no liquidity added). Nothing to remove.');
    console.log(`Plan once the pool exists: approve LP -> router (EXACT removal amount), then`);
    console.log(`  ${args.chain === 'robinhood' ? 'removeLiquidityETH(STEST, ...)' : 'removeLiquidity(STEST, quote, ...)'} with 5% min-out guard, deadline 20 min, LP stays in burner until then.`);
    console.log(`Planning gas (no live estimate possible pre-deployment): ~${PLANNING_GAS_REMOVE} gas per step (approve + remove).`);
    console.log('Re-run after create-pool.js mines; the script will then estimate live before sending.');
    if (args.broadcast) throw new Error('Refusing --broadcast: pair does not exist yet.');
    return;
  }

  const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);
  const token0 = await pair.token0();
  const token1 = await pair.token1();
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
  console.log(`Expected back (before 5% guard): ${ethers.formatUnits(tokenOut, 18)} STEST + ${args.chain === 'arc' ? ethers.formatUnits(quoteOut, quoteDecimals) : ethers.formatEther(quoteOut)} ${cfg.quoteSymbol}`);
  console.log(`Min-out guard (95%): ${ethers.formatUnits(tokenMin, 18)} STEST + ${args.chain === 'arc' ? ethers.formatUnits(quoteMin, quoteDecimals) : ethers.formatEther(quoteMin)} ${cfg.quoteSymbol}`);

  const router = new ethers.Contract(routerAddr, V2_ROUTER_ABI, provider);
  const steps = [];
  steps.push({
    name: '1. approve LP -> router (EXACT amount)',
    tx: {
      to: pairAddr,
      data: pair.interface.encodeFunctionData('approve', [routerAddr, liquidity]),
    },
    note: `Exact-amount approval only: ${liquidity} LP. Never unlimited.`,
  });
  if (args.chain === 'robinhood') {
    // Pair is STEST/WETH; removeLiquidityETH returns native test ETH.
    steps.push({
      name: '2. removeLiquidityETH(STEST, ...)',
      tx: {
        to: routerAddr,
        data: router.interface.encodeFunctionData('removeLiquidityETH', [
          token, liquidity, tokenMin, quoteMin, wallet.address, deadline,
        ]),
      },
      note: 'Standard V2 removal; ETH side comes back as native test ETH to the burner.',
    });
  } else {
    steps.push({
      name: '2. removeLiquidity(STEST, quote, ...)',
      tx: {
        to: routerAddr,
        data: router.interface.encodeFunctionData('removeLiquidity', [
          token, cfg.quoteToken, liquidity, tokenMin, quoteMin, wallet.address, deadline,
        ]),
      },
      note: 'Standard V2 removal; both sides come back to the burner.',
    });
  }

  console.log('\n--- Steps (built, not sent) ---');
  console.log('STANDING RULE: every step below is gas-estimated BEFORE any send.');
  const estimates = [];
  for (const s of steps) {
    const est = await estimateAndPrint(provider, wallet.address, s.name, s.tx, gasSym);
    estimates.push({ label: s.name, est });
    console.log(`\n[${s.name}]`);
    console.log(`  to: ${s.tx.to}  value: 0`);
    console.log(`  calldata: ${String(s.tx.data).slice(0, 160)}...`);
    console.log(`  note: ${s.note}`);
  }
  await printSummary(provider, estimates, balance, gasSym);

  if (!args.broadcast) {
    console.log('\n*** DRY-RUN ONLY — nothing was broadcast. ***');
    console.log('Run again with --broadcast ONLY after the user approves this step.');
    console.log('Withdrawability check: use --fraction 0.1 (default) right after pool creation,');
    console.log('then --all as the final step of the run, after the loop finishes.');
    return;
  }

  // --- Broadcast path: fresh estimate before EACH send, then verify ---
  const tokenC = new ethers.Contract(token, ERC20_ABI, provider);
  const quoteC = new ethers.Contract(cfg.quoteToken, ERC20_ABI, provider);
  const balBefore = {
    stest: await tokenC.balanceOf(wallet.address).catch(() => 0n),
    quote: args.chain === 'robinhood'
      ? await provider.getBalance(wallet.address)
      : await quoteC.balanceOf(wallet.address).catch(() => 0n),
  };
  console.log('\n*** --broadcast passed: sending steps IN ORDER, waiting for each receipt ***');
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
    quote: args.chain === 'robinhood'
      ? await provider.getBalance(wallet.address)
      : await quoteC.balanceOf(wallet.address).catch(() => 0n),
  };
  // Note: on Robinhood the quote side is native ETH, so balAfter.quote
  // includes gas spent; the check below uses the STEST side plus the
  // receipt's implied amounts, and only requires STEST >= min.
  const stestBack = balAfter.stest - balBefore.stest;
  console.log(`\nWithdrawability check: STEST back ${ethers.formatUnits(stestBack, 18)} (min ${ethers.formatUnits(tokenMin, 18)})`);
  if (stestBack >= tokenMin) {
    console.log('WITHDRAWABILITY CHECK: PASS — underlying tokens returned to the burner.');
  } else {
    console.log('WITHDRAWABILITY CHECK: FAIL — fewer tokens returned than the min-out guard. Investigate before continuing.');
    process.exitCode = 2;
  }
  console.log('Record the remaining LP balance in addresses.json if this was a partial removal.');
}

main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
