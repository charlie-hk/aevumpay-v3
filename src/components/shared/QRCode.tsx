'use client'

import { useMemo } from 'react'

/**
 * Lightweight QR code generator (pure SVG, no external deps).
 * Uses a compact QR Code Model 2 implementation — supports byte mode
 * up to ~100 chars at error correction level M, which is enough for
 * EIP-681 payment URIs.
 *
 * Reference: ISO/IEC 18004
 */

// ─── Galois field tables for Reed-Solomon ───
const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]
})()

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

// ─── Generator polynomials ───
const generatorCache = new Map<number, number[]>()
function rsGenerator(deg: number): number[] {
  if (generatorCache.has(deg)) return generatorCache.get(deg)!
  let g = [1]
  for (let i = 0; i < deg; i++) {
    const ng = new Array(g.length + 1).fill(0)
    for (let j = 0; j < g.length; j++) {
      ng[j] ^= g[j]
      ng[j + 1] ^= gfMul(g[j], GF_EXP[i])
    }
    g = ng
  }
  generatorCache.set(deg, g)
  return g
}

function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGenerator(ecLen)
  const result = data.concat(new Array(ecLen).fill(0))
  for (let i = 0; i < data.length; i++) {
    const coef = result[i]
    if (coef === 0) continue
    for (let j = 0; j < gen.length; j++) {
      result[i + j] ^= gfMul(gen[j], coef)
    }
  }
  return result.slice(data.length)
}

// ─── QR code structure (we support versions 1-10, level M) ───
// Capacity (bytes, level M): v1=14, v2=26, v3=42, v4=62, v5=84, v6=106, v7=122, v8=152, v9=180, v10=213
// Total codewords, ec codewords per block, num blocks
const VERSIONS = [
  null, // 0 placeholder
  { total: 26, ec: 10, blocks: 1 },   // v1
  { total: 44, ec: 16, blocks: 1 },   // v2
  { total: 70, ec: 26, blocks: 1 },   // v3
  { total: 100, ec: 18, blocks: 2 },  // v4
  { total: 134, ec: 24, blocks: 2 },  // v5
  { total: 172, ec: 16, blocks: 4 },  // v6
  { total: 196, ec: 18, blocks: 4 },  // v7
  { total: 242, ec: 22, blocks: 4 },  // v8
  { total: 292, ec: 22, blocks: 5 },  // v9
  { total: 346, ec: 26, blocks: 5 },  // v10
]

// Alignment pattern centers (subset for v1-10)
const ALIGN_CENTERS: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
]

function pickVersion(byteLen: number): number {
  for (let v = 1; v <= 10; v++) {
    const config = VERSIONS[v]
    if (!config) continue
    const dataBytes = config.total - config.ec * config.blocks
    // mode (4 bits) + count (8 bits for v1-9, 16 for v10+) + data
    const countBits = v < 10 ? 8 : 16
    const headerBits = 4 + countBits
    const headerBytes = Math.ceil(headerBits / 8)
    const capacity = dataBytes - headerBytes
    if (byteLen <= capacity) return v
  }
  return 10
}

interface QRMatrix {
  size: number
  modules: boolean[][] // true = dark
  reserved: boolean[][]
}

function createMatrix(version: number): QRMatrix {
  const size = version * 4 + 17
  const modules: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false))
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false))
  return { size, modules, reserved }
}

function placeFinder(m: QRMatrix, r: number, c: number) {
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const rr = r + dr
      const cc = c + dc
      if (rr < 0 || rr >= m.size || cc < 0 || cc >= m.size) continue
      const isBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6
      const isInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4
      const isOuter = (dr >= 0 && dr <= 7 && (dc === -1 || dc === 7)) || (dc >= 0 && dc <= 7 && (dr === -1 || dr === 7))
      if (isOuter) {
        m.reserved[rr][cc] = true
      } else if (isBorder || isInner) {
        m.modules[rr][cc] = true
        m.reserved[rr][cc] = true
      } else {
        m.reserved[rr][cc] = true
      }
    }
  }
}

function placeAlignment(m: QRMatrix, version: number) {
  const centers = ALIGN_CENTERS[version]
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      // Skip if overlaps with finder patterns
      if ((i === 0 && j === 0) || (i === 0 && j === centers.length - 1) || (i === centers.length - 1 && j === 0)) continue
      const r = centers[i]
      const c = centers[j]
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr
          const cc = c + dc
          if (rr < 0 || rr >= m.size || cc < 0 || cc >= m.size) continue
          const isEdge = Math.abs(dr) === 2 || Math.abs(dc) === 2
          const isCenter = dr === 0 && dc === 0
          m.modules[rr][cc] = isEdge || isCenter
          m.reserved[rr][cc] = true
        }
      }
    }
  }
}

function placeTiming(m: QRMatrix) {
  for (let i = 8; i < m.size - 8; i++) {
    if (!m.reserved[6][i]) {
      m.modules[6][i] = i % 2 === 0
      m.reserved[6][i] = true
    }
    if (!m.reserved[i][6]) {
      m.modules[i][6] = i % 2 === 0
      m.reserved[i][6] = true
    }
  }
}

