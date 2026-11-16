// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title SniperTestToken (STEST)
/// @notice TEST TOKEN ONLY — for the 0xmuse sniper toolkit on TESTNETS
///         (Arc testnet 5042002, Robinhood testnet 46630). No mainnet.
///         Fixed test supply minted once to the deployer at construction;
///         the owner can mint more ONLY for further testing. The user will
///         rename/replace this token before any real launch.
/// @dev Compiled with evm_version "paris" — Arc rejects PUSH0 (Shanghai).
///      Never mint to msg.sender in a CREATE2 deploy; here the constructor
///      mints to the deployer explicitly (msg.sender IS the deployer in a
///      normal CREATE deploy, and the deploy scripts pass the deployer
///      address explicitly where it matters).
contract SniperTestToken is ERC20, Ownable {
    /// @notice Test supply: 1,000,000 STEST (18 decimals).
    uint256 public constant INITIAL_SUPPLY = 1_000_000 * 10 ** 18;

    constructor() ERC20("Sniper Test Token", "STEST") Ownable(msg.sender) {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    /// @notice Owner-only mint, for test top-ups only. No cap change, no
    ///         renounce games — this is a throwaway test token.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
