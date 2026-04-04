# Architectural Decision Log

Decisions made during design of the gitinit project. Each entry records what was decided, what was considered, and what consequences follow — so future sessions don't re-litigate settled choices.

---

### [DECISION-001] Repository Namespace: `.gitinit/` not `.git/`

**Date:** 2026-04-05
**Status:** Accepted

**Context:**
gitinit needs a directory to store its internal state (objects, refs, index). The obvious choice is `.git/`, which mirrors real Git. However, running gitinit inside a real Git repository would cause it to read and write real Git's internal state, which could corrupt the repository and makes testing dangerous.

**Decision:**
Use `.gitinit/` as the repository directory name throughout the implementation.

**Alternatives considered:**
- `.git/` — matches real Git, but unsafe to use inside real Git repos
- `.gitinit/` — common in tutorial implementations; rejected because the project is named gitinit and the folder name was chosen to match the project name `gitinit` (the working directory)
- Configurable — adds complexity without learning value

**Consequences:**
- Safe to run gitinit inside real Git repositories during development
- Makes it obvious when looking at the filesystem that this is gitinit's state
- Means gitinit objects are not interchangeable with real Git objects without moving them

---

### [DECISION-002] Object Model Representation: Discriminated Unions, Not Classes

**Date:** 2026-04-05
**Status:** Accepted

**Context:**
The three Git object types (blob, tree, commit) need a TypeScript representation. Two main approaches: a class hierarchy (`abstract class GitObject`, with `BlobObject extends GitObject`, etc.) or plain interfaces with a discriminant field (`type: 'blob' | 'tree' | 'commit'`).

**Decision:**
Use discriminated union interfaces. Objects are plain data structures. Serialization is handled by standalone functions, not methods on the objects.

```typescript
type GitObject = BlobObject | TreeObject | CommitObject

interface BlobObject {
  readonly type: 'blob'
  readonly content: Buffer
}
```

**Alternatives considered:**
- Class hierarchy with `serialize()` as an abstract method — OOP-idiomatic, but couples data and behavior, makes testing harder, and hides what objects actually are
- Classes with discriminant — worst of both worlds
- Pure functions with type narrowing (chosen) — makes the data model explicit, enables exhaustive switch narrowing, easier to serialize/deserialize across boundaries

**Consequences:**
- TypeScript's exhaustive narrowing works correctly on `switch (obj.type)`
- Objects are trivially serializable (plain data)
- Serialization logic lives in `objects/blob.ts`, `objects/tree.ts`, `objects/commit.ts` as exported functions
- Adding a new object type (e.g. annotated tag) requires adding a new interface and updating the union — no class hierarchy to modify

---

### [DECISION-003] Hash Algorithm: SHA-1

**Date:** 2026-04-05
**Status:** Accepted

**Context:**
Git objects are identified by the SHA hash of their content. Modern Git (2.29+) supports SHA-256 via `--object-format=sha256`. We must choose which algorithm to implement.

**Decision:**
Use SHA-1. Implementation via Node.js built-in `crypto.createHash('sha1')` — no external dependency.

**Alternatives considered:**
- SHA-256 — more modern, collision-resistant; rejected because SHA-1 is what all Git documentation, mental models, and tooling are built around. Using SHA-256 would make cross-referencing real Git output (e.g. `git cat-file`) impossible and add no learning value
- Both (selectable) — overkill for a learning project

**Consequences:**
- gitinit object hashes can be cross-referenced with real Git using `git cat-file` if the same content is used
- SHA-1 is theoretically collision-vulnerable (SHAttered attack, 2017), but this is irrelevant for a local learning tool
- If this project is ever extended to support SHA-256, the hash utility is isolated in `utils/hash.ts` — a single-file change

---

### [DECISION-004] Object Storage Format: Faithful to Real Git

**Date:** 2026-04-05
**Status:** Accepted

**Context:**
Objects need to be stored on disk. The simplest approach is to just write the raw content or a JSON wrapper. Real Git prepends a type/length header, hashes the whole thing, then zlib-compresses it before writing.

