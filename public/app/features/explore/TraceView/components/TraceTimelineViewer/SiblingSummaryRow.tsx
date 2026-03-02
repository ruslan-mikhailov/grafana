import { css } from '@emotion/css';
import * as React from 'react';
import { useEffect, useRef } from 'react';

import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

import { autoColor } from '../Theme';
import { TraceSpan } from '../types/trace';

import SpanTreeOffset from './SpanTreeOffset';
import TimelineRow from './TimelineRow';

const getStyles = (theme: GrafanaTheme2) => ({
  row: css({
    label: 'SiblingSummaryRow',
    fontSize: '0.85em',
    cursor: 'pointer',
    userSelect: 'none',
    '&:hover': {
      backgroundColor: autoColor(theme, '#f0f0f0'),
    },
  }),
  nameWrapper: css({
    label: 'nameWrapper',
    lineHeight: '23px',
    overflow: 'hidden',
    display: 'flex',

    '& > *': {
      background: theme.colors.background.secondary,
    },
  }),
  nameColumn: css({
    label: 'nameColumn',
    position: 'relative',
    whiteSpace: 'nowrap',
    zIndex: 1,
  }),
  summaryLabel: css({
    label: 'summaryLabel',
    fontStyle: 'italic',
    color: theme.colors.text.secondary,
    padding: '2px 4px',
    flex: '1 1 auto',
  }),
  rightCell: css({
    label: 'rightCell',
    backgroundColor: autoColor(theme, '#fafafa'),
  }),
});

export type SiblingSummaryRowProps = {
  parentSpanID: string;
  position: 'above' | 'below';
  hiddenCount: number;
  span: TraceSpan;
  columnDivision: number;
  onShiftWindow: (parentSpanID: string, delta: number) => void;
  hoverIndentGuideIds: Set<string>;
  addHoverIndentGuideId: (spanID: string) => void;
  removeHoverIndentGuideId: (spanID: string) => void;
  visibleSpanIds: string[];
};

const SiblingSummaryRow = React.memo<SiblingSummaryRowProps>(
  ({
    parentSpanID,
    position,
    hiddenCount,
    span,
    columnDivision,
    onShiftWindow,
    hoverIndentGuideIds,
    addHoverIndentGuideId,
    removeHoverIndentGuideId,
    visibleSpanIds,
  }) => {
    const styles = useStyles2(getStyles);
    const rowRef = useRef<HTMLDivElement>(null);

    // Use ref + addEventListener with { passive: false } so we can preventDefault
    // (React's synthetic onWheel may be registered as passive in Chrome)
    useEffect(() => {
      const el = rowRef.current;
      if (!el) {
        return;
      }

      const handler = (e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? 1 : -1;
        onShiftWindow(parentSpanID, delta);
      };

      el.addEventListener('wheel', handler, { passive: false });
      return () => {
        el.removeEventListener('wheel', handler);
      };
    }, [parentSpanID, onShiftWindow]);

    const arrow = position === 'above' ? '\u2191' : '\u2193';
    const label =
      position === 'above' ? `${arrow} ${hiddenCount} spans above` : `${arrow} ${hiddenCount} spans below`;

    return (
      <div ref={rowRef}>
        <TimelineRow className={styles.row}>
          <TimelineRow.Cell className={styles.nameColumn} width={columnDivision}>
            <div className={styles.nameWrapper}>
              <SpanTreeOffset
                span={span}
                showChildrenIcon={false}
                removeLastIndentGuide={true}
                hoverIndentGuideIds={hoverIndentGuideIds}
                addHoverIndentGuideId={addHoverIndentGuideId}
                removeHoverIndentGuideId={removeHoverIndentGuideId}
                visibleSpanIds={visibleSpanIds}
              />
              <span className={styles.summaryLabel}>{label}</span>
            </div>
          </TimelineRow.Cell>
          <TimelineRow.Cell className={styles.rightCell} width={1 - columnDivision}>
            {/* Empty right cell - matches SpanBarRow layout */}
          </TimelineRow.Cell>
        </TimelineRow>
      </div>
    );
  }
);

SiblingSummaryRow.displayName = 'SiblingSummaryRow';

export default SiblingSummaryRow;
