# gitinit Internals

A technical reference for engineers reading the source. Covers how each layer
works, what the wire formats look like at the byte level, and where gitinit
diverges from real Git and why.

---

## 1. Content-Addressable Storage

Every piece of data in gitinit is an **object** — an immutable blob of bytes
whose identity is derived from its content. The storage mechanism is in
[`src/store/object-store.ts`](../src/store/object-store.ts).

### Write path

`ObjectStore.writeObject(obj)` executes these steps in order:

1. Serialize the object to its raw content bytes (type-specific, see §2).
2. Prepend the Git object header: `"<type> <content-byte-length>\0"` — for
   example, a 6-byte blob produces the header `"blob 6\0"`.
3. SHA-1 hash the concatenated buffer (header + content). This 40-char hex
   string is the object's identity.
4. Check if the hash already exists on disk — if so, return early. Writing the
   same content twice is a no-op.
5. zlib-compress the full buffer (header + content).
6. Write the compressed bytes to
   `.gitinit/objects/<first-2-hex-chars>/<remaining-38-hex-chars>`.

```
"blob 6\0hello\n"  →  SHA-1  →  ce013625030ba8dba906f756967f9e9ca394464a
                                         ↓ zlib compress
.gitinit/objects/ce/013625030ba8dba906f756967f9e9ca394464a
```

This is identical to real Git's loose object format. The blob hash above can
be verified with `git hash-object` on a file containing `hello\n`.

**Directory sharding:** splitting into `<2>/<38>` avoids putting all objects in
a single directory. Most filesystems degrade significantly above ~10,000 entries
per directory; sharding by the first byte gives 256 subdirectories.

### Read path

`ObjectStore.readObject(hash)` reverses the write:

1. Read the compressed file at the expected path.
2. zlib-decompress.
3. Find the null byte (`0x00`) that terminates the header.
4. Parse the type field from the header (the substring before the space).
5. Dispatch to the correct deserializer (`deserializeBlob`, `deserializeTree`,
   `deserializeCommit`).

`hasObject(hash)` is just a `readFileMaybe` — it returns `null` for ENOENT.

---

## 2. The Object Model

Three object types, defined in [`src/objects/types.ts`](../src/objects/types.ts):

```typescript
type GitObject = BlobObject | TreeObject | CommitObject

interface BlobObject   { readonly type: 'blob';   readonly content: Buffer }
interface TreeEntry    { readonly mode: FileMode; readonly name: string; readonly hash: string }
interface TreeObject   { readonly type: 'tree';   readonly entries: readonly TreeEntry[] }
interface GitSignature { readonly name: string; readonly email: string; readonly timestamp: number; readonly timezone: string }
interface CommitObject {
  readonly type: 'commit'
  readonly treeHash: string
  readonly parentHashes: readonly string[]
  readonly author: GitSignature
  readonly committer: GitSignature
  readonly message: string
}
```

TypeScript's discriminated union on `type` gives exhaustive narrowing in every
`switch` statement. Objects are plain interfaces — serialization is handled by
standalone functions, not methods.

### Blob

`serializeBlob` returns `blob.content` directly. The content bytes are the
file's raw bytes — no transformation. The object store prepends the header.

`deserializeBlob` wraps the content buffer in a `BlobObject`.

### Tree

`serializeTree` in [`src/objects/tree.ts`](../src/objects/tree.ts) produces
real Git's binary format. Each entry is:

```
"<mode> <name>\0<20-byte-raw-hash>"
```

Two things that must be exact to produce real Git-compatible hashes:

1. **Hash encoding:** the 40-char hex hash is written as 20 raw binary bytes
   (`Buffer.from(entry.hash, 'hex')`), not as the hex string.
2. **Sort order:** entries are sorted by `compareEntries`, which appends a
   virtual `/` to directory names before comparing. This means a directory
   `foo` sorts after a file `foo-bar` (because `-` is ASCII 45, `/` is ASCII
   47). Getting this wrong produces a different SHA-1.

`deserializeTree` is the inverse: it scans the buffer byte-by-byte, reading
`mode` and `name` up to each null byte, then reading exactly 20 bytes of raw
hash.

### Commit

`serializeCommit` in [`src/objects/commit.ts`](../src/objects/commit.ts)
produces plain UTF-8 text. Field order is fixed and matches real Git:

```
tree <40-char-hex>
parent <40-char-hex>       ← one line per parent; absent for root commits
author Name <email> <unix-timestamp> <+0000>
committer Name <email> <unix-timestamp> <+0000>
                           ← mandatory blank line
<message>
```

`parseSignature` uses a regex anchored from the right:

```typescript
/^(.+) <(.+)> (\d+) ([+-]\d{4})$/
```

Anchoring from the right lets names contain spaces without ambiguity.

