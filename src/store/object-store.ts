import {
  deserializeBlob,
  deserializeCommit,
  deserializeTree,
  serializeBlob,
  serializeCommit,
  serializeTree,
} from '../objects'
import type { GitObject, ObjectType } from '../objects'
import { sha1 } from '../utils/hash'
import { compress, decompress } from '../utils/compress'
import { objectPath, readFileMaybe, writeFileWithDirs } from '../utils/fs'

export class ObjectStore {
  constructor(private readonly rootPath: string) {}

  /**
   * Write a GitObject to the store and return its 40-char hex hash.
   *
   * Real Git object storage format:
   *   1. Serialize the object to raw content bytes
   *   2. Prepend the header: "<type> <byte-length>\0"
   *   3. SHA-1 hash the header + content → this IS the object's identity
   *   4. zlib-compress the header + content
   *   5. Write to .gitinit/objects/<first-2-hex>/<remaining-38-hex>
   *
   * The object is a no-op if the hash already exists on disk (content-
   * addressable storage means identical content = identical hash = same file).
   */
  async writeObject(obj: GitObject): Promise<string> {
    const content = serializeObject(obj)
    const header = Buffer.from(`${obj.type} ${content.length}\0`)
    const full = Buffer.concat([header, content])

    const hash = sha1(full)

    // Skip writing if already stored — idempotent by design
    if (await this.hasObject(hash)) return hash

    const compressed = await compress(full)
    await writeFileWithDirs(objectPath(this.rootPath, hash), compressed)

    return hash
  }

  /**
   * Read a GitObject from the store by its hash.
   *
   * Throws if the object does not exist. Use hasObject() first if presence
   * is not guaranteed.
   */
  async readObject(hash: string): Promise<GitObject> {
    const path = objectPath(this.rootPath, hash)
    const compressed = await readFileMaybe(path)

    if (!compressed) {
      throw new Error(`Object not found: ${hash}`)
    }

    const full = await decompress(compressed)

    // Strip the header — find the null byte that terminates "<type> <N>\0"
    const nullPos = full.indexOf(0x00)
    if (nullPos === -1) throw new Error(`Malformed object: ${hash}`)

    const header = full.slice(0, nullPos).toString('utf8')
    const content = full.slice(nullPos + 1)

    const spacePos = header.indexOf(' ')
    if (spacePos === -1) throw new Error(`Malformed object header: ${hash}`)

    const type = header.slice(0, spacePos) as ObjectType

    return deserializeByType(type, content, hash)
  }

  /**
   * Returns true if an object with the given hash exists in the store.
   */
  async hasObject(hash: string): Promise<boolean> {
    const data = await readFileMaybe(objectPath(this.rootPath, hash))
    return data !== null
  }
}

/**
 * Dispatch serialization to the correct function based on object type.
 */
function serializeObject(obj: GitObject): Buffer {
  switch (obj.type) {
    case 'blob':
      return serializeBlob(obj)
    case 'tree':
      return serializeTree(obj)
    case 'commit':
      return serializeCommit(obj)
  }
}

/**
 * Dispatch deserialization to the correct function based on the type field
 * parsed from the object header.
 */
function deserializeByType(
  type: ObjectType,
  content: Buffer,
  hash: string,
): GitObject {
  switch (type) {
    case 'blob':
      return deserializeBlob(content)
    case 'tree':
      return deserializeTree(content)
    case 'commit':
      return deserializeCommit(content)
    default:
      throw new Error(`Unknown object type "${type as string}" in object ${hash}`)
  }
}
