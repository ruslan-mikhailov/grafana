import { TraceSpan } from './components/types/trace';

/**
 * Given DFS-ordered spans, hidden IDs, and target span IDs that must be visible,
 * returns a new Set with ancestor span IDs removed to reveal each target span.
 * O(n) single pass with ancestor stack. Returns same reference if no changes needed.
 */
export function expandPathsToSpans(
  spans: TraceSpan[],
  hiddenIDs: Set<string>,
  targetSpanIDs: Set<string>
): Set<string> {
  if (targetSpanIDs.size === 0 || hiddenIDs.size === 0) {
    return hiddenIDs;
  }

  const toRemove = new Set<string>();
  const ancestorStack: TraceSpan[] = [];

  for (const span of spans) {
    while (ancestorStack.length > 0 && ancestorStack[ancestorStack.length - 1].depth >= span.depth) {
      ancestorStack.pop();
    }
    if (targetSpanIDs.has(span.spanID)) {
      for (const ancestor of ancestorStack) {
        if (hiddenIDs.has(ancestor.spanID)) {
          toRemove.add(ancestor.spanID);
        }
      }
    }
    ancestorStack.push(span);
  }

  if (toRemove.size === 0) {
    return hiddenIDs;
  }
  const result = new Set(hiddenIDs);
  for (const id of toRemove) {
    result.delete(id);
  }
  return result;
}
