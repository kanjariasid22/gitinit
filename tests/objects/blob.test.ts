import { describe, it, expect } from 'vitest'
import {
  createBlob,
  serializeBlob,
  deserializeBlob,
} from '../../src/objects/blob'
import { sha1 } from '../../src/utils/hash'

describe('blob', () => {
  describe('createBlob', () => {
    it('sets type to "blob"', () => {
      const blob = createBlob(Buffer.from('hello'))
      expect(blob.type).toBe('blob')
    })

    it('stores the content buffer', () => {
      const content = Buffer.from('hello world')
      const blob = createBlob(content)
      expect(blob.content).toEqual(content)
    })
  })

  describe('serializeBlob', () => {
    it('returns the raw content bytes unchanged', () => {
      const content = Buffer.from('hello\n')
      const blob = createBlob(content)
      expect(serializeBlob(blob)).toEqual(content)
    })

    it('handles binary content correctly', () => {
      const binary = Buffer.from([0x00, 0xff, 0x80, 0x01])
      expect(serializeBlob(createBlob(binary))).toEqual(binary)
    })

    it('handles an empty blob', () => {
      const empty = createBlob(Buffer.alloc(0))
      expect(serializeBlob(empty)).toEqual(Buffer.alloc(0))
    })
  })

  describe('deserializeBlob', () => {
    it('round-trips: deserialize(serialize(blob)) equals original', () => {
      const original = createBlob(Buffer.from('round trip test'))
      const restored = deserializeBlob(serializeBlob(original))
      expect(restored.type).toBe('blob')
      expect(restored.content).toEqual(original.content)
    })
  })

  describe('SHA-1 cross-verification with real Git', () => {
    it('produces the same object hash as real Git for "hello\\n"', () => {
      // Real Git stores a blob as: "blob <N>\0<content>"
      // Verifiable: echo "hello" | git hash-object --stdin
      // Expected:   ce013625030ba8dba906f756967f9e9ca394464a
      const content = Buffer.from('hello\n')
      const blob = createBlob(content)
      const serialized = serializeBlob(blob)
      const header = Buffer.from(`blob ${serialized.length}\0`)
      const fullObject = Buffer.concat([header, serialized])
      expect(sha1(fullObject)).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
    })
  })
})
