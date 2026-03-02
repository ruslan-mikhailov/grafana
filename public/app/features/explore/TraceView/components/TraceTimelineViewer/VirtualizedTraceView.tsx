// Copyright (c) 2017 Uber Technologies, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { css, cx } from '@emotion/css';
import { isEqual } from 'lodash';
import memoizeOne from 'memoize-one';
import * as React from 'react';
import { RefObject } from 'react';

import { CoreApp, GrafanaTheme2, LinkModel, TimeRange, TraceLog } from '@grafana/data';
import { t } from '@grafana/i18n';
import { TraceToProfilesOptions } from '@grafana/o11y-ds-frontend';
import { config, reportInteraction } from '@grafana/runtime';
import { TimeZone } from '@grafana/schema';
import { stylesFactory, withTheme2, ToolbarButton } from '@grafana/ui';

import { PEER_SERVICE } from '../constants/tag-keys';
import { SpanBarOptions } from '../settings/SpanBarSettings';
import TNil from '../types/TNil';
import TTraceTimeline from '../types/TTraceTimeline';
import { SpanLinkFunc } from '../types/links';
import { TraceSpan, Trace, TraceSpanReference, CriticalPathSection } from '../types/trace';
import { getColorByKey } from '../utils/color-generator';

import ListView from './ListView';
import SiblingSummaryRow from './SiblingSummaryRow';
import SpanBarRow from './SpanBarRow';
import { TraceFlameGraphs } from './SpanDetail';
import DetailState from './SpanDetail/DetailState';
import SpanDetailRow from './SpanDetailRow';
import {
  createViewedBoundsFunc,
  findServerChildSpan,
  isErrorSpan,
  isKindClient,
  spanContainsErredSpan,
  ViewedBoundsFunctionType,
} from './utils';

const getStyles = stylesFactory(() => ({
  rowsWrapper: css({
    width: '100%',
  }),
  row: css({
    width: '100%',
  }),
  scrollToTopButton: css({
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    width: '40px',
    height: '40px',
    position: 'absolute',
    bottom: '30px',
    right: '30px',
    zIndex: 1,
  }),
}));

type RowState = {
  isDetail: boolean;
  span: TraceSpan;
  spanIndex: number;
  // Pagination-only fields:
  isSiblingPagination?: boolean;
  paginationParentSpanID?: string;
  paginationPosition?: 'above' | 'below';
  paginationHiddenCount?: number;
};

type TVirtualizedTraceViewOwnProps = {
  currentViewRangeTime: [number, number];
  timeZone: TimeZone;
  findMatchesIDs: Set<string> | TNil;
  trace: Trace;
  traceToProfilesOptions?: TraceToProfilesOptions;
  spanBarOptions: SpanBarOptions | undefined;
  childrenToggle: (spanID: string) => void;
  detailLogItemToggle: (spanID: string, log: TraceLog) => void;
  detailLogsToggle: (spanID: string) => void;
  detailWarningsToggle: (spanID: string) => void;
  detailStackTracesToggle: (spanID: string) => void;
  detailReferencesToggle: (spanID: string) => void;
  detailReferenceItemToggle: (spanID: string, reference: TraceSpanReference) => void;
  detailProcessToggle: (spanID: string) => void;
  detailTagsToggle: (spanID: string) => void;
  detailToggle: (spanID: string) => void;
  setSpanNameColumnWidth: (width: number) => void;
  hoverIndentGuideIds: Set<string>;
  addHoverIndentGuideId: (spanID: string) => void;
  removeHoverIndentGuideId: (spanID: string) => void;
  theme: GrafanaTheme2;
  createSpanLink?: SpanLinkFunc;
  scrollElement?: Element;
  focusedSpanId?: string;
  focusedSpanIdForSearch: string;
  showSpanFilterMatchesOnly: boolean;
  createFocusSpanLink: (traceId: string, spanId: string) => LinkModel;
  topOfViewRef?: RefObject<HTMLDivElement | null>;
  datasourceType: string;
  datasourceUid: string;
  headerHeight: number;
  criticalPath: CriticalPathSection[];
  traceFlameGraphs: TraceFlameGraphs;
  setTraceFlameGraphs: (flameGraphs: TraceFlameGraphs) => void;
  redrawListView: {};
  setRedrawListView: (redraw: {}) => void;
  timeRange: TimeRange;
  app: CoreApp;
  siblingWindows?: Map<string, number>;
  siblingThreshold?: number;
  siblingPageSize?: number;
  shiftSiblingWindow?: (parentSpanID: string, delta: number) => void;
};