`deserializeCommit` splits on the first `\n\n` (blank line) to separate headers
from the message body.

### Merkle tree example

Consider a repository with two files:

```
README.md   → "# hello\n"
src/main.ts → "console.log('hi')\n"
```

After `gitinit add . && gitinit commit -m "init"`, the object graph is:

```
commit (hash C)
  └─ treeHash → tree (hash T_root)
                  ├─ "100644 README.md\0<blob-hash-R>"
                  └─ "040000 src\0<tree-hash-T_src>"
                                   └─ "100644 main.ts\0<blob-hash-M>"
```

If `README.md` is modified and re-committed:
- A new blob is written for the new content → new hash R'.
- A new root tree is written (different entry for README.md) → new hash T_root'.
- `src` tree is unchanged → T_src is reused as-is.
- A new commit is written pointing to T_root' → new hash C'.

The `src` subtree costs nothing — its object is shared. This is how Git avoids
storing redundant data.

---

## 3. The Staging Index

The index is managed by
[`src/index/index-manager.ts`](../src/index/index-manager.ts).

### Structure

```typescript
type Index = Record<string, IndexEntry>

interface IndexEntry {
  readonly hash: string   // blob SHA-1
  readonly mode: FileMode // always '100644' in gitinit (see §6)
  readonly mtime: number  // file mtime in milliseconds at time of staging
  readonly size: number   // file size in bytes at time of staging
}
```

The index is a flat map from repo-relative path (forward slashes on all
platforms) to its staged entry. It is stored as JSON at `.gitinit/index`.

### Stat cache

`isUnchanged(entry, absolutePath)` checks `mtime` and `size` before rehashing.
If both match the values recorded at stage time, the file is assumed unchanged
and no hash is computed. This mirrors what real Git does — the purpose of the
stat cache in Git's binary index is exactly this optimisation.

When mtime or size differ, the file is re-read and a SHA-1 is computed to
confirm the change. In `status.ts`, the rehash is done inline:

```typescript
const header = Buffer.from(`blob ${content.length}\0`)
const hash = sha1(Buffer.concat([header, content]))
```

This constructs the full Git object header before hashing, which is why the
result is comparable to the stored blob hash.

### Three-way status comparison

`status()` in [`src/commands/status.ts`](../src/commands/status.ts) performs
two independent comparisons:

**Staged changes (HEAD tree vs index):**
- Walk the index. For each path: if not in HEAD → `added`; if hash differs →
  `modified`.
- Walk the HEAD tree. For each path not in the index → `deleted`.

**Unstaged changes (index vs working directory):**
- For each indexed path: check stat cache. On mismatch, read file and rehash.
  If file missing → `deleted`; if hash differs → `modified`.
- Walk the entire working directory (recursively, skipping `.gitinit/`). Any
  path not in the index → `untracked`.

`resolveHeadTree` follows the chain: HEAD ref → commit hash → commit object →
`treeHash` → recursive `flattenTree` → flat `Record<string, string>` (path →
blob hash). An unborn repo (no commits) returns an empty map.

---

## 4. Refs and HEAD

Refs are managed by [`src/refs/ref-store.ts`](../src/refs/ref-store.ts).

### Storage

| Path | Contents | When |
|---|---|---|
| `.gitinit/HEAD` | `ref: refs/heads/main\n` | Normal state |
| `.gitinit/HEAD` | `<40-char-hash>\n` | Detached HEAD |
| `.gitinit/refs/heads/<name>` | `<40-char-hash>\n` | Any branch |

`listBranches` reads the `refs/heads/` directory with `readdir` and returns the
sorted filenames.

### HEAD resolution

`readHead()` reads `.gitinit/HEAD`. If the content starts with `ref: `, it
strips the prefix to get the branch ref path (e.g. `refs/heads/main`), then
reads that file to get the commit hash. If HEAD is a raw hash (detached), it
returns it directly. Returns `null` for an unborn repo (branch file does not
exist yet).

`readHeadBranch()` reads HEAD and returns only the branch name (the part after
`refs/heads/`), or null if detached or unborn. Commands use this to decide
whether to advance a branch ref or write HEAD directly.

### Commit sequence

Running `gitinit commit -m "msg"` executes exactly this:

1. `indexManager.readIndex()` — load the current staging area.
2. `buildTree(repo, index, '')` — recursively construct tree objects from the
   flat index. Files are grouped by the first path component under each prefix.
   Each subtree is written to the object store immediately; its hash is
   collected as a tree entry for the parent. Returns the root tree hash.
3. `refStore.readHead()` — get the parent commit hash (null for root commit).
4. `createCommit({treeHash, parentHashes, author, committer, message})`.
5. `objectStore.writeObject(commitObj)` — hash and store the commit.
6. `refStore.readHeadBranch()` — check if HEAD is symbolic.
   - If yes: `writeBranch(branchName, commitHash)` — overwrite the branch file.
   - If no (detached): `writeHeadDetached(commitHash)` — overwrite HEAD directly.

