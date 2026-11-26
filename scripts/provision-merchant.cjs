const { PrismaClient } = require('@prisma/client')
const { randomBytes, scryptSync } = require('node:crypto')
const { getAddress, ZeroAddress } = require('ethers')

async function main() {
  if (process.argv.length !== 5) throw new Error('Usage: npm run merchant:create -- <email> <testnet wallet address> <display name>')
  const [emailInput, walletInput, nameInput] = process.argv.slice(2)
  const email = emailInput.trim().toLowerCase()
  const name = nameInput.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 80) throw new Error('Invalid email or display name.')
  const walletAddress = getAddress(walletInput)
  if (walletAddress === ZeroAddress) throw new Error('The zero address is not a merchant wallet.')
  const password = randomBytes(24).toString('base64url')
  const salt = randomBytes(16)
  const passwordHash = `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`
  const db = new PrismaClient()
  try {
    await db.merchant.create({ data: { email, name, businessName: name, walletAddress, passwordHash }, select: { id: true } })
    console.log(`Created ${email}. Save this one-time display of the dashboard password securely: ${password}`)
    console.log('This is an off-chain account only. For live invoicing the matching wallet must also be registered on the configured QDay gateway.')
  } finally {
    await db.$disconnect()
  }
}

main().catch((error) => {
  console.error(error?.code === 'P2002' ? 'This email or wallet already exists. No account was modified.' : error.message)
  process.exitCode = 1
})
