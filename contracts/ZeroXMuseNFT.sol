// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ZeroXMuseNFT
/// @notice 0xmuse testnet NFT — owner-mintable ERC-721.
/// @dev TESTNET ONLY. Arc testnet: compile with evm_version "paris"
///      (PUSH0 is rejected on Arc). USDC is the native gas token on Arc.
///      Never mint to msg.sender in a CREATE2 deploy; mint() takes an
///      explicit `to` address so the recipient is always deliberate.
contract ZeroXMuseNFT is ERC721, Ownable {
    uint256 private _nextTokenId = 1;

    string private _baseTokenURI;

    event BaseURISet(string baseURI);

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseURI_
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        _baseTokenURI = baseURI_;
    }

    /// @notice Mint token `tokenId` to `to`. Only the owner (deployer) can mint.
    /// @dev Token IDs start at 1 and increment. The caller supplies the
    ///      recipient explicitly — never defaults to msg.sender.
    function mint(address to) external onlyOwner returns (uint256 tokenId) {
        tokenId = _nextTokenId;
        _nextTokenId += 1;
        _safeMint(to, tokenId);
    }

    /// @notice Update the base URI (e.g. after re-pinning metadata). Owner only.
    function setBaseURI(string memory baseURI_) external onlyOwner {
        _baseTokenURI = baseURI_;
        emit BaseURISet(baseURI_);
    }

    /// @notice Next token ID that will be minted (1 before any mint).
    function nextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
