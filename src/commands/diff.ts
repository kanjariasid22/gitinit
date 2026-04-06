import { join } from 'node:path'
import { readFileMaybe } from '../utils/fs'
import type { Repository } from '../repository'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ChangeType = 'added' | 'deleted' | 'modified'

export interface DiffLine {
  /** '+' for added, '-' for removed, ' ' for context */
  readonly kind: '+' | '-' | ' '
  readonly content: string
}

export interface FileDiff {
  readonly path: string
  readonly changeType: ChangeType
  readonly hunks: readonly DiffHunk[]
}

export interface DiffHunk {
  /** 1-based line numbers in the old and new file */
  readonly oldStart: number
  readonly oldCount: number
  readonly newStart: number
  readonly newCount: number
  readonly lines: readonly DiffLine[]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute unstaged changes: working directory vs index.
 *
 * This is what `git diff` shows — changes you've made on disk that you
 * haven't yet staged.
 */
export async function diff(repo: Repository): Promise<FileDiff[]> {
  const index = await repo.indexManager.readIndex()
  const results: FileDiff[] = []

  for (const [path, entry] of Object.entries(index)) {
    const absolutePath = join(repo.rootPath, path)
    const diskContent = await readFileMaybe(absolutePath)

    if (diskContent === null) {
      // File deleted from disk
      const blobObj = await repo.objectStore.readObject(entry.hash)
      if (blobObj.type !== 'blob') continue
      results.push(buildFileDiff(path, blobObj.content, null, 'deleted'))
      continue
    }

    if (diskContent.equals(
      await getBlobContent(repo, entry.hash),
    )) continue

    const oldContent = await getBlobContent(repo, entry.hash)
    results.push(buildFileDiff(path, oldContent, diskContent, 'modified'))
  }

  // Files on disk not in index are untracked — not shown in diff (use status)
  return results.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Compute staged changes: index vs HEAD tree.
 *
 * This is what `git diff --staged` shows — changes you've staged that will
 * go into the next commit.
 */
export async function diffStaged(repo: Repository): Promise<FileDiff[]> {
  const index = await repo.indexManager.readIndex()
  const headTree = await resolveHeadTree(repo)
  const results: FileDiff[] = []

  // Files in index not in HEAD, or with different hash
  for (const [path, entry] of Object.entries(index)) {
    const headHash = headTree[path]

    if (!headHash) {
      const content = await getBlobContent(repo, entry.hash)
      results.push(buildFileDiff(path, null, content, 'added'))
      continue
    }

    if (headHash !== entry.hash) {
      const oldContent = await getBlobContent(repo, headHash)
      const newContent = await getBlobContent(repo, entry.hash)
      results.push(buildFileDiff(path, oldContent, newContent, 'modified'))
    }
  }

  // Files in HEAD not in index → staged deletion
  for (const [path, headHash] of Object.entries(headTree)) {
    if (!index[path]) {
      const content = await getBlobContent(repo, headHash)
      results.push(buildFileDiff(path, content, null, 'deleted'))
    }
  }

  return results.sort((a, b) => a.path.localeCompare(b.path))
}

// ---------------------------------------------------------------------------
// Diff construction
// ---------------------------------------------------------------------------

const CONTEXT_LINES = 3

function buildFileDiff(
  path: string,
  oldContent: Buffer | null,
  newContent: Buffer | null,
  changeType: ChangeType,
): FileDiff {
  const oldLines = oldContent ? splitLines(oldContent.toString('utf8')) : []
  const newLines = newContent ? splitLines(newContent.toString('utf8')) : []
  const hunks = buildHunks(oldLines, newLines)
  return { path, changeType, hunks }
}

function splitLines(text: string): string[] {
  // Preserve the trailing newline as an empty entry if present
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Build unified diff hunks from two line arrays using LCS.
 *
 * Real Git uses Myers diff algorithm. We use LCS — it produces correct
 * output and is simpler to understand. The key insight is the same: find
 * the longest sequence of lines shared between old and new, then everything
 * outside that sequence is a change.
 *
 * Context lines (3 by default) are included around each changed region,
 * and adjacent change regions are merged into a single hunk.
 */
function buildHunks(oldLines: string[], newLines: string[]): DiffHunk[] {
  const lcs = computeLCS(oldLines, newLines)
  const changes = buildChangeList(oldLines, newLines, lcs)

  if (changes.every((c) => c.kind === ' ')) return []

  return groupIntoHunks(changes, oldLines.length, newLines.length)
}

// ---------------------------------------------------------------------------
// LCS algorithm
// ---------------------------------------------------------------------------

interface Change {
  kind: '+' | '-' | ' '
  content: string
  oldLine: number // 1-based, 0 if added
  newLine: number // 1-based, 0 if deleted
}

/**
 * Compute the Longest Common Subsequence of two string arrays.
 * Returns a 2D DP table used to trace back the diff.
 */
function computeLCS(a: string[], b: string[]): number[][] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  )

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  return dp
}

/**
 * Trace back through the LCS table to produce a list of Change records.
 */
function buildChangeList(
  a: string[],
  b: string[],
  dp: number[][],
): Change[] {
  const changes: Change[] = []
  let i = a.length
  let j = b.length

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      changes.push({ kind: ' ', content: a[i - 1], oldLine: i, newLine: j })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      changes.push({ kind: '+', content: b[j - 1], oldLine: 0, newLine: j })
      j--
    } else {
      changes.push({ kind: '-', content: a[i - 1], oldLine: i, newLine: 0 })
      i--
    }
  }

  return changes.reverse()
}

