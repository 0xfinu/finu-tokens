// Finish the Robinhood STEST pool with the PATCHED router.
//   node scripts/finish-rh-pool.js              (dry-run)
//   node scripts/finish-rh-pool.js --broadcast  (only with the user's
//                                                go-ahead for this step)
//
// Context: the stock router's pairFor() used the canonical init-code
// hash (0x96e8ac42...) while our deployed factory's pair code hashes
// to 0x8b438ce1..., so addLiquidityETH reverted on a no-code pair
// address. The factory (0x4D92...) and the STEST approval to the old
// router (0xa946...) are already onchain and harmless; this script
// deploys the patched router (UniswapV2Router02.json —
// compiled by scripts/compile-router-patched.js), approves it for
// exactly 10,000 STEST, and adds the liquidity (10,000 STEST +
// 0.001 test ETH). It refuses to run unless the loaded router artifact
// is the patched build. Then it records factory/router/pair in
// addresses.json and verifies the burner holds LP tokens.
//
// TESTNET ONLY (Robinhood Chain testnet 46630). Burner EVM ONLY.
'use strict';

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { CHAINS, BURNER_ADDRESS } = require('../chains');
const { loadBurnerWallet } = require('./wallet');
const { estimateTx, printSummary } = require('./gas');

const OUR_HASH = '8b438ce1178c6a062bf694855f2a859473ff45ae8c4f1217b8e6bcc52eef1819';
const CANON_HASH = '96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f';
const FACTORY = '0x4D92b6F9F5C853f40e9bceded343533e74C118F1';
const OLD_ROUTER = '0xa9467E7eA8EcEA7448d5a0beacc9f4144b84379D';

const V2_FACTORY_ABI = ['function getPair(address,address) view returns (address)'];
const V2_ROUTER_ABI = [
  'function factory() view returns (address)',
  'function WETH() view returns (address)',
  'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)',
];
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
];
const PAIR_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
];

