// Recompile UniswapV2Router02 from the PATCHED local periphery copy.
//   node scripts/compile-router-patched.js
//
// Why: the factory we deployed on Robinhood testnet was compiled with
// solc 0.5.16 / optimizer 200 runs, so its UniswapV2Pair creation code
// hashes to 0x8b438ce1... — NOT the canonical 0x96e8ac42... that the
// stock periphery library hardcodes in pairFor(). The stock router
// therefore computed a pair address with no code, and addLiquidityETH
// reverted (bare require(false)) when it called mint() on that empty
// address. The patch (contracts/vendor/v2-periphery, INIT_CODE_HASH
// replaced in UniswapV2Library.pairFor) makes the router compute the
// pair address our factory actually creates. This is the standard fix
// every V2 fork applies; it changes NO economics, only the address math.
// The original node_modules source is left untouched.
//
// Settings mirror compile.js Phase C: remote solc 0.6.6, optimizer 200
// runs, evm_version istanbul (pre-Shanghai: no PUSH0 possible).
// Overwrites UniswapV2Router02.json and notes the patch in
// compilation-record.json. TESTNET ONLY.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const solc = require('solc');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = ROOT; // flattened layout: artifacts live at repo root
const OUR_HASH = '8b438ce1178c6a062bf694855f2a859473ff45ae8c4f1217b8e6bcc52eef1819';
const CANON_HASH = '96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f';

function readFile(p) { return fs.readFileSync(p, 'utf8'); }

function findImports(importPath, importingFile) {
  const candidates = [];
  if (importingFile) candidates.push(path.resolve(path.dirname(importingFile), importPath));
  candidates.push(path.resolve(ROOT, 'node_modules', importPath));
  candidates.push(path.resolve(ROOT, importPath));
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return { contents: readFile(c), path: c };
  }
  return { error: `Import not found: ${importPath} (from ${importingFile || '<root>'})` };
}

function collectSources(entryFiles) {
  const sources = {};
  const seen = new Set();
  const queue = [...entryFiles];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    sources[path.relative(ROOT, file)] = { content: readFile(file) };
    const importRe = /import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/g;
    let m;
    while ((m = importRe.exec(readFile(file)))) {
      const resolved = findImports(m[1], file);
      if (resolved.error) throw new Error(resolved.error);
      if (!seen.has(resolved.path)) queue.push(resolved.path);
    }
  }
  return sources;
}

function loadRemote(version) {
  return new Promise((resolve, reject) => {
    solc.loadRemoteVersion(version, (err, compiler) => (err ? reject(err) : resolve(compiler)));
  });
}

async function main() {
  const libPath = path.join(ROOT, 'contracts', 'vendor', 'v2-periphery', 'libraries', 'UniswapV2Library.sol');
  const lib = readFile(libPath);
  if (!lib.includes(OUR_HASH)) throw new Error('Patched hash not found in the vendor library — apply the patch first.');
  if (lib.includes(CANON_HASH)) throw new Error('Canonical hash still present in the vendor library — patch incomplete.');
  console.log('Vendor library carries the patched init-code hash 0x' + OUR_HASH.slice(0, 8) + '...');

  console.log('Loading remote solc 0.6.6 for the patched router...');
  const solc066 = await loadRemote('v0.6.6+commit.6c089d02');
  const routerFile = path.join(ROOT, 'contracts', 'vendor', 'v2-periphery', 'UniswapV2Router02.sol');
  const sources = collectSources([routerFile]);
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      evmVersion: 'istanbul',
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
    },
  };
  const output = JSON.parse(solc066.compile(JSON.stringify(input), {
    import: (importPath, importingFile) => {
      const resolved = findImports(importPath, importingFile);
      return resolved.error ? { error: resolved.error } : { contents: resolved.contents };
    },
  }));
  const errors = (output.errors || []).filter((e) => e.severity === 'error');
  for (const w of (output.errors || []).filter((e) => e.severity === 'warning')) {
    console.log(`warning: ${w.formattedMessage.trim().split('\n')[0]}`);
  }
  if (errors.length) {
    for (const e of errors) console.error(e.formattedMessage);
    throw new Error(`Compilation failed with ${errors.length} error(s).`);
  }
  const compiled = output.contracts[path.relative(ROOT, routerFile)].UniswapV2Router02;
  if (!compiled || !compiled.evm.bytecode.object) throw new Error('No bytecode produced for UniswapV2Router02.');
  const bytecode = '0x' + compiled.evm.bytecode.object;
  const sha = crypto.createHash('sha256').update(bytecode).digest('hex');
  const artifact = {
    contractName: 'UniswapV2Router02',
    sourceName: path.relative(ROOT, routerFile),
    compiler: 'solc 0.6.6 (patched init-code hash)',
    evmVersion: 'istanbul (pre-Shanghai: no PUSH0)',
    optimizer: { enabled: true, runs: 200 },
    patchedInitCodeHash: '0x' + OUR_HASH,
    canonicalInitCodeHash: '0x' + CANON_HASH,
    patchNote: 'UniswapV2Library.pairFor uses our factory pair hash, not the canonical one — see scripts/compile-router-patched.js header.',
    abi: compiled.abi,
    bytecode,
    deployedBytecode: '0x' + compiled.evm.deployedBytecode.object,
    bytecodeSha256: sha,
  };
  fs.writeFileSync(path.join(ARTIFACTS, 'UniswapV2Router02.json'), JSON.stringify(artifact, null, 2));
  console.log(`UniswapV2Router02 (patched): OK — bytecode ${(bytecode.length - 2) / 2} bytes, sha256 ${sha}`);

  // Sanity: the new bytecode must embed OUR hash and NOT the canonical one.
  const hex = bytecode.toLowerCase();
  if (!hex.includes(OUR_HASH)) throw new Error('Patched hash missing from compiled router bytecode — something is wrong.');
  if (hex.includes(CANON_HASH)) throw new Error('Canonical hash still present in compiled router bytecode — patch did not take effect.');
  console.log('Bytecode check passed: patched hash present, canonical hash absent.');

  const recordPath = path.join(ARTIFACTS, 'compilation-record.json');
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  record.contracts.UniswapV2Router02 = { bytecodeSha256: sha, bytecodeBytes: (bytecode.length - 2) / 2, patched: true, patchedInitCodeHash: '0x' + OUR_HASH };
  record.routerPatch = {
    date: new Date().toISOString(),
    reason: 'Deployed RH factory pair hash is 0x8b438ce1..., not canonical 0x96e8ac42...; stock router computed a no-code pair address and addLiquidityETH reverted. Patched UniswapV2Library.pairFor in contracts/vendor/v2-periphery to our hash; original node_modules source untouched.',
    vendorSource: 'contracts/vendor/v2-periphery (copy of @uniswap/v2-periphery, hash patched)',
  };
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
  console.log('compilation-record.json updated with the patch note.');
}

main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
