import { describe, it, expect } from 'vitest'
import {
  createCommit,
  serializeCommit,
  deserializeCommit,
} from '../../src/objects/commit'
import type { CommitObject, GitSignature } from '../../src/objects/types'

const AUTHOR: GitSignature = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  timestamp: 1712345678,
  timezone: '+0000',
}

const TREE_HASH = 'a'.repeat(40)
const PARENT_HASH = 'b'.repeat(40)

function makeCommit(
  overrides: Partial<Omit<CommitObject, 'type'>> = {},
): CommitObject {
  return createCommit({
    treeHash: TREE_HASH,
    parentHashes: [],
    author: AUTHOR,
    committer: AUTHOR,
    message: 'initial commit',
    ...overrides,
  })
}

describe('commit', () => {
  describe('createCommit', () => {
    it('sets type to "commit"', () => {
      expect(makeCommit().type).toBe('commit')
    })
  })

  describe('serializeCommit', () => {
    it('starts with "tree <hash>"', () => {
      const text = serializeCommit(makeCommit()).toString()
      expect(text.startsWith(`tree ${TREE_HASH}\n`)).toBe(true)
    })

    it('omits parent line for a root commit', () => {
      const text = serializeCommit(makeCommit({ parentHashes: [] })).toString()
      expect(text).not.toContain('parent ')
    })

    it('includes a parent line when parent is provided', () => {
      const text = serializeCommit(
        makeCommit({ parentHashes: [PARENT_HASH] }),
      ).toString()
      expect(text).toContain(`parent ${PARENT_HASH}`)
    })

    it('includes multiple parent lines for a merge commit', () => {
      const p2 = 'c'.repeat(40)
      const text = serializeCommit(
        makeCommit({ parentHashes: [PARENT_HASH, p2] }),
      ).toString()
      expect(text).toContain(`parent ${PARENT_HASH}`)
      expect(text).toContain(`parent ${p2}`)
    })

    it('formats the author signature correctly', () => {
      const text = serializeCommit(makeCommit()).toString()
      expect(text).toContain(
        'author Ada Lovelace <ada@example.com> 1712345678 +0000',
      )
    })

    it('contains a blank line separating headers from the message', () => {
      const text = serializeCommit(
        makeCommit({ message: 'my message' }),
      ).toString()
      expect(text).toContain('\n\nmy message')
    })

    it('preserves a multi-line commit message', () => {
      const message = 'subject line\n\nbody paragraph\nsecond body line'
      const text = serializeCommit(makeCommit({ message })).toString()
      expect(text.endsWith(message)).toBe(true)
    })

    it('serializes author before committer', () => {
      const text = serializeCommit(makeCommit()).toString()
      const authorIdx = text.indexOf('author ')
      const committerIdx = text.indexOf('committer ')
      expect(authorIdx).toBeLessThan(committerIdx)
    })
  })

  describe('deserializeCommit', () => {
    it('round-trips a root commit', () => {
      const original = makeCommit()
      const restored = deserializeCommit(serializeCommit(original))
      expect(restored.type).toBe('commit')
      expect(restored.treeHash).toBe(original.treeHash)
      expect(restored.parentHashes).toEqual([])
      expect(restored.author).toEqual(original.author)
      expect(restored.committer).toEqual(original.committer)
      expect(restored.message).toBe(original.message)
    })

    it('round-trips a commit with parents', () => {
      const original = makeCommit({ parentHashes: [PARENT_HASH] })
      const restored = deserializeCommit(serializeCommit(original))
      expect(restored.parentHashes).toEqual([PARENT_HASH])
    })

    it('round-trips an author name with spaces', () => {
      const sig: GitSignature = { ...AUTHOR, name: 'Grace Murray Hopper' }
      const original = makeCommit({ author: sig, committer: sig })
      const restored = deserializeCommit(serializeCommit(original))
      expect(restored.author.name).toBe('Grace Murray Hopper')
    })

    it('round-trips a multi-line commit message', () => {
      const message = 'subject\n\nbody line 1\nbody line 2'
      const original = makeCommit({ message })
      const restored = deserializeCommit(serializeCommit(original))
      expect(restored.message).toBe(message)
    })

    it('throws on malformed commit data', () => {
      expect(() =>
        deserializeCommit(Buffer.from('no blank line here')),
      ).toThrow()
    })

    it('throws when tree hash is missing', () => {
      const bad = Buffer.from('author A <a@b.com> 0 +0000\n\nmessage')
      expect(() => deserializeCommit(bad)).toThrow(/tree/)
    })
  })
})
