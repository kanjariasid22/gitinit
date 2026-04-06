import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { gitDir } from './utils/fs'
import { ObjectStore } from './store/object-store'
import { RefStore } from './refs/ref-store'
import { IndexManager } from './index/index-manager'

export class Repository {
  readonly objectStore: ObjectStore
  readonly refStore: RefStore
  readonly indexManager: IndexManager

  constructor(readonly rootPath: string) {
    this.objectStore = new ObjectStore(rootPath)
    this.refStore = new RefStore(rootPath)
    this.indexManager = new IndexManager(rootPath)
  }

  get gitDirPath(): string {
    return gitDir(this.rootPath)
  }

  /**
   * Initialize a new repository at rootPath.
   *
   * Creates the .gitinit/ directory structure and points HEAD at an unborn
   * "main" branch — exactly what `git init` does.
   */
  static async init(rootPath: string): Promise<Repository> {
    const repo = new Repository(rootPath)

    await mkdir(join(repo.gitDirPath, 'objects'), { recursive: true })
    await mkdir(join(repo.gitDirPath, 'refs', 'heads'), { recursive: true })

    // HEAD points at main before any commits exist (unborn branch)
    await repo.refStore.writeHeadSymbolic('main')

    return repo
  }

  /**
   * Open an existing repository at rootPath.
   * Does not verify the directory exists — callers are responsible for that.
   */
  static open(rootPath: string): Repository {
    return new Repository(rootPath)
  }
}
