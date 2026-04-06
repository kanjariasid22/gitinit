import { createCommit, createTree } from '../objects'
import type { TreeEntry, GitSignature } from '../objects'
import type { Index } from '../index/index-manager'
import type { Repository } from '../repository'

/**
 * Create a commit from the current index and advance HEAD.
 *
 * Steps:
 *   1. Build a tree object from the index (handling nested paths)
 *   2. Write the tree (and all subtrees) to the object store
 *   3. Resolve the current HEAD commit hash (null for root commit)
 *   4. Write the commit object
 *   5. Advance the current branch ref to the new commit hash
 *
 * Returns the new commit hash.
 */
export async function commit(
  repo: Repository,
  message: string,
): Promise<string> {
  const index = await repo.indexManager.readIndex()

  if (Object.keys(index).length === 0) {
    throw new Error('Nothing to commit — the index is empty')
  }

  const treeHash = await buildTree(repo, index, '')
  const parentHash = await repo.refStore.readHead()
  const parentHashes = parentHash ? [parentHash] : []
  const signature = makeSignature()

  const commitObj = createCommit({
    treeHash,
    parentHashes,
    author: signature,
    committer: signature,
    message,
  })

  const commitHash = await repo.objectStore.writeObject(commitObj)

  // Advance the current branch (or write directly to HEAD in detached state)
  const branch = await repo.refStore.readHeadBranch()
  if (branch) {
    await repo.refStore.writeBranch(branch, commitHash)
  } else {
    await repo.refStore.writeHeadDetached(commitHash)
  }

  return commitHash
}

/**
 * Recursively build tree objects from the index for a given directory prefix.
 *
 * The index is flat (e.g. {"src/utils/hash.ts": {...}}). To write a tree we
 * need to reconstruct the directory hierarchy:
 *   root tree → "src" subtree → "utils" subtree → blob "hash.ts"
 *
 * This function groups index entries by their first path component under
 * `prefix`, recurses into subdirectories to get their tree hashes, then
 * writes and returns the tree for `prefix`.
 */
async function buildTree(
  repo: Repository,
  index: Index,
  prefix: string,
): Promise<string> {
  // Collect the direct children of `prefix`
  const files = new Map<string, string>() // name → blob hash
  const dirs = new Set<string>() // immediate subdirectory names

  for (const [path, entry] of Object.entries(index)) {
    if (prefix && !path.startsWith(prefix + '/')) continue

    const relative = prefix ? path.slice(prefix.length + 1) : path
    const slash = relative.indexOf('/')

    if (slash === -1) {
      // Direct file child
      files.set(relative, entry.hash)
    } else {
      // Path descends into a subdirectory
      dirs.add(relative.slice(0, slash))
    }
  }

  const entries: TreeEntry[] = []

  // Add blob entries for files
  for (const [name, hash] of files) {
    entries.push({ mode: '100644', name, hash })
  }

  // Recurse into subdirectories to get their tree hashes
  for (const dir of dirs) {
    const subPrefix = prefix ? `${prefix}/${dir}` : dir
    const subTreeHash = await buildTree(repo, index, subPrefix)
    entries.push({ mode: '040000', name: dir, hash: subTreeHash })
  }

  // Write the tree to the object store and return its hash
  const tree = createTree(entries)
  return repo.objectStore.writeObject(tree)
}

/**
 * Build a GitSignature from environment variables, with sensible defaults.
 *
 * Real Git reads from ~/.gitconfig and .git/config. We skip config parsing
 * (see DECISIONS.md #009) and read from env vars instead.
 */
function makeSignature(): GitSignature {
  return {
    name: process.env['GITINIT_AUTHOR_NAME'] ?? 'Unknown',
    email: process.env['GITINIT_AUTHOR_EMAIL'] ?? 'unknown@example.com',
    timestamp: Math.floor(Date.now() / 1000),
    timezone: '+0000',
  }
}