// ---------------------------------------------------------------------------
// Hunk grouping
// ---------------------------------------------------------------------------

function groupIntoHunks(
  changes: Change[],
  _oldTotal: number,
  _newTotal: number,
): DiffHunk[] {
  // Find indices of changed lines
  const changedIndices = changes
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.kind !== ' ')
    .map(({ i }) => i)

  if (changedIndices.length === 0) return []

  // Expand each changed region with CONTEXT_LINES on each side, then merge
  const regions: Array<{ start: number; end: number }> = []

  for (const idx of changedIndices) {
    const start = Math.max(0, idx - CONTEXT_LINES)
    const end = Math.min(changes.length - 1, idx + CONTEXT_LINES)

    const last = regions[regions.length - 1]
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end)
    } else {
      regions.push({ start, end })
    }
  }

  return regions.map(({ start, end }) => {
    const slice = changes.slice(start, end + 1)

    const oldLines = slice.filter((c) => c.kind !== '+')
    const newLines = slice.filter((c) => c.kind !== '-')

    const oldStart = oldLines[0]?.oldLine ?? 1
    const newStart = newLines[0]?.newLine ?? 1

    return {
      oldStart,
      oldCount: oldLines.length,
      newStart,
      newCount: newLines.length,
      lines: slice.map((c) => ({ kind: c.kind, content: c.content })),
    }
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getBlobContent(
  repo: Repository,
  hash: string,
): Promise<Buffer> {
  const obj = await repo.objectStore.readObject(hash)
  if (obj.type !== 'blob') throw new Error(`Expected blob: ${hash}`)
  return obj.content
}

async function resolveHeadTree(
  repo: Repository,
): Promise<Record<string, string>> {
  const headHash = await repo.refStore.readHead()
  if (!headHash) return {}

  const commitObj = await repo.objectStore.readObject(headHash)
  if (commitObj.type !== 'commit') return {}

  return flattenTree(repo, commitObj.treeHash, '')
}

async function flattenTree(
  repo: Repository,
  treeHash: string,
  prefix: string,
): Promise<Record<string, string>> {
  const treeObj = await repo.objectStore.readObject(treeHash)
  if (treeObj.type !== 'tree') return {}

  const result: Record<string, string> = {}

  for (const entry of treeObj.entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.mode === '040000') {
      Object.assign(result, await flattenTree(repo, entry.hash, path))
    } else {
      result[path] = entry.hash
    }
  }

  return result
}
