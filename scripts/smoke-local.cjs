const assert = require('node:assert/strict')

const base = new URL(process.env.SMOKE_BASE_URL || 'http://localhost:3000')
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(base.hostname) || base.username || base.password) {
  throw new Error('This smoke check runs against a local instance only.')
}

async function get(path, cookie) {
  return fetch(new URL(path, base), { headers: cookie ? { cookie } : {}, redirect: 'manual', signal: AbortSignal.timeout(15000) })
}

async function main() {
  const home = await get('/')
  assert.equal(home.status, 200)
  for (const path of ['/api/auth/me', '/api/dashboard', '/api/invoices', '/api/transactions', '/api/webhooks', '/api/contract']) {
    assert.equal((await get(path)).status, 401, `${path} must require a merchant session`)
  }
  const publicDocs = await get('/download/contracts/README.md')
  assert.equal(publicDocs.status, 200)
  assert((await publicDocs.text()).includes('Historical on-chain demo (v1)'))

  const email = process.env.SMOKE_EMAIL
  const password = process.env.SMOKE_PASSWORD
  if (!email || !password) {
    console.log('Anonymous/auth boundary and public contract checks passed. Configure smoke credentials to check dashboard login as well.')
    return
  }
  const login = await fetch(new URL('/api/auth/login', base), {
    method: 'POST', headers: { 'content-type': 'application/json', origin: base.origin },
    body: JSON.stringify({ email, password }), redirect: 'manual', signal: AbortSignal.timeout(15000),
  })
  assert.equal(login.status, 200, 'The provisioned merchant must be able to log in')
  const setCookie = login.headers.get('set-cookie')
  assert(setCookie && /HttpOnly/i.test(setCookie))
  const cookie = setCookie.split(';', 1)[0]
  const identity = await get('/api/auth/me', cookie)
  assert.equal(identity.status, 200)
  const me = (await identity.json()).merchant
  assert.equal(me.email, email)
  assert(!('passwordHash' in me) && !('apiKey' in me))
  for (const path of ['/api/dashboard', '/api/invoices', '/api/transactions', '/api/webhooks']) {
    const result = await get(path, cookie)
    assert.equal(result.status, 200, `${path} must work after logging in`)
  }
  const bundle = await (await get('/api/contract', cookie)).json()
  assert(bundle.sources.some((x) => x.name === 'AevumPaymentGateway.sol' && x.content.includes('WrongRefundRecipient')))
  assert(bundle.readme.includes('Historical on-chain demo (v1)'))
  console.log('Local smoke checks passed: public documentation, private dashboard routes and a valid merchant session.')
}

main().catch((err) => { console.error(err.message); process.exitCode = 1 })
