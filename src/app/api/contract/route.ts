import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { requireSession } from '@/lib/api-auth'

/**
 * GET /api/contract
 * Returns the Solidity source code for the AevumPaymentGateway contract
 * so it can be displayed in the in-app "Smart Contract" view.
 */
export async function GET() {
  // Bundled contract source is reference material for signed-in merchants; it is
  // not served to anonymous visitors (it is also available on the block explorer).
  const auth = await requireSession()
  if (!auth.ok) return auth.response

  // The bundled sources live under public/ — try both layouts for dev/prod.
  const candidates = [
    path.join(process.cwd(), 'public', 'download', 'contracts'),
    path.join(process.cwd(), 'download', 'contracts'),
  ]
  let contractsDir = ''
  let readmePath = ''
  for (const base of candidates) {
    try {
      await fs.access(path.join(base, 'contracts'))
      contractsDir = path.join(base, 'contracts')
      readmePath = path.join(base, 'README.md')
      break
    } catch {}
  }
  if (!contractsDir) {
    return NextResponse.json({ sources: [], readme: '', error: 'contracts not found' })
  }
  try {
    const files = await fs.readdir(contractsDir)
    const sources: { name: string; content: string; contentBase64: string }[] = []
    for (const f of files) {
      if (f.endsWith('.sol')) {
        const content = await fs.readFile(path.join(contractsDir, f), 'utf8')
        sources.push({
          name: f,
          content,
          contentBase64: Buffer.from(content, 'utf8').toString('base64'),
        })
      }
    }
    let readme = ''
    try {
      readme = await fs.readFile(readmePath, 'utf8')
    } catch {}
    return NextResponse.json({ sources, readme, network: 'qday-testnet' })
  } catch {
    return NextResponse.json({ sources: [], readme: '', error: 'contracts not found' })
  }
}
