import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { Repository } from '../repository'
import type { Index } from '../index/index-manager'
import type { FileMode } from '../objects'
import { createCommit } from '../objects'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MergeResult {
  readonly status: 'up-to-date' | 'fast-forward' | 'merged' | 'conflict'
  /** Repo-relative paths of files that have conflict markers. */
  readonly conflicts: string[]
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Merge the given branch into the current HEAD.
 *
 * Three cases:
 *   up-to-date   — target is already in our history, nothing to do
 *   fast-forward — we are an ancestor of target, just move HEAD forward
 *   merged       — true three-way merge, produces a merge commit
 *   conflict     — three-way merge with unresolvable conflicts; merge commit
 *                  is NOT created — user must resolve and commit manually
 *
 * Simplification vs real Git: real Git has multiple merge strategies
 * (recursive, ort, octopus). We implement a basic three-way merge with
 * no rename detection.
 */
export async function merge(
  repo: Repository,
  branchName: string,
): Promise<MergeResult> {
  const ourHash = await repo.refStore.readHead()
  if (!ourHash) throw new Error('Cannot merge: no commits on current branch')

  const theirHash = await repo.refStore.readBranch(branchName)
  if (!theirHash) throw new Error(`Branch not found: ${branchName}`)

  if (ourHash === theirHash) {
    return { status: 'up-to-date', conflicts: [] }
  }

  const baseHash = await findMergeBase(repo, ourHash, theirHash)

  // Case 1: their branch is already in our history
  if (baseHash === theirHash) {
    return { status: 'up-to-date', conflicts: [] }
  }

  // Case 2: we are behind — fast-forward
  if (baseHash === ourHash) {
    return fastForward(repo, theirHash, branchName)
  }

  // Case 3: true three-way merge
  // baseHash can only be null if the two histories share no common ancestor,
  // which shouldn't happen in a single-repo workflow. Treat as empty base.
  return threeWayMerge(
    repo,
    ourHash,
    theirHash,
    baseHash ?? ourHash,
    branchName,
  )
}

// ---------------------------------------------------------------------------
// Fast-forward
// ---------------------------------------------------------------------------

async function fastForward(
  repo: Repository,
  theirHash: string,
  _branchName: string,
): Promise<MergeResult> {
  const commitObj = await repo.objectStore.readObject(theirHash)
  if (commitObj.type !== 'commit') throw new Error('Expected commit object')

  // Restore working tree and index from the target commit
  const newIndex: Index = {}
  await restoreTree(repo, commitObj.treeHash, '', newIndex)
  await repo.indexManager.writeIndex(newIndex)

  const currentBranch = await repo.refStore.readHeadBranch()
  if (currentBranch) {
    await repo.refStore.writeBranch(currentBranch, theirHash)
  } else {
    await repo.refStore.writeHeadDetached(theirHash)
  }

  return { status: 'fast-forward', conflicts: [] }
}

// ---------------------------------------------------------------------------
// Three-way merge
// ---------------------------------------------------------------------------

async function threeWayMerge(
  repo: Repository,
  ourHash: string,
  theirHash: string,
  baseHash: string,
  theirBranch: string,
): Promise<MergeResult> {
  const baseTrees = await flattenTree(
    repo,
    await getTreeHash(repo, baseHash),
    '',
  )
  const ourTrees = await flattenTree(repo, await getTreeHash(repo, ourHash), '')
  const theirTrees = await flattenTree(
    repo,
    await getTreeHash(repo, theirHash),
    '',
  )

  const allPaths = new Set([
    ...Object.keys(baseTrees),
    ...Object.keys(ourTrees),
    ...Object.keys(theirTrees),
  ])

  const conflicts: string[] = []
  const newIndex: Index = {}

  for (const path of allPaths) {
    const baseHash_ = baseTrees[path] ?? null
    const ourHash_ = ourTrees[path] ?? null
    const theirHash_ = theirTrees[path] ?? null

    const result = await mergeFile(repo, path, baseHash_, ourHash_, theirHash_)

    if (result.conflict) conflicts.push(path)

    if (result.content !== null) {
      const absolutePath = join(repo.rootPath, path)
      await mkdir(dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, result.content)

      const { stat } = await import('node:fs/promises')
      const fileStat = await stat(absolutePath)
      newIndex[path] = {
        hash: result.hash ?? ourHash_ ?? theirHash_ ?? baseHash_ ?? '',
        mode: '100644' as FileMode,
        mtime: fileStat.mtimeMs,
        size: fileStat.size,
      }
    }
  }

  await repo.indexManager.writeIndex(newIndex)

  if (conflicts.length > 0) {
    return { status: 'conflict', conflicts }
  }

  // No conflicts — create the merge commit
  const currentBranch = await repo.refStore.readHeadBranch()
  const signature = makeSignature()
  const treeHash = await buildTreeFromIndex(repo, newIndex)

  const mergeCommit = createCommit({
    treeHash,
    parentHashes: [ourHash, theirHash],
    author: signature,
    committer: signature,
    message: `Merge branch '${theirBranch}'`,
  })

  const mergeHash = await repo.objectStore.writeObject(mergeCommit)

  if (currentBranch) {
    await repo.refStore.writeBranch(currentBranch, mergeHash)
  } else {
    await repo.refStore.writeHeadDetached(mergeHash)
  }

  return { status: 'merged', conflicts: [] }
}

// ---------------------------------------------------------------------------
// File-level three-way merge
// ---------------------------------------------------------------------------

interface FilemergeResult {
  content: Buffer | null
  hash: string | null
  conflict: boolean
}

async function mergeFile(
  repo: Repository,
  path: string,
  baseHash: string | null,
  ourHash: string | null,
  theirHash: string | null,
): Promise<FilemergeResult> {
  const ourChanged = ourHash !== baseHash
  const theirChanged = theirHash !== baseHash

  // Neither side changed — keep base
  if (!ourChanged && !theirChanged) {
    const content = baseHash ? await getBlobContent(repo, baseHash) : null
    return { content, hash: baseHash, conflict: false }
  }

  // Only ours changed
  if (ourChanged && !theirChanged) {
    if (!ourHash) return { content: null, hash: null, conflict: false } // we deleted it
    const content = await getBlobContent(repo, ourHash)
    return { content, hash: ourHash, conflict: false }
  }

  // Only theirs changed
  if (!ourChanged && theirChanged) {
    if (!theirHash) return { content: null, hash: null, conflict: false } // they deleted it
    const content = await getBlobContent(repo, theirHash)
    return { content, hash: theirHash, conflict: false }
  }

  // Both changed — check if identically
  if (ourHash === theirHash) {
    const content = ourHash ? await getBlobContent(repo, ourHash) : null
    return { content, hash: ourHash, conflict: false }
  }

  // Both changed differently — attempt line-level merge
  // Deletion on either side while the other modified → conflict
  if (!ourHash || !theirHash) {
    const existingHash = ourHash ?? theirHash
    const content = existingHash
      ? await getBlobContent(repo, existingHash)
      : null
    const conflictContent = buildDeletionConflict(
      path,
      content,
      !ourHash ? 'ours' : 'theirs',
    )
    return {
      content: Buffer.from(conflictContent),
      hash: null,
      conflict: true,
    }
  }

  const baseContent = baseHash
    ? await getBlobContent(repo, baseHash)
    : Buffer.alloc(0)
  const ourContent = await getBlobContent(repo, ourHash)
  const theirContent = await getBlobContent(repo, theirHash)

  const { merged, hasConflict } = mergeLines(
    path,
    splitLines(baseContent.toString('utf8')),
    splitLines(ourContent.toString('utf8')),
    splitLines(theirContent.toString('utf8')),
  )

  return {
    content: Buffer.from(merged.join('\n') + '\n'),
    hash: null,
    conflict: hasConflict,
  }
}

// ---------------------------------------------------------------------------
// Line-level diff3 merge
// ---------------------------------------------------------------------------

/**
 * Merge three versions of a file at the line level using a diff3-style
 * algorithm.
 *
 * For each region of the base:
 *   - unchanged in both → keep base
 *   - changed only in ours → take ours
 *   - changed only in theirs → take theirs
 *   - changed in both the same way → take once
 *   - changed in both differently → conflict markers
 */
function mergeLines(
  path: string,
  base: string[],
  ours: string[],
  theirs: string[],
): { merged: string[]; hasConflict: boolean } {
  // Compute diffs from base to each side
  const diffOurs = computeDiff(base, ours)
  const diffTheirs = computeDiff(base, theirs)

  // Build region chunks from the base perspective
  const chunks = buildMergeChunks(base, diffOurs, diffTheirs)

  const merged: string[] = []
  let hasConflict = false

  for (const chunk of chunks) {
    switch (chunk.type) {
      case 'unchanged':
        merged.push(...chunk.lines)
        break
      case 'ours':
        merged.push(...chunk.lines)
        break
      case 'theirs':
        merged.push(...chunk.lines)
        break
      case 'conflict':
        hasConflict = true
        merged.push(`<<<<<<< HEAD`)
        merged.push(...chunk.ourLines)
        merged.push('=======')
        merged.push(...chunk.theirLines)
        merged.push(`>>>>>>> ${path}`)
        break
    }
  }

  return { merged, hasConflict }
}

type ChunkType = 'unchanged' | 'ours' | 'theirs' | 'conflict'

interface MergeChunk {
  type: ChunkType
  lines: string[]
  ourLines: string[]
  theirLines: string[]
}

interface DiffOp {
  type: 'keep' | 'replace'
  baseLines: string[]
  newLines: string[]
}

/**
 * Compute a simplified diff from `a` to `b` as a list of keep/replace ops
 * over the lines of `a`.
 */
function computeDiff(a: string[], b: string[]): DiffOp[] {
  const dp = computeLCS(a, b)
  const ops: DiffOp[] = []
  let i = a.length
  let j = b.length

  const raw: Array<{ kind: 'keep' | 'del' | 'add'; line: string }> = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      raw.push({ kind: 'keep', line: a[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.push({ kind: 'add', line: b[j - 1] })
      j--
    } else {
      raw.push({ kind: 'del', line: a[i - 1] })
      i--
    }
  }
  raw.reverse()

  // Group into keep and replace ops
  let k = 0
  while (k < raw.length) {
    if (raw[k].kind === 'keep') {
      const start = k
      while (k < raw.length && raw[k].kind === 'keep') k++
      ops.push({
        type: 'keep',
        baseLines: raw.slice(start, k).map((r) => r.line),
        newLines: raw.slice(start, k).map((r) => r.line),
      })
    } else {
      const deleted: string[] = []
      const added: string[] = []
      while (k < raw.length && raw[k].kind !== 'keep') {
        if (raw[k].kind === 'del') deleted.push(raw[k].line)
        else added.push(raw[k].line)
        k++
      }
      ops.push({ type: 'replace', baseLines: deleted, newLines: added })
    }
  }

  return ops
}

/**
 * Align the two sets of diff ops over the base and produce merge chunks.
 */
function buildMergeChunks(
  _base: string[],
  diffOurs: DiffOp[],
  diffTheirs: DiffOp[],
): MergeChunk[] {
  const chunks: MergeChunk[] = []
  let oi = 0
  let ti = 0

  while (oi < diffOurs.length || ti < diffTheirs.length) {
    const o = diffOurs[oi]
    const t = diffTheirs[ti]

    if (!o) {
      // Remaining theirs ops
      if (t.type === 'keep') {
        chunks.push({
          type: 'unchanged',
          lines: t.newLines,
          ourLines: [],
          theirLines: [],
        })
      } else {
        chunks.push({
          type: 'theirs',
          lines: t.newLines,
          ourLines: [],
          theirLines: [],
        })
      }
      ti++
      continue
    }

    if (!t) {
      // Remaining ours ops
      if (o.type === 'keep') {
        chunks.push({
          type: 'unchanged',
          lines: o.newLines,
          ourLines: [],
          theirLines: [],
        })
      } else {
        chunks.push({
          type: 'ours',
          lines: o.newLines,
          ourLines: [],
          theirLines: [],
        })
      }
      oi++
      continue
    }

    if (o.type === 'keep' && t.type === 'keep') {
      chunks.push({
        type: 'unchanged',
        lines: o.newLines,
        ourLines: [],
        theirLines: [],
      })
      oi++
      ti++
    } else if (o.type === 'keep' && t.type === 'replace') {
      // Theirs changed this region, ours kept it
      chunks.push({
        type: 'theirs',
        lines: t.newLines,
        ourLines: [],
        theirLines: [],
      })
      oi++
      ti++
    } else if (o.type === 'replace' && t.type === 'keep') {
      // Ours changed this region, theirs kept it
      chunks.push({
        type: 'ours',
        lines: o.newLines,
        ourLines: [],
        theirLines: [],
      })
      oi++
      ti++
    } else {
      // Both changed — conflict unless identical
      if (JSON.stringify(o.newLines) === JSON.stringify(t.newLines)) {
        chunks.push({
          type: 'ours',
          lines: o.newLines,
          ourLines: [],
          theirLines: [],
        })
      } else {
        chunks.push({
          type: 'conflict',
          lines: [],
          ourLines: o.newLines,
          theirLines: t.newLines,
        })
      }
      oi++
      ti++
    }
  }

  return chunks
}

/** LCS DP table — same algorithm as in diff.ts. */
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

function buildDeletionConflict(
  path: string,
  content: Buffer | null,
  deletedSide: 'ours' | 'theirs',
): string {
  const lines = content ? splitLines(content.toString('utf8')) : []
  if (deletedSide === 'ours') {
    return [
      '<<<<<<< HEAD',
      '',
      '=======',
      ...lines,
      `>>>>>>> ${path}`,
      '',
    ].join('\n')
  }
  return ['<<<<<<< HEAD', ...lines, '=======', '', `>>>>>>> ${path}`, ''].join(
    '\n',
  )
}

// ---------------------------------------------------------------------------
// Merge base (LCA)
// ---------------------------------------------------------------------------

/**
 * Find the lowest common ancestor of two commits using BFS.
 *
 * Collect all ancestors of `hashA` (including itself), then walk `hashB`'s
 * history and return the first commit found in that set.
 */
async function findMergeBase(
  repo: Repository,
  hashA: string,
  hashB: string,
): Promise<string | null> {
  const ancestorsA = new Set<string>()
  const queue: string[] = [hashA]

  while (queue.length > 0) {
    const h = queue.shift()!
    if (ancestorsA.has(h)) continue
    ancestorsA.add(h)
    const obj = await repo.objectStore.readObject(h)
    if (obj.type === 'commit') queue.push(...obj.parentHashes)
  }

  const queueB: string[] = [hashB]
  const visited = new Set<string>()

  while (queueB.length > 0) {
    const h = queueB.shift()!
    if (visited.has(h)) continue
    visited.add(h)
    if (ancestorsA.has(h)) return h
    const obj = await repo.objectStore.readObject(h)
    if (obj.type === 'commit') queueB.push(...obj.parentHashes)
  }

  return null
}

// ---------------------------------------------------------------------------
// Tree helpers (shared with status, diff, checkout)
// ---------------------------------------------------------------------------

async function getTreeHash(
  repo: Repository,
  commitHash: string,
): Promise<string> {
  const obj = await repo.objectStore.readObject(commitHash)
  if (obj.type !== 'commit') throw new Error(`Expected commit: ${commitHash}`)
  return obj.treeHash
}

async function flattenTree(
  repo: Repository,
  treeHash: string,
  prefix: string,
): Promise<Record<string, string>> {
  const obj = await repo.objectStore.readObject(treeHash)
  if (obj.type !== 'tree') return {}

  const result: Record<string, string> = {}
  for (const entry of obj.entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.mode === '040000') {
      Object.assign(result, await flattenTree(repo, entry.hash, path))
    } else {
      result[path] = entry.hash
    }
  }
  return result
}

async function restoreTree(
  repo: Repository,
  treeHash: string,
  prefix: string,
  index: Index,
): Promise<void> {
  const obj = await repo.objectStore.readObject(treeHash)
  if (obj.type !== 'tree') return

  for (const entry of obj.entries) {
    const repoPath = prefix ? `${prefix}/${entry.name}` : entry.name
    const absolutePath = join(repo.rootPath, repoPath)
    if (entry.mode === '040000') {
      await restoreTree(repo, entry.hash, repoPath, index)
    } else {
      const blob = await repo.objectStore.readObject(entry.hash)
      if (blob.type !== 'blob') continue
      await mkdir(dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, blob.content)
      const { stat } = await import('node:fs/promises')
      const fileStat = await stat(absolutePath)
      index[repoPath] = {
        hash: entry.hash,
        mode: entry.mode as FileMode,
        mtime: fileStat.mtimeMs,
        size: fileStat.size,
      }
    }
  }
}

async function buildTreeFromIndex(
  repo: Repository,
  index: Index,
): Promise<string> {
  const { createTree } = await import('../objects')
  type TreeEntry = import('../objects').TreeEntry

  const files = new Map<string, string>()
  const dirs = new Set<string>()

  for (const [path, entry] of Object.entries(index)) {
    const slash = path.indexOf('/')
    if (slash === -1) {
      files.set(path, entry.hash)
    } else {
      dirs.add(path.slice(0, slash))
    }
  }

  const entries: TreeEntry[] = []
  for (const [name, hash] of files) {
    entries.push({ mode: '100644', name, hash })
  }
  for (const dir of dirs) {
    const subIndex: Index = {}
    for (const [p, e] of Object.entries(index)) {
      if (p.startsWith(dir + '/')) {
        subIndex[p.slice(dir.length + 1)] = e
      }
    }
    const subHash = await buildTreeFromIndex(repo, subIndex)
    entries.push({ mode: '040000', name: dir, hash: subHash })
  }

  const tree = createTree(entries)
  return repo.objectStore.writeObject(tree)
}

async function getBlobContent(repo: Repository, hash: string): Promise<Buffer> {
  const obj = await repo.objectStore.readObject(hash)
  if (obj.type !== 'blob') throw new Error(`Expected blob: ${hash}`)
  return obj.content
}

function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function makeSignature(): import('../objects').GitSignature {
  return {
    name: process.env['GITINIT_AUTHOR_NAME'] ?? 'Unknown',
    email: process.env['GITINIT_AUTHOR_EMAIL'] ?? 'unknown@example.com',
    timestamp: Math.floor(Date.now() / 1000),
    timezone: '+0000',
  }
}
