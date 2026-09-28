import { act, render, screen } from '@testing-library/react';

import { FieldType, sortDataFrame, toDataFrame } from '@grafana/data';

import {
  inferLogFieldCategory,
  frameFieldCategory,
  resolveProtectedLogCell,
  resolveProtectedLogField,
  resolveProtectedLogLine,
  useProtectedLogDisplayEpoch,
  withLogFieldProvenance,
} from './protectedLogDisplay';

const symbol = Symbol.for('grafana.loki.protectedLogDisplay.v1');
const event = 'grafana.loki.protectedLogDisplay.v1.change';
const email = `lenc:v1:${'a'.repeat(32)}:AAAAAAAAAAAAAAAAAAAAAA`;
const token = `lenc:v1:${'b'.repeat(32)}:AAAAAAAAAAAAAAAAAAAAAA`;
const rawLine = `event=login email="${email}" api_token="${token}" outcome=accepted`;

function Display({ line }: { line: string }) {
  useProtectedLogDisplayEpoch();
  return <span>{resolveProtectedLogLine(line)}</span>;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, symbol);
});

it('masks every reserved envelope without a plugin, including malformed markers in logfmt and whole lines', () => {
  expect(resolveProtectedLogField('label', 'namespace', email)).toBe('[encrypted: key unavailable]');
  expect(resolveProtectedLogField('metadata', 'email', 'lenc:v1:broken')).toBe('[encrypted: invalid data]');
  expect(resolveProtectedLogLine(rawLine)).toBe(
    'event=login email="[encrypted: key unavailable]" api_token="[encrypted: key unavailable]" outcome=accepted'
  );
  expect(resolveProtectedLogLine(`email=lenc:broken rest=public`)).toBe('email=[encrypted: invalid data] rest=public');
  expect(resolveProtectedLogLine(email)).toBe('[encrypted: key unavailable]');
});

it('rerenders mixed-key lines on import and forget while retaining ciphertext in the source frame', () => {
  const frame = toDataFrame({ fields: [
    { name: 'body', type: FieldType.string, values: [rawLine] },
    { name: 'labels', type: FieldType.other, values: [{ namespace: email }] },
  ] });
  const listeners = new Set<() => void>();
  let loaded = new Set<string>();
  let epoch = 0;
  Reflect.set(globalThis, symbol, {
    epoch: () => epoch,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    resolveField: (category: string, field: string, value: string) => {
      if (value === email && category === 'line' && field === 'email' && loaded.has('email')) {
        return 'alice@example.invalid';
      }
      if (value === token && category === 'line' && field === 'api_token' && loaded.has('token')) {
        return 'demo-123';
      }
      return loaded.has(value === email ? 'email' : 'token')
        ? '[encrypted: invalid data]'
        : '[encrypted: key unavailable]';
    },
    resolveLine: (line: string) => line.replace(/(email|api_token)="(lenc:[^"]+)"/g, (_all, field, value) => {
      const key = field === 'email' ? 'email' : 'token';
      return `${field}="${loaded.has(key) ? (key === 'email' ? 'alice@example.invalid' : 'demo-123') : '[encrypted: key unavailable]'}"`;
    }),
  });
  const { unmount } = render(<Display line={frame.fields[0].values[0]} />);
  expect(screen.getByText(/email="\[encrypted: key unavailable\]"/)).toHaveTextContent('api_token="[encrypted: key unavailable]"');
  act(() => {
    loaded = new Set(['email']);
    epoch++;
    listeners.forEach((notify) => notify());
    window.dispatchEvent(new Event(event));
  });
  expect(screen.getByText(/alice@example.invalid/)).toHaveTextContent('api_token="[encrypted: key unavailable]"');
  expect(resolveProtectedLogField('label', 'email', email)).toBe('[encrypted: invalid data]');
  act(() => {
    loaded = new Set(['email', 'token']);
    epoch++;
    listeners.forEach((notify) => notify());
  });
  expect(screen.getByText(/alice@example.invalid/)).toHaveTextContent('api_token="demo-123"');
  act(() => {
    loaded = new Set();
    epoch++;
    listeners.forEach((notify) => notify());
  });
  expect(screen.getByText(/email="\[encrypted: key unavailable\]"/)).not.toHaveTextContent('alice@example.invalid');
  expect(frame.fields[0].values[0]).toBe(rawLine);
  expect(frame.fields[1].values[0]).toEqual({ namespace: email });
  unmount();
});

