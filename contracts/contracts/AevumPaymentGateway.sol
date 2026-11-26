// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title AevumPaymentGateway
 * @notice V3 invoice gateway for exact-transfer ERC-20 stablecoins. The merchant's net
 *         share is forwarded at payment; the gateway holds only the platform fee.
 *         Payers can grant an AI agent a revocable spending mandate (per-invoice
 *         limit, total cap, expiry, optional merchant lock) so the agent can settle
 *         invoices on their behalf without ever holding the payer's funds or keys.
 * @dev The fixed refund window is 30 days from each payment's block timestamp,
 *      inclusive of its deadline (unrelated to the pending invoice's expiry).
 *      An invoice's original fee remains reserved until it is refunded, or until
 *      anyone crystallizes it strictly after the deadline. Crystallization only
 *      reclassifies the fee, leaving the invoice PAID. Only crystallized fees
 *      can be withdrawn. Neither a fee change nor delisting changes past payments.
 *
 *      Amounts are in smallest units. The official QDay tUSD8 uses six decimals.
 *      Tokens must provide truthful, stable balances and exact transfers; both
 *      boolean-returning and USDT-style no-return transfers are accepted.
 */
contract AevumPaymentGateway {
    // ────────────────────────── Errors ──────────────────────────
    error NotOwner();
    error NotMerchant();
    error NotPayer();
    error WrongRefundRecipient();
    error InvoiceNotFound();
    error InvoiceExpiredError();
    error InvoiceAlreadyPaid();
    error InvoiceNotPending();
    error TokenNotWhitelisted();
    error AmountMismatch();
    error TransferFailed();
    error ZeroAddress();
    error Paused();
    error InvalidExpiry();
    error Reentrancy();
    error FeeBalanceTooLow();
    error RefundWindowClosed();
    error RefundWindowOpen();
    error FeeAlreadyCrystallized();
    error InvalidMandate();
    error MandateInactive();
    error MandateExpired();
    error MandateTokenMismatch();
    error MandateMerchantMismatch();
    error MandatePerInvoiceLimit();
    error MandateCapExceeded();

    // ────────────────────────── Events ──────────────────────────
    event MerchantRegistered(address indexed merchant, string indexed merchantId, uint256 timestamp);
    event MerchantDeregistered(address indexed merchant, uint256 timestamp);
    event TokenWhitelisted(address indexed token, string symbol, uint8 decimals);
    event TokenDelisted(address indexed token);
    event InvoiceCreated(
        bytes32 indexed invoiceId,
        address indexed merchant,
        address token,
        uint256 amount,
        uint256 expiresAt,
        string indexed orderRef
    );
    event InvoicePaid(
        bytes32 indexed invoiceId,
        address indexed merchant,
        address indexed payer,
        address token,
        uint256 amount,
        uint256 networkFee,
        uint256 paidAt
    );
    event InvoiceExpired(bytes32 indexed invoiceId, uint256 expiredAt);
    event InvoiceRefunded(bytes32 indexed invoiceId, address indexed to, uint256 amount, uint256 refundedAt);
    event InvoiceCancelled(bytes32 indexed invoiceId, uint256 cancelledAt);
    event GatewayPaused(address indexed by);
    event GatewayUnpaused(address indexed by);
    event FeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event FeeWithdrawn(address indexed to, uint256 amount);
    event FeeCrystallized(bytes32 indexed invoiceId, address indexed token, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeeCollectorUpdated(address indexed previousCollector, address indexed newCollector);
    event MandateGranted(
        address indexed payer,
        address indexed agent,
        address token,
        address merchant,
        uint256 maxPerInvoice,
        uint256 totalCap,
        uint64 validUntil
    );
    event MandateRevoked(address indexed payer, address indexed agent, uint256 spent);
    event MandatePayment(
        address indexed payer,
        address indexed agent,
        bytes32 indexed invoiceId,
        uint256 amount,
        uint256 remaining
    );

    // ────────────────────────── Types ──────────────────────────
    enum InvoiceStatus { PENDING, PAID, EXPIRED, REFUNDED, CANCELLED }

    struct Invoice {
        bytes32 id;            // keccak256(merchant, orderRef, salt)
        address merchant;      // payee
        address token;         // ERC-20 token address
        uint256 amount;        // amount in smallest unit (wei-like)
        address payer;         // set on payment
        InvoiceStatus status;
        uint256 createdAt;
        uint256 expiresAt;
        uint256 paidAt;
        string  orderRef;      // off-chain reference (merchant's internal order id)
        uint256 feePaid;       // fee actually charged at payment time
    }

    // ────────────────────────── Storage ──────────────────────────
    address public owner;
    bool public paused;
    uint256 public feeBps = 25; // 0.25% platform fee (configurable)
    address public feeCollector;

    mapping(address => bool) public isMerchant;
    mapping(address => TokenInfo) public tokens;       // token => info
    mapping(bytes32 => Invoice) public invoices;       // invoiceId => Invoice
    /// @notice Amount reclassified as withdrawable, by token. Excludes refund reserves.
    mapping(address => uint256) public pendingFees;

    uint256 public constant REFUND_WINDOW = 30 days;

    /// @notice Fees held for individual paid invoices, aggregated by token.
    /// @dev Includes expired reserves until each invoice is crystallized.
    mapping(address => uint256) public reservedFees;

    /// @notice Whether the invoice's fee has already been made withdrawable.
    /// @dev An invoice contributes its feePaid to reservedFees iff it is PAID
    ///      and not crystallized. This keeps the original Invoice ABI unchanged.
    mapping(bytes32 => bool) public feeCrystallized;

    struct TokenInfo {
        bool supported;
        string symbol;
        uint8 decimals;
    }

    /// @notice Spending authority a payer delegates to an agent address.
    /// @dev `merchant == address(0)` allows any registered merchant.
    struct Mandate {
        address token;
        address merchant;
        uint256 maxPerInvoice;
        uint256 totalCap;
        uint256 spent;
        uint64 validUntil;
        bool active;
    }

    /// @notice payer => agent => mandate
    mapping(address => mapping(address => Mandate)) public mandates;

    uint256 private _locked = 1;

    // ────────────────────────── Modifiers ──────────────────────────
    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier onlyMerchant() { if (!isMerchant[msg.sender]) revert NotMerchant(); _; }
    modifier whenNotPaused() { if (paused) revert Paused(); _; }
    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    // ────────────────────────── Constructor ──────────────────────────
    constructor(address _feeCollector) {
        if (_feeCollector == address(0)) revert ZeroAddress();
        owner = _feeCollector;
        feeCollector = _feeCollector;
    }

    // ────────────────────────── Safe ERC-20 transfers ──────────────────────────
    function _safeTransfer(address token, address to, uint256 amount) private {
        _exactTransfer(token, address(this), to, amount,
            abi.encodeWithSelector(bytes4(0xa9059cbb), to, amount));
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        _exactTransfer(token, from, to, amount,
            abi.encodeWithSelector(bytes4(0x23b872dd), from, to, amount));
    }

    /// @dev Enforce exact transfer deltas so an incoming shortfall cannot be
    ///      covered by reserves and the intended recipient receives the quoted amount.
    function _exactTransfer(address token, address from, address to, uint256 amount, bytes memory callData) private {
        uint256 fromBefore = IERC20(token).balanceOf(from);
        uint256 toBefore = from == to ? fromBefore : IERC20(token).balanceOf(to);
        (bool success, bytes memory data) = token.call(callData);
        if (!success || (data.length != 0 && (data.length < 32 || abi.decode(data, (uint256)) != 1))) {
            revert TransferFailed();
        }

        uint256 fromAfter = IERC20(token).balanceOf(from);
        if (from == to) {
            // A merchant may pay (and refund) its own invoice as before.
            if (fromAfter != fromBefore) revert TransferFailed();
        } else {
            uint256 toAfter = IERC20(token).balanceOf(to);
            if (fromAfter > fromBefore || fromBefore - fromAfter != amount ||
                toAfter < toBefore || toAfter - toBefore != amount) revert TransferFailed();
        }
    }

    function _requireFeeSolvency(address token) private view {
        if (IERC20(token).balanceOf(address(this)) < reservedFees[token] + pendingFees[token]) {
            revert FeeBalanceTooLow();
        }
    }

    // ────────────────────────── Merchant management ──────────────────────────
    function registerMerchant(address merchant, string calldata merchantId) external onlyOwner {
        if (merchant == address(0)) revert ZeroAddress();
        isMerchant[merchant] = true;
        emit MerchantRegistered(merchant, merchantId, block.timestamp);
    }

    function deregisterMerchant(address merchant) external onlyOwner {
        isMerchant[merchant] = false;
        emit MerchantDeregistered(merchant, block.timestamp);
    }

    // ────────────────────────── Token whitelist ──────────────────────────
    function whitelistToken(address token, string calldata symbol, uint8 decimals) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        tokens[token] = TokenInfo({ supported: true, symbol: symbol, decimals: decimals });
        emit TokenWhitelisted(token, symbol, decimals);
    }

    function delistToken(address token) external onlyOwner {
        tokens[token].supported = false;
        emit TokenDelisted(token);
    }

    // ────────────────────────── Invoice lifecycle ──────────────────────────
    /**
     * @notice Create a new invoice. The merchant (caller) becomes the payee.
     * @param token        Whitelisted ERC-20 token address
     * @param amount       Amount in token's smallest unit
     * @param expiresAt    Unix timestamp after which the invoice is expired
     * @param orderRef     Off-chain reference (merchant's internal order id)
     * @param salt         Random salt to make invoice id unique
     */
    function createInvoice(
        address token,
        uint256 amount,
        uint256 expiresAt,
        string calldata orderRef,
        bytes32 salt
    ) external onlyMerchant whenNotPaused nonReentrant returns (bytes32 invoiceId) {
        if (!tokens[token].supported) revert TokenNotWhitelisted();
        if (amount == 0) revert AmountMismatch();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();

        invoiceId = keccak256(abi.encodePacked(msg.sender, orderRef, salt, block.chainid));
        if (invoices[invoiceId].merchant != address(0)) revert InvoiceAlreadyPaid(); // already exists

        invoices[invoiceId] = Invoice({
            id: invoiceId,
            merchant: msg.sender,
            token: token,
            amount: amount,
            payer: address(0),
            status: InvoiceStatus.PENDING,
            createdAt: block.timestamp,
            expiresAt: expiresAt,
            paidAt: 0,
            orderRef: orderRef,
            feePaid: 0
        });

        emit InvoiceCreated(invoiceId, msg.sender, token, amount, expiresAt, orderRef);
    }

    /**
     * @notice Pay an invoice. The caller must have approved the gateway to spend
     *         `invoice.amount` of `invoice.token` before calling this.
     */
    function pay(bytes32 invoiceId) external whenNotPaused nonReentrant {
        _pay(invoiceId, msg.sender);
    }

    /**
     * @notice Settle an invoice as an agent, spending from `payer` under a mandate.
     * @dev The payer must have approved the gateway for the token (not the agent).
     *      Funds move payer -> gateway -> merchant; the agent never holds them,
     *      and a refund always returns to the payer recorded on the invoice.
     */
    function payWithMandate(bytes32 invoiceId, address payer) external whenNotPaused nonReentrant {
        Mandate storage m = mandates[payer][msg.sender];
        if (!m.active) revert MandateInactive();
        if (block.timestamp > m.validUntil) revert MandateExpired();

        Invoice storage inv = invoices[invoiceId];
        if (inv.merchant == address(0)) revert InvoiceNotFound();
        if (inv.token != m.token) revert MandateTokenMismatch();
        if (m.merchant != address(0) && inv.merchant != m.merchant) revert MandateMerchantMismatch();
        if (inv.amount > m.maxPerInvoice) revert MandatePerInvoiceLimit();
        if (m.spent + inv.amount > m.totalCap) revert MandateCapExceeded();

        m.spent += inv.amount;
        _pay(invoiceId, payer);

        emit MandatePayment(payer, msg.sender, invoiceId, inv.amount, m.totalCap - m.spent);
    }

    function _pay(bytes32 invoiceId, address payer) private {
        Invoice storage inv = invoices[invoiceId];
        if (inv.merchant == address(0)) revert InvoiceNotFound();
        if (inv.status != InvoiceStatus.PENDING) revert InvoiceNotPending();
        if (block.timestamp > inv.expiresAt) revert InvoiceExpiredError();
        if (!tokens[inv.token].supported) revert TokenNotWhitelisted();

        uint256 fee = (inv.amount * feeBps) / 10_000;
        uint256 merchantNet = inv.amount - fee;

        inv.payer = payer;
        inv.status = InvoiceStatus.PAID;
        inv.paidAt = block.timestamp;
        inv.feePaid = fee;
        if (fee > 0) reservedFees[inv.token] += fee;

        _safeTransferFrom(inv.token, payer, address(this), inv.amount);

        if (merchantNet > 0) {
            _safeTransfer(inv.token, inv.merchant, merchantNet);
        }

        _requireFeeSolvency(inv.token);

        emit InvoicePaid(invoiceId, inv.merchant, payer, inv.token, inv.amount, fee, block.timestamp);
    }

    // ────────────────────────── Agent mandates ──────────────────────────
    /**
     * @notice Grant (or replace) an agent's spending mandate. Replacing resets `spent`.
     * @param merchant  Restrict to one merchant, or address(0) for any merchant.
     */
    function grantMandate(
        address agent,
        address token,
        address merchant,
        uint256 maxPerInvoice,
        uint256 totalCap,
        uint64 validUntil
    ) external {
        if (agent == address(0) || token == address(0)) revert ZeroAddress();
        if (agent == msg.sender) revert InvalidMandate();
        if (!tokens[token].supported) revert TokenNotWhitelisted();
        if (maxPerInvoice == 0 || totalCap == 0 || maxPerInvoice > totalCap) revert InvalidMandate();
        if (validUntil <= block.timestamp) revert InvalidExpiry();

        mandates[msg.sender][agent] = Mandate({
            token: token,
            merchant: merchant,
            maxPerInvoice: maxPerInvoice,
            totalCap: totalCap,
            spent: 0,
            validUntil: validUntil,
            active: true
        });
        emit MandateGranted(msg.sender, agent, token, merchant, maxPerInvoice, totalCap, validUntil);
    }

    /// @notice Immediately stop an agent from spending. Works even while paused.
    function revokeMandate(address agent) external {
        Mandate storage m = mandates[msg.sender][agent];
        if (!m.active) revert MandateInactive();
        m.active = false;
        emit MandateRevoked(msg.sender, agent, m.spent);
    }

    /// @notice Remaining spendable amount, or zero if inactive or expired.
    function mandateRemaining(address payer, address agent) external view returns (uint256) {
        Mandate storage m = mandates[payer][agent];
        if (!m.active || block.timestamp > m.validUntil) return 0;
        return m.totalCap - m.spent;
    }

    /**
     * @notice Refund a paid invoice through its refund deadline, inclusive.
     * @dev Only the original merchant can call this, even after deregistration.
     *      Refunds remain available while paused or after token delisting. The
     *      payer receives the full amount: the merchant approves its net share
     *      and only this invoice's reserved fee is returned from the gateway.
     */
    function refund(bytes32 invoiceId, address to) external nonReentrant {
        Invoice storage inv = invoices[invoiceId];
        if (inv.merchant != msg.sender) revert NotMerchant();
        if (inv.status != InvoiceStatus.PAID) revert InvoiceNotPending();
        if (to == address(0)) revert ZeroAddress();
        if (to != inv.payer) revert WrongRefundRecipient();
        if (block.timestamp > inv.paidAt + REFUND_WINDOW) revert RefundWindowClosed();

        uint256 fee = inv.feePaid;
        uint256 merchantNet = inv.amount - fee;

        inv.status = InvoiceStatus.REFUNDED;
        if (fee > 0) {
            _requireFeeSolvency(inv.token);
            // PAID and within the window implies this invoice's fee was never crystallized.
            reservedFees[inv.token] -= fee;
        }

        if (merchantNet > 0) _safeTransferFrom(inv.token, inv.merchant, to, merchantNet);
        if (fee > 0) {
            _safeTransfer(inv.token, to, fee);
            _requireFeeSolvency(inv.token);
        }

        emit InvoiceRefunded(invoiceId, to, inv.amount, block.timestamp);
    }

    /// @notice Anyone may make a paid invoice's fee withdrawable strictly after its refund deadline.
    /// @dev No transfers are performed. The invoice remains PAID and its historical fee is unchanged.
    function crystallizeFee(bytes32 invoiceId) external nonReentrant {
        Invoice storage inv = invoices[invoiceId];
        if (inv.merchant == address(0)) revert InvoiceNotFound();
        if (inv.status != InvoiceStatus.PAID) revert InvoiceNotPending();
        if (feeCrystallized[invoiceId]) revert FeeAlreadyCrystallized();
        if (block.timestamp <= inv.paidAt + REFUND_WINDOW) revert RefundWindowOpen();

        feeCrystallized[invoiceId] = true;
        uint256 fee = inv.feePaid;
        if (fee > 0) {
            reservedFees[inv.token] -= fee;
            pendingFees[inv.token] += fee;
        }
        emit FeeCrystallized(invoiceId, inv.token, fee);
    }

    /// @notice Cancel a pending invoice. Only the merchant can call this.
    function cancel(bytes32 invoiceId) external onlyMerchant {
        Invoice storage inv = invoices[invoiceId];
        if (inv.merchant != msg.sender) revert NotMerchant();
        if (inv.status != InvoiceStatus.PENDING) revert InvoiceNotPending();
        inv.status = InvoiceStatus.CANCELLED;
        emit InvoiceCancelled(invoiceId, block.timestamp);
    }

    /// @notice Mark an expired invoice. Anyone can call (gas-refundable off-chain).
    function markExpired(bytes32 invoiceId) external {
        Invoice storage inv = invoices[invoiceId];
        if (inv.merchant == address(0)) revert InvoiceNotFound();
        if (inv.status != InvoiceStatus.PENDING) revert InvoiceNotPending();
        if (block.timestamp <= inv.expiresAt) revert InvoiceExpiredError();
        inv.status = InvoiceStatus.EXPIRED;
        emit InvoiceExpired(invoiceId, block.timestamp);
    }

    // ────────────────────────── View ──────────────────────────
    function getInvoice(bytes32 invoiceId) external view returns (Invoice memory) {
        return invoices[invoiceId];
    }

    /// @notice Historical refund deadline for an invoice that was paid, or zero if never paid.
    function refundDeadline(bytes32 invoiceId) external view returns (uint256) {
        uint256 paidAt = invoices[invoiceId].paidAt;
        return paidAt == 0 ? 0 : paidAt + REFUND_WINDOW;
    }

    function isInvoicePaid(bytes32 invoiceId) external view returns (bool) {
        return invoices[invoiceId].status == InvoiceStatus.PAID;
    }

    // ────────────────────────── Admin ──────────────────────────
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        if (_paused) emit GatewayPaused(msg.sender);
        else emit GatewayUnpaused(msg.sender);
    }

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 500, "fee too high"); // max 5%
        emit FeeUpdated(feeBps, _feeBps);
        feeBps = _feeBps;
    }

    function setFeeCollector(address _collector) external onlyOwner {
        if (_collector == address(0) || _collector == address(this)) revert ZeroAddress();
        emit FeeCollectorUpdated(feeCollector, _collector);
        feeCollector = _collector;
    }

    /// @notice Withdraw only this token's crystallized fees, never its refund reserves.
    function withdrawFees(address token) external onlyOwner nonReentrant {
        uint256 amount = pendingFees[token];
        if (amount == 0) revert AmountMismatch();
        _requireFeeSolvency(token);
        address collector = feeCollector;
        pendingFees[token] = 0;
        _safeTransfer(token, collector, amount);
        _requireFeeSolvency(token);
        emit FeeWithdrawn(collector, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
