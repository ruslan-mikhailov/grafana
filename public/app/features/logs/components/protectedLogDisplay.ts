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
  requestKey?(kid: string): boolean;
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
export function protectedLogCellCategory(frame: DataFrame, rowIndex: number, field: string, fallback?: Category): Category {
  return cellCategory(frame, rowIndex, field, fallback);
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
export function protectedLogKeyId(value: string): string | undefined {
  return validEnvelope(value) ? value.slice('lenc:v1:'.length, 'lenc:v1:'.length + 32) : undefined;
}

export function requestProtectedLogKey(value: string): boolean {
  const kid = protectedLogKeyId(value);
  return kid ? bridge()?.requestKey?.(kid) ?? false : false;
}

export type ProtectedLogSegment =
  | { text: string }
  | { invalid: true }
  | { value: string; field: string; category: Category };

// Bind only complete logfmt values to their field name. Everything else containing
// the reserved marker is invalid, never guessed from adjacent text.
export function protectedLogLineSegments(line: string): ProtectedLogSegment[] {
  if (!line.includes('lenc:')) {
    return [{ text: line }];
  }
  if (line.startsWith('lenc:') && !/\s/.test(line)) {
    return [{ value: line, field: '', category: 'line' }];
  }
  const segments: ProtectedLogSegment[] = [];
  const marker = /lenc:[^\s"'`]*/g;
  let end = 0;
  let scanned = 0;
  let tokenStart = 0;
  let quote: string | undefined;
  let escaped = false;
  for (const match of line.matchAll(marker)) {
    const start = match.index ?? 0;
    for (let i = scanned; i < start; i++) {
      const char = line[i];
      if (escaped) {
        escaped = false;
      } else if (quote && char === '\\') {
        escaped = true;
      } else if (quote && char === quote) {
        quote = undefined;
      } else if (!quote && (char === '"' || char === "'")) {
        quote = char;
      } else if (!quote && /\s/.test(char)) {
        tokenStart = i + 1;
      }
    }
    const prefix = line.slice(end, start);
    const binding = /^([A-Za-z_][\w.-]*)=(["']?)$/.exec(line.slice(tokenStart, start));
    const quoted = binding?.[2];
    const after = start + match[0].length;
    const complete = binding && (quoted
      ? quote === quoted && line[after] === quoted
      : !quote && (after === line.length || /\s/.test(line[after])));
    if (prefix) {
      segments.push({ text: prefix });
    }
    segments.push(complete ? { value: match[0], field: binding[1], category: 'line' } : { invalid: true });
    end = after;
    scanned = after;
  }
  if (end < line.length) {
    segments.push({ text: line.slice(end) });
  }
  return segments;
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
    return containsProtectedLogValue(resolved) ? invalid : resolved;
  } catch {
    return invalid;
  }
}

// Copy/presentation uses the same field-bound segmentation as visible React values.
// Never hand an ambiguous marker to a whole-line bridge that may guess its field.
export function resolveProtectedLogLine(line: string): string {
  return protectedLogLineSegments(line).map((segment) =>
    'text' in segment ? segment.text : 'invalid' in segment ? invalid :
      resolveProtectedLogField(segment.category, segment.field, segment.value)
  ).join('');
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
