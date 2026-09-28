import { css, cx } from '@emotion/css';
import { type SyntheticEvent, useEffect, useState } from 'react';

import { getProtectedAttributeKeyId, type GrafanaTheme2 } from '@grafana/data';

import { useStyles2 } from '../../themes/ThemeContext';
import { Button } from '../Button/Button';
import { Icon } from '../Icon/Icon';
import { Modal } from '../Modal/Modal';

export interface ProtectedValueProps {
  /** The original envelope. This component never changes its caller's data. */
  value: string;
  /** The browser-only display resolver's result. */
  displayValue: string;
  fieldName: string;
  /** Canonical key ID when the envelope belongs to another datasource (for example Loki). */
  kid?: string;
  epoch: string | number;
  onLoadKey?: () => boolean | void;
  className?: string;
  /** For explicit copy controls: the value currently visible in this component. */
  onDisplayedValueChange?: (value: string) => void;
}

const unavailable = '[encrypted: key unavailable]';
const invalid = '[encrypted: invalid data]';

export function ProtectedValue(props: ProtectedValueProps) {
  const { value, displayValue, fieldName, epoch, kid: providedKid, onLoadKey, className, onDisplayedValueChange } = props;
  const [state, setState] = useState({ value, fieldName, epoch, raw: false, inspector: false, loadUnavailable: false });
  const sameValue = state.value === value && state.fieldName === fieldName && state.epoch === epoch;
  // Drop reveal state during render, not in an effect after a stale value may have been painted.
  if (!sameValue) {
    setState({ value, fieldName, epoch, raw: false, inspector: false, loadUnavailable: false });
  }
  const raw = sameValue && state.raw;
  const inspector = sameValue && state.inspector;
  const missing = displayValue === unavailable;
  const broken = displayValue === invalid;
  const shownValue = raw ? value : missing ? 'Locked' : broken ? 'Invalid data' : displayValue;
  const styles = useStyles2(getStyles);
  const kid = providedKid ?? getProtectedAttributeKeyId(fieldName, value);

  useEffect(() => {
    onDisplayedValueChange?.(shownValue);
  }, [shownValue, onDisplayedValueChange]);

  const stopInteraction = (event: SyntheticEvent) => event.stopPropagation();
  const toggleRaw = () => {
    setState({ value, fieldName, epoch, raw: !raw, inspector: false, loadUnavailable: false });
    onDisplayedValueChange?.(raw ? (missing ? 'Locked' : displayValue) : value);
  };

  if (broken) {
    return (
      <span className={cx(styles.invalid, className)}>
        <Icon name="lock" size="sm" aria-hidden="true" /> Invalid data
      </span>
    );
  }

  return (
    <span className={cx(styles.value, className)} onClick={stopInteraction} onKeyDown={stopInteraction} onKeyUp={stopInteraction}>
      <button
        type="button"
        className={styles.toggle}
        aria-label={
          raw
            ? `Show ${missing ? 'locked' : 'decrypted'} value for ${fieldName}`
            : missing
              ? `Inspect locked value for ${fieldName}`
              : `Show ciphertext for ${fieldName}`
        }
        aria-pressed={missing && !raw ? undefined : raw}
        onClick={(event) => {
          const selection = window.getSelection();
          if (raw && selection && !selection.isCollapsed && selection.containsNode(event.currentTarget, true)) {
            return;
          }
          if (missing && !raw) {
            setState({ value, fieldName, epoch, raw: false, inspector: true, loadUnavailable: false });
          } else {
            toggleRaw();
          }
        }}
      >
        <Icon name={raw || missing ? 'lock' : 'unlock'} size="sm" aria-hidden="true" />
        <span className={raw ? styles.ciphertext : undefined}>{raw ? value : missing ? 'Locked' : displayValue}</span>
      </button>
      {missing && inspector && (
        <Modal
          title="Protected value"
          isOpen
          onDismiss={() => setState({ value, fieldName, epoch, raw: false, inspector: false, loadUnavailable: false })}
        >
          <p>Required key ID: <code className={styles.ciphertext}>{kid}</code></p>
          <div className={styles.actions}>
            {onLoadKey && (
              <Button
                type="button"
                onClick={() => {
                  try {
                    if (onLoadKey() === false) {
                      setState({ value, fieldName, epoch, raw: false, inspector: true, loadUnavailable: true });
                      return;
                    }
                    setState({ value, fieldName, epoch, raw: false, inspector: false, loadUnavailable: false });
                  } catch {
                    setState({ value, fieldName, epoch, raw: false, inspector: true, loadUnavailable: true });
                  }
                }}
              >
                Load matching key
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={toggleRaw}>
              Show ciphertext
            </Button>
          </div>
          {state.loadUnavailable && (
            <p role="status">No key editor is available here. Open this datasource in Explore to load the matching key.</p>
          )}
        </Modal>
      )}
    </span>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  value: css({ display: 'inline', overflowWrap: 'anywhere' }),
  toggle: css({
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: theme.spacing(0.5),
    border: 0,
    background: 'none',
    padding: 0,
    color: theme.colors.text.link,
    cursor: 'pointer',
    font: 'inherit',
    textAlign: 'inherit',
    userSelect: 'text',
    '&:focus-visible': { outline: `2px solid ${theme.colors.primary.main}`, outlineOffset: '2px' },
  }),
  ciphertext: css({ overflowWrap: 'anywhere', userSelect: 'text', whiteSpace: 'pre-wrap' }),
  invalid: css({ color: theme.colors.text.secondary }),
  actions: css({ display: 'flex', gap: theme.spacing(1), justifyContent: 'flex-end' }),
});