export type VirtualizedTraceViewProps = TVirtualizedTraceViewOwnProps & TTraceTimeline;

// export for tests
export const DEFAULT_HEIGHTS = {
  bar: 28,
  detail: 161,
  detailWithLogs: 197,
  siblingPagination: 24,
};

const NUM_TICKS = 5;
const BUFFER_SIZE = 33;

type PaginationContext = {
  parentSpanID: string;
  childCount: number;
  windowStart: number;
  windowEnd: number;
  currentChildIndex: number;
  childDepth: number;
  afterSummaryEmitted: boolean;
};

function generateRowStates(
  spans: TraceSpan[] | TNil,
  childrenHiddenIDs: Set<string>,
  detailStates: Map<string, DetailState | TNil>,
  findMatchesIDs: Set<string> | TNil,
  showSpanFilterMatchesOnly: boolean,
  criticalPath: CriticalPathSection[],
  siblingWindows?: Map<string, number>,
  siblingThreshold?: number,
  siblingPageSize?: number
): RowState[] {
  if (!spans) {
    return [];
  }
  // Apply filtering when matchesOnly is enabled
  // Critical path filtering is now integrated into findMatchesIDs
  if (showSpanFilterMatchesOnly && findMatchesIDs) {
    spans = spans.filter((span) => findMatchesIDs.has(span.spanID));
  }

  const threshold = siblingThreshold ?? 50;
  const pageSize = siblingPageSize ?? 20;
  const usePagination = !showSpanFilterMatchesOnly && siblingWindows != null;

  let collapseDepth: number | null = null;
  let paginationSkipDepth: number | null = null;
  const paginationStack: PaginationContext[] = [];
  const rowStates: RowState[] = [];

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const { spanID, depth } = span;

    // 1. Pop stale pagination contexts
    if (usePagination) {
      while (paginationStack.length > 0) {
        const ctx = paginationStack[paginationStack.length - 1];
        if (depth < ctx.childDepth) {
          // Emit "below" summary if we haven't yet and there are hidden children after the window
          if (!ctx.afterSummaryEmitted && ctx.windowEnd < ctx.childCount) {
            const hiddenAfter = ctx.childCount - ctx.windowEnd;
            rowStates.push({
              span: span, // boundary sibling for indentation
              isDetail: false,
              spanIndex: i,
              isSiblingPagination: true,
              paginationParentSpanID: ctx.parentSpanID,
              paginationPosition: 'below',
              paginationHiddenCount: hiddenAfter,
            });
          }
          paginationStack.pop();
        } else {
          break;
        }
      }

      // Clear paginationSkipDepth if we've ascended above it
      if (paginationSkipDepth != null && depth < paginationSkipDepth) {
        paginationSkipDepth = null;
      }
    }

    // 2. Collapse check (existing collapseDepth logic, unchanged)
    let hidden = false;
    if (collapseDepth != null) {
      if (depth >= collapseDepth) {
        hidden = true;
      } else {
        collapseDepth = null;
      }
    }
    if (hidden) {
      continue;
    }

    // 3. Pagination skip check
    if (usePagination && paginationSkipDepth != null && depth >= paginationSkipDepth) {
      continue;
    }

    // 4. Pagination sibling check (if direct child of paginated parent)
    if (usePagination && paginationStack.length > 0) {
      const ctx = paginationStack[paginationStack.length - 1];
      if (depth === ctx.childDepth) {
        const childIdx = ctx.currentChildIndex;
        ctx.currentChildIndex++;

        // Emit "above" summary row before the first visible child
        if (childIdx === ctx.windowStart && ctx.windowStart > 0) {
          rowStates.push({
            span,
            isDetail: false,
            spanIndex: i,
            isSiblingPagination: true,
            paginationParentSpanID: ctx.parentSpanID,
            paginationPosition: 'above',
            paginationHiddenCount: ctx.windowStart,
          });
        }

        if (childIdx < ctx.windowStart) {
          // Before window — skip this span and all its descendants
          paginationSkipDepth = depth + 1;
          continue;
        }

        if (childIdx >= ctx.windowEnd) {
          // After window — emit "below" summary row on the first out-of-window child
          if (!ctx.afterSummaryEmitted) {
            ctx.afterSummaryEmitted = true;
            const hiddenAfter = ctx.childCount - ctx.windowEnd;
            rowStates.push({
              span,
              isDetail: false,
              spanIndex: i,
              isSiblingPagination: true,
              paginationParentSpanID: ctx.parentSpanID,
              paginationPosition: 'below',
              paginationHiddenCount: hiddenAfter,
            });
          }
          paginationSkipDepth = depth + 1;
          continue;
        }

        // In window — fall through to normal processing
      }
    }

    // 5. Push pagination context if this span qualifies as a paginated parent
    if (usePagination && span.childSpanCount >= threshold && !childrenHiddenIDs.has(spanID)) {
      const windowStart = siblingWindows!.get(spanID) ?? 0;
      paginationStack.push({
        parentSpanID: spanID,
        childCount: span.childSpanCount,
        windowStart,
        windowEnd: Math.min(windowStart + pageSize, span.childSpanCount),
        currentChildIndex: 0,
        childDepth: depth + 1,
        afterSummaryEmitted: false,
      });
    }

    // 6. User collapse check (childrenHiddenIDs, set collapseDepth)
    if (childrenHiddenIDs.has(spanID)) {
      collapseDepth = depth + 1;
    }

    // 7. Emit span row + optional detail row (existing)
    rowStates.push({
      span,
      isDetail: false,
      spanIndex: i,
    });
    if (detailStates.has(spanID)) {
      rowStates.push({
        span,
        isDetail: true,
        spanIndex: i,
      });
    }
  }

  // Flush remaining "below" summaries for any open pagination contexts
  if (usePagination) {
    for (const ctx of paginationStack) {
      if (!ctx.afterSummaryEmitted && ctx.windowEnd < ctx.childCount) {
        const hiddenAfter = ctx.childCount - ctx.windowEnd;
        // Use the last span as a boundary reference
        const lastSpan = spans[spans.length - 1];
        rowStates.push({
          span: lastSpan,
          isDetail: false,
          spanIndex: spans.length - 1,
          isSiblingPagination: true,
          paginationParentSpanID: ctx.parentSpanID,
          paginationPosition: 'below',
          paginationHiddenCount: hiddenAfter,
        });
      }
    }
  }

  return rowStates;
}

