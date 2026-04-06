import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { sha1 } from '../utils/hash'
import { readFileMaybe } from '../utils/fs'
import type { Repository } from '../repository'
import type { Index } from '../index/index-manager'

export interface StatusResult {
  /** Files added/modified/deleted in the index since the last commit. */
  readonly staged: {
    readonly added: string[]
    readonly modified: string[]
    readonly deleted: string[]
  }
  /** Files changed on disk but not yet staged. */
  readonly unstaged: {
    readonly modified: string[]
    readonly deleted: string[]
  }
  /** Files on disk not tracked by the index. */
  readonly untracked: string[]
}

/**
 * Compute the three-way status: HEAD tree vs index vs working directory.
 *
 * Real Git has a much more optimised implementation using stat caching in
 * the binary index. We use the same stat-cache concept (mtime + size check
 * before rehashing) but walk the working directory naively.
 */
export async function status(repo: Repository): Promise<StatusResult> {
  const index = await repo.indexManager.readIndex()
  const headTree = await resolveHeadTree(repo)

  const staged = computeStagedChanges(headTree, index)
  const { unstaged, untracked } = await computeWorkingDirChanges(
    repo,
    index,
  )

  return { staged, unstaged, untracked }
}

// ---------------------------------------------------------------------------
// Staged changes: HEAD tree vs index
// ---------------------------------------------------------------------------

function computeStagedChanges(
  headTree: Record<string, string>,
  index: Index,
): StatusResult['staged'] {
  const added: string[] = []
  const modified: string[] = []
  const deleted: string[] = []

  // Files in index but not in HEAD → added
  // Files in both but with different hashes → modified
  for (const [path, entry] of Object.entries(index)) {
    const headHash = headTree[path]
    if (!headHash) {
      added.push(path)
    } else if (headHash !== entry.hash) {
      modified.push(path)
    }
  }

  // Files in HEAD but not in index → deleted
  for (const path of Object.keys(headTree)) {
    if (!index[path]) {
      deleted.push(path)
    }
  }

  return {
    added: added.sort(),
    modified: modified.sort(),
    deleted: deleted.sort(),
  }
}

// ---------------------------------------------------------------------------
// Working directory changes: index vs disk
// ---------------------------------------------------------------------------

async function computeWorkingDirChanges(
  repo: Repository,
  index: Index,
): Promise<{ unstaged: StatusResult['unstaged']; untracked: string[] }> {
  const modified: string[] = []
  const deleted: string[] = []
  const untracked: string[] = []

  // Check every indexed file against the working directory
  for (const [path, entry] of Object.entries(index)) {
    const absolutePath = join(repo.rootPath, path)
    const unchanged = await repo.indexManager.isUnchanged(entry, absolutePath)

    if (unchanged) continue

    // Stat mismatch — check if the file is gone or actually changed
    const data = await readFileMaybe(absolutePath)
    if (data === null) {
      deleted.push(path)
    } else {
      // Rehash to confirm it really changed (not just a touched mtime)
      const content = data
      const header = Buffer.from(`blob ${content.length}\0`)
      const hash = sha1(Buffer.concat([header, content]))
      if (hash !== entry.hash) {
        modified.push(path)
      }
    }
  }

  // Walk the working directory to find untracked files
  const workingDirFiles = await collectWorkingDirFiles(repo.rootPath)
  for (const path of workingDirFiles) {
    if (!index[path]) {
      untracked.push(path)
    }
  }

  return {
    unstaged: { modified: modified.sort(), deleted: deleted.sort() },
    untracked: untracked.sort(),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the HEAD commit's tree into a flat path→hash map.
 * Returns an empty map for an unborn repository (no commits yet).
 */
async function resolveHeadTree(
  repo: Repository,
): Promise<Record<string, string>> {
  const headHash = await repo.refStore.readHead()
  if (!headHash) return {}

  const commitObj = await repo.objectStore.readObject(headHash)
  if (commitObj.type !== 'commit') return {}

  return flattenTree(repo, commitObj.treeHash, '')
}

/**
 * Recursively walk a tree object and return a flat map of
 * repo-relative path → blob hash for every file in the tree.
 */
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
      // Subtree — recurse
      const sub = await flattenTree(repo, entry.hash, path)
      Object.assign(result, sub)
    } else {
      // Blob
      result[path] = entry.hash
    }
  }

  return result
}

/**
 * Recursively collect all file paths under rootPath, ignoring .gitinit/.
 * Returns repo-relative paths with forward slashes.
 */
async function collectWorkingDirFiles(rootPath: string): Promise<string[]> {
  const results: string[] = []

  async function walk(dir: string, prefix: string): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry === '.gitinit') continue

      const fullPath = join(dir, entry)
      const fileStat = await stat(fullPath).catch(() => null)
      if (!fileStat) continue

      const relPath = prefix ? `${prefix}/${entry}` : entry

      if (fileStat.isDirectory()) {
        await walk(fullPath, relPath)
      } else {
        results.push(relPath)
      }
    }
  }

  await walk(rootPath, '')
  return results
}
