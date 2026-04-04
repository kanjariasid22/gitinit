import { describe, it, expect } from 'vitest'
import { sha1 } from '../../src/utils/hash'

describe('sha1', () => {
  it('returns a 40-character lowercase hex string', () => {
    const result = sha1(Buffer.from('hello'))
    expect(result).toHaveLength(40)
    expect(result).toMatch(/^[0-9a-f]{40}$/)
  })

  it('is deterministic — same input always produces the same hash', () => {
    const data = Buffer.from('same content every time')
    expect(sha1(data)).toBe(sha1(data))
  })

  it('produces different hashes for different inputs', () => {
    expect(sha1(Buffer.from('foo'))).not.toBe(sha1(Buffer.from('bar')))
  })

  it('matches a known SHA-1 value for cross-verification with real Git', () => {
    // SHA-1("hello") — verifiable with: echo -n "hello" | sha1sum
    // This test lets us confirm we're using the same algorithm as real Git
    expect(sha1(Buffer.from('hello'))).toBe(
      'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d',
    )
  })

  it('handles an empty buffer', () => {
    // SHA-1("") — verifiable with: echo -n "" | sha1sum
    expect(sha1(Buffer.alloc(0))).toBe(
      'da39a3ee5e6b4b0d3255bfef95601890afd80709',
    )
  })

  it('treats binary data correctly — not as a UTF-8 string', () => {
    const binary = Buffer.from([0x00, 0x01, 0x02, 0xff])
    const result = sha1(binary)
    expect(result).toHaveLength(40)
    expect(result).toMatch(/^[0-9a-f]{40}$/)
  })
})
