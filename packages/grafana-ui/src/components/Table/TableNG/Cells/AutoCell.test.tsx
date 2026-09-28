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

test('shows decrypted text only in the cell, switches to raw inline, and remasks when a key is forgotten', async () => {
  const user = userEvent.setup();
  const protectedField = field('enc.password', envelope);
  protectedField.config.links = [{ title: 'search', url: '/search' }];
  protectedField.getLinks = jest.fn(() => [
    { title: 'search', href: `/search?value=${protectedField.values[0]}`, target: '_blank', origin: {} },
  ]);
  render(<AutoCell field={protectedField} value={envelope} rowIdx={0} />);
  const resolve = jest.fn(() => 'abc');
  act(() => {
    Reflect.set(globalThis, registrySymbol, { epoch: 1, resolve });
    window.dispatchEvent(new Event(eventName));
  });
  expect(screen.getByRole('button', { name: 'Show ciphertext for enc.password' })).toHaveTextContent('abc');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Show ciphertext for enc.password' }));
  expect(screen.getByRole('button', { name: 'Show decrypted value for enc.password' })).toHaveTextContent(envelope);
  await user.click(screen.getByText(envelope));
  expect(screen.getByRole('button', { name: 'Show ciphertext for enc.password' })).toHaveTextContent('abc');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(protectedField.values[0]).toBe(envelope);
  expect(resolve).toHaveBeenCalledWith('enc.password', envelope);
  act(() => {
    Reflect.set(globalThis, registrySymbol, { epoch: 2, resolve: () => '[encrypted: key unavailable]' });
    window.dispatchEvent(new Event(eventName));
  });
  expect(screen.getByRole('button', { name: 'Inspect locked value for enc.password' })).toHaveTextContent('Locked');
  expect(protectedField.values[0]).toBe(envelope);
});

test('routes the missing-key request to one editor and reveals raw without following a link', async () => {
  const user = userEvent.setup();
  const protectedField = field('enc.password', envelope);
  protectedField.config.links = [{ title: 'search', url: '/search' }];
  const requestKey = jest.fn(() => true);
  const registry = { epoch: 1, resolve: jest.fn(() => '[encrypted: key unavailable]'), requestKey };
  Reflect.set(globalThis, registrySymbol, registry);
  const { rerender } = render(<AutoCell field={protectedField} value={envelope} rowIdx={0} />);
  await user.click(screen.getByRole('button', { name: 'Inspect locked value for enc.password' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('630dcd2966c4336691125448bbb25b4f');
  await user.click(screen.getByRole('button', { name: 'Load matching key' }));
  expect(requestKey).toHaveBeenCalledWith('630dcd2966c4336691125448bbb25b4f');
  expect(requestKey).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Inspect locked value for enc.password' }));
  await user.click(screen.getByRole('button', { name: 'Show ciphertext' }));
  expect(screen.getByRole('button', { name: 'Show locked value for enc.password' })).toHaveTextContent(envelope);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(protectedField.values[0]).toBe(envelope);
  act(() => {
    registry.epoch++;
    window.dispatchEvent(new Event(eventName));
  });
  expect(screen.getByRole('button', { name: 'Inspect locked value for enc.password' })).toHaveTextContent('Locked');
  rerender(<AutoCell field={protectedField} value={`${envelope}=`} rowIdx={0} />);
  expect(screen.queryByRole('button', { name: /locked value/ })).not.toBeInTheDocument();
  expect(screen.getByText(`formatted: ${envelope}=`)).toBeInTheDocument();
  rerender(<AutoCell field={protectedField} value={envelope} rowIdx={0} />);
  registry.resolve.mockReturnValue('[encrypted: invalid data]');
  act(() => {
    registry.epoch++;
    window.dispatchEvent(new Event(eventName));
  });
  expect(screen.queryByRole('button', { name: /locked value/ })).not.toBeInTheDocument();
  expect(screen.getByText('Invalid data')).toBeInTheDocument();
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
