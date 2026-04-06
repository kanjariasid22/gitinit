import { writeFile, mkdir, unlink, readdir, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { Repository } from '../repository'
import type { Index } from '../index/index-manager'
import type { FileMode } from '../objects'

/**
 * Switch to a branch or detach HEAD at a commit hash.
 *
 * Steps:
 *   1. Resolve the target to a commit hash
 *   2. Update HEAD (symbolic ref for branch, direct hash for detached)
 *   3. Restore the working directory from the target commit's tree
 *   4. Rebuild the index to match the restored tree
 *
 * Simplification vs real Git: real Git performs a three-way merge when
 * switching branches so that local modifications are carried over safely.
 * We do a hard switch — any uncommitted changes are overwritten. This is
 * documented in DECISIONS.md.
 */
export async function checkout(
  repo: Repository,
  target: string,
): Promise<void> {
  // Resolve target: try as a branch name first, then as a raw commit hash
  const branchHash = await repo.refStore.readBranch(target)
  const isBranch = branchHash !== null
  const commitHash = branchHash ?? target

  // Validate — make sure the object exists and is a commit
  const commitObj = await repo.objectStore.readObject(commitHash)
  if (commitObj.type !== 'commit') {
    throw new Error(`Not a commit: ${commitHash}`)
  }

  // Update HEAD before touching the working tree
  if (isBranch) {
    await repo.refStore.writeHeadSymbolic(target)
  } else {
    await repo.refStore.writeHeadDetached(commitHash)
  }

  // Clear the working directory (tracked files only) and restore from tree
  const currentIndex = await repo.indexManager.readIndex()
  await removeTrackedFiles(repo.rootPath, currentIndex)

  const newIndex: Index = {}
  await restoreTree(repo, commitObj.treeHash, '', newIndex)

  await repo.indexManager.writeIndex(newIndex)
}

// ---------------------------------------------------------------------------
// Working tree restoration
// ---------------------------------------------------------------------------

/**
 * Recursively write all files in a tree object to the working directory,
 * and populate `index` with entries for each restored file.
 */
async function restoreTree(
  repo: Repository,
  treeHash: string,
  prefix: string,
  index: Index,
): Promise<void> {
  const treeObj = await repo.objectStore.readObject(treeHash)
  if (treeObj.type !== 'tree') return

  for (const entry of treeObj.entries) {
    const repoPath = prefix ? `${prefix}/${entry.name}` : entry.name
    const absolutePath = join(repo.rootPath, repoPath)

    if (entry.mode === '040000') {
      await restoreTree(repo, entry.hash, repoPath, index)
    } else {
      const blobObj = await repo.objectStore.readObject(entry.hash)
      if (blobObj.type !== 'blob') continue

      await mkdir(dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, blobObj.content)

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

/**
 * Remove all files currently tracked by the index from the working
 * directory. Leaves untracked files untouched.
 */
async function removeTrackedFiles(
  rootPath: string,
  index: Index,
): Promise<void> {
  for (const repoPath of Object.keys(index)) {
    const absolutePath = join(rootPath, repoPath)
    try {
      await unlink(absolutePath)
    } catch {
      // File already gone — not an error
    }
  }

  // Clean up any empty directories left behind
  await removeEmptyDirs(rootPath)
}

/**
 * Recursively remove empty directories under rootPath, skipping .gitinit/.
 */
async function removeEmptyDirs(dir: string): Promise<void> {
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
    if (fileStat?.isDirectory()) {
      await removeEmptyDirs(fullPath)
      // Try removing the dir — only succeeds if it's now empty
      const { rmdir } = await import('node:fs/promises')
      await rmdir(fullPath).catch(() => undefined)
    }
  }
}