function getClipping(currentViewRange: [number, number]) {
  const [zoomStart, zoomEnd] = currentViewRange;
  return {
    left: zoomStart > 0,
    right: zoomEnd < 1,
  };
}

function generateRowStatesFromTrace(
  trace: Trace | TNil,
  childrenHiddenIDs: Set<string>,
  detailStates: Map<string, DetailState | TNil>,
  findMatchesIDs: Set<string> | TNil,
  showSpanFilterMatchesOnly: boolean,
  criticalPath: CriticalPathSection[],
  siblingWindows?: Map<string, number>,
  siblingThreshold?: number,
  siblingPageSize?: number
): RowState[] {
  return trace
    ? generateRowStates(
        trace.spans,
        childrenHiddenIDs,
        detailStates,
        findMatchesIDs,
        showSpanFilterMatchesOnly,
        criticalPath,
        siblingWindows,
        siblingThreshold,
        siblingPageSize
      )
    : [];
}

function childSpansMap(trace: Trace | TNil) {
  const childSpansMap = new Map<string, string[]>();
  if (!trace) {
    return childSpansMap;
  }
  trace.spans.forEach((span) => {
    if (span.childSpanIds.length) {
      childSpansMap.set(span.spanID, span.childSpanIds);
    }
  });
  return childSpansMap;
}

const memoizedGenerateRowStates = memoizeOne(generateRowStatesFromTrace);
const memoizedViewBoundsFunc = memoizeOne(createViewedBoundsFunc, isEqual);
const memoizedGetClipping = memoizeOne(getClipping, isEqual);
const memoizedChildSpansMap = memoizeOne(childSpansMap);

// export from tests
export class UnthemedVirtualizedTraceView extends React.Component<VirtualizedTraceViewProps> {
  listView: ListView | TNil;
  hasScrolledToSpan = false;

  componentDidMount() {
    this.scrollToSpan(this.props.headerHeight, this.props.focusedSpanId);
  }

