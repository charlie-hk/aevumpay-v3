// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAevumPaymentGateway {
    event FeeCrystallized(bytes32 indexed invoiceId, address indexed token, uint256 amount);
    enum InvoiceStatus { PENDING, PAID, EXPIRED, REFUNDED, CANCELLED }

    struct Invoice {
        bytes32 id;
        address merchant;
        address token;
        uint256 amount;
        address payer;
        InvoiceStatus status;
        uint256 createdAt;
        uint256 expiresAt;
        uint256 paidAt;
        string  orderRef;
        uint256 feePaid;       // fee charged at payment time (0 while pending)
    }

    function createInvoice(
        address token,
        uint256 amount,
        uint256 expiresAt,
        string calldata orderRef,
        bytes32 salt
    ) external returns (bytes32 invoiceId);

    function pay(bytes32 invoiceId) external;
    function refund(bytes32 invoiceId, address to) external;
    function cancel(bytes32 invoiceId) external;
    function markExpired(bytes32 invoiceId) external;

    function getInvoice(bytes32 invoiceId) external view returns (Invoice memory);
    function isInvoicePaid(bytes32 invoiceId) external view returns (bool);

    function registerMerchant(address merchant, string calldata merchantId) external;
    function whitelistToken(address token, string calldata symbol, uint8 decimals) external;

    function feeBps() external view returns (uint256);
    function feeCollector() external view returns (address);
    function REFUND_WINDOW() external view returns (uint256);
    function refundDeadline(bytes32 invoiceId) external view returns (uint256);
    function feeCrystallized(bytes32 invoiceId) external view returns (bool);
    function reservedFees(address token) external view returns (uint256);
    function crystallizeFee(bytes32 invoiceId) external;
    /// @notice Total crystallized (withdrawable) fees for a token.
    function pendingFees(address token) external view returns (uint256);
    function withdrawFees(address token) external;

    function payWithMandate(bytes32 invoiceId, address payer) external;
    function grantMandate(
        address agent,
        address token,
        address merchant,
        uint256 maxPerInvoice,
        uint256 totalCap,
        uint64 validUntil
    ) external;
    function revokeMandate(address agent) external;
    function mandateRemaining(address payer, address agent) external view returns (uint256);
}
