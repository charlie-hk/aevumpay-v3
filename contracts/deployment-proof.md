# Deployment and demo proof - AevumPay V3

All links are on the QDay testnet explorer (https://explorer-test.qday.info). Testnet only.

## Contract
- Address: [0x6935DC350d790A11FF227841130B9de1642A865a](https://explorer-test.qday.info/address/0x6935DC350d790A11FF227841130B9de1642A865a#code)
- Deployment transaction: [0xd03acd30418b451ffb78f4a67ca8f773f3ee59bbe5a2a8db66a019bc3519a137](https://explorer-test.qday.info/tx/0xd03acd30418b451ffb78f4a67ca8f773f3ee59bbe5a2a8db66a019bc3519a137)
- Block: 4116934
- Gas used: 2199169

## Token and merchant setup
- whitelistToken: https://explorer-test.qday.info/tx/0x8369963f0fb0fc6f48f88df37b6c10dcd31d791f208e355823b22b9099df5324
- registerMerchant: https://explorer-test.qday.info/tx/0x0949d1db2d741713b0b293edb5b4aa8c28d8c2075ce75a306356eadc1280ce73

## Agent spending mandate demo
1. Payer approves the gateway: https://explorer-test.qday.info/tx/0xed6dbb3cd930c0ca72d21a08cf25db3d3cbc60cf63d457a4cba9249a204cbcc1
2. Payer grants the mandate: https://explorer-test.qday.info/tx/0x0731773e1da5ffb21f89d1361487fa1d7d0f25ad8e548c291124f289001dfe81
3. Merchant creates a 2-unit invoice: https://explorer-test.qday.info/tx/0x49ed2c73016a01f02aade4d764113c7cff18eae3025a922cb6e12cc47be90f09
4. Agent pays with the mandate: https://explorer-test.qday.info/tx/0x99ee763ce115c8ae31e99803f73250d76e2ecc9e4633e8c499a7383f94a94e7e
5. Merchant creates a second invoice: https://explorer-test.qday.info/tx/0x82b565f4deacf08488dc3ff47444e6b78568b5ddc7a0a4f229053ca5f3947ffc
6. Payer revokes the mandate: https://explorer-test.qday.info/tx/0x6eb443050fe856938dc168eee2a059ec9de33e562c68307dbdd0f3de4e645d2a

## Actors
- Merchant, owner and fee collector: 0x7F6f8d310dD5523D2B222c61Bb013c6a80ddB66E
- Payer: 0x39a2baB12b3757831A092e5786e477AC6b0ba0F9
- Agent: 0x1D1d7C1ec58d12cbA440c5d34a31970d44126543

## Real payment made from the app
- Invoice: INV-7CBA5815994E119D
- Payment transaction: https://explorer-test.qday.info/tx/0x21e10f6a62b98a8f623c1288f1b3b3ee73b2811c595af2942e0bf9e55a07a0cd
- Block: 4119361
- Amount: 1.0 tUSD8, fee: 0.0025 tUSD8 (25 basis points)
- Payer: 0x39a2baB12b3757831A092e5786e477AC6b0ba0F9
- Merchant: 0x7F6f8d310dD5523D2B222c61Bb013c6a80ddB66E

## Earlier payment from the previous site version (V2 gateway)
- Site: https://aevumpay-app.vercel.app
- Invoice: INV-498547BD3E0CACA1 (1 tUSD8)
- On-chain invoice creation: https://explorer-test.qday.info/tx/0x387fb577243e3834efca77e65e66d546d4d4319ac241156abf755fa54f3da254
- Payment: https://explorer-test.qday.info/tx/0x0705006ecbe32b9a9127f864c52148e59a53f88a07457d0b2352e2e43cbfdd72
- Payment block: 4159473
- Fee: 0.0025 tUSD8

## Agent mandate demo from the live site (V3)
- Site: https://aevumpay-v3.vercel.app
- Mandate granted by the payer wallet: https://explorer-test.qday.info/tx/0x0f83361485090b1bb1e79a059478662b4f0fe282042ac8222e6d47ec9a47578d
- Agent address: 0x1D1d7C1ec58d12cbA440c5d34a31970d44126543
- Mandate revoked: https://explorer-test.qday.info/tx/0x6995efe46c03c12fb9a1c6bcc2ad4d379f10d873f68d9aa0131cb59bc45d2989
- Limits: 2 tUSD8 per invoice, 5 tUSD8 total, valid until 3 December 2026

## Invoice created and paid on the live site (V3)
- Site: https://aevumpay-v3.vercel.app
- Invoice: INV-F92F6CE0700C3800
- On-chain invoice creation (createInvoice): https://explorer-test.qday.info/tx/0xfc400fe434698acf8d0721afc9381e13746ceb35c70db4f7760fc4467a68bd78
- Payment (pay): https://explorer-test.qday.info/tx/0xe5ce5ec5303c80835d79e371c02e1fd48aead1d39d34216698f65d9346ad69a5
- Amount: 1 tUSD8. The merchant received 0.9975 tUSD8 and 0.0025 tUSD8 (0.25%) was reserved as the fee.
- Note: the same testnet wallet acted as merchant and payer in this test.
