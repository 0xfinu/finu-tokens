// Per-chain config for the 0xmuse ERC-20 launch kit — TESTNETS ONLY.
// Every address below was verified live on-chain (eth_getCode / eth_call)
// on 2026-11-15, or is flagged UNVERIFIED. Never copy a mainnet address
// onto a testnet: on Robinhood testnet the canonical mainnet Uniswap
// addresses return NO_CODE; on Arc testnet the official Uniswap mainnet
// (5042) addresses also return NO_CODE.
//
// Wallet rule (user decision 2026-11-15): ONLY the burner EVM wallet
// 0xBb87bD789Ca67562F531685e10EB78eC03dE3dEB signs anything in this kit,
// on both chains. NOT Privy — the Privy agent wallet (ETH
// 0x3c0BC553136fD79aE12A6401a18f0B892a0C4AdD, SOL
// GEkC94UGzMDYJqLMzurmBmqt5A5TnNjKEtWWcMLLKTcE) is ARCHIVED and must
// NEVER be used for this build: no transactions, no signing, no funding.
// The Circle agent wallet stays Arc-USDC-claims-only.
'use strict';

const CHAINS = {
  arc: {
    name: 'Arc Testnet',
    chainId: 5042002,
    rpcUrl: 'https://rpc.testnet.arc.io',
    wsUrl: 'wss://rpc.testnet.arc.io',
    explorer: 'https://explorer.testnet.arc.io',
    explorerApi: 'https://explorer.testnet.arc.io/api',
    gasToken: 'USDC (test, native gas, 18 decimals as native balance)',
    faucet: 'https://faucet.circle.com',
    // Native USDC ERC-20 view (dual interface: 18-dec native, 6-dec ERC-20).
    // Verified live 2026-11-15: decimals() = 6, symbol() = "USDC".
    quoteToken: '0x3600000000000000000000000000000000000000',
    quoteSymbol: 'USDC',
    quoteDecimals: 6,
    // evm_version MUST be "paris": Arc rejects PUSH0 (Shanghai opcode).
    evmVersion: 'paris',
    dex: {
      // Uniswap V2-style deployment live on Arc testnet (third-party, NOT
      // the official Uniswap deployment — official Uniswap is mainnet 5042
      // only; its addresses have NO code on testnet). Source: MINEPAD docs
      // (actfun/docs replit.md); verified live 2026-11-15:
      // factory feeTo() = 0x0, allPairsLength() = 46 pairs.
      kind: 'uniswap-v2',
      factory: '0xB56B00C38EF85633A789644415A16b4C8ea12EF8',
      router: '0x54599C3e0bcb99ca37b286242b5eC5D331AB9D18',
      note: 'V2 pair = STEST / test-USDC (ERC-20 view 0x3600...0000). No WETH9 on Arc — never use WETH paths here.',
    },
    dexAlt: {
      // Synthra V3 fork, also live on Arc testnet (verified: factory
      // owner() returns an address, router has code). V3 path is a
      // fallback; V2 is the primary because pair creation + addLiquidity
      // is a single router call.
      kind: 'synthra-v3',
      factory: '0x0fB6EEDA6e90E90797083861A75D15752a27f59c',
      router: '0xA545bCB1Bd7985c59ea162aB1748A0803434C31b',
    },
  },

  robinhood: {
    name: 'Robinhood Chain Testnet',
    chainId: 46630,
    rpcUrl: 'https://rpc.testnet.chain.robinhood.com',
    explorer: 'https://explorer.testnet.chain.robinhood.com',
    explorerApi: 'https://explorer.testnet.chain.robinhood.com/api',
    gasToken: 'ETH (test, native gas)',
    faucet: 'https://faucet.testnet.chain.robinhood.com',
    // WETH on Robinhood testnet (verified live 2026-11-15: has code).
    // There is NO canonical Uniswap V2 on this testnet: the mainnet
    // V2/V3 addresses (0x8bce..., 0x89e5..., 0x1f7d...) return NO_CODE.
    quoteToken: '0x33e4191705c386532ba27cBF171Db86919200B94',
    quoteSymbol: 'WETH',
    quoteDecimals: 18,
    evmVersion: 'paris',
    dex: {
      // PRIMARY for Robinhood testnet: deploy our OWN canonical Uniswap V2
      // factory + router (sources in node_modules via @uniswap/v2-core and
      // @uniswap/v2-periphery, compiled here with evm_version paris).
      // No usable pre-deployed V2 exists on this testnet, and the V3
      // alternative (Synthra) has no verified NonfungiblePositionManager
      // address for adding liquidity, so own-V2 is the honest path.
      kind: 'own-uniswap-v2',
      factory: null, // filled in after the factory deploy (see LP-RUN-PLAN.md)
      router: null,
      note: 'Deploy factory, then router(factory, WETH). Pair = STEST / WETH. Burner gas budget is the constraint: 0.01 test ETH total.',
    },
    dexAlt: {
      // Synthra V3 fork, live on Robinhood testnet (verified 2026-11-15:
      // factory + router + QuoterV2 have code; WETH/NFLX pool
      // 0x9640afcbc2310d011b7b71a76975e919d9b6fa4a exists and has code).
      // Pool creation (createPool + initialize) is possible; adding
      // liquidity needs a NonfungiblePositionManager address that is NOT
      // verified — create-pool.js refuses to guess it (open item).
      kind: 'synthra-v3',
      factory: '0x911b4000d3422f482f4062a913885f7b035382df',
      router: '0x3Ce954107b1A675826B33bF23060Dd655e3758fE',
      swapRouter02: '0x05FaE28A5917DA56D464fcfC13Ee9141B4FC057c',
      quoterV2: '0xd9613Dd50dD035FB630181811dD65191791BeFB6',
      positionManager: null, // UNVERIFIED — do not guess
    },
    v4PoolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951', // canonical, has code on testnet
  },

  sepolia: {
    name: 'Sepolia (fallback / portability check only)',
    chainId: 11155111,
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    explorer: 'https://sepolia.etherscan.io',
    gasToken: 'ETH (test, native gas)',
    faucet: 'https://sepoliafaucet.com / https://faucet.quicknode.com/ethereum/sepolia',
    quoteToken: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f0', // Sepolia WETH9
    quoteSymbol: 'WETH',
    quoteDecimals: 18,
    evmVersion: 'paris',
    dex: {
      kind: 'uniswap-v2',
      factory: '0xF62c03E08ada871A0bEb309762E260a7a6a880E6',
      router: '0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3',
      // Verified live 2026-11-15 via eth_getCode on the publicnode
      // endpoint: factory 13,859 bytes, router 17,944 bytes. The MAINNET
      // addresses (factory 0x5C69..., router 0x7a25...) have NO code on
      // Sepolia — never use them here. (This corrects the earlier
      // 'eth_getCode anomaly' note: the endpoint was fine, the addresses
      // were wrong.)
      note: 'Sepolia V2 factory/router verified live 2026-11-15 (code present).',
    },
  },
};

const BURNER_ADDRESS = '0xBb87bD789Ca67562F531685e10EB78eC03dE3dEB';
const BURNER_BACKUP_FILE = `${process.env.HOME}/workspace/burners/burner-single-mnemonic-backup.json`;

// Suggested initial-liquidity test amounts (small slices; user approves
// the final numbers before any step runs). STEST has 18 decimals.
const SUGGESTED_LIQUIDITY = {
  arc: { tokenAmount: '10000', quoteAmount: '10', quoteSymbol: 'USDC' }, // 10k STEST + 10 test USDC
  robinhood: { tokenAmount: '10000', quoteAmount: '0.001', quoteSymbol: 'WETH' }, // 10k STEST + 0.001 test WETH
  sepolia: { tokenAmount: '10000', quoteAmount: '0.001', quoteSymbol: 'WETH' },
};

module.exports = { CHAINS, BURNER_ADDRESS, BURNER_BACKUP_FILE, SUGGESTED_LIQUIDITY };
