import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AccordionCategorizedKeyValues from './AccordionCategorizedKeyValues';

const tags = [
  { key: 'http.method', value: 'POST' },
  { key: 'http.status_code', value: '204' },
  { key: 'service.name', value: 'api' },
];

const displayRegistrySymbol = Symbol.for('grafana.tempo.protected-attribute-display.v1');
const encryptedValue = 'enc:v1:630dcd2966c4336691125448bbb25b4f:7aUwjY5fPtHvu_dUnzcxBJc6XQ';

describe('AccordionCategorizedKeyValues', () => {
  it('renders categorized attribute sections when expanded', () => {
    render(
      <AccordionCategorizedKeyValues
        data={tags}
        sectionType="span"
        isOpen={true}
        label="Span attributes"
        onToggle={jest.fn()}
      />
    );

    expect(screen.getByTestId('attribute-category-http')).toBeInTheDocument();
    expect(screen.getByText('HTTP')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'http.method' })).toBeInTheDocument();
  });

  it('hides categories when collapsed', () => {
    render(
      <AccordionCategorizedKeyValues
        data={tags}
        sectionType="span"
        isOpen={false}
        label="Span attributes"
        onToggle={jest.fn()}
      />
    );

    expect(screen.queryByTestId('attribute-category-http')).not.toBeInTheDocument();
    expect(screen.getByText('http.method')).toBeInTheDocument();
  });

  it('calls onToggle when the header is clicked', async () => {
    const onToggle = jest.fn();

    render(
      <AccordionCategorizedKeyValues
        data={tags}
        sectionType="resource"
        isOpen={false}
        label="Resource attributes"
        onToggle={onToggle}
      />
    );

    await userEvent.click(screen.getByRole('switch', { name: /Resource attributes/ }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('toggles category sections open and closed', async () => {
    render(
      <AccordionCategorizedKeyValues
        data={tags}
        sectionType="span"
        isOpen={true}
        label="Span attributes"
        onToggle={jest.fn()}
      />
    );

    expect(screen.getByRole('cell', { name: 'http.method' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /HTTP/ }));

    expect(screen.queryByRole('cell', { name: 'http.method' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /HTTP/ }));

    expect(screen.getByRole('cell', { name: 'http.method' })).toBeInTheDocument();
  });

  it('renders uncategorized attributes flat without an Other section', () => {
    render(
      <AccordionCategorizedKeyValues
        data={[
          { key: 'custom.field', value: 'value' },
          { key: 'another.custom', value: 'other' },
        ]}
        sectionType="span"
        isOpen={true}
        label="Span attributes"
        onToggle={jest.fn()}
      />
    );

    expect(screen.queryByTestId('attribute-category-other')).not.toBeInTheDocument();
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'custom.field' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'another.custom' })).toBeInTheDocument();
  });

  it('still shows Other when mixed with named categories', () => {
    render(
      <AccordionCategorizedKeyValues
        data={[
          { key: 'http.method', value: 'GET' },
          { key: 'custom.field', value: 'value' },
        ]}
        sectionType="span"
        isOpen={true}
        label="Span attributes"
        onToggle={jest.fn()}
      />
    );

    expect(screen.getByTestId('attribute-category-http')).toBeInTheDocument();
    expect(screen.getByTestId('attribute-category-other')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
  });

  it('shows an empty-state message and keeps the section visible when there are no attributes', () => {
    const onToggle = jest.fn();

    render(
      <AccordionCategorizedKeyValues
        data={[]}
        sectionType="resource"
        isOpen={false}
        label="Resource attributes"
        onToggle={onToggle}
      />
    );

    expect(screen.getByText('Resource attributes')).toBeInTheDocument();
    expect(screen.getByText('No attributes')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /Resource attributes/ })).not.toBeInTheDocument();
  });

  it('does not call onToggle when the empty header is clicked', async () => {
    const onToggle = jest.fn();

    render(
      <AccordionCategorizedKeyValues
        data={[]}
        sectionType="span"
        isOpen={false}
        label="Span attributes"
        onToggle={onToggle}
      />
    );

    await userEvent.click(screen.getByTestId('AccordionCategorizedKeyValues--header'));

    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('protected attributes in categorized span detail', () => {
  const originalRegistry = Reflect.get(globalThis, displayRegistrySymbol);

  afterEach(() => {
    if (originalRegistry === undefined) {
      Reflect.deleteProperty(globalThis, displayRegistrySymbol);
    } else {
      Reflect.set(globalThis, displayRegistrySymbol, originalRegistry);
    }
  });

  it('updates the collapsed and expanded Tempo span display on key changes without decrypting resource or other datasource values', () => {
    const data = [
      { key: 'enc.secret', value: encryptedValue },
      { key: 'http.method', value: 'GET' },
    ];
    const registry = { epoch: 1, resolve: jest.fn((): string | undefined => 'abc') };
    Reflect.set(globalThis, displayRegistrySymbol, registry);

    const { rerender } = render(
      <AccordionCategorizedKeyValues
        data={data}
        sectionType="span"
        datasourceType="tempo"
        isOpen={false}
        label="Span attributes"
      />
    );

    expect(screen.getByText('abc')).toBeInTheDocument();
    expect(screen.queryByText(encryptedValue)).not.toBeInTheDocument();

    registry.resolve.mockReturnValue(undefined);
    act(() => {
      registry.epoch++;
      window.dispatchEvent(new Event('grafana.tempo.protected-attribute-display-change'));
    });
    expect(screen.queryByText('abc')).not.toBeInTheDocument();
    expect(screen.getByText(encryptedValue)).toBeInTheDocument();

    registry.resolve.mockReturnValue('abc');
    act(() => {
      registry.epoch++;
      window.dispatchEvent(new Event('grafana.tempo.protected-attribute-display-change'));
    });
    rerender(
      <AccordionCategorizedKeyValues
        data={data}
        sectionType="span"
        datasourceType="tempo"
        isOpen={true}
        label="Span attributes"
      />
    );
    expect(screen.getByRole('button', { name: 'Show ciphertext for enc.secret' })).toHaveTextContent('abc');
    expect(screen.getByTestId('attribute-category-other')).toBeInTheDocument();

    rerender(
      <AccordionCategorizedKeyValues
        data={data}
        sectionType="resource"
        datasourceType="tempo"
        isOpen={true}
        label="Resource attributes"
      />
    );
    expect(screen.queryByText('abc')).not.toBeInTheDocument();
    expect(screen.getByText(encryptedValue)).toBeInTheDocument();

    rerender(
      <AccordionCategorizedKeyValues
        data={data}
        sectionType="resource"
        datasourceType="tempo"
        isOpen={false}
        label="Resource attributes"
      />
    );
    expect(screen.queryByText('abc')).not.toBeInTheDocument();
    expect(screen.getByText(encryptedValue)).toBeInTheDocument();

    rerender(
      <AccordionCategorizedKeyValues
        data={data}
        sectionType="span"
        datasourceType="jaeger"
        isOpen={false}
        label="Span attributes"
      />
    );
    expect(screen.queryByText('abc')).not.toBeInTheDocument();
    expect(screen.getByText(encryptedValue)).toBeInTheDocument();
    expect(data[0].value).toBe(encryptedValue);
  });
  it('reveals only the selected ciphertext in the collapsed summary and expanded table', async () => {
    const user = userEvent.setup();
    const data = [
      { key: 'enc.first', value: encryptedValue },
      { key: 'enc.second', value: encryptedValue },
    ];
    Reflect.set(globalThis, displayRegistrySymbol, {
      epoch: 1,
      resolve: () => '[encrypted: key unavailable]',
    });
    const { rerender } = render(
      <AccordionCategorizedKeyValues
        data={data}
        sectionType="span"
        datasourceType="tempo"
        isOpen={false}
        label="Span attributes"
      />
    );
    await user.click(screen.getByRole('button', { name: 'Inspect locked value for enc.first' }));
    await user.click(screen.getByRole('button', { name: 'Show ciphertext' }));
    expect(screen.getByRole('button', { name: 'Show locked value for enc.first' })).toHaveTextContent(encryptedValue);
    expect(screen.getByRole('button', { name: 'Inspect locked value for enc.second' })).toHaveTextContent('Locked');
    rerender(
      <AccordionCategorizedKeyValues
        data={data}
        sectionType="span"
        datasourceType="tempo"
        isOpen={true}
        label="Span attributes"
      />
    );
    expect(screen.queryByText(encryptedValue)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Inspect locked value for enc.second' }));
    await user.click(screen.getByRole('button', { name: 'Show ciphertext' }));
    expect(screen.getByRole('button', { name: 'Inspect locked value for enc.first' })).toHaveTextContent('Locked');
    expect(screen.getByRole('button', { name: 'Show locked value for enc.second' })).toHaveTextContent(encryptedValue);
    expect(data[0].value).toBe(encryptedValue);
    expect(data[1].value).toBe(encryptedValue);
  });
});
