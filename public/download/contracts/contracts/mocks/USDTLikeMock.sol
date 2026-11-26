// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title USDTLikeMock
 * @notice Minimal ERC-20 that mimics Tether (USDT): `transfer` and
 *         `transferFrom` return NOTHING, so any caller that decodes a `bool`
 *         return value will revert.
 *
 *         Used by the test suite to prove that AevumPaymentGateway works with
 *         real-world stablecoins, not just textbook ERC-20s.
 *
 * @dev Test-only contract. No access control on `mint` on purpose.
 */
contract USDTLikeMock {
    string public name = "Tether Mock";
    string public symbol = "USDTm";
    uint8 public decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor() {
        _mint(msg.sender, 1_000_000 * 1e6);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    // NOTE: no return value — exactly like Tether.
    function transfer(address to, uint256 amount) external {
        _transfer(msg.sender, to, amount);
    }

    // NOTE: no return value — exactly like Tether.
    function transferFrom(address from, address to, uint256 amount) external {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "USDTLikeMock: allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "USDTLikeMock: balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) private {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
