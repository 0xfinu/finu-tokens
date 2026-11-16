// Deploy SniperTestToken — DRY-RUN BY DEFAULT.
//   node scripts/deploy.js --chain arc            (dry-run, Arc testnet)
//   node scripts/deploy.js --chain robinhood       (dry-run, Robinhood testnet)
//   node scripts/deploy.js --chain arc --broadcast (BROADCAST — only with
//                                                    the user's explicit
//                                                    go-ahead for this step)
// TESTNET ONLY. The --broadcast path exists for later use only.
// Wallet: burner EVM ONLY (0xBb87bD789Ca67562F531685e10EB78eC03dE3dEB),
// key loaded at runtime from ~/workspace/burners/burner-single-mnemonic-backup.json.
// NOT Privy (archived, never use). NOT the Circle agent wallet.
'use strict';

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { CHAINS, BURNER_ADDRESS } = require('../chains');
const { loadBurnerWallet } = require('./wallet');
const { estimateAndPrint, printSummary } = require('./gas');

function parseArgs() {
  const args = { chain: 'arc', broadcast: false };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--chain') args.chain = process.argv[++i];
    else if (a === '--broadcast') args.broadcast = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/deploy.js [--chain arc|robinhood|sepolia] [--broadcast]');
      console.log('Default is DRY-RUN (no broadcast). --broadcast only with user go-ahead.');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

async function main() {
  const { chain, broadcast } = parseArgs();
  const cfg = CHAINS[chain];
  if (!cfg) throw new Error(`Unknown chain "${chain}". Use arc, robinhood, or sepolia.`);
  if (cfg.chainId === 1 || cfg.chainId === 8453 || cfg.chainId === 5042 || cfg.chainId === 4663) {
    throw new Error('Mainnet chain refused. Testnets only.');
  }

  const artifact = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'SniperTestToken.json'), 'utf8'));
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== cfg.chainId) {
    throw new Error(`RPC chainId mismatch: expected ${cfg.chainId} (${cfg.name}), got ${net.chainId}. Refusing.`);
  }
  console.log(`Chain: ${cfg.name} (chainId ${cfg.chainId}) — RPC ${cfg.rpcUrl}`);
  console.log(`Explorer: ${cfg.explorer} — gas token: ${cfg.gasToken}`);

  const wallet = loadBurnerWallet(provider);
  console.log(`Deployer (burner, verified): ${wallet.address}`);
  console.log(`Expected burner address:      ${BURNER_ADDRESS}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Burner balance: ${ethers.formatEther(balance)} ${cfg.gasToken.split(' ')[0]} (native units)`);
  const nonce = await provider.getTransactionCount(wallet.address);
  console.log(`Nonce: ${nonce}`);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const deployTx = await factory.getDeployTransaction();
  console.log('\n--- Deployment transaction (built, not sent) ---');
  console.log(`to: (contract creation)  value: 0  data length: ${(deployTx.data.length - 2) / 2} bytes`);
  console.log(`calldata (first 200 chars): ${deployTx.data.slice(0, 200)}...`);

  // STANDING RULE: estimate gas BEFORE sending. Read-only eth_estimateGas.
  const gasSym = cfg.gasToken.split(' ')[0];
  const est = await estimateAndPrint(provider, wallet.address, 'deploy SniperTestToken', deployTx, gasSym);
  const gasEstimate = est.ok ? est.gas : 0n;
  const gasPrice = est.ok ? est.gasPrice : 0n;
  const costWei = est.ok ? est.costWei : 0n;
  if (est.ok) {
    console.log(`Estimated gas: ${gasEstimate}`);
    console.log(`Gas price: ${gasPrice} wei (${ethers.formatUnits(gasPrice, 'gwei')} gwei)`);
    console.log(`Estimated cost: ${ethers.formatEther(costWei)} ${gasSym} (~${costWei} wei)`);
    if (costWei > balance) console.log('WARNING: estimated cost exceeds burner balance — top up via faucet first.');
    await printSummary(provider, [{ label: 'deploy', est }], balance, gasSym);
  }

  // Predicted contract address (CREATE, nonce-based).
  const predicted = ethers.getCreateAddress({ from: wallet.address, nonce });
  console.log(`Predicted token address (CREATE): ${predicted}`);

  if (!broadcast) {
    console.log('\n*** DRY-RUN ONLY — nothing was broadcast. ***');
    console.log('To deploy for real, re-run with --broadcast AFTER the user approves this step.');
    console.log(`Then record the address in addresses.json and verify with: node scripts/verify.js --chain ${chain} --address ${predicted}`);
    return;
  }

  console.log('\n*** --broadcast passed: sending the deployment transaction ***');
  if (!est.ok) throw new Error('No gas estimate available — refusing to send without a calculated gas cost.');
  const tx = await wallet.sendTransaction({ ...deployTx, gasLimit: (gasEstimate * 120n) / 100n });
  console.log(`tx hash: ${tx.hash}`);
  console.log(`Explorer: ${cfg.explorer}/tx/${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Mined in block ${receipt.blockNumber}, contract: ${receipt.contractAddress}, gas used: ${receipt.gasUsed}`);
  const addrs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'addresses.json'), 'utf8'));
  addrs[chain] = addrs[chain] || {};
  addrs[chain].token = receipt.contractAddress;
  addrs[chain].tokenTxHash = tx.hash;
  addrs[chain].tokenDeployedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, '..', 'addresses.json'), JSON.stringify(addrs, null, 2));
  console.log('Recorded in addresses.json');
}

main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
