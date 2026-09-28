import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

test('reveals canonical keyless ciphertext as text without nesting it inside a data link, then remasks on key changes', async () => {
  const user = userEvent.setup();
  const protectedField = field('enc.password', envelope);
  protectedField.config.links = [{ title: 'search', url: '/search' }];
  protectedField.getLinks = jest.fn(() => [
    { title: 'search', href: `/search?value=${envelope}`, target: '_blank', origin: {} },
  ]);
  const registry = { epoch: 1, resolve: jest.fn(() => '[encrypted: key unavailable]') };
  Reflect.set(globalThis, registrySymbol, registry);
  const { rerender } = render(<AutoCell field={protectedField} value={envelope} rowIdx={0} />);
  const show = screen.getByRole('button', { name: 'Show encrypted value for enc.password' });
  expect(show).toHaveTextContent('[encrypted: key unavailable] · Show ciphertext');
  expect(show.closest('a')).toBeNull();
  expect(screen.queryByText(envelope)).not.toBeInTheDocument();

  await user.tab();
  expect(show).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(screen.getByText(envelope)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Hide encrypted value for enc.password' })).toHaveTextContent(
    'Hide ciphertext'
  );
  expect(protectedField.values[0]).toBe(envelope);
  expect(screen.getByText(envelope).closest('button, a')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Hide encrypted value for enc.password' }));
  expect(screen.getByRole('button', { name: 'Show encrypted value for enc.password' })).toHaveTextContent(
    '[encrypted: key unavailable] · Show ciphertext'
  );

  await user.click(screen.getByRole('button', { name: 'Show encrypted value for enc.password' }));
  act(() => {
    registry.epoch++;
    window.dispatchEvent(new Event(eventName));
  });
  expect(screen.getByRole('button', { name: 'Show encrypted value for enc.password' })).toHaveTextContent(
    '[encrypted: key unavailable] · Show ciphertext'
  );

  rerender(<AutoCell field={protectedField} value={`${envelope}=`} rowIdx={0} />);
  expect(screen.queryByRole('button', { name: /encrypted value/ })).not.toBeInTheDocument();
  expect(screen.getByText(`formatted: ${envelope}=`)).toBeInTheDocument();
  rerender(<AutoCell field={protectedField} value={envelope} rowIdx={0} />);
  registry.resolve.mockReturnValue('[encrypted: invalid data]');
  act(() => {
    registry.epoch++;
    window.dispatchEvent(new Event(eventName));
  });
  expect(screen.queryByRole('button', { name: /encrypted value/ })).not.toBeInTheDocument();
  expect(screen.getByText('[encrypted: invalid data]')).toBeInTheDocument();
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
