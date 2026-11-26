// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title tUSD8Mock
 * @dev 6-decimals test stablecoin that mirrors the OFFICIAL tUSD8 on the Aevum
 *      testnet (which uses 6 decimals, not 18). Used only by the test suite to
 *      exercise AevumPaymentGateway with the real decimal precision.
 *
 *      The official on-chain tUSD8 is a separate, pre-deployed contract at
 *      0x456569838f1d43009A91ebA4263147Afd7233483 and is NOT redeployed.
 */
contract tUSD8Mock {
    string public constant name = "Test USD 8";
    string public constant symbol = "tUSD8";
    uint8  public constant decimals = 6;
    uint256 public totalSupply;

    address public owner;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor() {
        owner = msg.sender;
        _mint(msg.sender, 1_000_000 * 1e6);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "insufficient allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        _transfer(from, to, amount);
        return true;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == owner, "not owner");
        _mint(to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "zero recipient");
        require(balanceOf[from] >= amount, "insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
