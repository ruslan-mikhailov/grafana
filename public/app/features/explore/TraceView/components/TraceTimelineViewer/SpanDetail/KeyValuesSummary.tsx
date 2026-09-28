import { css } from '@emotion/css';

import { useState, useSyncExternalStore } from 'react';

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
  const epoch = useSyncExternalStore(
    subscribeProtectedAttributeDisplay,
    getProtectedAttributeDisplayEpoch,
    getProtectedAttributeDisplayEpoch
  );
  const [revealed, setRevealed] = useState<Record<number, { field: string; raw: string; epoch: number }>>({});
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
        const canReveal = displayValue === '[encrypted: key unavailable]' && typeof item.value === 'string';
        const isRevealed =
          canReveal && revealed[i]?.field === item.key && revealed[i].raw === item.value && revealed[i].epoch === epoch;
        return (
          // `i` is necessary in the key because item.key can repeat
          <li className={styles.summaryItem} key={`${item.key}-${i}`}>
            <span className={styles.summaryLabel}>{item.key}</span>
            {canReveal ? (
              <>
                {isRevealed && <span className={styles.ciphertextText}>{item.value}</span>}
                {isRevealed && ' '}
                <button
                  type="button"
                  className={styles.ciphertextButton}
                  aria-label={`${isRevealed ? 'Hide' : 'Show'} encrypted value for ${item.key}`}
                  aria-pressed={isRevealed}
                  onClick={(event) => {
                    event.stopPropagation();
                    setRevealed((current) => {
                      const next = { ...current };
                      if (isRevealed) {
                        delete next[i];
                      } else {
                        next[i] = { field: item.key, raw: item.value, epoch };
                      }
                      return next;
                    });
                  }}
                >
                  {isRevealed ? 'Hide ciphertext' : `${displayValue} · Show ciphertext`}
                </button>
              </>
            ) : (
              String(displayValue ?? item.value)
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
    ciphertextButton: css({
      background: 'none',
      border: 0,
      color: theme.colors.text.link,
      cursor: 'pointer',
      font: 'inherit',
      padding: 0,
      textAlign: 'inherit',
      textDecoration: 'underline',
      textUnderlineOffset: '2px',
      '&:focus-visible': {
        outline: '2px solid currentColor',
        outlineOffset: '2px',
      },
      overflowWrap: 'anywhere',
    }),
    ciphertextText: css({
      overflowWrap: 'anywhere',
      userSelect: 'text',
    }),
  };
};
