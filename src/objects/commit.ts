import type { CommitObject, GitSignature } from './types'

export function createCommit(params: Omit<CommitObject, 'type'>): CommitObject {
  return { type: 'commit', ...params }
}

/**
 * Serialize a commit to its raw content bytes (without the Git object header).
 *
 * Real Git commit text format — field order and the blank line are mandatory:
 *   tree <tree-hash>
 *   parent <parent-hash>    (one line per parent; omitted for root commit)
 *   author <signature>
 *   committer <signature>
 *   <blank line>
 *   <message>
 *
 * A GitSignature serializes as: "Name <email> <timestamp> <timezone>"
 */
export function serializeCommit(commit: CommitObject): Buffer {
  const lines: string[] = []

  lines.push(`tree ${commit.treeHash}`)

  for (const parent of commit.parentHashes) {
    lines.push(`parent ${parent}`)
  }

  lines.push(`author ${formatSignature(commit.author)}`)
  lines.push(`committer ${formatSignature(commit.committer)}`)

  // Mandatory blank line separating headers from the message body
  lines.push('')
  lines.push(commit.message)

  return Buffer.from(lines.join('\n'), 'utf8')
}

/**
 * Reconstruct a CommitObject from the raw content bytes read from the store.
 */
export function deserializeCommit(data: Buffer): CommitObject {
  const text = data.toString('utf8')

  // Split on the first blank line — everything above is headers, below is message
  const blankLine = text.indexOf('\n\n')
  if (blankLine === -1) throw new Error('Malformed commit: missing blank line')

  const headerBlock = text.slice(0, blankLine)
  // Message starts after the two newline characters ("\n\n")
  const message = text.slice(blankLine + 2)

  const headers = headerBlock.split('\n')

  let treeHash = ''
  const parentHashes: string[] = []
  let author: GitSignature | null = null
  let committer: GitSignature | null = null

  for (const line of headers) {
    if (line.startsWith('tree ')) {
      treeHash = line.slice(5)
    } else if (line.startsWith('parent ')) {
      parentHashes.push(line.slice(7))
    } else if (line.startsWith('author ')) {
      author = parseSignature(line.slice(7))
    } else if (line.startsWith('committer ')) {
      committer = parseSignature(line.slice(10))
    }
  }

  if (!treeHash) throw new Error('Malformed commit: missing tree')
  if (!author) throw new Error('Malformed commit: missing author')
  if (!committer) throw new Error('Malformed commit: missing committer')

  return { type: 'commit', treeHash, parentHashes, author, committer, message }
}

/**
 * Format a GitSignature as "Name <email> timestamp timezone".
 */
function formatSignature(sig: GitSignature): string {
  return `${sig.name} <${sig.email}> ${sig.timestamp} ${sig.timezone}`
}

/**
 * Parse "Name <email> timestamp timezone" into a GitSignature.
 *
 * The regex anchors from the right so that name can safely contain spaces.
 */
function parseSignature(line: string): GitSignature {
  const match = line.match(/^(.+) <(.+)> (\d+) ([+-]\d{4})$/)
  if (!match) throw new Error(`Malformed signature: "${line}"`)
  return {
    name: match[1],
    email: match[2],
    timestamp: parseInt(match[3], 10),
    timezone: match[4],
  }
}
