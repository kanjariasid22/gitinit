import { describe, it, expect } from 'vitest'
import { compress, decompress } from '../../src/utils/compress'

describe('compress / decompress', () => {
  it('round-trips: decompress(compress(x)) === x', async () => {
    const original = Buffer.from('hello, gitinit!')
    const compressed = await compress(original)
    const restored = await decompress(compressed)
    expect(restored).toEqual(original)
  })

  it('round-trips binary data correctly', async () => {
    const binary = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x80])
    const restored = await decompress(await compress(binary))
    expect(restored).toEqual(binary)
  })

  it('round-trips an empty buffer', async () => {
    const empty = Buffer.alloc(0)
    const restored = await decompress(await compress(empty))
    expect(restored).toEqual(empty)
  })

  it('compressed output is a Buffer', async () => {
    const compressed = await compress(Buffer.from('test'))
    expect(compressed).toBeInstanceOf(Buffer)
  })

  it('compressed output is smaller than input for repetitive data', async () => {
    // zlib should compress repetitive content significantly
    const repetitive = Buffer.from('a'.repeat(1000))
    const compressed = await compress(repetitive)
    expect(compressed.length).toBeLessThan(repetitive.length)
  })

  it('decompress throws on invalid compressed data', async () => {
    const garbage = Buffer.from('this is not compressed data')
    await expect(decompress(garbage)).rejects.toThrow()
  })
})
