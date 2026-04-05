export type ObjectType = 'blob' | 'tree' | 'commit'

/**
 * File mode strings, matching real Git's values exactly.
 *
 * '100644' — regular file
 * '100755' — executable file
 * '040000' — directory (subtree)
 *
 * Real Git also has '120000' (symlink) and '160000' (gitlink/submodule),
 * but gitinit does not implement those.
 */
export type FileMode = '100644' | '100755' | '040000'

export interface BlobObject {
  readonly type: 'blob'
  readonly content: Buffer
}

/**
 * A single entry in a tree object.
 *
 * `hash` is the 40-char hex SHA-1 of the referenced object (a blob or
 * another tree). The on-disk tree format stores this as 20 raw binary
 * bytes — that conversion happens in serializeTree/deserializeTree.
 */
export interface TreeEntry {
  readonly mode: FileMode
  readonly name: string
  readonly hash: string
}

export interface TreeObject {
  readonly type: 'tree'
  readonly entries: readonly TreeEntry[]
}

/**
 * Author or committer identity, matching the format real Git uses:
 *   Name <email> <unix-timestamp> <timezone>
 *
 * `timestamp` is seconds since the Unix epoch (UTC).
 * `timezone` is a fixed-offset string like "+0530" or "-0700".
 */
export interface GitSignature {
  readonly name: string
  readonly email: string
  readonly timestamp: number
  readonly timezone: string
}

export interface CommitObject {
  readonly type: 'commit'
  readonly treeHash: string
  /** Empty for the root commit. Multiple entries for a merge commit. */
  readonly parentHashes: readonly string[]
  readonly author: GitSignature
  readonly committer: GitSignature
  readonly message: string
}

export type GitObject = BlobObject | TreeObject | CommitObject
