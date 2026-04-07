#!/usr/bin/env node
import { Command } from 'commander'
import { cwd } from 'node:process'
import { resolve as resolvePath } from 'node:path'
import { Repository } from './repository'
import { init } from './commands/init'
import { add } from './commands/add'
import { commit } from './commands/commit'
import { log } from './commands/log'
import { status } from './commands/status'
import { createBranch, listBranches, deleteBranch } from './commands/branch'
import { checkout } from './commands/checkout'
import { diff, diffStaged } from './commands/diff'
import type { FileDiff } from './commands/diff'
import { merge } from './commands/merge'

const program = new Command()

program
  .name('gitinit')
  .description('A simplified Git implementation in TypeScript')
  .version('0.1.0')

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

program
  .command('new')
  .description('Initialize a new repository in the current directory')
  .action(async () => {
    await run(async () => {
      await init(cwd())
      console.log(`Initialized empty gitinit repository in ${cwd()}/.gitinit/`)
    })
  })

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

program
  .command('add <path>')
  .description('Stage a file or directory')
  .action(async (path: string) => {
    await run(async () => {
      const repo = openRepo()
      const absolutePath = resolve(path)
      await add(repo, absolutePath)
    })
  })

// ---------------------------------------------------------------------------
// commit
// ---------------------------------------------------------------------------

program
  .command('commit')
  .description('Create a commit from the current index')
  .requiredOption('-m, --message <message>', 'Commit message')
  .action(async (opts: { message: string }) => {
    await run(async () => {
      const repo = openRepo()
      const hash = await commit(repo, opts.message)
      const branch = await repo.refStore.readHeadBranch()
      const ref = branch ?? hash.slice(0, 7)
      console.log(`[${ref} ${hash.slice(0, 7)}] ${opts.message}`)
    })
  })

// ---------------------------------------------------------------------------
// log
// ---------------------------------------------------------------------------

program
  .command('log')
  .description('Show commit history')
  .action(async () => {
    await run(async () => {
      const repo = openRepo()
      const entries = await log(repo)

      if (entries.length === 0) {
        console.log('No commits yet.')
        return
      }

      for (const { hash, commit: c } of entries) {
        const date = new Date(c.author.timestamp * 1000).toUTCString()
        console.log(`commit ${hash}`)
        console.log(`Author: ${c.author.name} <${c.author.email}>`)
        console.log(`Date:   ${date}`)
        console.log()
        console.log(`    ${c.message}`)
        console.log()
      }
    })
  })

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

program
  .command('status')
  .description('Show working tree status')
  .action(async () => {
    await run(async () => {
      const repo = openRepo()
      const branch = await repo.refStore.readHeadBranch()
      const s = await status(repo)

      if (branch) {
        console.log(`On branch ${branch}`)
      } else {
        const head = await repo.refStore.readHead()
        console.log(`HEAD detached at ${head?.slice(0, 7) ?? 'unknown'}`)
      }

      const hasStaged =
        s.staged.added.length > 0 ||
        s.staged.modified.length > 0 ||
        s.staged.deleted.length > 0
      const hasUnstaged =
        s.unstaged.modified.length > 0 || s.unstaged.deleted.length > 0
      const hasUntracked = s.untracked.length > 0

      if (!hasStaged && !hasUnstaged && !hasUntracked) {
        console.log('nothing to commit, working tree clean')
        return
      }

      if (hasStaged) {
        console.log('\nChanges to be committed:')
        for (const f of s.staged.added) console.log(`\tnew file:   ${f}`)
        for (const f of s.staged.modified) console.log(`\tmodified:   ${f}`)
        for (const f of s.staged.deleted) console.log(`\tdeleted:    ${f}`)
      }

      if (hasUnstaged) {
        console.log('\nChanges not staged for commit:')
        for (const f of s.unstaged.modified) console.log(`\tmodified:   ${f}`)
        for (const f of s.unstaged.deleted) console.log(`\tdeleted:    ${f}`)
      }

      if (hasUntracked) {
        console.log('\nUntracked files:')
        for (const f of s.untracked) console.log(`\t${f}`)
      }
    })
  })

