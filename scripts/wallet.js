// Shared burner-wallet loader for the 0xmuse ERC-20 launch kit.
// Loads key material ONLY at runtime from the burner backup file (or the
// BURNER_PRIVATE_KEY / BURNER_MNEMONIC env vars). Never writes, prints,
// or embeds any secret. The only thing ever printed is the derived
// PUBLIC address, which must match the burner address before anything
// else happens.
//
// Wallet rule: burner EVM 0xBb87bD789Ca67562F531685e10EB78eC03dE3dEB ONLY.
// NOT Privy (archived, never use). NOT the Circle agent wallet.
'use strict';

const fs = require('fs');
const { ethers } = require('ethers');
const { BURNER_ADDRESS, BURNER_BACKUP_FILE } = require('../chains');

function loadBurnerWallet(provider) {
  let privateKey = process.env.BURNER_PRIVATE_KEY || null;
  let mnemonic = process.env.BURNER_MNEMONIC || null;

  if (!privateKey && !mnemonic) {
    const backupPath = process.env.BURNER_BACKUP_FILE || BURNER_BACKUP_FILE;
    let backup;
    try {
      backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    } catch (e) {
      throw new Error(`Cannot read burner backup file (${backupPath}): ${e.message}`);
    }
    if (backup.privateKeys && backup.privateKeys.evm) {
      privateKey = backup.privateKeys.evm;
    } else if (backup.mnemonic) {
      mnemonic = backup.mnemonic;
    } else {
      throw new Error('Burner backup file has neither privateKeys.evm nor mnemonic.');
    }
  }

  let wallet;
  if (privateKey) {
    wallet = new ethers.Wallet(privateKey.startsWith('0x') ? privateKey : '0x' + privateKey, provider);
  } else {
    // Standard EVM derivation path m/44'/60'/0'/0/0.
    wallet = ethers.Wallet.fromPhrase(mnemonic, provider);
  }

  if (wallet.address.toLowerCase() !== BURNER_ADDRESS.toLowerCase()) {
    throw new Error(
      `Derived address ${wallet.address} does NOT match the burner address ${BURNER_ADDRESS}. Refusing to continue.`
    );
  }
  return wallet;
}

module.exports = { loadBurnerWallet, BURNER_ADDRESS };