  shouldComponentUpdate(nextProps: VirtualizedTraceViewProps) {
    // If any prop updates, VirtualizedTraceViewImpl should update.
    let key: keyof VirtualizedTraceViewProps;
    for (key in nextProps) {
      if (nextProps[key] !== this.props[key]) {
        return true;
      }
    }
    return false;
  }

  componentDidUpdate(prevProps: Readonly<VirtualizedTraceViewProps>) {
    const { headerHeight, focusedSpanId, focusedSpanIdForSearch } = this.props;

    if (!this.hasScrolledToSpan) {
      this.scrollToSpan(headerHeight, focusedSpanId);
      this.hasScrolledToSpan = true;
    }

    if (focusedSpanId !== prevProps.focusedSpanId) {
      this.scrollToSpan(headerHeight, focusedSpanId);
    }

    if (focusedSpanIdForSearch !== prevProps.focusedSpanIdForSearch) {
      this.scrollToSpan(headerHeight, focusedSpanIdForSearch);
    }
  }

  getRowStates(): RowState[] {
    const {
      childrenHiddenIDs,
      detailStates,
      trace,
      findMatchesIDs,
      showSpanFilterMatchesOnly,
      criticalPath,
      siblingWindows,
      siblingThreshold,
      siblingPageSize,
    } = this.props;
    return memoizedGenerateRowStates(
      trace,
      childrenHiddenIDs,
      detailStates,
      findMatchesIDs,
      showSpanFilterMatchesOnly,
      criticalPath,
      siblingWindows,
      siblingThreshold,
      siblingPageSize
    );
  }

  getClipping(): { left: boolean; right: boolean } {
    const { currentViewRangeTime } = this.props;
    return memoizedGetClipping(currentViewRangeTime);
  }

  getViewedBounds(): ViewedBoundsFunctionType {
    const { currentViewRangeTime, trace } = this.props;
    const [zoomStart, zoomEnd] = currentViewRangeTime;

    return memoizedViewBoundsFunc({
      min: trace.startTime,
      max: trace.endTime,
      viewStart: zoomStart,
      viewEnd: zoomEnd,
    });
  }

  getChildSpansMap() {
    return memoizedChildSpansMap(this.props.trace);
  }

  getAccessors() {
    const lv = this.listView;
    if (!lv) {
      throw new Error('ListView unavailable');
    }
    return {
      getViewRange: this.getViewRange,
      getSearchedSpanIDs: this.getSearchedSpanIDs,
      getCollapsedChildren: this.getCollapsedChildren,
      getViewHeight: lv.getViewHeight,
      getBottomRowIndexVisible: lv.getBottomVisibleIndex,
      getTopRowIndexVisible: lv.getTopVisibleIndex,
      getRowPosition: lv.getRowPosition,
      mapRowIndexToSpanIndex: this.mapRowIndexToSpanIndex,
      mapSpanIndexToRowIndex: this.mapSpanIndexToRowIndex,
    };
  }

  getViewRange = () => this.props.currentViewRangeTime;

  getSearchedSpanIDs = () => this.props.findMatchesIDs;

  getCollapsedChildren = () => this.props.childrenHiddenIDs;

  mapRowIndexToSpanIndex = (index: number) => this.getRowStates()[index].spanIndex;

  mapSpanIndexToRowIndex = (index: number) => {
    const max = this.getRowStates().length;
    for (let i = 0; i < max; i++) {
      const row = this.getRowStates()[i];
      if (row.isSiblingPagination) {
        continue;
      }
      if (row.spanIndex === index) {
        return i;
      }
    }
    // Return -1 for spans that are paginated away (outside the visible window)
    return -1;
  };

  setListView = (listView: ListView | TNil) => {
    this.listView = listView;
  };

  // use long form syntax to avert flow error
  // https://github.com/facebook/flow/issues/3076#issuecomment-290944051
  getKeyFromIndex = (index: number) => {
    const row = this.getRowStates()[index];
    if (row.isSiblingPagination) {
      return `${row.paginationParentSpanID}--pagination-${row.paginationPosition}`;
    }
    const { isDetail, span } = row;
    return `${span.traceID}--${span.spanID}--${isDetail ? 'detail' : 'bar'}`;
  };

