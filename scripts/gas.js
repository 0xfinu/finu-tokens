// Shared gas-estimation helper — STANDING RULE: always calculate gas
// costs BEFORE any onchain action. Every script in this kit estimates
// first, shows the cost, and only then sends (and only with --broadcast
// + the user's per-step go-ahead).
//
// What it prints per transaction: gas units, gas price, cost in the
// chain's native (test) token. No USD equivalent is shown — these are
// test tokens with no market price; the cost is stated in test USDC
// (Arc) or test ETH (Robinhood) only.
'use strict';

const { ethers } = require('ethers');

/**
 * Estimate one transaction (read-only eth_estimateGas — no broadcast).
 * Returns { ok, gas, gasPrice, costWei, costFormatted } or { ok:false, error }.
 */
async function estimateTx(provider, walletAddress, tx, gasTokenSymbol) {
  try {
    const gas = await provider.estimateGas({ ...tx, from: walletAddress });
    const fee = await provider.getFeeData();
    const gasPrice = fee.gasPrice ?? fee.maxFeePerGas ?? 0n;
    const costWei = gas * gasPrice;
    return {
      ok: true,
      gas,
      gasPrice,
      costWei,
      costFormatted: `${ethers.formatEther(costWei)} ${gasTokenSymbol}`,
    };
  } catch (e) {
    return { ok: false, error: String(e.message).split('\n')[0] };
  }
}

/** Print one estimate line and return it. */
async function estimateAndPrint(provider, walletAddress, label, tx, gasTokenSymbol) {
  const est = await estimateTx(provider, walletAddress, tx, gasTokenSymbol);
  if (est.ok) {
    console.log(`  [gas] ${label}: ${est.gas} gas @ ${est.gasPrice} wei (${ethers.formatUnits(est.gasPrice, 'gwei')} gwei) = ${est.costFormatted}`);
  } else {
    console.log(`  [gas] ${label}: ESTIMATE UNAVAILABLE — ${est.error}`);
    console.log('        (Expected in dry-run when a prior step has not mined yet. Re-estimate live before sending.)');
  }
  return est;
}

/**
 * Print a cost summary for a list of estimates against a balance.
 * estimates: [{label, est}] where est is an estimateTx result.
 */
async function printSummary(provider, estimates, balanceWei, gasTokenSymbol) {
  let totalGas = 0n;
  let totalCost = 0n;
  let missing = 0;
  for (const { est } of estimates) {
    if (est && est.ok) { totalGas += est.gas; totalCost += est.costWei; }
    else missing++;
  }
  console.log('\n--- Gas summary (all estimates are pre-send) ---');
  console.log(`Total gas (estimated steps): ${totalGas}`);
  console.log(`Total cost (estimated steps): ${ethers.formatEther(totalCost)} ${gasTokenSymbol}`);
  if (missing) console.log(`Steps without an estimate: ${missing} (re-estimate live before sending)`);
  console.log(`Burner balance: ${ethers.formatEther(balanceWei)} ${gasTokenSymbol}`);
  if (totalCost > balanceWei) {
    console.log(`SHORTFALL: estimated cost exceeds balance by ${ethers.formatEther(totalCost - balanceWei)} ${gasTokenSymbol} — refill via faucet before running.`);
  } else {
    console.log(`Fits balance: ${ethers.formatEther(balanceWei - totalCost)} ${gasTokenSymbol} would remain after the estimated steps.`);
  }
  return { totalGas, totalCost };
}

module.exports = { estimateTx, estimateAndPrint, printSummary };
