import { useMemo, useState, useCallback } from 'react';

import { TraceSpan } from './components/types/trace';

const DEFAULT_DEPTH_LIMIT = 3;
const LARGE_TRACE_THRESHOLD = 10_000;

export function useDepthLimit(spans: TraceSpan[] | undefined) {
  const [depthLimit, setDepthLimitState] = useState<number | null>(null);

  // Auto-apply depth limit for large traces, respect explicit user choice
  const effectiveDepthLimit = useMemo(() => {
    if (depthLimit !== null) {
      return depthLimit === 0 ? null : depthLimit;
    }
    if (spans && spans.length >= LARGE_TRACE_THRESHOLD) {
      return DEFAULT_DEPTH_LIMIT;
    }
    return null;
  }, [spans, depthLimit]);

  // Compute initial hidden IDs: hide children of spans at depth >= limit-1
  const initialHiddenIDs = useMemo(() => {
    if (!spans || effectiveDepthLimit === null) {
      return new Set<string>();
    }
    const hidden = new Set<string>();
    for (const span of spans) {
      if (span.hasChildren && span.depth >= effectiveDepthLimit - 1) {
        hidden.add(span.spanID);
      }
    }
    return hidden;
  }, [spans, effectiveDepthLimit]);

  const showFullTrace = useCallback(() => setDepthLimitState(0), []);
  const setDepthLimit = useCallback((limit: number) => setDepthLimitState(limit), []);

  return { depthLimit: effectiveDepthLimit, initialHiddenIDs, showFullTrace, setDepthLimit };
}
