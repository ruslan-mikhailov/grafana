import { act, render, screen } from '@testing-library/react';

import { type Field, FieldType } from '@grafana/data';

import { AutoCell } from './AutoCell';

const registrySymbol = Symbol.for('grafana.tempo.protected-attribute-display.v1');
const eventName = 'grafana.tempo.protected-attribute-display-change';
const envelope = 'enc:v1:630dcd2966c4336691125448bbb25b4f:7aUwjY5fPtHvu_dUnzcxBJc6XQ';

let originalRegistry: unknown;
beforeEach(() => {
  originalRegistry = Reflect.get(globalThis, registrySymbol);
  Reflect.deleteProperty(globalThis, registrySymbol);
});
afterEach(() => {
  if (originalRegistry === undefined) {
    Reflect.deleteProperty(globalThis, registrySymbol);
  } else {
    Reflect.set(globalThis, registrySymbol, originalRegistry);
  }
});

function field(name: string, value: string): Field<string> {
  return {
    name,
    type: FieldType.string,
    values: [value],
    config: {},
    display: (raw) => ({ text: `formatted: ${raw}`, numeric: NaN }),
  };
}

test('shows decrypted protected values locally, then reverts on clear without changing raw cells or links', () => {
  const protectedField = field('enc.password', envelope);
  protectedField.config.links = [{ title: 'search', url: '/search' }];
  protectedField.getLinks = jest.fn(() => [
    { title: 'search', href: `/search?value=${protectedField.values[0]}`, target: '_blank', origin: {} },
  ]);
  render(<AutoCell field={protectedField} value={envelope} rowIdx={0} />);
  expect(screen.getByText(`formatted: ${envelope}`)).toBeInTheDocument();

  const resolve = jest.fn(() => 'abc');
  act(() => {
    Reflect.set(globalThis, registrySymbol, { epoch: 1, resolve });
    window.dispatchEvent(new Event(eventName));
  });
  expect(screen.getByText('abc')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'abc' })).toHaveAttribute('href', `/search?value=${envelope}`);
  expect(resolve).toHaveBeenCalledWith('enc.password', envelope);
  expect(protectedField.values[0]).toBe(envelope);

  act(() => {
    Reflect.set(globalThis, registrySymbol, { epoch: 2, resolve: () => '[encrypted: key unavailable]' });
    window.dispatchEvent(new Event(eventName));
  });
  expect(screen.getByText('[encrypted: key unavailable]')).toBeInTheDocument();
  expect(protectedField.values[0]).toBe(envelope);
});

test('keeps default formatting for ordinary and malformed values even with an imported key', () => {
  const resolve = jest.fn(() => 'abc');
  Reflect.set(globalThis, registrySymbol, { epoch: 1, resolve });
  const ordinary = field('password', envelope);
  const malformed = field('enc.password', `${envelope}=`);
  const { rerender } = render(<AutoCell field={ordinary} value={envelope} rowIdx={0} />);
  expect(screen.getByText(`formatted: ${envelope}`)).toBeInTheDocument();
  rerender(<AutoCell field={malformed} value={`${envelope}=`} rowIdx={0} />);
  expect(screen.getByText(`formatted: ${envelope}=`)).toBeInTheDocument();
  expect(resolve).not.toHaveBeenCalled();
  Reflect.set(globalThis, registrySymbol, { epoch: 2, resolve: () => undefined });
  rerender(<AutoCell field={malformed} value={envelope} rowIdx={0} />);
  expect(screen.getByText(`formatted: ${envelope}`)).toBeInTheDocument();
});