function parseArgs() {
  const args = { broadcast: false };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--broadcast') args.broadcast = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/finish-rh-pool.js [--broadcast]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

async function main() {
  const { broadcast } = parseArgs();
  const cfg = CHAINS.robinhood;
  const addrs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'addresses.json'), 'utf8'));
  const token = addrs.robinhood && addrs.robinhood.token;
  if (!token) throw new Error('No STEST token recorded for robinhood — deploy first.');

  // Safety: refuse unless the router artifact is the PATCHED build.
  const routerArt = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'UniswapV2Router02.json'), 'utf8'));
  const hex = routerArt.bytecode.toLowerCase();
  if (!hex.includes(OUR_HASH)) throw new Error('Router artifact is NOT the patched build — run scripts/compile-router-patched.js first.');
  if (hex.includes(CANON_HASH)) throw new Error('Router artifact still contains the canonical hash — patch did not take effect.');
  console.log('Router artifact verified: patched build (our init-code hash, no canonical hash).');

  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== cfg.chainId) throw new Error(`RPC chainId mismatch: expected ${cfg.chainId}, got ${net.chainId}.`);
  const wallet = loadBurnerWallet(provider);
  console.log(`Chain: ${cfg.name} (${cfg.chainId}) — burner ${wallet.address} (verified ${wallet.address === BURNER_ADDRESS})`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Burner native balance: ${ethers.formatEther(balance)} ETH`);
  const tokenC = new ethers.Contract(token, ERC20_ABI, provider);
  console.log(`Burner STEST balance: ${ethers.formatUnits(await tokenC.balanceOf(wallet.address), 18)}`);

  const factory = new ethers.Contract(FACTORY, V2_FACTORY_ABI, provider);
  console.log(`Factory ${FACTORY} — existing pair: ${await factory.getPair(token, cfg.quoteToken)}`);
  console.log(`Old (broken) router ${OLD_ROUTER} stays unused; its exact-amount STEST approval is harmless.`);

  const nonce = await provider.getTransactionCount(wallet.address);
  const routerFactory = new ethers.ContractFactory(routerArt.abi, routerArt.bytecode, wallet);
  const routerTx = await routerFactory.getDeployTransaction(FACTORY, cfg.quoteToken);
  const predictedRouter = ethers.getCreateAddress({ from: wallet.address, nonce });
  console.log(`Predicted patched router: ${predictedRouter} (nonce ${nonce})`);

  const tokenAmount = ethers.parseUnits('10000', 18);
  const quoteAmount = ethers.parseEther('0.001');
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
  const routerIface = new ethers.Interface(V2_ROUTER_ABI);
  const steps = [
    { name: '1. deploy patched UniswapV2Router02 (factory, WETH)', tx: { ...routerTx }, note: 'Router with our init-code hash; pairFor now matches our factory.' },
    { name: '2. approve STEST -> patched router (EXACT amount)', tx: { to: token, data: tokenC.interface.encodeFunctionData('approve', [predictedRouter, tokenAmount]) }, note: 'Exact-amount approval only: 10000.0 STEST. Never unlimited.' },
    { name: '3. addLiquidityETH(STEST, ETH)', tx: { to: predictedRouter, value: quoteAmount, data: routerIface.encodeFunctionData('addLiquidityETH', [token, tokenAmount, (tokenAmount * 95n) / 100n, (quoteAmount * 95n) / 100n, wallet.address, deadline]) }, note: 'Sends 0.001 test ETH; pair is created inside this call. 5% min-amount guard.' },
  ];

  console.log('\n--- Steps (built, not sent) ---');
  const estimates = [];
  for (const s of steps) {
    const est = await estimateTx(provider, wallet.address, s.tx, 'ETH');
    estimates.push({ label: s.name, est });
    console.log(`\n[${s.name}]`);
    console.log(`  to: ${s.tx.to || '(contract creation)'}  value: ${s.tx.value ? ethers.formatEther(s.tx.value) : '0'}`);
    console.log(`  note: ${s.note}`);
    if (!est.ok) console.log(`  gas estimate: UNAVAILABLE (${est.error}) — re-estimate live before sending.`);
    else console.log(`  [gas] ${s.name}: ${est.gas} gas @ ${est.gasPrice} wei = ${est.costFormatted}`);
  }
  await printSummary(provider, estimates, balance, 'ETH');

  if (!broadcast) {
    console.log('\n*** DRY-RUN ONLY — nothing was broadcast. ***');
    console.log('Run again with --broadcast ONLY after the user approves this step.');
    return;
  }
  console.log('\n*** --broadcast passed: sending steps IN ORDER, waiting for each receipt ***');
  const txHashes = {};
  for (const s of steps) {
    const fresh = await estimateTx(provider, wallet.address, s.tx, 'ETH');
    if (!fresh.ok) throw new Error(`No gas estimate for "${s.name}" — refusing to send without a calculated gas cost: ${fresh.error}`);
    console.log(`Sending: ${s.name} — gas ${fresh.gas} @ ${fresh.gasPrice} wei = ${fresh.costFormatted}`);
    const tx = await wallet.sendTransaction({ ...s.tx, gasLimit: (fresh.gas * 120n) / 100n });
    console.log(`  tx: ${tx.hash} — ${cfg.explorer}/tx/${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  mined block ${receipt.blockNumber}, gas used ${receipt.gasUsed}`);
    txHashes[s.name] = { hash: tx.hash, block: Number(receipt.blockNumber), gasUsed: receipt.gasUsed.toString() };
  }

  // Verify the pool: pair address, LP balance, reserves.
  const pairAddr = await factory.getPair(token, cfg.quoteToken);
  console.log(`\nPair: ${pairAddr}`);
  if (pairAddr === ethers.ZeroAddress) throw new Error('No pair after addLiquidity — something went wrong.');
  const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);
  const lpBal = await pair.balanceOf(wallet.address);
  const lpTotal = await pair.totalSupply();
  const [r0, r1] = await pair.getReserves();
  console.log(`Burner LP balance: ${ethers.formatUnits(lpBal, 18)} (total LP supply ${ethers.formatUnits(lpTotal, 18)})`);
  console.log(`Reserves: token0 ${ethers.formatUnits(r0, 18)} / token1 ${ethers.formatUnits(r1, 18)} — token0 ${await pair.token0()}, token1 ${await pair.token1()}`);
  if (lpBal === 0n) throw new Error('Burner holds 0 LP tokens — liquidity did not land.');

  addrs.robinhood = addrs.robinhood || {};
  addrs.robinhood.factory = FACTORY;
  addrs.robinhood.router = predictedRouter;
  addrs.robinhood.routerPatched = true;
  addrs.robinhood.routerOldBroken = OLD_ROUTER;
  addrs.robinhood.pair = pairAddr;
  addrs.robinhood.pairTxHash = txHashes['3. addLiquidityETH(STEST, ETH)'].hash;
  addrs.robinhood.routerTxHash = txHashes['1. deploy patched UniswapV2Router02 (factory, WETH)'].hash;
  addrs.robinhood.poolCreatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, '..', 'addresses.json'), JSON.stringify(addrs, null, 2));
  console.log('Recorded factory/router/pair in addresses.json');
  console.log('POOL LIVE on Robinhood testnet. Next: test-remove 10% LP (scripts/remove-liquidity.js) before any run.');
}

main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
