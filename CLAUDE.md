# CLAUDE.md — gitinit Project Memory

This file is persistent context for Claude Code across sessions. Read this before doing anything in this project.

---

## Project Identity

**Name:** gitinit
**Purpose:** A simplified but honest Git implementation in TypeScript, built from scratch to understand Git's internals deeply — not to clone the CLI, but to understand why Git is designed the way it is.
**Repository directory:** `.gitinit/` (not `.git/` — avoids collision with real Git)

---

## Guiding Philosophy

This is a **learning-first, portfolio-worthy** project. That means:

- **Explain concepts before implementing them.** The user wants to understand why, not just what. Before writing any non-trivial code, explain the concept it implements and where real Git differs.
- **Faithful where it matters, simplified where it doesn't.** The object format, SHA hashing, and zlib compression are kept real. The index format is simplified. That line matters.
- **Push back on shallowness.** If a shortcut would make the project a tutorial clone rather than a genuine implementation, say so and propose the better path.
- **Call out every simplification explicitly** — in code comments, README, and DECISIONS.md.
- **This will be on GitHub.** Code quality, documentation, and structure matter. This should look like serious engineering work.

---

## User Background

- ~2 years backend experience: Node.js, NestJS, TypeScript, PostgreSQL, event-driven architecture
- Comfortable with TypeScript but new to low-level systems / CS fundamentals
- This project is intentional CS education, not productivity tooling
- Frame explanations assuming strong TypeScript/backend instincts but no prior exposure to systems-level concepts like content-addressable storage, tree structures for filesystems, or binary serialization

---

## How We Work Together

- Explain the concept and the "why" before showing implementation code
- When real Git does something differently than gitinit, say so explicitly
- When about to implement something, first state what layer it belongs to and what it enables
- If a proposed approach would produce shallow or tutorial-quality results, push back with a concrete alternative
- Keep commits focused — one layer at a time

---

## Folder / Module Structure

```
gitinit/
├── src/
│   ├── objects/
│   │   ├── types.ts          # GitObject, BlobObject, TreeObject, CommitObject, TreeEntry, GitSignature
│   │   ├── blob.ts           # createBlob(), serializeBlob()
│   │   ├── tree.ts           # createTree(), serializeTree()
│   │   ├── commit.ts         # createCommit(), serializeCommit()
│   │   └── index.ts          # barrel re-export
│   │
│   ├── store/
│   │   └── object-store.ts   # writeObject(), readObject(), hasObject() — only thing touching .gitinit/objects/
│   │
│   ├── index/
│   │   └── index-manager.ts  # readIndex(), writeIndex(), stageFile(), removeFile()
│   │
│   ├── refs/
│   │   └── ref-store.ts      # readHead(), writeHead(), readBranch(), writeBranch(), listBranches()
│   │
│   ├── commands/
│   │   ├── init.ts           # initialize .gitinit/ directory structure
│   │   ├── add.ts            # hash file → blob, update index
│   │   ├── commit.ts         # build tree from index, write commit, update HEAD
│   │   ├── log.ts            # walk commit parent chain
│   │   ├── status.ts         # compare index vs HEAD tree vs working directory
│   │   ├── branch.ts         # create/list/delete branches
│   │   ├── checkout.ts       # switch branches, restore working tree
│   │   └── diff.ts           # compare two trees or tree vs working directory
│   │
│   ├── utils/
│   │   ├── hash.ts           # sha1(buffer): string — wraps Node crypto
│   │   ├── compress.ts       # deflate(buffer), inflate(buffer) — promisified Node zlib
│   │   └── fs.ts             # gitinit-aware path helpers, safe read/write wrappers
│   │
│   ├── repository.ts         # Repository class — central context, DI root
│   └── cli.ts                # CLI entry point (commander)
│
├── tests/
│   ├── objects/              # serialization round-trips
│   ├── store/                # object store read/write/hash verification
│   ├── commands/             # integration tests per command
│   └── fixtures/             # pre-built binary objects for deterministic tests
│
├── docs/
│   ├── DECISIONS.md          # architectural decision log
│   └── internals.md          # deep-dive on object model, index, refs (linked from README)
│
├── CLAUDE.md                 # this file
├── README.md
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Implementation Order (Dependency Graph)

Each layer depends only on what comes before it. Do not skip ahead.

```
1. utils/           — hash, compress, fs helpers. Pure functions. No dependencies.
2. objects/         — serialize/deserialize blob, tree, commit. Depends on utils/hash.
3. store/           — read/write objects to disk. Depends on objects/, utils/.
4. refs/            — read/write HEAD and branch refs. Depends on utils/fs.
5. index/           — staging area. Depends on objects/ (blob hashing), utils/.
6. commands/init    — creates .gitinit/ layout. Depends on refs/, store/.
7. commands/add     — hashes files, updates index. Depends on store/, index/.
8. commands/commit  — builds tree, writes commit, advances HEAD. Depends on all above.
9. commands/log     — walks commit chain. Depends on store/, refs/.
10. commands/status — 3-way comparison. Depends on store/, index/, refs/.
11. commands/branch — ref manipulation. Depends on refs/.
12. commands/checkout — ref switch + working tree restore. Depends on store/, refs/, index/.
13. commands/diff   — tree comparison. Depends on store/, objects/.
14. merge           — last, hardest. Depends on everything.
```

---

## Core Design Decisions

### Object Model: Discriminated Unions

Objects are plain TypeScript interfaces with a `type` discriminant field, not classes.

```typescript
type GitObject = BlobObject | TreeObject | CommitObject

