import type { Repository } from '../repository'
import type { CommitObject } from '../objects'

export interface LogEntry {
  readonly hash: string
  readonly commit: CommitObject
}

/**
 * Walk the first-parent commit chain from HEAD and return an ordered list
 * of log entries, most recent first.
 *
 * Real Git's `git log` follows all parents (for merge commits) and supports
 * many traversal strategies (--first-parent, --topo-order, etc.). We follow
 * only the first parent — sufficient for a linear history and for
 * understanding the core traversal concept.
 *
 * Returns an empty array if the repository has no commits yet.
 */
export async function log(repo: Repository): Promise<LogEntry[]> {
  const entries: LogEntry[] = []
  let hash = await repo.refStore.readHead()

  while (hash) {
    const obj = await repo.objectStore.readObject(hash)
    if (obj.type !== 'commit') {
      throw new Error(`Expected commit object, got ${obj.type}: ${hash}`)
    }

    entries.push({ hash, commit: obj })

    // Follow the first parent; stop at root commit (no parents)
    hash = obj.parentHashes[0] ?? null
  }

  return entries
}