  getIndexFromKey = (key: string) => {
    // Check for pagination keys
    if (key.includes('--pagination-')) {
      const max = this.getRowStates().length;
      for (let i = 0; i < max; i++) {
        const row = this.getRowStates()[i];
        if (row.isSiblingPagination) {
          const rowKey = `${row.paginationParentSpanID}--pagination-${row.paginationPosition}`;
          if (rowKey === key) {
            return i;
          }
        }
      }
      return -1;
    }
    const parts = key.split('--');
    const _traceID = parts[0];
    const _spanID = parts[1];
    const _isDetail = parts[2] === 'detail';
    const max = this.getRowStates().length;
    for (let i = 0; i < max; i++) {
      const { span, isDetail } = this.getRowStates()[i];
      if (span.spanID === _spanID && span.traceID === _traceID && isDetail === _isDetail) {
        return i;
      }
    }
    return -1;
  };

  getRowHeight = (index: number) => {
    const row = this.getRowStates()[index];
    if (row.isSiblingPagination) {
      return DEFAULT_HEIGHTS.siblingPagination;
    }
    const { span, isDetail } = row;
    if (!isDetail) {
      return DEFAULT_HEIGHTS.bar;
    }
    if (Array.isArray(span.logs) && span.logs.length) {
      return DEFAULT_HEIGHTS.detailWithLogs;
    }
    return DEFAULT_HEIGHTS.detail;
  };

  renderRow = (key: string, style: React.CSSProperties, index: number, attrs: {}) => {
    const row = this.getRowStates()[index];
    const { isDetail, span, spanIndex } = row;

    // Compute the list of currently visible span IDs to pass to the row renderers.
    const start = Math.max((this.listView?.getTopVisibleIndex() || 0) - BUFFER_SIZE, 0);
    const end = (this.listView?.getBottomVisibleIndex() || 0) + BUFFER_SIZE;
    const visibleSpanIds = this.getVisibleSpanIds(start, end);

    if (row.isSiblingPagination) {
      return this.renderSiblingPaginationRow(row, key, style, attrs, visibleSpanIds);
    }

    return isDetail
      ? this.renderSpanDetailRow(span, key, style, attrs, visibleSpanIds)
      : this.renderSpanBarRow(span, spanIndex, key, style, attrs, visibleSpanIds);
  };

  scrollToSpan = (headerHeight: number, spanID?: string) => {
    if (spanID == null) {
      return;
    }
    const i = this.getRowStates().findIndex((row) => !row.isSiblingPagination && row.span.spanID === spanID);
    if (i >= 0) {
      this.listView?.scrollToIndex(i, headerHeight);
    }
  };

  renderSiblingPaginationRow(
    row: RowState,
    key: string,
    style: React.CSSProperties,
    attrs: {},
    visibleSpanIds: string[]
  ) {
    const { spanNameColumnWidth, hoverIndentGuideIds, addHoverIndentGuideId, removeHoverIndentGuideId, shiftSiblingWindow } =
      this.props;
    const styles = getStyles();
    return (
      <div className={styles.row} key={key} style={style} {...attrs}>
        <SiblingSummaryRow
          parentSpanID={row.paginationParentSpanID!}
          position={row.paginationPosition!}
          hiddenCount={row.paginationHiddenCount!}
          span={row.span}
          columnDivision={spanNameColumnWidth}
          onShiftWindow={shiftSiblingWindow!}
          hoverIndentGuideIds={hoverIndentGuideIds}
          addHoverIndentGuideId={addHoverIndentGuideId}
          removeHoverIndentGuideId={removeHoverIndentGuideId}
          visibleSpanIds={visibleSpanIds}
        />
      </div>
    );
  }