interface BlobObject {
  readonly type: 'blob'
  readonly content: Buffer
}
```

TypeScript's exhaustive narrowing on `type` gives us type safety without inheritance overhead. Serialization is handled by standalone functions, not methods.

### Object Storage Format: Faithful to Real Git

The format is:
```
"<type> <content-byte-length>\0<content>"  →  SHA-1 hash  →  zlib-deflate  →  disk
```

Stored at: `.gitinit/objects/<first-2-hex-chars>/<remaining-38-hex-chars>`

This is exactly how real Git works. Zlib compression is included (5 lines of code, not optional).

### Hash Algorithm: SHA-1

We use SHA-1, same as classic Git. Modern Git (2.29+) supports SHA-256 via `--object-format=sha256`, but SHA-1 is what all documentation, tooling, and mental models are built around. Using SHA-256 here would add no learning value and would make cross-referencing real Git output impossible.

Node.js `crypto.createHash('sha1')` — no external dependency.

### Index Format: JSON (Simplified)

Real Git's index is a binary format with 62-byte fixed headers per entry, plus stat caching fields (ctime, mtime, dev, ino, uid, gid, size, flags). We store the index as JSON.

We **do** implement stat-based change detection (mtime + size comparison before rehashing), which is the important behavioral concept. The binary format is an implementation detail, not a conceptual one.

### Pack Files: Not Implemented (Loose Objects Only)

Every object is stored as a separate file. Real Git periodically runs `git gc` to pack loose objects into a single packfile with delta compression. This is a significant optimization but a separate concern from the core object model. Acknowledged in README.

### Config Parsing: Not Implemented

Real Git reads `~/.gitconfig` and `.git/config` for user identity, default branch name, line endings, remotes, etc. We skip config parsing entirely.

- User identity (`user.name`, `user.email`) is read from environment variables `GITINIT_AUTHOR_NAME` and `GITINIT_AUTHOR_EMAIL`, with sensible defaults.
- Default branch: hardcoded to `main`.
- Remote configuration: remotes are out of scope entirely.

### Repository Class: Central DI Context

All commands receive a `Repository` instance rather than accessing global state. The Repository holds references to the ObjectStore, IndexManager, and RefStore.

```typescript
class Repository {
  constructor(
    readonly rootPath: string,
    readonly objectStore: ObjectStore,
    readonly indexManager: IndexManager,
    readonly refStore: RefStore,
  ) {}
}
```

Commands are pure functions: `async function commit(repo: Repository, message: string): Promise<string>`

### No External Runtime Dependencies

The core implementation uses only Node.js built-ins: `crypto`, `zlib`, `fs/promises`, `path`. Commander is the only dependency — for CLI argument parsing only.

---

## Tooling Choices

| Tool | Choice | Reason |
|------|--------|--------|
| Language | TypeScript (strict) | Portfolio project, type safety on discriminated unions |
| Runtime | Node.js | Built-in crypto + zlib, no external deps needed |
| Test runner | Vitest | Fast, native ESM, excellent DX, no config overhead |
| CLI parser | Commander | Minimal, good ergonomics, no magic |
| Build | tsc (no bundler) | This is a CLI tool, not a browser app — bundler adds no value |
| Linter | ESLint + typescript-eslint | Standard |
| Formatter | Prettier | Standard |

---

## Simplifications vs Real Git (Full List)

| Area | gitinit | Real Git | Notes |
|------|--------|----------|-------|
| Index format | JSON | Binary (62-byte headers + stat cache) | Concept preserved, format simplified |
| Object packing | Loose only | Pack files with delta compression | `git gc` is a separate optimization layer |
| Config | None (env vars) | INI-format config at multiple scopes | Not core to object model |
| Hash algorithm | SHA-1 | SHA-1 or SHA-256 (selectable since 2.29) | SHA-1 is the teachable baseline |
| Merge | Basic (later) | Recursive 3-way merge | Merge is the hardest part, saved for last |
| Remotes | Not implemented | Push, fetch, pull, remote tracking refs | Out of scope for this project |
| Annotated tags | Not implemented | 4th object type | Extends commit model trivially |
| Symbolic refs | Partial | Full symref chains | HEAD → branch is implemented; chains are not |
| Submodules | Not implemented | Gitlink tree entries | Out of scope |
| Worktrees | Not implemented | Multiple working trees | Out of scope |
| Hooks | Not implemented | Pre-commit, post-commit, etc. | Out of scope |
| Large file handling | None | Git LFS (external) | Out of scope |

---

## Object Type Reference

```typescript
// Full type definitions — keep in sync with src/objects/types.ts