**Decision:**
Implement the full real Git object format:
1. Prepend header: `"<type> <byte-length>\0"`
2. SHA-1 hash the header + content → this becomes the object's identity
3. zlib-deflate the header + content
4. Write to `.gitinit/objects/<2-char-prefix>/<38-char-suffix>`

Node.js `zlib.deflate` / `zlib.inflate` — no external dependency.

**Alternatives considered:**
- Raw content, no compression — simpler but doesn't teach the real format; hash would differ from real Git for the same content
- JSON wrapping — loses binary fidelity (Buffers don't round-trip through JSON), hides the real design
- Real format without zlib — almost faithful but skips compression for no good reason; zlib is 5 lines in Node.js

**Consequences:**
- gitinit object hashes match real Git for the same content — you can verify with `git cat-file`
- Teaches the actual storage design, not a simplified proxy
- `utils/compress.ts` must promisify Node's callback-style zlib API — minor but educational
- Binary fidelity requires careful handling of Buffer vs string throughout

---

### [DECISION-005] Tree Serialization: Real Git Binary Format

**Date:** 2026-04-05
**Status:** Accepted

**Context:**
Tree objects must be serialized to bytes before hashing. Unlike blobs (raw bytes) and commits (plain text), trees use a binary format in real Git. We could substitute a simpler format (e.g. newline-delimited text), but tree hashes must be deterministic: the same directory contents must always produce the same tree hash, regardless of implementation.

**Decision:**
Match real Git's tree binary format exactly:
```
For each entry (sorted by name, directories sort as if their name has a trailing '/'):
  "<mode> <name>\0<20-byte-raw-hash>"
```

The hash in each entry is raw binary (20 bytes), not hex. The final serialized tree is the concatenation of all entries.

**Alternatives considered:**
- Newline-delimited text — simpler, but produces different hashes than real Git for the same directory; makes verification impossible
- JSON — same problem, plus worse for binary data
- Real format (chosen) — enables hash cross-verification with real Git

**Consequences:**
- Must convert hex hashes to binary (20-byte Buffer) when serializing trees
- Must convert binary back to hex when deserializing
- Tree hashes for the same directory content will match real Git's output exactly
- Sort order matters: must implement Git's sort comparator, not standard lexicographic sort

---

### [DECISION-006] Commit Serialization: Real Git Text Format

**Date:** 2026-04-05
**Status:** Accepted

**Context:**
Commit objects are serialized as text in real Git. We could use JSON or another format, but for the same reasons as tree serialization — hash determinism and cross-verification — we should match the real format.

**Decision:**
Match real Git's commit text format exactly:
```
tree <tree-hash>
parent <parent-hash>
author <name> <<email>> <unix-timestamp> <timezone>
committer <name> <<email>> <unix-timestamp> <timezone>

<message>
```

`parent` lines are omitted for the root commit. Multiple parents are represented as multiple `parent` lines (for merge commits).

**Alternatives considered:**
- JSON — convenient but produces different hashes; can't cross-verify with `git cat-file`
- Custom text format — same problem

**Consequences:**
- Commit hashes for identical content will match real Git
- Must parse this format faithfully when reading commits back from the object store
- The blank line between headers and message is mandatory — off-by-one errors here will break hash verification

---

### [DECISION-007] Index Format: JSON (Simplified)

**Date:** 2026-04-05
**Status:** Accepted

**Context:**
The staging index needs to persist between commands. Real Git's index is a binary file with a 12-byte header, 62-byte fixed-length entry headers per file, variable-length path names, and extension sections. This format exists for performance: it caches stat(2) data to detect changed files without rehashing everything.

**Decision:**
Store the index as a JSON file at `.gitinit/index`. Each entry stores: path, blob hash, file mode, mtime, and size. Stat-based change detection (compare mtime + size before rehashing) is implemented even though the format is simplified.

```json
{
  "entries": {
    "src/main.ts": {
      "hash": "abc123...",
      "mode": "100644",
      "mtime": 1712345678,
      "size": 1024
    }
  }
}
```

**Alternatives considered:**
- Real binary format — teaches the format but not the concept; the concept (stat caching, path→hash mapping) is what matters
- No stat caching — always rehash on status — loses the important behavioral detail of how Git avoids expensive rehashing

**Consequences:**
- Cannot interoperate with real Git's index (but this was never a goal)
- The important conceptual behavior (stat-based change detection) is preserved
- Dramatically simpler parsing; no binary deserialization needed for this layer
- Should be explicitly called out in README as a known simplification

---

### [DECISION-008] Pack Files: Not Implemented (Loose Objects Only)

**Date:** 2026-04-05
**Status:** Accepted

**Context:**
Real Git stores objects in two ways: loose (one file per object) and packed (many objects in a single binary file with delta compression). `git gc` converts loose objects to pack files for efficiency. Pack files involve a complex binary format, delta encoding, and a separate index file.

**Decision:**
Implement loose object storage only. Every object is its own file in `.gitinit/objects/`. Pack file generation is out of scope.

**Alternatives considered:**
- Implementing pack files — significantly more complexity for an optimization, not a conceptual feature
- Stub/fake pack file support — adds complexity without value

**Consequences:**
- Repositories with many commits will accumulate large numbers of small files — fine for a learning project
- The object store API (`writeObject`, `readObject`, `hasObject`) is designed to be storage-agnostic; pack file support could be added behind this interface without changing callers
- Must be documented in README

---

### [DECISION-009] Configuration: Not Implemented (Environment Variables for Identity)

**Date:** 2026-04-05
**Status:** Accepted

**Context:**
Real Git reads user identity, default branch name, line ending behavior, remote URLs, etc. from INI-format config files at three scopes: `/etc/gitconfig` (system), `~/.gitconfig` (global), and `.git/config` (local). Implementing config parsing would require an INI parser and scope merging logic.

**Decision:**
Skip config file parsing entirely. User identity is sourced from environment variables:

- `GITINIT_AUTHOR_NAME` (default: `"Unknown"`)
- `GITINIT_AUTHOR_EMAIL` (default: `"unknown@example.com"`)

Default branch is hardcoded to `main`. Remote configuration is out of scope.

**Alternatives considered:**
- Full config implementation — adds an INI parser and scope resolution for marginal learning value; the config system is not interesting from a VCS internals perspective
- Single `.gitinit/config` without scope merging — partial implementation with unclear semantics
- Command-line flags only — too inconvenient for repeated use

**Consequences:**
- Every commit must have environment variables set, or commits will have generic author info
- No `gitinit config` command — could be added later as an isolated feature without touching anything else
- `gitinit clone`-style workflows (which require remote config) remain out of scope

---

### [DECISION-010] Remote Support: Out of Scope

**Date:** 2026-04-05
**Status:** Accepted

**Context:**
Real Git's remote support involves: remote URL configuration, the pack protocol (fetch/push wire format), remote tracking refs (`refs/remotes/`), refspecs, and authentication. This is a substantial subsystem.

**Decision:**
Remotes are entirely out of scope. The implementation covers local repository operations only.

**Alternatives considered:**
- Implementing a subset of the push/fetch protocol — too complex relative to learning value; the network layer obscures the object model
- Simulating remotes via local filesystem copies — possible future extension, not planned

**Consequences:**
- No `gitinit push`, `gitinit pull`, `gitinit fetch`, `gitinit clone`
- The ref store does not need to handle `refs/remotes/`
- Simplifies the branch model significantly (no tracking branches, no upstream configuration)

---

### [DECISION-011] Repository Class as Central DI Context

**Date:** 2026-04-05
**Status:** Accepted

**Context:**
Commands need access to the object store, index, and ref store. These could be accessed via global singletons, module-level state, or passed explicitly.

**Decision:**
All commands receive a `Repository` instance as their first argument. `Repository` holds references to `ObjectStore`, `IndexManager`, and `RefStore`. Commands are pure functions, not methods.

```typescript
class Repository {
  constructor(
    readonly rootPath: string,
    readonly objectStore: ObjectStore,
    readonly indexManager: IndexManager,
    readonly refStore: RefStore,
  ) {}

  static async open(workingDir: string): Promise<Repository> { ... }
  static async init(workingDir: string): Promise<Repository> { ... }
}

// Command signature pattern:
async function commit(repo: Repository, message: string): Promise<string>
```

**Alternatives considered:**
- Global singletons — untestable; makes it impossible to run multiple repos in the same process
- Methods on Repository — couples the command logic to the Repository class; makes the class a god object
- Module-level state — same problems as global singletons

**Consequences:**
- Tests can construct a `Repository` pointing at a temp directory — no mocking needed
- `Repository` never grows beyond being a context holder; all logic stays in commands and subsystems
- The CLI entry point is responsible for constructing the `Repository` and passing it to commands

---

### [DECISION-012] No External Runtime Dependencies (Core)

**Date:** 2026-04-05
**Status:** Accepted

**Context:**
Node.js provides built-in modules for hashing (`crypto`), compression (`zlib`), and filesystem access (`fs/promises`). External libraries could simplify some parts but add dependency surface area.

**Decision:**
The core implementation (objects, store, index, refs, commands) uses only Node.js built-ins. The only external runtime dependency is Commander, used exclusively for CLI argument parsing.

**Alternatives considered:**
- `hash.js` or similar hashing library — no advantage over built-in `crypto`
- `pako` for zlib — no advantage over built-in `zlib`; just wrapping the built-in anyway
- `leveldb` or similar for object storage — replaces the interesting filesystem-level storage with an abstraction

**Consequences:**
- `npm install` installs effectively one package
- Zlib's callback-based API must be promisified — `util.promisify(zlib.deflate)` — minor but teaches Node.js async patterns
- No risk of dependency supply chain issues for the core storage engine

---

### [DECISION-013] Test Runner: Vitest

**Date:** 2026-04-05
**Status:** Accepted

**Context:**
The project needs a test runner. Options include Jest (the Node.js ecosystem default), Vitest (faster, native ESM), and Node's built-in test runner (no config).

**Decision:**
Use Vitest.

**Alternatives considered:**
- Jest — mature ecosystem but requires more configuration for ESM TypeScript, slower cold start
- Node built-in test runner — minimal config but less ergonomic API, fewer ecosystem integrations
- Vitest (chosen) — fast, native ESM, familiar Jest-compatible API, excellent TypeScript support, no transform configuration needed

**Consequences:**
- `vitest.config.ts` is minimal — mostly just pointing at the test directory
- Test fixtures in `tests/fixtures/` can be pre-built binary object files for deterministic hash verification
- Coverage via `@vitest/coverage-v8` — no additional configuration

---

### [DECISION-014] Implementation Order: Layer-by-Layer, Bottom-Up

**Date:** 2026-04-05
**Status:** Accepted

**Context:**
Implementation could proceed command-by-command (vertical slices) or layer-by-layer (horizontal slices). Each has tradeoffs for learnability and for having working code early.

**Decision:**
Build bottom-up, layer by layer:
1. `utils/` — hash, compress, fs
2. `objects/` — serialize/deserialize
3. `store/` — read/write to disk
4. `refs/` — HEAD and branch refs
5. `index/` — staging area
6. `commands/init` → `add` → `commit` → `log` → `status` → `branch` → `checkout` → `diff` → `merge`

**Alternatives considered:**
- Vertical slices (e.g. implement `init` + `add` + `commit` end-to-end before touching `log`) — produces working code faster but risks building wrong abstractions in lower layers
- Top-down (start from CLI, stub downward) — obscures the object model, which is the point of the project

**Consequences:**
- Lower layers can be fully tested before upper layers exist
- Each layer has a clear, testable contract before the next is built
- The object store is solid before any command touches it — no retrofitting
- `utils/` tests are written first, establishing the test pattern for the project
