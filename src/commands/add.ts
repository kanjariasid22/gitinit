import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { createBlob } from '../objects'
import type { FileMode } from '../objects'
import type { Index } from '../index/index-manager'
import type { Repository } from '../repository'

/**
 * Stage a file or directory recursively.
 *
 * For each file:
 *   1. Read its content into a blob
 *   2. Write the blob to the object store
 *   3. Update the index entry with the blob hash + stat data
 *
 * Real Git also resolves symlinks and handles gitignore here. We skip both.
 */
export async function add(
  repo: Repository,
  targetPath: string,
): Promise<void> {
  let index = await repo.indexManager.readIndex()
  index = await addPath(repo, targetPath, index)
  await repo.indexManager.writeIndex(index)
}

async function addPath(
  repo: Repository,
  absolutePath: string,
  index: Index,
): Promise<Index> {
  const fileStat = await stat(absolutePath)

  if (fileStat.isDirectory()) {
    return addDirectory(repo, absolutePath, index)
  }

  return addFile(repo, absolutePath, index)
}

async function addDirectory(
  repo: Repository,
  dirPath: string,
  index: Index,
): Promise<Index> {
  const entries = await readdir(dirPath)
  let current = index

  for (const entry of entries) {
    const fullPath = join(dirPath, entry)
    current = await addPath(repo, fullPath, current)
  }

  return current
}

async function addFile(
  repo: Repository,
  absolutePath: string,
  index: Index,
): Promise<Index> {
  const content = await readFile(absolutePath)
  const blob = createBlob(content)
  const hash = await repo.objectStore.writeObject(blob)

  const repoRelativePath = relative(repo.rootPath, absolutePath)
    // Normalise to forward slashes on all platforms
    .replace(/\\/g, '/')

  const mode: FileMode = '100644'

  return repo.indexManager.stageFile(
    index,
    repoRelativePath,
    hash,
    mode,
    absolutePath,
  )
}
