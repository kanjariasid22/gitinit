import { Repository } from '../repository'
import { readFileMaybe } from '../utils/fs'
import { join } from 'node:path'

/**
 * Initialize a new gitinit repository at the given path.
 *
 * Fails if a .gitinit/ directory already exists there.
 * Returns the initialized Repository.
 */
export async function init(rootPath: string): Promise<Repository> {
  const gitDirPath = join(rootPath, '.gitinit')
  const existing = await readFileMaybe(join(gitDirPath, 'HEAD'))

  if (existing !== null) {
    throw new Error(`Already a gitinit repository: ${gitDirPath}`)
  }

  return Repository.init(rootPath)
}
