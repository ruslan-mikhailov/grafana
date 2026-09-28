import { act, render, screen } from '@testing-library/react';

import { FieldType, toDataFrame } from '@grafana/data';

import { ProtectedLogsTableCell } from './ProtectedLogsTableCell';

const symbol = Symbol.for('grafana.loki.protectedLogDisplay.v1');
const envelope = `lenc:v1:${'a'.repeat(32)}:AAAAAAAAAAAAAAAAAAAAAA`;
const frame = toDataFrame({ fields: [
  { name: 'email', type: FieldType.string, values: [envelope] },
  { name: 'labelTypes', type: FieldType.other, values: [{ email: 'P' }] },
] });

afterEach(() => {
  Reflect.deleteProperty(globalThis, symbol);
});

it('masks encrypted cells without a key and does not change their frame values on key import or forget', () => {
  let keyAvailable = false;
  let epoch = 0;
  const listeners = new Set<() => void>();
  Reflect.set(globalThis, symbol, {
    epoch: () => epoch,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    resolveField: (category: string, field: string, value: string) =>
      category === 'line' && field === 'email' && value === envelope && keyAvailable
        ? 'alice@example.invalid'
        : '[encrypted: key unavailable]',
    resolveLine: (line: string) => line,
  });
  const { container } = render(
    <ProtectedLogsTableCell field={frame.fields[0]} frame={frame} rowIndex={0} value={envelope} isBody={false} />
  );
  expect(screen.getByText('[encrypted: key unavailable]')).toBeVisible();
  expect(container).not.toHaveTextContent(envelope);
  act(() => {
    keyAvailable = true;
    epoch++;
    listeners.forEach((notify) => notify());
  });
  expect(screen.getByText('alice@example.invalid')).toBeVisible();
  expect(frame.fields[0].values[0]).toBe(envelope);
  act(() => {
    keyAvailable = false;
    epoch++;
    listeners.forEach((notify) => notify());
  });
  expect(container).not.toHaveTextContent('alice@example.invalid');
  expect(frame.fields[0].values[0]).toBe(envelope);
});
