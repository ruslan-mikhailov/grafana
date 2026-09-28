import { useSyncExternalStore } from 'react';
import { type DataFrame, type LogRowModel } from '@grafana/data';

const symbol = Symbol.for('grafana.loki.protectedLogDisplay.v1');
const changeEvent = 'grafana.loki.protectedLogDisplay.v1.change';
const unavailable = '[encrypted: key unavailable]';
const invalid = '[encrypted: invalid data]';

export type Category = 'label' | 'metadata' | 'line';
interface DisplayBridge {
  resolveField(category: Category, field: string, value: string): string;
  resolveLine(line: string): string;
  subscribe(listener: () => void): () => void;
  epoch(): number;
}
export function logFieldCategory(log: LogRowModel, field: string, isLabel: boolean): Category {
  return frameFieldCategory(log.dataFrame, log.rowIndex, field, isLabel);
}

export function frameFieldCategory(frame: DataFrame, rowIndex: number, field: string, isLabel = false): Category {
  const labelTypes = frame.fields.find((item) => item.name === 'labelTypes')?.values[rowIndex];
  const type = labelTypes?.[field];
  if (type === 'P') {
    return 'line';
  }
  if (type === 'S') {
    return 'metadata';
  }
  return isLabel ? 'label' : 'metadata';
}

// Keep row provenance alongside cells when table transforms project or sort fields.
export function withLogFieldProvenance(frame: DataFrame, source: DataFrame): DataFrame {
  const types = frame.fields.find((item) => item.name === 'labelTypes') ??
    (frame.length === source.length ? source.fields.find((item) => item.name === 'labelTypes') : undefined);
  if (!types) {
    return frame;
  }
  const hiddenTypes = {
    ...types,
    config: {
      ...types.config,
      custom: { ...types.config?.custom, hideFrom: { ...types.config?.custom?.hideFrom, viz: true } },
    },
  };
  return {
    ...frame,
    fields: frame.fields.some((item) => item.name === 'labelTypes')
      ? frame.fields.map((item) => item.name === 'labelTypes' ? hiddenTypes : item)
      : [...frame.fields, hiddenTypes],
  };
}

function cellCategory(frame: DataFrame, rowIndex: number, field: string, fallback?: Category): Category {
  const type = frame.fields.find((item) => item.name === 'labelTypes')?.values[rowIndex]?.[field];
  return type === 'P' ? 'line' : type === 'S' ? 'metadata' : type === 'I' ? 'label' :
    fallback ?? frameFieldCategory(frame, rowIndex, field);
}

export function inferLogFieldCategory(source: DataFrame, field: string): Category {
  const types = source.fields.find((item) => item.name === 'labelTypes')?.values;
  if (types) {
    for (const rowTypes of types) {
      if (rowTypes?.[field] === 'P') {
        return 'line';
      }
      if (rowTypes?.[field] === 'S') {
        return 'metadata';
      }
      if (rowTypes?.[field] === 'I') {
        return 'label';
      }
    }
  }
  const labels = source.fields.find((item) => item.name === 'labels')?.values;
  return labels?.some((item) => item && typeof item === 'object' && field in item) ? 'label' : 'metadata';
}

export function resolveProtectedLogCell(field: string, value: unknown, frame: DataFrame, rowIndex: number, isBody: boolean, category?: Category): string | undefined {
  if (typeof value === 'string') {
    if (isBody) {
      return containsProtectedLogValue(value) ? resolveProtectedLogLine(value) : undefined;
    }
    if (!containsProtectedLogValue(value)) {
      return undefined;
    }
    return resolveProtectedLogField(cellCategory(frame, rowIndex, field, category), field, value);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.some(([, item]) => containsProtectedLogValue(item))) {
      const category = field === 'labels' ? 'label' : 'metadata';
      return JSON.stringify(Object.fromEntries(entries.map(([name, item]) =>
        [name, typeof item === 'string' && containsProtectedLogValue(item)
          ? resolveProtectedLogField(field === 'labels' ? cellCategory(frame, rowIndex, name, 'label') : category, name, item)
          : item]
      )));
    }
  }
  return undefined;
}

function bridge(): DisplayBridge | undefined {
  return Reflect.get(globalThis, symbol) as DisplayBridge | undefined;
}

function validEnvelope(value: string): boolean {
  const match = /^lenc:v1:[0-9a-f]{32}:([A-Za-z0-9_-]{22,})$/.exec(value);
  if (!match) {
    return false;
  }
  const payload = match[1];
  const remainder = payload.length % 4;
  const last = payload[payload.length - 1];
  return (
    remainder !== 1 &&
    (remainder !== 2 || /[AQgw]/.test(last)) &&
    (remainder !== 3 || /[AEIMQUYcgkosw048]/.test(last))
  );
}

export function isProtectedLogValue(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('lenc:');
}

export function resolveProtectedLogField(category: Category, field: string, value: string): string {
  if (!isProtectedLogValue(value)) {
    return containsProtectedLogValue(value) ? invalid : value;
  }
  if (!validEnvelope(value)) {
    return invalid;
  }
  const resolver = bridge();
  if (!resolver) {
    return unavailable;
  }
  try {
    const resolved = resolver.resolveField(category, field, value);
    return isProtectedLogValue(resolved) ? invalid : resolved;
  } catch {
    return invalid;
  }
}

// Only a complete logfmt value (or an entire encrypted line) has a known field context.
// Unbound lenc markers must be masked, not guessed at or displayed as ciphertext.
export function resolveProtectedLogLine(line: string): string {
  if (!line.includes('lenc:')) {
    return line;
  }
  if (line.startsWith('lenc:') && !/\s/.test(line)) {
    return resolveProtectedLogField('line', '', line);
  }
  const resolver = bridge();
  if (resolver) {
    try {
      const resolved = resolver.resolveLine(line);
      return resolved.replace(/lenc:[^\s"']+/g, (value) => (validEnvelope(value) ? unavailable : invalid));
    } catch {
      // An invalid bridge result must not expose the original ciphertext.
    }
  }
  return line.replace(/lenc:[^\s"']+/g, (value) => (validEnvelope(value) ? unavailable : invalid));
}

export function containsProtectedLogValue(value: unknown): boolean {
  return typeof value === 'string' && value.includes('lenc:');
}

function subscribe(listener: () => void): () => void {
  let unsubscribe = bridge()?.subscribe(listener);
  if (typeof window === 'undefined') {
    return () => unsubscribe?.();
  }
  const onChange = () => {
    unsubscribe?.();
    unsubscribe = bridge()?.subscribe(listener);
    listener();
  };
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    unsubscribe?.();
  };
}

function snapshot(): string {
  const current = bridge();
  return `${current ? 'installed' : 'absent'}:${current?.epoch() ?? 0}`;
}

export function useProtectedLogDisplayEpoch(): string {
  return useSyncExternalStore(subscribe, snapshot, () => 'absent:0');
}