it('uses label provenance for extracted fields and masks objects without modifying raw values', () => {
  const frame = toDataFrame({ fields: [
    { name: 'labelTypes', type: FieldType.other, values: [{ namespace: 'I', email: 'P', customer_email: 'S' }] },
    { name: 'labels', type: FieldType.other, values: [{ namespace: email, status: 'accepted' }] },
    { name: 'email', type: FieldType.string, values: [email] },
  ] });
  expect(frameFieldCategory(frame, 0, 'namespace', true)).toBe('label');
  expect(frameFieldCategory(frame, 0, 'email', true)).toBe('line');
  expect(frameFieldCategory(frame, 0, 'customer_email', true)).toBe('metadata');
  expect(resolveProtectedLogCell('labels', frame.fields[1].values[0], frame, 0, false)).toBe(
    '{"namespace":"[encrypted: key unavailable]","status":"accepted"}'
  );
  expect(resolveProtectedLogCell('email', frame.fields[2].values[0], frame, 0, false)).toBe('[encrypted: key unavailable]');
  const projected = toDataFrame({ fields: [{ name: 'email', type: FieldType.string, values: [email] }] });
  expect(resolveProtectedLogCell('email', email, projected, 0, false, inferLogFieldCategory(frame, 'email')))
    .toBe('[encrypted: key unavailable]');
  expect(frame.fields[1].values[0]).toEqual({ namespace: email, status: 'accepted' });
});

it('never parses embedded logfmt envelopes in scalar metadata or labels', () => {
  const resolveLine = jest.fn(() => 'email=alice@example.invalid');
  const resolveField = jest.fn(() => 'alice@example.invalid');
  Reflect.set(globalThis, symbol, {
    resolveLine,
    resolveField,
    epoch: () => 1,
    subscribe: () => () => {},
  });

  expect(resolveProtectedLogField('metadata', 'api_token', `email=${email}`)).toBe('[encrypted: invalid data]');
  expect(resolveProtectedLogField('label', 'account', `prefix email="${email}"`)).toBe('[encrypted: invalid data]');
  const frame = toDataFrame({ fields: [
    { name: 'api_token', type: FieldType.string, values: [`email=${email}`] },
    { name: 'labels', type: FieldType.other, values: [{ account: `email=${email}` }] },
  ] });
  expect(resolveProtectedLogCell('api_token', frame.fields[0].values[0], frame, 0, false))
    .toBe('[encrypted: invalid data]');
  expect(resolveProtectedLogCell('labels', frame.fields[1].values[0], frame, 0, false))
    .toBe('{"account":"[encrypted: invalid data]"}');
  expect(resolveLine).not.toHaveBeenCalled();
  expect(resolveField).not.toHaveBeenCalled();
});

it('uses each row authentication category after projection and sorting, not the first row category', () => {
  const source = toDataFrame({ fields: [
    { name: 'Time', type: FieldType.time, values: [1, 2] },
    { name: 'email', type: FieldType.string, values: [email, token] },
    { name: 'labelTypes', type: FieldType.other, values: [{ email: 'S' }, { email: 'P' }] },
  ] });
  const projected = toDataFrame({ fields: [
    { name: 'Time', type: FieldType.time, values: [1, 2] },
    { name: 'email', type: FieldType.string, values: [email, token] },
  ] });
  const resolveField = jest.fn((category: string, field: string, value: string) =>
    category === 'metadata' && field === 'email' && value === email ? 'metadata-address' :
      category === 'line' && field === 'email' && value === token ? 'parsed-address' : '[encrypted: invalid data]'
  );
  Reflect.set(globalThis, symbol, {
    resolveField,
    resolveLine: (line: string) => line,
    epoch: () => 1,
    subscribe: () => () => {},
  });

  const withProvenance = withLogFieldProvenance(projected, source);
  expect(withProvenance.fields.find((field) => field.name === 'labelTypes')?.config.custom?.hideFrom?.viz).toBe(true);
  expect(resolveProtectedLogCell('email', email, withProvenance, 0, false, inferLogFieldCategory(source, 'email')))
    .toBe('metadata-address');
  const sorted = sortDataFrame(withProvenance, 0, true);
  expect(resolveProtectedLogCell('email', sorted.fields[1].values[0], sorted, 0, false, inferLogFieldCategory(source, 'email')))
    .toBe('parsed-address');
  expect(resolveProtectedLogCell('email', sorted.fields[1].values[1], sorted, 1, false, inferLogFieldCategory(source, 'email')))
    .toBe('metadata-address');
  expect(resolveField).toHaveBeenCalledWith('line', 'email', token);
  expect(resolveField).toHaveBeenCalledWith('metadata', 'email', email);
});