  renderSpanBarRow(
    span: TraceSpan,
    spanIndex: number,
    key: string,
    style: React.CSSProperties,
    attrs: {},
    visibleSpanIds: string[]
  ) {
    const { spanID, childSpanIds } = span;
    const { serviceName } = span.process;
    const {
      childrenHiddenIDs,
      childrenToggle,
      detailStates,
      detailToggle,
      findMatchesIDs,
      spanNameColumnWidth,
      trace,
      spanBarOptions,
      hoverIndentGuideIds,
      addHoverIndentGuideId,
      removeHoverIndentGuideId,
      createSpanLink,
      focusedSpanId,
      focusedSpanIdForSearch,
      showSpanFilterMatchesOnly,
      theme,
      datasourceType,
      criticalPath,
    } = this.props;
    // to avert flow error
    if (!trace) {
      return null;
    }
    const color = getColorByKey(serviceName, theme);
    const isCollapsed = childrenHiddenIDs.has(spanID);
    const isDetailExpanded = detailStates.has(spanID);
    const isMatchingFilter = findMatchesIDs ? findMatchesIDs.has(spanID) : false;
    const isFocused = spanID === focusedSpanId || spanID === focusedSpanIdForSearch;
    const showErrorIcon = isErrorSpan(span) || (isCollapsed && spanContainsErredSpan(trace.spans, spanIndex));

    // Check for direct child "server" span if the span is a "client" span.
    let rpc = null;
    if (isCollapsed) {
      const rpcSpan = findServerChildSpan(trace.spans.slice(spanIndex));
      if (rpcSpan) {
        const rpcViewBounds = this.getViewedBounds()(rpcSpan.startTime, rpcSpan.startTime + rpcSpan.duration);
        rpc = {
          color: getColorByKey(rpcSpan.process.serviceName, theme),
          operationName: rpcSpan.operationName,
          serviceName: rpcSpan.process.serviceName,
          viewEnd: rpcViewBounds.end,
          viewStart: rpcViewBounds.start,
        };
      }
    }

    const peerServiceKV = span.tags.find((kv) => kv.key === PEER_SERVICE);
    // Leaf, kind == client and has peer.service.tag, is likely a client span that does a request
    // to an uninstrumented/external service
    let noInstrumentedServer = null;
    if (!span.hasChildren && peerServiceKV && isKindClient(span)) {
      noInstrumentedServer = {
        serviceName: peerServiceKV.value,
        color: getColorByKey(peerServiceKV.value, theme),
      };
    }

    const prevSpan = spanIndex > 0 ? trace.spans[spanIndex - 1] : null;

    const allChildSpanIds = [spanID, ...childSpanIds];
    // This function called recursively to find all descendants of a span
    const findAllDescendants = (currentChildSpanIds: string[]) => {
      currentChildSpanIds.forEach((eachId) => {
        const childrenOfCurrent = this.getChildSpansMap().get(eachId);
        if (childrenOfCurrent?.length) {
          allChildSpanIds.push(...childrenOfCurrent);
          findAllDescendants(childrenOfCurrent);
        }
      });
    };
    findAllDescendants(childSpanIds);
    const criticalPathSections = criticalPath?.filter((each) => {
      if (isCollapsed) {
        return allChildSpanIds.includes(each.spanId);
      }
      return each.spanId === spanID;
    });

    const styles = getStyles();
    return (
      <div className={styles.row} key={key} style={style} {...attrs}>
        <SpanBarRow
          clippingLeft={this.getClipping().left}
          clippingRight={this.getClipping().right}
          color={color}
          spanBarOptions={spanBarOptions}
          columnDivision={spanNameColumnWidth}
          isChildrenExpanded={!isCollapsed}
          isDetailExpanded={isDetailExpanded}
          isMatchingFilter={isMatchingFilter}
          isFocused={isFocused}
          showSpanFilterMatchesOnly={showSpanFilterMatchesOnly}
          numTicks={NUM_TICKS}
          onDetailToggled={detailToggle}
          onChildrenToggled={childrenToggle}
          rpc={rpc}
          noInstrumentedServer={noInstrumentedServer}
          showErrorIcon={showErrorIcon}
          getViewedBounds={this.getViewedBounds()}
          traceStartTime={trace.startTime}
          span={span}
          hoverIndentGuideIds={hoverIndentGuideIds}
          addHoverIndentGuideId={addHoverIndentGuideId}
          removeHoverIndentGuideId={removeHoverIndentGuideId}
          createSpanLink={createSpanLink}
          datasourceType={datasourceType}
          showServiceName={prevSpan === null || prevSpan.process.serviceName !== span.process.serviceName}
          visibleSpanIds={visibleSpanIds}
          criticalPath={criticalPathSections}
          collapsedDescendantCount={isCollapsed ? span.descendantCount : undefined}
        />
      </div>
    );
  }

