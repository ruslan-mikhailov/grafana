// Copyright (c) 2017 Uber Technologies, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AccordionKeyValues, { type AccordionKeyValuesProps } from './AccordionKeyValues';
import { KeyValuesSummary } from './KeyValuesSummary';

const tags = [
  { key: 'span.kind', value: 'client' },
  { key: 'omg', value: 'mos-def' },
];

const setupAccordion = (propOverrides?: AccordionKeyValuesProps) => {
  const props = {
    compact: false,
    data: tags,
    isOpen: true,
    label: 'test accordion',
    onToggle: jest.fn(),
    ...propOverrides,
  };
  return render(<AccordionKeyValues {...(props as AccordionKeyValuesProps)} />);
};

const setupKeyValues = (propOverrides?: AccordionKeyValuesProps) => {
  const props = {
    data: tags,
    ...propOverrides,
  };
  return render(<KeyValuesSummary {...props} />);
};

describe('KeyValuesSummary tests', () => {
  it('renders without exploding', () => {
    expect(() => setupKeyValues()).not.toThrow();
  });

  it('returns `null` when props.data is empty', () => {
    setupKeyValues({ data: null } as unknown as AccordionKeyValuesProps);

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.queryAllByRole('row')).toHaveLength(0);
    expect(screen.queryAllByRole('cell')).toHaveLength(0);
  });

  it('generates a list from `data` with the correct content', () => {
    setupKeyValues();

    expect(screen.queryAllByRole('listitem')).toHaveLength(2);
  });

  it('renders the data as text', () => {
    setupKeyValues();

    expect(screen.getByText(/^span.kind$/)).toBeInTheDocument();
    expect(screen.getByText(/^client$/)).toBeInTheDocument();
    expect(screen.getByText(/^omg$/)).toBeInTheDocument();
    expect(screen.getByText(/^mos-def$/)).toBeInTheDocument();
  });
});

describe('Keyless Tempo span summary', () => {
  const registrySymbol = Symbol.for('grafana.tempo.protected-attribute-display.v1');
  const originalRegistry = Reflect.get(globalThis, registrySymbol);
  const ciphertext = 'enc:v1:630dcd2966c4336691125448bbb25b4f:7aUwjY5fPtHvu_dUnzcxBJc6XQ';

  afterEach(() => {
    if (originalRegistry === undefined) {
      Reflect.deleteProperty(globalThis, registrySymbol);
    } else {
      Reflect.set(globalThis, registrySymbol, originalRegistry);
    }
  });

  it('toggles raw text independently without activating the containing section, then remasks on a key change', async () => {
    const user = userEvent.setup();
    const onToggle = jest.fn();
    const item = { key: 'enc.secret', value: ciphertext };
    const registry = { epoch: 1, resolve: jest.fn(() => '[encrypted: key unavailable]') };
    Reflect.set(globalThis, registrySymbol, registry);
    render(
      <div role="switch" aria-checked={false} onClick={onToggle}>
        <KeyValuesSummary data={[item]} datasourceType="tempo" isSpanAttribute />
      </div>
    );

    const show = screen.getByRole('button', { name: 'Show encrypted value for enc.secret' });
    expect(show).toHaveTextContent('[encrypted: key unavailable] · Show ciphertext');
    await user.tab();
    expect(show).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByText(ciphertext).closest('button, a')).toBeNull();
    expect(screen.getByRole('button', { name: 'Hide encrypted value for enc.secret' })).toHaveTextContent(
      'Hide ciphertext'
    );
    expect(item.value).toBe(ciphertext);
    expect(onToggle).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Hide encrypted value for enc.secret' }));
    expect(screen.getByRole('button', { name: 'Show encrypted value for enc.secret' })).toHaveTextContent(
      '[encrypted: key unavailable] · Show ciphertext'
    );

    await user.click(screen.getByRole('button', { name: 'Show encrypted value for enc.secret' }));
    act(() => {
      registry.epoch++;
      window.dispatchEvent(new Event('grafana.tempo.protected-attribute-display-change'));
    });
    expect(screen.getByRole('button', { name: 'Show encrypted value for enc.secret' })).toHaveTextContent(
      '[encrypted: key unavailable] · Show ciphertext'
    );
  });

  it('does not reveal other trace sections, malformed envelopes, or invalid ciphertext', () => {
    const registry = { epoch: 1, resolve: jest.fn(() => '[encrypted: key unavailable]') };
    Reflect.set(globalThis, registrySymbol, registry);
    const item = { key: 'enc.secret', value: ciphertext };
    const { rerender } = render(<KeyValuesSummary data={[item]} datasourceType="jaeger" isSpanAttribute />);
    expect(screen.queryByRole('button', { name: /encrypted value/ })).not.toBeInTheDocument();
    rerender(<KeyValuesSummary data={[item]} datasourceType="tempo" isSpanAttribute={false} />);
    expect(screen.queryByRole('button', { name: /encrypted value/ })).not.toBeInTheDocument();
    rerender(
      <KeyValuesSummary
        data={[{ key: 'enc.secret', value: `${ciphertext}=` }]}
        datasourceType="tempo"
        isSpanAttribute
      />
    );
    expect(screen.queryByRole('button', { name: /encrypted value/ })).not.toBeInTheDocument();
    registry.resolve.mockReturnValue('[encrypted: invalid data]');
    rerender(<KeyValuesSummary data={[item]} datasourceType="tempo" isSpanAttribute />);
    expect(screen.getByText('[encrypted: invalid data]')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /encrypted value/ })).not.toBeInTheDocument();
  });
});

describe('AccordionKeyValues test', () => {
  it('renders without exploding', () => {
    expect(() => setupAccordion()).not.toThrow();
  });

  it('renders the label', () => {
    setupAccordion();

    expect(screen.getByTestId('AccordionKeyValues--header')).toBeInTheDocument();
  });

  it('renders table correctly when passed data & is open ', () => {
    setupAccordion();

    expect(screen.getByRole('switch', { name: 'test accordion' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'span.kind client' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'span.kind' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'client' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'omg' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'mos-def' })).toBeInTheDocument();
  });

  it('renders the summary instead of the table when it is not expanded', () => {
    setupAccordion({ isOpen: false } as AccordionKeyValuesProps);

    expect(screen.getByRole('switch', { name: 'test accordion span.kind client omg mos-def' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('cell')).toHaveLength(0);
  });
});
