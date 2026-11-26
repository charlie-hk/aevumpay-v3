// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title tUSD8
 * @author AevumPay Team
 * @notice Test stablecoin (1 tUSD8 = 1 USD peg) for the Aevum Builder Challenge #1
 *         on the QDay testnet. Anyone can mint free test tokens via `faucet()`.
 *
 * @dev Implements EIP-20 + EIP-2612 (permit) for gasless approvals. The token is
 *      intentionally permissionless for the hackathon — in production you would
 *      restrict minting to a Treasury / issuer role.
 */
contract tUSD8 {
    // ────────────────────────── ERC-20 metadata ──────────────────────────
    string public constant name = "Test USD 8";
    string public constant symbol = "tUSD8";
    uint8  public constant decimals = 18;
    uint256 public totalSupply;

    address public owner;
    bool public paused;

    // ────────────────────────── EIP-2612 permit ──────────────────────────
    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 private constant EIP712_DOMAIN =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant VERSION_HASH = keccak256("1");
    mapping(address => uint256) public nonces;

    // ────────────────────────── ERC-20 storage ──────────────────────────
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ────────────────────────── Events ──────────────────────────
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Mint(address indexed to, uint256 amount);
    event Burn(address indexed from, uint256 amount, address indexed burner);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ────────────────────────── Modifiers ──────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "tUSD8: not owner");
        _;
    }
    modifier whenNotPaused() {
        require(!paused, "tUSD8: paused");
        _;
    }

    // ────────────────────────── Constructor ──────────────────────────
    constructor() {
        owner = msg.sender;
        // Premint 1,000,000 tUSD8 to deployer for seeding faucets & merchants
        _mint(msg.sender, 1_000_000 * 1e18);
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ────────────────────────── ERC-20 core ──────────────────────────
    function transfer(address to, uint256 amount) external whenNotPaused returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external whenNotPaused returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "tUSD8: insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "tUSD8: zero recipient");
        require(balanceOf[from] >= amount, "tUSD8: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "tUSD8: zero recipient");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
        emit Mint(to, amount);
    }

    // ────────────────────────── Faucet (testnet only!) ──────────────────────────
    /// @notice Anyone can claim 1,000 tUSD8 every 24h. Testnet only.
    mapping(address => uint256) public lastFaucet;
    uint256 public constant FAUCET_AMOUNT = 1_000 * 1e18;
    uint256 public constant FAUCET_COOLDOWN = 24 hours;

    function faucet() external whenNotPaused {
        require(block.timestamp >= lastFaucet[msg.sender] + FAUCET_COOLDOWN, "tUSD8: cooldown");
        lastFaucet[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    // ────────────────────────── EIP-2612 permit ──────────────────────────
    function permit(
        address tokenOwner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp <= deadline, "tUSD8: expired deadline");
        bytes32 domainSep = keccak256(
            abi.encode(
                EIP712_DOMAIN,
                keccak256(bytes(name)),
                VERSION_HASH,
                block.chainid,
                address(this)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, tokenOwner, spender, value, nonces[tokenOwner]++, deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == tokenOwner, "tUSD8: invalid signature");
        allowance[tokenOwner][spender] = value;
        emit Approval(tokenOwner, spender, value);
    }

    // ────────────────────────── Admin ──────────────────────────
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "tUSD8: insufficient balance");
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
        emit Burn(msg.sender, amount, msg.sender);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        if (_paused) emit Paused(msg.sender);
        else emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "tUSD8: zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
