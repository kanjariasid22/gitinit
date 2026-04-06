# gitinit

A Git implementation in TypeScript, built from scratch. Real SHA-1 hashing, zlib compression, the full object model (blob/tree/commit), a staging index, branching, history traversal, and diff. Built to understand how Git actually works, not to replace it.

---

## Why This Exists

Most "build your own Git" resources stop at a single blob and commit. This project goes further — working object store, staging index, branching, history traversal, working tree diffing, and eventually merge. Every architectural decision is documented in [docs/DECISIONS.md](docs/DECISIONS.md).

---

## How It Works

### Content-Addressable Storage

Everything in gitinit is an **object** — an immutable blob of bytes identified by the SHA-1 hash of its content. The hash is not a name you assign; it's derived from the content itself. This means:

- The same file content always produces the same object. No duplication.
- You can verify any object's integrity by recomputing its hash.
- Objects are immutable. "Changing" something creates a new object.

Objects are stored at `.gitinit/objects/<first-2-hex>/<remaining-38-hex>`, compressed with zlib — exactly as real Git stores them.

### The Object Model

There are three object types:

| Type | What it represents | Contains |
|------|-------------------|----------|
| **Blob** | A file's content | Raw bytes. No filename, no path. |
| **Tree** | A directory snapshot | A list of `(mode, name, hash)` entries pointing to blobs and other trees |
| **Commit** | A point in history | A pointer to a root tree, zero or more parent commit hashes, author info, and a message |

A commit points to a tree. That tree points to blobs (files) and subtrees (subdirectories). Chains of commits form the history graph. The same blob hash appearing in a thousand commits costs nothing — it's stored once.

### The Index (Staging Area)

`gitinit add` doesn't write a commit — it writes to the **index**, a file that represents the next commit's state. The index maps file paths to blob hashes. When you run `gitinit commit`, the index is serialized into a tree object and wrapped in a commit.

Real Git's index is a binary format with per-entry stat caching. gitinit uses JSON for the index (see [Simplifications](#simplifications-vs-real-git)).

### Refs and Branches

A branch is a text file containing a single commit hash. That's the entire implementation. `main` is just `.gitinit/refs/heads/main` containing `a1b2c3...`. `HEAD` is `.gitinit/HEAD`, containing either `ref: refs/heads/main` (normal) or a raw hash (detached HEAD).

Moving a branch forward means overwriting that file with a new hash. Creating a branch means creating a new file.

---

## Supported Commands

| Command | Description | Status |
|---------|-------------|--------|
| `gitinit init` | Initialize a `.gitinit/` directory | Done |
| `gitinit add <path>` | Stage a file or directory | Done |
| `gitinit commit -m <msg>` | Create a commit from the current index | Done |
| `gitinit log` | Walk and display the commit history | Done |
| `gitinit status` | Show staged, unstaged, and untracked changes | Done |
| `gitinit branch <name>` | Create a branch | Done |
| `gitinit branch -l` | List branches | Done |
| `gitinit branch -d <name>` | Delete a branch | Done |
| `gitinit checkout <branch>` | Switch branches | Done |
| `gitinit checkout <hash>` | Enter detached HEAD at a commit | Done |
| `gitinit diff` | Show unstaged changes | Done |
| `gitinit diff --staged` | Show staged changes vs HEAD | Done |
| `gitinit merge <branch>` | Merge a branch into the current branch | Done |

---

## Installation

**Prerequisites:** Node.js 20+

```bash
git clone https://github.com/yourusername/gitinit
cd gitinit
npm install
npm run build
npm link       # makes `gitinit` available globally
```

**Usage:**

```bash
mkdir my-project && cd my-project
gitinit init
echo "hello" > hello.txt
gitinit add hello.txt
gitinit commit -m "initial commit"
gitinit log
```

**Environment variables for commit identity:**

```bash
export GITINIT_AUTHOR_NAME="Your Name"
export GITINIT_AUTHOR_EMAIL="you@example.com"
```

---

## Tech Stack

| Concern | Choice |
|---------|--------|
| Language | TypeScript (strict mode) |
| Runtime | Node.js 20+ |
| Hashing | Node.js built-in `crypto` (SHA-1) |
| Compression | Node.js built-in `zlib` |
| CLI parsing | Commander |
| Tests | Vitest |
| Build | tsc |

No runtime dependencies beyond Commander. The core object model, storage, and hashing use only Node.js built-ins.

---

## Simplifications vs Real Git

| Area | gitinit | Real Git |
|------|--------|----------|
| **Index format** | JSON | Binary format with 62-byte fixed headers and stat cache fields (ctime, mtime, dev, ino, uid, gid, flags) |
| **Object packing** | Loose objects only | Pack files with delta compression, created by `git gc` |
| **Configuration** | Not implemented — identity via env vars | Multi-scope INI config: system, global, local, worktree |
| **Hash algorithm** | SHA-1 | SHA-1 or SHA-256 (selectable since Git 2.29) |
| **Merge** | LCS-based diff3, no rename detection | Recursive 3-way merge with conflict markers and rename detection |
| **Remotes** | Not implemented | Push, fetch, pull, remote tracking refs, refspecs |
| **Annotated tags** | Not implemented | 4th object type wrapping a commit with additional metadata |
| **Submodules** | Not implemented | Gitlink tree entries referencing external repositories |
| **Worktrees** | Not implemented | Multiple working trees sharing one object store |
| **Hooks** | Not implemented | Shell scripts invoked at lifecycle events |

---

## Internals

A deeper walkthrough of the object model, wire formats, and storage layout is in [docs/internals.md](docs/internals.md) (TODO).

**Highlights:**

- **Blob serialization:** `"blob <N>\0<content>"` — hashed, then stored zlib-compressed
- **Tree serialization:** Binary entries: `"<mode> <name>\0<20-byte-raw-hash>"` — sorted by name, matches real Git's format exactly so hashes are reproducible
- **Commit serialization:** Plain text with `tree`, `parent`, `author`, `committer`, and message fields — matches real Git's format exactly
- **Ref resolution:** `HEAD` → branch ref file → commit hash, with detached HEAD support

The architectural decisions behind every one of these choices are in [docs/DECISIONS.md](docs/DECISIONS.md).

---

## What I Learned

> This section will be filled in as implementation progresses.

Planned topics:
- Why content-addressable storage makes deduplication and integrity verification free
- How the three-object model (blob/tree/commit) is sufficient to represent arbitrary filesystem snapshots and full history
- Why branches are just pointers and what that implies for branching cost
- How the index enables a three-way comparison (HEAD vs index vs working tree) that powers `git status`
- How merge works at the object level: finding the common ancestor, applying two diffs, detecting conflicts

---

## License

MIT