// ---------------------------------------------------------------------------
// branch
// ---------------------------------------------------------------------------

const branchCmd = program
  .command('branch')
  .description('List, create, or delete branches')

branchCmd
  .argument('[name]', 'Branch name to create')
  .option('-l, --list', 'List branches')
  .option('-d, --delete <name>', 'Delete a branch')
  .action(
    async (
      name: string | undefined,
      opts: { list?: boolean; delete?: string },
    ) => {
      await run(async () => {
        const repo = openRepo()

        if (opts.delete) {
          await deleteBranch(repo, opts.delete)
          console.log(`Deleted branch ${opts.delete}`)
          return
        }

        if (!name || opts.list) {
          const { branches, current } = await listBranches(repo)
          for (const b of branches) {
            console.log(b === current ? `* ${b}` : `  ${b}`)
          }
          return
        }

        await createBranch(repo, name)
        console.log(`Created branch ${name}`)
      })
    },
  )

// ---------------------------------------------------------------------------
// checkout
// ---------------------------------------------------------------------------

program
  .command('checkout <target>')
  .description('Switch branches or restore working tree at a commit')
  .action(async (target: string) => {
    await run(async () => {
      const repo = openRepo()
      await checkout(repo, target)
      const branch = await repo.refStore.readHeadBranch()
      if (branch) {
        console.log(`Switched to branch '${branch}'`)
      } else {
        const head = await repo.refStore.readHead()
        console.log(`HEAD is now at ${head?.slice(0, 7) ?? target}`)
      }
    })
  })

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

program
  .command('diff')
  .description('Show changes between working tree and index, or index and HEAD')
  .option('--staged', 'Compare index to HEAD instead of working tree to index')
  .action(async (opts: { staged?: boolean }) => {
    await run(async () => {
      const repo = openRepo()
      const diffs = opts.staged ? await diffStaged(repo) : await diff(repo)

      if (diffs.length === 0) {
        return // Nothing to show — same as real git
      }

      printDiffs(diffs)
    })
  })

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

program
  .command('merge <branch>')
  .description('Merge a branch into the current branch')
  .action(async (branch: string) => {
    await run(async () => {
      const repo = openRepo()
      const result = await merge(repo, branch)

      switch (result.status) {
        case 'up-to-date':
          console.log('Already up to date.')
          break
        case 'fast-forward':
          console.log(`Fast-forward`)
          break
        case 'merged':
          console.log(`Merge made with the 'gitinit' strategy.`)
          break
        case 'conflict':
          console.log('CONFLICT — automatic merge failed.')
          console.log('Fix conflicts and commit the result:')
          for (const f of result.conflicts) {
            console.log(`\tboth modified: ${f}`)
          }
          break
      }
    })
  })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Open a Repository at the current working directory. */
function openRepo(): Repository {
  return Repository.open(cwd())
}

/** Resolve a path relative to the current working directory. */
function resolve(path: string): string {
  return resolvePath(cwd(), path)
}

/**
 * Wrap an async action so errors print cleanly instead of crashing with a
 * stack trace. Exits with code 1 on failure.
 */
async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`error: ${message}`)
    process.exit(1)
  }
}

/** Render a list of FileDiffs as a unified diff to stdout. */
function printDiffs(diffs: FileDiff[]): void {
  for (const fileDiff of diffs) {
    console.log(`diff --gitinit a/${fileDiff.path} b/${fileDiff.path}`)

    if (fileDiff.changeType === 'added') {
      console.log('--- /dev/null')
      console.log(`+++ b/${fileDiff.path}`)
    } else if (fileDiff.changeType === 'deleted') {
      console.log(`--- a/${fileDiff.path}`)
      console.log('+++ /dev/null')
    } else {
      console.log(`--- a/${fileDiff.path}`)
      console.log(`+++ b/${fileDiff.path}`)
    }

    for (const hunk of fileDiff.hunks) {
      console.log(
        `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
      )
      for (const line of hunk.lines) {
        console.log(`${line.kind}${line.content}`)
      }
    }
  }
}

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`error: ${message}`)
  process.exit(1)
})
