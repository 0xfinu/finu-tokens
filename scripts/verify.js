// Verify contract source after deployment — DOCUMENTATION + read-only check.
//   node scripts/verify.js --chain arc --address 0x...
//   node scripts/verify.js --chain robinhood --address 0x... --check
// This script NEVER submits a verification (nothing is deployed yet in
// this phase). It prints the exact commands to run after deployment, and
// with --check it does a read-only Blockscout API query to see whether
// an address is already verified.
// No API key is created or used: Blockscout's public verification UI
// needs no key; Sourcify needs no key. (A Blockscout Pro API key is a
// deferred item the user said "Later" to on 2026-11-15.)
'use strict';

const { CHAINS } = require('../chains');

function parseArgs() {
  const args = { chain: 'arc', address: null, check: false };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--chain') args.chain = process.argv[++i];
    else if (a === '--address') args.address = process.argv[++i];
    else if (a === '--check') args.check = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/verify.js --chain arc|robinhood|sepolia --address 0x... [--check]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.address) throw new Error('Pass --address 0x... (the deployed contract address).');
  return args;
}

async function main() {
  const { chain, address, check } = parseArgs();
  const cfg = CHAINS[chain];
  if (!cfg) throw new Error(`Unknown chain "${chain}".`);

  console.log(`Contract: ${address} on ${cfg.name} (chainId ${cfg.chainId})`);
  console.log(`Compiler: solc (see compilation-record.json), evm_version paris, optimizer enabled, 200 runs.`);
  console.log(`Source: contracts/SniperTestToken.sol (+ OpenZeppelin imports — use the flattened/standard-JSON input from the compile step).`);
  console.log('');
  console.log('--- Option A: Blockscout UI (no key, recommended) ---');
  console.log(`1. Open ${cfg.explorer}/address/${address}`);
  console.log('2. Contract tab -> "Verify & Publish" -> choose "Solidity (Single file)" or "Standard JSON Input".');
  console.log('3. Compiler version = the solc version in compilation-record.json; EVM version = paris; optimization = Yes, 200 runs.');
  console.log('4. Paste the source (single-file: contracts/SniperTestToken.sol with its OpenZeppelin imports resolved — or use the Standard JSON Input from the compile step).');
  console.log('5. Constructor arguments: none (the constructor takes no args; 1,000,000 STEST is minted to the deployer inside it).');
  console.log('');
  console.log('--- Option B: Sourcify (no key; Blockscout imports Sourcify matches) ---');
  console.log(`1. Open https://sourcify.dev and verify on chain ${cfg.chainId} with the same compiler settings (paris, optimizer 200).`);
  console.log('2. Or submit the standard-JSON metadata via:');
  console.log(`   curl -X POST https://sourcify.dev/server/verify -H 'Content-Type: application/json' -d @SniperTestToken-sourcify.json`);
  console.log('   (Generate that JSON from the compile step before running this; it does not exist yet.)');
  console.log('');
  console.log('--- Option C: Blockscout API (needs a free API key — DEFERRED, user said "Later" 2026-11-15) ---');
  console.log(`   curl -X POST "${cfg.explorerApi}/smart-contracts/verification" ... (see Blockscout docs; do not run until the key decision is made)`);
  console.log('');

  if (check) {
    const url = `${cfg.explorerApi}/v2/smart-contracts/${address}`;
    console.log(`Read-only check: GET ${url}`);
    const res = await fetch(url);
    if (res.status === 404) { console.log('Result: NOT verified yet (404).'); return; }
    const data = await res.json();
    console.log(`Result: verified=${!!data.is_verified}, name=${data.name || 'n/a'}, compiler=${data.compiler_version || 'n/a'}, evm=${data.evm_version || 'n/a'}, optimization=${data.optimization_enabled ?? 'n/a'}`);
  } else {
    console.log('(Add --check to do a read-only Blockscout lookup for this address.)');
  }
}

main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