---

## 5. Command Internals

### new

Creates the `.gitinit/` directory structure:

```
.gitinit/
  objects/
  refs/
    heads/
  HEAD          ← written with "ref: refs/heads/main\n"
```

No objects are written. The repo is "unborn" — HEAD points to `main`, but
`refs/heads/main` does not exist yet.

### add

[`src/commands/add.ts`](../src/commands/add.ts)

For a directory target, `readdir` recurses into all entries. For each file:
1. `readFile(absolutePath)` → raw bytes.
2. `createBlob(content)` → `BlobObject`.
3. `objectStore.writeObject(blob)` → blob hash (idempotent).
4. `indexManager.stageFile(index, repoPath, hash, '100644', absolutePath)` →
   reads `stat()` for mtime and size, returns new index (immutable).
5. After all files: `indexManager.writeIndex(index)`.

Paths are normalised to forward slashes with `.replace(/\\/g, '/')`. No
gitignore support — all files under the target path are staged.

### commit

Covered in §4 above. Key detail: `buildTree` is recursive. Given a flat index
like `{"src/utils/hash.ts": ..., "src/main.ts": ..., "README.md": ...}`, it:

- At the root prefix: finds `README.md` as a direct file, `src` as a
  subdirectory.
- Recurses into `src`: finds `main.ts` as a direct file, `utils` as a
  subdirectory.
- Recurses into `src/utils`: finds `hash.ts` as a direct file, writes a tree,
  returns its hash.
- Writes the `src` tree with `main.ts` + the `utils` subtree.
- Writes the root tree with `README.md` + the `src` subtree.

Author identity is read from `GITINIT_AUTHOR_NAME` and `GITINIT_AUTHOR_EMAIL`
environment variables, defaulting to `"Unknown"` / `"unknown@example.com"`.
The timezone is hardcoded to `"+0000"`.

### log

[`src/commands/log.ts`](../src/commands/log.ts)

Reads the HEAD commit hash, then follows `parentHashes[0]` in a loop until a
commit with no parents is reached. Returns `LogEntry[]` most-recent-first. Only
the first parent is followed — merge commits produce linear history in the log
output.

### status

Covered in §3. The working directory walk skips `.gitinit/` by name. No other
directories are excluded.

### branch

[`src/commands/branch.ts`](../src/commands/branch.ts)

- `createBranch(repo, name)`: guards against unborn repo (no HEAD commit) and
  name collision, then calls `refStore.writeBranch(name, currentHash)`.
- `listBranches(repo)`: calls `refStore.listBranches()` and
  `refStore.readHeadBranch()` in parallel, returns `{branches, current}`.
- `deleteBranch(repo, name)`: guards against deleting the currently checked-out
  branch, then calls `refStore.deleteBranch(name)` which calls `unlink`.

### checkout

[`src/commands/checkout.ts`](../src/commands/checkout.ts)

1. Try `refStore.readBranch(target)` — if non-null, target is a branch name.
   Otherwise treat target as a raw commit hash.
2. Validate the resolved hash is a commit object.
3. Update HEAD (symbolic or detached).
4. `removeTrackedFiles`: `unlink` every path in the current index. Untracked
   files are not touched. `removeEmptyDirs` walks the tree and calls `rmdir`
   on directories that are now empty (skipping `.gitinit/`).
5. `restoreTree`: recursively walk the target commit's tree, write each blob to
   the working directory, and populate a new index with fresh stat data.
6. Write the new index.

This is a hard switch — modifications to tracked files that haven't been staged
or committed are overwritten without warning.

### diff

[`src/commands/diff.ts`](../src/commands/diff.ts)

`diff()` (working tree vs index):
- For each indexed path: read the file from disk. If missing → deleted. If
  content matches the stored blob → no change. Otherwise → modified.
- Untracked files are not shown.

`diffStaged()` (index vs HEAD):
- For each indexed path: look up its hash in the HEAD tree. If not present →
  added. If hash differs → modified.
- For each HEAD tree path not in the index → deleted.

Both use the same LCS pipeline:
1. `computeLCS(a, b)` — O(mn) DP table over line arrays.
2. `buildChangeList` — traces back through the DP table, producing a list of
   `{kind: '+' | '-' | ' ', content, oldLine, newLine}` records.
3. `groupIntoHunks` — finds the indices of changed lines, expands each by
   `CONTEXT_LINES` (3) on each side, merges overlapping regions, and slices the
   change list into `DiffHunk` objects.

### merge

[`src/commands/merge.ts`](../src/commands/merge.ts)

