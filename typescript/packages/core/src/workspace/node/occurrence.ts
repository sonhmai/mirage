import type { Claimant, HandOff, Occurrence } from '../../policy/types.ts'
import type { TSNodeLike } from '../../shell/types.ts'

/**
 * What opens and closes a substitution's body, in the order the openers
 * are tried; the body between them is the text a nested line is parsed
 * from.
 */
export const SUBSTITUTION_DELIMITERS: readonly (readonly [string, string])[] = [
  ['$(', ')'],
  ['<(', ')'],
  ['>(', ')'],
  ['`', '`'],
]

/**
 * The text a walk reads commands from, as the line that evaluates it
 * will parse it.
 *
 * The pass walks one tree and computes for every command the occurrence
 * the gate will compute when it runs, and the gate may be running a
 * different parse of the same text: a substitution's body is parsed on
 * its own by the nested line, at offsets that start from zero, while
 * the pass reads it as a subtree of the outer line. The frame is what
 * makes the two agree: `text` is what the nested line parses, `base` is
 * where that text starts in the tree being walked, and `parent` is the
 * occurrence its commands stand under. Mirrors the Python Frame.
 */
export interface Frame {
  readonly text: string
  readonly base: number
  readonly parent: Occurrence | null
}

/** The root of the tree a node belongs to. */
export function rootOf(node: TSNodeLike): TSNodeLike {
  let root = node
  while (root.parent !== null && root.parent !== undefined) root = root.parent
  return root
}

/**
 * The frame of the tree a node belongs to: the text its parse read, at
 * that parse's own offsets.
 *
 * The one rule both readers share. The gate builds it from the node it
 * runs, and the pass from the tree it walks, so a stored function body,
 * kept as the nodes of the line that defined it, is read at invocation
 * exactly as it was judged.
 */
export function rootFrame(node: TSNodeLike, parent: Occurrence | null): Frame {
  const root = rootOf(node)
  return { text: root.text, base: root.startIndex ?? 0, parent }
}

/**
 * The frame of a line a word runs (`eval`, `sh -c`), which the pass
 * parses on its own exactly as the nested evaluation will.
 */
export function lineFrame(text: string, parent: Occurrence): Frame {
  return { text, base: 0, parent }
}

/** Where a node stands, as a parse of the frame's text would place it. */
export function occurrenceIn(node: TSNodeLike, frame: Frame): Occurrence {
  return {
    parent: frame.parent,
    source: frame.text,
    start: (node.startIndex ?? 0) - frame.base,
    end: (node.endIndex ?? 0) - frame.base,
  }
}

/**
 * The occurrence of a frame's whole text, for words a command runs
 * without a parse of their own (`xargs cat`, `find -exec`).
 */
export function wholeOccurrence(frame: Frame): Occurrence {
  return { parent: frame.parent, source: frame.text, start: 0, end: frame.text.length }
}

/**
 * The frame of a substitution's body, as the nested line that evaluates
 * it will parse it: `$( )`, `<( )`, `>( )` or a backtick region, with
 * the whitespace tree-sitter folds into the opening token set aside as
 * expansion sets it aside. Null for a node that is not a substitution
 * the evaluator would run.
 */
export function bodyFrame(node: TSNodeLike, frame: Frame): Frame | null {
  const text = node.text
  const prefix = text.length - text.trimStart().length
  const raw = text.slice(prefix)
  for (const [opener, closer] of SUBSTITUTION_DELIMITERS) {
    if (raw.startsWith(opener) && raw.endsWith(closer)) {
      const body = raw.slice(opener.length, raw.length - closer.length)
      const base = (node.startIndex ?? 0) + prefix + opener.length
      return { text: body, base, parent: occurrenceIn(node, frame) }
    }
  }
  return null
}

/**
 * Where a node the executor runs stands, on the line it runs in: the
 * line's hand-off carries as `origin` the node the line's text was
 * evaluated from.
 */
export function occurrenceOf(node: TSNodeLike, handed: HandOff): Occurrence {
  return occurrenceIn(node, rootFrame(node, handed.origin))
}

/**
 * The reader of the ledger for one command the executor runs, null
 * outside a line.
 */
export function claimantFor(node: TSNodeLike, handed: HandOff | null | undefined): Claimant | null {
  if (handed === null || handed === undefined) return null
  return { line: handed, occurrence: occurrenceOf(node, handed) }
}
