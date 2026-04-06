# Usage Guide

Build first:

```bash
npm run build
node dist/cli.js --help
```

Or add an alias:

```bash
alias gitinit="node /path/to/gitinit/dist/cli.js"
```

---

## Commands

### init
```bash
gitinit init
```
Creates `.gitinit/` in the current directory.

---

### add
```bash
gitinit add <path>
```
Stage a file or directory. Directories are staged recursively.

```bash
gitinit add src/main.ts
gitinit add src/
```

---

### commit
```bash
gitinit commit -m "message"
```

Author identity is read from env vars (falls back to defaults):
```bash
export GITINIT_AUTHOR_NAME="Your Name"
export GITINIT_AUTHOR_EMAIL="you@example.com"
```

---

### status
```bash
gitinit status
```
Shows staged changes, unstaged changes, and untracked files.

---

### log
```bash
gitinit log
```
Walks the commit chain from HEAD, most recent first.

---

### diff
```bash
gitinit diff           # working tree vs index
gitinit diff --staged  # index vs HEAD
```

---

### branch
```bash
gitinit branch              # list branches
gitinit branch feature      # create branch at HEAD
gitinit branch -d feature   # delete branch
```

---

### checkout
```bash
gitinit checkout feature    # switch to branch
gitinit checkout <hash>     # detach HEAD at commit
```
Hard switch — uncommitted changes are overwritten without warning.

---

### merge
```bash
gitinit merge feature
```

| Output | Meaning |
|---|---|
| `Already up to date.` | Target is in current history |
| `Fast-forward` | Current branch advanced to target |
| `Merge made with the 'gitinit' strategy.` | Three-way merge, no conflicts |
| `CONFLICT — automatic merge failed.` | Conflict markers written to files |

When conflicts occur, edit the files to resolve, then:
```bash
gitinit add <resolved-file>
gitinit commit -m "resolve merge conflict"
```

---

## Typical workflow

```bash
gitinit init
echo "hello" > README.md
gitinit add README.md
gitinit commit -m "initial commit"

gitinit branch feature
gitinit checkout feature
echo "new feature" > feature.txt
gitinit add feature.txt
gitinit commit -m "add feature"

gitinit checkout main
gitinit merge feature
```