**Merge base:** `findMergeBase(repo, ourHash, theirHash)` uses BFS. It first
collects the full ancestor set of `ourHash` (including itself) into a `Set`.
Then it does a second BFS from `theirHash`, returning the first commit found in
that set. This is the lowest common ancestor.

**Fast-forward:** if the merge base equals our HEAD, we're behind. `fastForward`
restores the working tree from the target commit (same as checkout), updates
the index, and advances the branch ref. No commit is created.

**Three-way merge:** `threeWayMerge` flattens all three trees (base, ours,
theirs) into `Record<string, string>` maps. For every path in the union of all
three:

```
mergeFile(repo, path, baseHash, ourHash, theirHash)
```

`mergeFile` decides per-path:
- Neither changed: keep base.
- Only ours changed: take ours (including deletion).
- Only theirs changed: take theirs (including deletion).
- Both changed identically: take once.
- One deleted, one modified: write a deletion conflict marker and flag conflict.
- Both changed differently: run `mergeLines`.

`mergeLines` diffs base→ours and base→theirs using `computeDiff` (same LCS
algorithm). Each diff produces a list of `keep` or `replace` ops. `buildMergeChunks`
aligns the two op lists pairwise:

| ours op | theirs op | result |
|---|---|---|
| keep | keep | unchanged |
| keep | replace | theirs |
| replace | keep | ours |
| replace | replace, same output | ours (no conflict) |
| replace | replace, different output | conflict |

Conflict regions are written with `<<<<<<< HEAD` / `=======` / `>>>>>>>` markers.

If any conflicts are found, the working directory and index are updated but no
merge commit is created. The user must resolve, re-stage, and commit manually.

If there are no conflicts, `buildTreeFromIndex` constructs a tree from the new
index (same recursive grouping as `commit`), and a merge commit is written with
`parentHashes: [ourHash, theirHash]`.

---

## 6. Simplifications vs Real Git

| Area | gitinit | Real Git | Gap |
|---|---|---|---|
| **Index format** | JSON at `.gitinit/index` | Binary; 62-byte fixed header per entry plus stat cache fields (ctime, dev, ino, uid, gid, flags) | The stat cache concept is preserved; the binary format is not. Implementing the real format would require careful byte-offset parsing and packing. |
| **File modes** | All files staged as `100644` | Detects executable bit (`100755`), symlinks (`120000`), gitlinks (`160000`) | `add.ts` hardcodes `'100644'`. Executable detection would require `stat().mode & 0o111`. |
| **Timezone** | Hardcoded `+0000` | Reads from the system locale | `makeSignature()` in `commit.ts` and `merge.ts` hardcodes `'+0000'`. |
| **Config** | None — identity via env vars | Multi-scope INI config: system, global, local, worktree | No config parser. `GITINIT_AUTHOR_NAME` / `GITINIT_AUTHOR_EMAIL` are the only inputs. |
| **SHA algorithm** | SHA-1 only | SHA-1 or SHA-256 (selectable since Git 2.29 via `--object-format`) | Using SHA-256 would require changing hash lengths everywhere and would break cross-verification with `git cat-file`. |
| **Pack files** | Not implemented | `git gc` packs loose objects with delta compression into a single packfile | Every object is a separate file. Large repos accumulate many small files. |
| **gitignore** | Not implemented | `.gitignore`, `.git/info/exclude`, global excludes file | `add` stages everything under the target path unconditionally. |
| **Symlinks** | Not implemented | Stored as blob with mode `120000`, content = target path | `readFile` on a symlink reads the target's content, not the link. |
| **Diff algorithm** | LCS (O(mn) DP) | Myers diff (O(nd)) | LCS produces correct output. Myers is faster on typical diffs and produces shorter edit scripts, but the difference is not observable for small files. |
| **LCS duplication** | `computeLCS` copied in `diff.ts` and `merge.ts` | n/a | Both files implement the same function independently. Could be extracted to a shared utility. |
| **Merge strategy** | Basic three-way, no rename detection | Recursive/ort strategy with rename detection and criss-cross merge handling | Rename detection requires comparing file content similarity across trees. Criss-cross merges (multiple common ancestors) are not handled. |
| **Checkout safety** | Hard switch | Three-way merge to carry over local modifications | Uncommitted changes to tracked files are silently overwritten. |
| **Object streaming** | Entire file loaded into memory | Delta compression and streaming in pack protocol | `readFile` loads the full content. Not suitable for large files. |
| **Remotes** | Not implemented | Push, fetch, pull, remote tracking refs, refspecs, pack protocol | Out of scope. |
| **Annotated tags** | Not implemented | Fourth object type wrapping a commit with tagger info and a message | The object store's `deserializeByType` throws on any type other than blob/tree/commit. |
| **Submodules** | Not implemented | Gitlink tree entries (`160000`) referencing external repos | Out of scope. |
