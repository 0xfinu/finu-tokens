// Compile the launch-kit contracts with solc-js.
//   node scripts/compile.js
// Targets:
//   - SniperTestToken (OpenZeppelin ERC20 v5, Ownable) — bundled solc 0.8.x
//   - UniswapV2Factory + UniswapV2Pair (canonical v2-core, pragma =0.5.16)
//     — remote solc 0.5.16, for the Robinhood-testnet "deploy our own V2" path
//   - UniswapV2Router02 (canonical v2-periphery, pragma =0.6.6)
//     — remote solc 0.6.6
// Settings: optimizer enabled, 200 runs. evm_version "paris" for the token
// (Arc rejects PUSH0). The V2 contracts predate Shanghai, so they are
// compiled with "istanbul" (0.5.16) / "istanbul" (0.6.6) — compilers
// that cannot emit PUSH0 at all, which is equally safe on Arc.
// Writes *.json (ABI + bytecode, flat at repo root) and prints a sha256 of each
// bytecode for the record.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const solc = require('solc');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = ROOT; // flattened layout: artifacts live at repo root

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

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
    const contents = readFile(file);
    sources[path.relative(ROOT, file)] = { content: contents };
    const importRe = /import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/g;
    let m;
    while ((m = importRe.exec(contents))) {
      const resolved = findImports(m[1], file);
      if (resolved.error) throw new Error(resolved.error);
      if (!seen.has(resolved.path)) queue.push(resolved.path);
    }
  }
  return sources;
}

function compileWith(compiler, entryFiles, evmVersion) {
  const sources = collectSources(entryFiles);
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      evmVersion,
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
    },
  };
  const output = JSON.parse(
    compiler.compile(JSON.stringify(input), {
      import: (importPath, importingFile) => {
        const resolved = findImports(importPath, importingFile);
        return resolved.error ? { error: resolved.error } : { contents: resolved.contents };
      },
    })
  );
  const errors = (output.errors || []).filter((e) => e.severity === 'error');
  for (const w of (output.errors || []).filter((e) => e.severity === 'warning')) {
    console.log(`warning: ${w.formattedMessage.trim().split('\n')[0]}`);
  }
  if (errors.length) {
    for (const e of errors) console.error(e.formattedMessage);
    throw new Error(`Compilation failed with ${errors.length} error(s).`);
  }
  return output;
}

function saveArtifact(name, sourceRel, output, compilerLabel, evmVersion) {
  const compiled = output.contracts[sourceRel][name];
  if (!compiled || !compiled.evm.bytecode.object) throw new Error(`No bytecode produced for ${name} (${sourceRel}).`);
  const bytecode = '0x' + compiled.evm.bytecode.object;
  const sha = crypto.createHash('sha256').update(bytecode).digest('hex');
  const artifact = {
    contractName: name,
    sourceName: sourceRel,
    compiler: compilerLabel,
    evmVersion,
    optimizer: { enabled: true, runs: 200 },
    abi: compiled.abi,
    bytecode,
    deployedBytecode: '0x' + compiled.evm.deployedBytecode.object,
    bytecodeSha256: sha,
  };
  fs.writeFileSync(path.join(ARTIFACTS, `${name}.json`), JSON.stringify(artifact, null, 2));
  console.log(`${name}: OK — bytecode ${(bytecode.length - 2) / 2} bytes, sha256 ${sha}`);
  return { bytecodeSha256: sha, bytecodeBytes: (bytecode.length - 2) / 2 };
}

function loadRemote(version) {
  return new Promise((resolve, reject) => {
    solc.loadRemoteVersion(version, (err, compiler) => (err ? reject(err) : resolve(compiler)));
  });
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const record = { evmVersionToken: 'paris', optimizer: { enabled: true, runs: 200 }, contracts: {} };

  // Phase A — token, bundled solc 0.8.x, evm_version paris.
  const tokenFile = path.join(ROOT, 'contracts', 'SniperTestToken.sol');
  const outA = compileWith(solc, [tokenFile], 'paris');
  record.compilerToken = `solc ${solc.version()}`;
  record.contracts.SniperTestToken = saveArtifact(
    'SniperTestToken', path.relative(ROOT, tokenFile), outA, record.compilerToken, 'paris'
  );

  // Phase B — canonical V2 core (0.5.16), remote solc 0.5.16, istanbul.
  console.log('\nLoading remote solc 0.5.16 for Uniswap V2 core...');
  const solc0517 = await loadRemote('v0.5.16+commit.9c3226ce');
  const coreFiles = [
    path.join(ROOT, 'node_modules', '@uniswap', 'v2-core', 'contracts', 'UniswapV2Factory.sol'),
    path.join(ROOT, 'node_modules', '@uniswap', 'v2-core', 'contracts', 'UniswapV2Pair.sol'),
  ];
  const outB = compileWith(solc0517, coreFiles, 'istanbul');
  for (const f of coreFiles) {
    const name = path.basename(f, '.sol');
    record.contracts[name] = saveArtifact(name, path.relative(ROOT, f), outB, 'solc 0.5.16', 'istanbul (pre-Shanghai: no PUSH0)');
  }

  // Phase C — canonical V2 router (0.6.6), remote solc 0.6.6, istanbul.
  console.log('\nLoading remote solc 0.6.6 for Uniswap V2 router...');
  const solc0612 = await loadRemote('v0.6.6+commit.6c089d02');
  const routerFile = path.join(ROOT, 'node_modules', '@uniswap', 'v2-periphery', 'contracts', 'UniswapV2Router02.sol');
  const outC = compileWith(solc0612, [routerFile], 'istanbul');
  record.contracts.UniswapV2Router02 = saveArtifact(
    'UniswapV2Router02', path.relative(ROOT, routerFile), outC, 'solc 0.6.6', 'istanbul (pre-Shanghai: no PUSH0)'
  );

  fs.writeFileSync(path.join(ARTIFACTS, 'compilation-record.json'), JSON.stringify(record, null, 2));
  console.log('\nCompilation succeeded. Token: evm_version=paris. V2: pre-Shanghai compilers (no PUSH0 possible). Optimizer=200 runs.');
  console.log(`Artifacts in ${ARTIFACTS}/`);
}

main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
