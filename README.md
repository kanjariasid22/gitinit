# gitinit

A simplified but honest Git implementation in TypeScript, built from scratch to understand Git's internals — not as a tutorial exercise, but as a genuine exploration of how content-addressable storage, immutable object graphs, and ref-based branching actually work.

---

## Why This Exists

Most "build your own Git" tutorials stop at blobs and a single commit. This project goes further: a working object store with real SHA-1 hashing and zlib compression, a staging index, branching, history traversal, working tree diffing, and eventually merge.

The goal is depth over completeness. Every design decision is documented. Every simplification relative to real Git is called out explicitly. This is a portfolio project and a learning artifact — not a Git replacement.

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
| `gitinit init` | Initialize a `.gitinit/` directory | TODO |
| `gitinit add <path>` | Stage a file or directory | TODO |
| `gitinit commit -m <msg>` | Create a commit from the current index | TODO |
| `gitinit log` | Walk and display the commit history | TODO |
| `gitinit status` | Show staged, unstaged, and untracked changes | TODO |
| `gitinit branch <name>` | Create a branch | TODO |
| `gitinit branch -l` | List branches | TODO |
| `gitinit branch -d <name>` | Delete a branch | TODO |
| `gitinit checkout <branch>` | Switch branches | TODO |
| `gitinit checkout <hash>` | Enter detached HEAD at a commit | TODO |
| `gitinit diff` | Show unstaged changes | TODO |
| `gitinit diff --staged` | Show staged changes vs HEAD | TODO |

---

## Installation

> Implementation is in progress. These instructions will be updated as commands are completed.

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

gitinit is honest about where it differs from real Git. These are not accidents or oversights — each is a deliberate tradeoff documented in [docs/DECISIONS.md](docs/DECISIONS.md).

| Area | gitinit | Real Git |
|------|--------|----------|
| **Index format** | JSON | Binary format with 62-byte fixed headers and stat cache fields (ctime, mtime, dev, ino, uid, gid, flags) |
| **Object packing** | Loose objects only — one file per object | Pack files: multiple objects bundled with delta compression, created by `git gc` |
| **Configuration** | Not implemented — identity via env vars | Multi-scope INI config: system, global, local, worktree |
| **Hash algorithm** | SHA-1 | SHA-1 or SHA-256 (selectable since Git 2.29) |
| **Merge** | Basic (planned) | Recursive 3-way merge with conflict markers, rename detection, and strategy plugins |
| **Remotes** | Not implemented | Push, fetch, pull, remote tracking refs, refspecs |
| **Annotated tags** | Not implemented | 4th object type, wraps a commit with additional metadata |
| **Submodules** | Not implemented | Gitlink tree entries referencing external repositories |
| **Worktrees** | Not implemented | Multiple working trees sharing one object store |
| **Hooks** | Not implemented | Shell scripts invoked at lifecycle events (pre-commit, post-commit, etc.) |

The index format and pack files are the two most significant simplifications. Both are implementation-detail optimizations over a conceptual model that gitinit implements correctly.

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
