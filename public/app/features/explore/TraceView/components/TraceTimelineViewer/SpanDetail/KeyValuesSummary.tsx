import { css } from '@emotion/css';
import { useSyncExternalStore } from 'react';

import {
  getProtectedAttributeDisplayEpoch,
  getProtectedAttributeDisplayValue,
  getProtectedAttributeKeyId,
  requestProtectedAttributeKey,
  subscribeProtectedAttributeDisplay,
  type GrafanaTheme2,
  type TraceKeyValuePair,
} from '@grafana/data';
import { ProtectedValue, useStyles2 } from '@grafana/ui';

export type KeyValuesSummaryProps = {
  data?: TraceKeyValuePair[] | null;
  datasourceType?: string;
  isSpanAttribute?: boolean;
};

export function KeyValuesSummary({ data = null, datasourceType, isSpanAttribute }: KeyValuesSummaryProps) {
  const epoch = useSyncExternalStore(
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
      {data.map((item, i) => {
        const displayValue =
          datasourceType === 'tempo' && isSpanAttribute
            ? getProtectedAttributeDisplayValue(item.key, item.value)
            : undefined;
        return (
          // `i` is necessary in the key because item.key can repeat
          <li className={styles.summaryItem} key={`${item.key}-${i}`}>
            <span className={styles.summaryLabel}>{item.key}</span>
            {displayValue !== undefined && typeof item.value === 'string' ? (
              <ProtectedValue
                value={item.value}
                displayValue={displayValue}
                fieldName={item.key}
                epoch={epoch}
                onLoadKey={() => {
                  const kid = getProtectedAttributeKeyId(item.key, item.value);
                  return kid ? requestProtectedAttributeKey(kid) : false;
                }}
              />
            ) : (
              String(item.value)
            )}
          </li>
        );
      })}
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
