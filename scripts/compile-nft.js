#!/usr/bin/env node
// Compile contracts/ZeroXMuseNFT.sol with solc-js.
// Arc testnet quirk: evm_version "paris" — PUSH0 (Shanghai+) is rejected on Arc.
// Optimizer: 200 runs. Output: ZeroXMuseNFT.json (abi + bytecode, repo root).
"use strict";

const fs = require("fs");
const path = require("path");
const solc = require("solc");

const ROOT = path.resolve(__dirname, "..");
const CONTRACT_PATH = path.join(ROOT, "contracts", "ZeroXMuseNFT.sol");
const ARTIFACTS_DIR = ROOT; // flattened layout: artifact lives at repo root
const ARTIFACT_PATH = path.join(ARTIFACTS_DIR, "ZeroXMuseNFT.json");

function findImports(importPath) {
  // Resolve OpenZeppelin imports from node_modules.
  const candidates = [
    path.join(ROOT, "node_modules", importPath),
    path.join(ROOT, importPath),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return { contents: fs.readFileSync(c, "utf8") };
    }
  }
  return { error: `Import not found: ${importPath}` };
}

const source = fs.readFileSync(CONTRACT_PATH, "utf8");

const input = {
  language: "Solidity",
  sources: { "ZeroXMuseNFT.sol": { content: source } },
  settings: {
    evmVersion: "paris",
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

const errors = (output.errors || []).filter((e) => e.severity === "error");
const warnings = (output.errors || []).filter((e) => e.severity === "warning");
for (const w of warnings) console.log("warning:", w.formattedMessage);
if (errors.length > 0) {
  for (const e of errors) console.error("error:", e.formattedMessage);
  process.exit(1);
}

const contract = output.contracts["ZeroXMuseNFT.sol"]["ZeroXMuseNFT"];
if (!contract || !contract.evm.bytecode.object) {
  console.error("compile produced no bytecode");
  process.exit(1);
}

fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
const artifact = {
  contractName: "ZeroXMuseNFT",
  sourceName: "contracts/ZeroXMuseNFT.sol",
  compiler: `solc ${solc.version()}`,
  evmVersion: "paris",
  optimizer: { enabled: true, runs: 200 },
  abi: contract.abi,
  bytecode: "0x" + contract.evm.bytecode.object,
  deployedBytecode: "0x" + contract.evm.deployedBytecode.object,
};
fs.writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2) + "\n");

console.log("compiled OK");
console.log("  compiler:", artifact.compiler);
console.log("  evmVersion: paris, optimizer runs: 200");
console.log("  bytecode bytes:", contract.evm.bytecode.object.length / 2);
console.log("  deployed bytes:", contract.evm.deployedBytecode.object.length / 2);
console.log("  abi entries:", contract.abi.length);
console.log("  artifact:", ARTIFACT_PATH);
