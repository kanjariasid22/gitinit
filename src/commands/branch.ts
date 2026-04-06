import type { Repository } from '../repository'

/**
 * Create a new branch pointing at the current HEAD commit.
 *
 * Throws if HEAD has no commits yet (unborn repo) or if the branch
 * already exists.
 */
export async function createBranch(
  repo: Repository,
  name: string,
): Promise<void> {
  const existing = await repo.refStore.readBranch(name)
  if (existing !== null) {
    throw new Error(`Branch already exists: ${name}`)
  }

  const headHash = await repo.refStore.readHead()
  if (!headHash) {
    throw new Error('Cannot create a branch on an unborn repository')
  }

  await repo.refStore.writeBranch(name, headHash)
}

/**
 * List all local branch names, alphabetically sorted.
 * Also returns the current branch name so callers can mark it.
 */
export async function listBranches(
  repo: Repository,
): Promise<{ branches: string[]; current: string | null }> {
  const [branches, current] = await Promise.all([
    repo.refStore.listBranches(),
    repo.refStore.readHeadBranch(),
  ])
  return { branches, current }
}

/**
 * Delete a branch by name.
 *
 * Refuses to delete the currently checked-out branch — same behaviour as
 * real Git's `git branch -d`.
 */
export async function deleteBranch(
  repo: Repository,
  name: string,
): Promise<void> {
  const current = await repo.refStore.readHeadBranch()
  if (current === name) {
    throw new Error(`Cannot delete the currently checked-out branch: ${name}`)
  }

  await repo.refStore.deleteBranch(name)
}
