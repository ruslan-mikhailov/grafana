import { css } from '@emotion/css';

import { useSyncExternalStore } from 'react';

import {
  getProtectedAttributeDisplayEpoch,
  getProtectedAttributeDisplayValue,
  subscribeProtectedAttributeDisplay,
  type GrafanaTheme2,
  type TraceKeyValuePair,
} from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

export type KeyValuesSummaryProps = {
  data?: TraceKeyValuePair[] | null;
  datasourceType?: string;
  isSpanAttribute?: boolean;
};

export function KeyValuesSummary({ data = null, datasourceType, isSpanAttribute }: KeyValuesSummaryProps) {
  useSyncExternalStore(
    subscribeProtectedAttributeDisplay,
    getProtectedAttributeDisplayEpoch,
    getProtectedAttributeDisplayEpoch
  );
  const styles = useStyles2(getStyles);

  if (!Array.isArray(data) || !data.length) {
    return null;
  }

  return (
    <ul className={styles.summary}>
      {data.map((item, i) => (
        // `i` is necessary in the key because item.key can repeat
        <li className={styles.summaryItem} key={`${item.key}-${i}`}>
          <span className={styles.summaryLabel}>{item.key}</span>
          {String(
            (datasourceType === 'tempo' && isSpanAttribute
              ? getProtectedAttributeDisplayValue(item.key, item.value)
              : undefined) ?? item.value
          )}
        </li>
      ))}
    </ul>
  );
}

const getStyles = (theme: GrafanaTheme2) => {
  return {
    summary: css({
      label: 'summary',
      display: 'inline',
      listStyle: 'none',
      padding: 0,
    }),
    summaryItem: css({
      label: 'summaryItem',
      display: 'inline',
      paddingRight: '0.5rem',
      '&:last-child': {
        paddingRight: 0,
        borderRight: 'none',
      },
    }),
    summaryLabel: css({
      label: 'summaryLabel',
      color: theme.colors.text.secondary,
      paddingRight: '0.5rem',
    }),
  };
};
