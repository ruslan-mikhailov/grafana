import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { FieldType, sortDataFrame, toDataFrame } from '@grafana/data';
import { ProtectedLogCell, ProtectedLogField, ProtectedLogText } from './ProtectedLogText';


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
it('keeps public logfmt text intact while independently toggling available and missing protected values', () => {
  const requestKey = jest.fn(() => true);
  const resolveField = jest.fn((category: string, field: string, value: string) =>
    category === 'line' && field === 'email' && value === email ? 'alice@example.invalid' :
      '[encrypted: key unavailable]'
  );
  Reflect.set(globalThis, symbol, {
    epoch: () => 1,
    subscribe: () => () => {},
    resolveField,
    resolveLine: jest.fn(() => { throw new Error('whole-line resolver must not guess field context'); }),
    requestKey,
  });
  const { container } = render(<ProtectedLogText value={rawLine} />);
  expect(container).toHaveTextContent('event=login email="alice@example.invalid" api_token="Locked" outcome=accepted');
  expect(container).not.toHaveTextContent(email);
  fireEvent.click(screen.getByRole('button', { name: 'Show ciphertext for email' }));
  expect(container).toHaveTextContent(`email="${email}" api_token="Locked"`);
  expect(container).not.toHaveTextContent('alice@example.invalid');
  fireEvent.click(screen.getByRole('button', { name: 'Show decrypted value for email' }));
  expect(container).toHaveTextContent('email="alice@example.invalid"');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Inspect locked value for api_token' }));
  const inspector = screen.getByRole('dialog');
  expect(within(inspector).getByText('b'.repeat(32))).toBeVisible();
  fireEvent.click(within(inspector).getByRole('button', { name: 'Load matching key' }));
  expect(requestKey).toHaveBeenCalledTimes(1);
  expect(requestKey).toHaveBeenCalledWith('b'.repeat(32));
});

it('masks ambiguous or malformed markers without invoking field decryption', () => {
  const resolveField = jest.fn(() => 'secret');
  Reflect.set(globalThis, symbol, {
    epoch: () => 0, subscribe: () => () => {}, resolveField,
    resolveLine: jest.fn(() => 'secret'),
  });
  const { container } = render(<ProtectedLogText value={`prefix ${email} note=lenc:broken email="prefix${token}" message="hello email=${email}" ending=public`} />);
  expect(container).not.toHaveTextContent(email);
  expect(container).not.toHaveTextContent(token);
  expect(container).toHaveTextContent('prefix Invalid data note=Invalid data email="prefixInvalid data" message="hello email=Invalid data" ending=public');
  expect(resolveField).not.toHaveBeenCalled();
});

it('distinguishes failed authentication from a missing key in field displays', () => {
  Reflect.set(globalThis, symbol, {
    epoch: () => 1, subscribe: () => () => {},
    resolveField: () => '[encrypted: invalid data]',
  });
  const { container } = render(<>
    <ProtectedLogField category="label" fieldName="email" value={email} />
    <ProtectedLogField category="metadata" fieldName="token" value="lenc:v1:broken" />
  </>);
  expect(container).toHaveTextContent('Invalid data');
  expect(container).not.toHaveTextContent(email);
  expect(screen.queryByRole('button', { name: /Inspect locked value/ })).not.toBeInTheDocument();
});

it('resets a revealed fragment when its envelope changes without a key epoch change', () => {
  Reflect.set(globalThis, symbol, {
    epoch: () => 1, subscribe: () => () => {},
    resolveField: (_category: string, _field: string, value: string) =>
      value === email ? 'alice@example.invalid' : 'new@example.invalid',
  });
  const { container, rerender } = render(<ProtectedLogField category="line" fieldName="email" value={email} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show ciphertext for email' }));
  expect(container).toHaveTextContent(email);
  rerender(<ProtectedLogField category="line" fieldName="email" value={token} />);
  expect(container).toHaveTextContent('new@example.invalid');
  expect(container).not.toHaveTextContent(token);
});

it('updates live protected fragments on key epochs and forget without modifying source rows', () => {
  const listeners = new Set<() => void>();
  let loaded = false;
  let epoch = 0;
  const frame = toDataFrame({ fields: [{ name: 'body', type: FieldType.string, values: [rawLine] }] });
  Reflect.set(globalThis, symbol, {
    epoch: () => epoch,
    subscribe: (notify: () => void) => { listeners.add(notify); return () => listeners.delete(notify); },
    resolveField: (_category: string, field: string) => loaded && field === 'email' ? 'alice@example.invalid' : '[encrypted: key unavailable]',
  });
  const { container } = render(<ProtectedLogText value={frame.fields[0].values[0]} />);
  expect(container).toHaveTextContent('email="Locked"');
  act(() => { loaded = true; epoch++; listeners.forEach((notify) => notify()); });
  fireEvent.click(screen.getByRole('button', { name: 'Show ciphertext for email' }));
  expect(container).toHaveTextContent(email);
  act(() => { epoch++; listeners.forEach((notify) => notify()); });
  expect(container).toHaveTextContent('email="alice@example.invalid"');
  act(() => { loaded = false; epoch++; listeners.forEach((notify) => notify()); });
  expect(container).toHaveTextContent('email="Locked"');
  expect(frame.fields[0].values[0]).toBe(rawLine);
});

it('binds table cells and labels to their own row provenance without replacing frame values', () => {
  const frame = toDataFrame({ fields: [
    { name: 'email', type: FieldType.string, values: [email] },
    { name: 'labels', type: FieldType.other, values: [{ namespace: token, region: 'public' }] },
    { name: 'labelTypes', type: FieldType.other, values: [{ email: 'S', namespace: 'I' }] },
  ] });
  const resolveField = jest.fn((category: string, name: string) =>
    category === 'metadata' && name === 'email' ? 'alice@example.invalid' : '[encrypted: key unavailable]'
  );
  Reflect.set(globalThis, symbol, { epoch: () => 1, subscribe: () => () => {}, resolveField });
  const { container } = render(<>
    {ProtectedLogCell({ field: 'email', value: email, frame, rowIndex: 0, isBody: false })}
    {ProtectedLogCell({ field: 'labels', value: frame.fields[1].values[0], frame, rowIndex: 0, isBody: false })}
    <ProtectedLogField category="line" fieldName="email" value={email} />
  </>);
  expect(container).toHaveTextContent('alice@example.invalid');
  expect(container).toHaveTextContent('"namespace":"Locked"');
  expect(container).toHaveTextContent('"region":"public"');
  expect(resolveField).toHaveBeenCalledWith('metadata', 'email', email);
  expect(resolveField).toHaveBeenCalledWith('label', 'namespace', token);
  expect(resolveField).toHaveBeenCalledWith('line', 'email', email);
  expect(frame.fields[0].values[0]).toBe(email);
  expect(frame.fields[1].values[0]).toEqual({ namespace: token, region: 'public' });
});