type ObjectType = 'blob' | 'tree' | 'commit'
type FileMode = '100644' | '100755' | '040000'  // regular | executable | directory

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

type GitObject = BlobObject | TreeObject | CommitObject
```

---

## Object Wire Format Reference

### Blob
```
"blob <N>\0<content>"
```
Where `N` is the byte length of `content`.

### Tree
Real Git serializes each entry as:
```
"<mode> <name>\0<20-byte-binary-hash>"
```
Entries are sorted by name (with a trailing `/` for directories in sort comparisons). The hash is raw binary (20 bytes), not hex. This is one of the few places we match the real binary format exactly — because tree hashes must be deterministic across implementations.

### Commit
Plain text, newline-separated:
```
tree <tree-hash>
parent <parent-hash>        (repeated for each parent; omitted for root commit)
author <name> <<email>> <unix-timestamp> <timezone>
committer <name> <<email>> <unix-timestamp> <timezone>
                            (blank line)
<message>
```

---

## Session Notes

- Architecture and data structure design: complete (2026-04-05)
- Documentation (CLAUDE.md, README.md, docs/DECISIONS.md): complete (2026-04-05)
- Project scaffolding complete (2026-04-05): package.json, tsconfig.json, tsconfig.eslint.json, vitest.config.ts, eslint.config.js, .prettierrc, .prettierignore, .gitignore
- `utils/` layer complete (2026-04-05): hash.ts, compress.ts, fs.ts — 21 tests, all passing
- `objects/` layer complete (2026-04-05): types.ts, blob.ts, tree.ts, commit.ts — 32 tests, all passing
- `store/` layer complete (2026-04-05): object-store.ts — 13 tests, all passing; blob hash cross-verified against real Git
- `refs/` layer complete (2026-04-05): ref-store.ts — 16 tests, all passing
- `index/` layer complete (2026-04-06): index-manager.ts — 13 tests, all passing
- `repository.ts` complete (2026-04-06): central DI context wiring all subsystems
- `commands/init`, `commands/add`, `commands/commit` complete (2026-04-06): 23 tests, all passing; full stack exercised end-to-end
- `commands/log`, `commands/status` complete (2026-04-06): 19 tests, all passing
- `commands/branch` complete (2026-04-06): 9 tests, all passing
- Next step: `commands/checkout`