function placeFormatInfo(m: QRMatrix, formatBits: number) {
  // Place format bits around finders
  for (let i = 0; i < 15; i++) {
    const bit = ((formatBits >> i) & 1) === 1
    // Around top-left finder
    if (i < 6) {
      m.modules[8][i] = bit
      m.reserved[8][i] = true
    } else if (i < 8) {
      m.modules[8][i + 1] = bit
      m.reserved[8][i + 1] = true
    } else if (i < 9) {
      m.modules[7][8] = bit
      m.reserved[7][8] = true
    } else {
      m.modules[14 - i][8] = bit
      m.reserved[14 - i][8] = true
    }
    // Around top-right + bottom-left finders
    if (i < 8) {
      m.modules[m.size - 1 - i][8] = bit
      m.reserved[m.size - 1 - i][8] = true
    } else {
      m.modules[8][m.size - 15 + i] = bit
      m.reserved[8][m.size - 15 + i] = true
    }
  }
  // Always-dark module
  m.modules[m.size - 8][8] = true
  m.reserved[m.size - 8][8] = true
}

function placeData(m: QRMatrix, bits: number[]) {
  let bitIdx = 0
  let goingUp = true
  for (let col = m.size - 1; col > 0; col -= 2) {
    if (col === 6) col-- // skip timing column
    for (let i = 0; i < m.size; i++) {
      const r = goingUp ? m.size - 1 - i : i
      for (let c = 0; c < 2; c++) {
        const cc = col - c
        if (!m.reserved[r][cc]) {
          m.modules[r][cc] = bitIdx < bits.length ? bits[bitIdx] === 1 : false
          bitIdx++
        }
      }
    }
    goingUp = !goingUp
  }
}

function applyMask(m: QRMatrix, maskId: number) {
  const maskFn = [
    (r: number, c: number) => (r + c) % 2 === 0,
    (r: number, c: number) => r % 2 === 0,
    (r: number, c: number) => c % 3 === 0,
    (r: number, c: number) => (r + c) % 3 === 0,
    (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r: number, c: number) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r: number, c: number) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r: number, c: number) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ][maskId]
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (!m.reserved[r][c] && maskFn(r, c)) {
        m.modules[r][c] = !m.modules[r][c]
      }
    }
  }
}

// Format info bits for level M (mask id 0-7) — pre-computed
const FORMAT_BITS_M = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b,
  0x45f9, 0x40ce, 0x4f97, 0x4aa0,
]

export function generateQR(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text)
  const version = pickVersion(bytes.length)
  const v = VERSIONS[version]
  if (!v) throw new Error("Unsupported QR version")

  // Encode data: byte mode
  const countBits = version < 10 ? 8 : 16
  const bits: number[] = []
  // Mode indicator (0100 = byte)
  bits.push(0, 1, 0, 0)
  // Char count
  for (let i = countBits - 1; i >= 0; i--) bits.push((bytes.length >> i) & 1)
  // Data bytes
  for (const b of bytes) {
    for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1)
  }
  // Terminator (up to 4 zero bits)
  const totalDataBits = (v.total - v.ec * v.blocks) * 8
  for (let i = 0; i < 4 && bits.length < totalDataBits; i++) bits.push(0)
  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0)
  // Pad bytes
  const padBytes = [0xec, 0x11]
  let padIdx = 0
  while (bits.length < totalDataBits) {
    const pb = padBytes[padIdx++ % 2]
    for (let i = 7; i >= 0; i--) bits.push((pb >> i) & 1)
  }

  // Convert bits to codewords
  const dataCodewords: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]
    dataCodewords.push(b)
  }

  // Error correction + block interleaving
  const dataPerBlock = Math.floor(v.total / v.blocks) - v.ec
  const blocks: number[][] = []
  const ecBlocks: number[][] = []
  for (let i = 0; i < v.blocks; i++) {
    const block = dataCodewords.slice(i * dataPerBlock, (i + 1) * dataPerBlock)
    blocks.push(block)
    ecBlocks.push(rsEncode(block, v.ec))
  }
  // Interleave
  const interleaved: number[] = []
  for (let i = 0; i < dataPerBlock; i++) {
    for (const b of blocks) interleaved.push(b[i])
  }
  for (let i = 0; i < v.ec; i++) {
    for (const b of ecBlocks) interleaved.push(b[i])
  }

  // Convert back to bits
  const finalBits: number[] = []
  for (const b of interleaved) {
    for (let i = 7; i >= 0; i--) finalBits.push((b >> i) & 1)
  }

  // Build matrix
  const m = createMatrix(version)
  placeFinder(m, 0, 0)
  placeFinder(m, 0, m.size - 7)
  placeFinder(m, m.size - 7, 0)
  placeAlignment(m, version)
  placeTiming(m)

  // Try mask 0 only (good enough for our use case — short URIs)
  const maskId = 0
  placeData(m, finalBits)
  applyMask(m, maskId)
  placeFormatInfo(m, FORMAT_BITS_M[maskId])

  return m.modules
}

export function QRCode({
  value,
  size = 200,
  className,
  fg = '#0B0D17',
  bg = '#ffffff',
}: {
  value: string
  size?: number
  className?: string
  fg?: string
  bg?: string
}) {
  const matrix = useMemo(() => generateQR(value), [value])
  if (!matrix || matrix.length === 0) {
    return <div style={{ width: size, height: size }} className={className} />
  }
  const n = matrix.length
  const cell = size / n
  const quietSize = size + 16
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${quietSize} ${quietSize}`}
      className={className}
      role="img"
      aria-label="Payment QR code"
    >
      <rect x={0} y={0} width={quietSize} height={quietSize} fill={bg} rx={8} />
      <g transform="translate(8, 8)">
        {matrix.map((row, r) =>
          row.map((on, c) =>
            on ? (
              <rect
                key={`${r}-${c}`}
                x={c * cell}
                y={r * cell}
                width={cell + 0.5}
                height={cell + 0.5}
                fill={fg}
                rx={cell * 0.15}
              />
            ) : null
          )
        )}
      </g>
    </svg>
  )
}
