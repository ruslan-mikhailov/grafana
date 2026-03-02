import { useCallback, useMemo, useState } from 'react';

import { Trace, TraceSpan } from './components/types/trace';

export const SIBLING_PAGE_SIZE = 20;
export const SIBLING_THRESHOLD = 50;
const SCROLL_STEP = 5;

type ChildPosition = {
  parentSpanID: string;
  childIndex: number;
};

export type SiblingPaginationResult = {
  siblingWindows: Map<string, number>;
  shiftSiblingWindow: (parentSpanID: string, delta: number) => void;
  pageSize: number;
  threshold: number;
};

/**
 * Build a map from spanID → { parentSpanID, childIndex } using DFS order.
 * This matches how generateRowStates counts children (by iterating spans in array order
 * and tracking depth), NOT the order in childSpanIds (which may be sorted by end time).
 */
function buildChildPositionMap(spans: TraceSpan[]): Map<string, ChildPosition> {
  const map = new Map<string, ChildPosition>();
  // spanByID for O(1) lookups
  const spanByID = new Map<string, TraceSpan>();
  for (const span of spans) {
    spanByID.set(span.spanID, span);
  }

  // Track parent context via depth-based stack
  // Each entry: { spanID, depth, currentChildIndex }
  const parentStack: Array<{ spanID: string; depth: number; childCount: number; currentChildIndex: number }> = [];

  for (const span of spans) {
    // Pop stack until we find the parent at depth - 1
    while (parentStack.length > 0 && parentStack[parentStack.length - 1].depth >= span.depth) {
      parentStack.pop();
    }

    if (parentStack.length > 0) {
      const parent = parentStack[parentStack.length - 1];
      // This span is a direct child if its depth === parent.depth + 1
      if (span.depth === parent.depth + 1) {
        map.set(span.spanID, {
          parentSpanID: parent.spanID,
          childIndex: parent.currentChildIndex,
        });
        parent.currentChildIndex++;
      }
    }

    // Push this span as a potential parent
    if (span.hasChildren) {
      parentStack.push({
        spanID: span.spanID,
        depth: span.depth,
        childCount: span.childSpanCount,
        currentChildIndex: 0,
      });
    }
  }

  return map;
}

export function useSiblingPagination(
  trace: Trace | undefined,
  mustBeVisibleSpanIDs: Set<string>
): SiblingPaginationResult {
  const [userWindows, setUserWindows] = useState<Map<string, number>>(() => new Map());

  const childPositionMap = useMemo(() => {
    if (!trace?.spans) {
      return new Map<string, ChildPosition>();
    }
    return buildChildPositionMap(trace.spans);
  }, [trace?.spans]);

  // Build a set of parentSpanIDs that qualify for pagination
  const paginatedParents = useMemo(() => {
    if (!trace?.spans) {
      return new Set<string>();
    }
    const parents = new Set<string>();
    for (const span of trace.spans) {
      if (span.childSpanCount >= SIBLING_THRESHOLD) {
        parents.add(span.spanID);
      }
    }
    return parents;
  }, [trace?.spans]);

  // Compute effective windows: start from user windows, then auto-center for must-be-visible spans
  const siblingWindows = useMemo(() => {
    const effective = new Map(userWindows);

    for (const spanID of mustBeVisibleSpanIDs) {
      const pos = childPositionMap.get(spanID);
      if (!pos) {
        continue;
      }
      if (!paginatedParents.has(pos.parentSpanID)) {
        continue;
      }

      const currentStart = effective.get(pos.parentSpanID) ?? 0;
      const currentEnd = currentStart + SIBLING_PAGE_SIZE;

      // If the span is outside the current window, shift to center on it
      if (pos.childIndex < currentStart || pos.childIndex >= currentEnd) {
        // Center the window on this child
        const spanByID = new Map<string, TraceSpan>();
        if (trace?.spans) {
          for (const s of trace.spans) {
            spanByID.set(s.spanID, s);
          }
        }
        const parentSpan = spanByID.get(pos.parentSpanID);
        const totalChildren = parentSpan?.childSpanCount ?? SIBLING_THRESHOLD;
        const maxStart = Math.max(0, totalChildren - SIBLING_PAGE_SIZE);
        const centered = Math.max(0, Math.min(maxStart, pos.childIndex - Math.floor(SIBLING_PAGE_SIZE / 2)));
        effective.set(pos.parentSpanID, centered);
      }
    }

    return effective;
  }, [userWindows, mustBeVisibleSpanIDs, childPositionMap, paginatedParents, trace?.spans]);

  const shiftSiblingWindow = useCallback(
    (parentSpanID: string, delta: number) => {
      setUserWindows((prev) => {
        const next = new Map(prev);
        const currentStart = next.get(parentSpanID) ?? 0;
        // Find the parent's child count
        let totalChildren = SIBLING_THRESHOLD;
        if (trace?.spans) {
          for (const span of trace.spans) {
            if (span.spanID === parentSpanID) {
              totalChildren = span.childSpanCount;
              break;
            }
          }
        }
        const maxStart = Math.max(0, totalChildren - SIBLING_PAGE_SIZE);
        const newStart = Math.max(0, Math.min(maxStart, currentStart + delta * SCROLL_STEP));
        next.set(parentSpanID, newStart);
        return next;
      });
    },
    [trace?.spans]
  );

  return {
    siblingWindows,
    shiftSiblingWindow,
    pageSize: SIBLING_PAGE_SIZE,
    threshold: SIBLING_THRESHOLD,
  };
}