  renderSpanDetailRow(span: TraceSpan, key: string, style: React.CSSProperties, attrs: {}, visibleSpanIds: string[]) {
    const { spanID } = span;
    const { serviceName } = span.process;
    const {
      detailLogItemToggle,
      detailLogsToggle,
      detailProcessToggle,
      detailReferencesToggle,
      detailReferenceItemToggle,
      detailWarningsToggle,
      detailStackTracesToggle,
      detailStates,
      detailTagsToggle,
      detailToggle,
      spanNameColumnWidth,
      trace,
      traceToProfilesOptions,
      timeZone,
      hoverIndentGuideIds,
      addHoverIndentGuideId,
      removeHoverIndentGuideId,
      createSpanLink,
      focusedSpanId,
      createFocusSpanLink,
      theme,
      datasourceType,
      datasourceUid,
      traceFlameGraphs,
      setTraceFlameGraphs,
      setRedrawListView,
      timeRange,
      app,
    } = this.props;
    const detailState = detailStates.get(spanID);
    if (!trace || !detailState) {
      return null;
    }
    const color = getColorByKey(serviceName, theme);
    const styles = getStyles();

    return (
      <div className={cx(styles.row, 'span-detail-row')} key={key} style={{ ...style, zIndex: 1 }} {...attrs}>
        <SpanDetailRow
          color={color}
          columnDivision={spanNameColumnWidth}
          onDetailToggled={detailToggle}
          detailState={detailState}
          logItemToggle={detailLogItemToggle}
          logsToggle={detailLogsToggle}
          processToggle={detailProcessToggle}
          referenceItemToggle={detailReferenceItemToggle}
          referencesToggle={detailReferencesToggle}
          warningsToggle={detailWarningsToggle}
          stackTracesToggle={detailStackTracesToggle}
          span={span}
          traceToProfilesOptions={traceToProfilesOptions}
          timeZone={timeZone}
          tagsToggle={detailTagsToggle}
          traceStartTime={trace.startTime}
          traceDuration={trace.duration}
          traceName={trace.traceName}
          hoverIndentGuideIds={hoverIndentGuideIds}
          addHoverIndentGuideId={addHoverIndentGuideId}
          removeHoverIndentGuideId={removeHoverIndentGuideId}
          createSpanLink={createSpanLink}
          focusedSpanId={focusedSpanId}
          createFocusSpanLink={createFocusSpanLink}
          datasourceType={datasourceType}
          datasourceUid={datasourceUid}
          visibleSpanIds={visibleSpanIds}
          traceFlameGraphs={traceFlameGraphs}
          setTraceFlameGraphs={setTraceFlameGraphs}
          setRedrawListView={setRedrawListView}
          timeRange={timeRange}
          app={app}
        />
      </div>
    );
  }

  scrollToTop = () => {
    const { topOfViewRef, datasourceType, trace } = this.props;
    topOfViewRef?.current?.scrollIntoView({ behavior: 'smooth' });
    reportInteraction('grafana_traces_trace_view_scroll_to_top_clicked', {
      datasourceType: datasourceType,
      grafana_version: config.buildInfo.version,
      numServices: trace.services.length,
      numSpans: trace.spans.length,
    });
  };

  getVisibleSpanIds = memoizeOne((start: number, end: number) => {
    const spanIds = [];
    for (let i = start; i < end; i++) {
      const rowState = this.getRowStates()[i];
      if (rowState?.span) {
        spanIds.push(rowState.span.spanID);
      }
    }
    return spanIds;
  });

  render() {
    const styles = getStyles();
    const { scrollElement, redrawListView } = this.props;

    return (
      <>
        <ListView
          ref={this.setListView}
          dataLength={this.getRowStates().length}
          itemHeightGetter={this.getRowHeight}
          itemRenderer={this.renderRow}
          viewBuffer={BUFFER_SIZE}
          viewBufferMin={BUFFER_SIZE}
          itemsWrapperClassName={styles.rowsWrapper}
          getKeyFromIndex={this.getKeyFromIndex}
          getIndexFromKey={this.getIndexFromKey}
          windowScroller={false}
          scrollElement={scrollElement}
          redraw={redrawListView}
        />
        {this.props.topOfViewRef && ( // only for panel as explore uses content outline to scroll to top
          <ToolbarButton
            className={styles.scrollToTopButton}
            onClick={this.scrollToTop}
            tooltip={t('explore.unthemed-virtualized-trace-view.title-scroll-to-top', 'Scroll to top')}
            icon="arrow-up"
          ></ToolbarButton>
        )}
      </>
    );
  }
}

export default withTheme2(UnthemedVirtualizedTraceView);
