import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LogLabels, LogLabelsList } from './LogLabels';
import { LOG_LINE_BODY_FIELD_NAME } from './fieldSelector/logFields';
import { getNormalizedFieldName } from './panel/processing';
const protectedDisplay = Symbol.for('grafana.loki.protectedLogDisplay.v1');

afterEach(() => Reflect.deleteProperty(globalThis, protectedDisplay));


describe('<LogLabels />', () => {
  it('renders notice when no labels are found', () => {
    render(<LogLabels labels={{}} emptyMessage="(no unique labels)" />);
    expect(screen.queryByText('(no unique labels)')).toBeInTheDocument();
  });
  it('renders labels', () => {
    render(<LogLabels labels={{ foo: 'bar', baz: '42' }} />);
    expect(screen.queryByText('foo=bar')).toBeInTheDocument();
    expect(screen.queryByText('baz=42')).toBeInTheDocument();
  });
  it('excludes labels with certain names or labels starting with underscore', () => {
    render(<LogLabels labels={{ foo: 'bar', level: '42', _private: '13' }} />);
    expect(screen.queryByText('foo=bar')).toBeInTheDocument();
    expect(screen.queryByText('level=42')).not.toBeInTheDocument();
    expect(screen.queryByText('13')).not.toBeInTheDocument();
  });
  it('excludes labels with empty string values', () => {
    render(<LogLabels labels={{ foo: 'bar', baz: '' }} />);
    expect(screen.queryByText('foo=bar')).toBeInTheDocument();
    expect(screen.queryByText(/baz/)).not.toBeInTheDocument();
  });
  it('shows a tooltip', async () => {
    render(<LogLabels labels={{ foo: 'bar' }} />);
    await userEvent.hover(screen.getByText('foo=bar'));
    expect(screen.getAllByText('foo=bar')).toHaveLength(2);
  });
  it('disables the tooltip', async () => {
    render(<LogLabels labels={{ foo: 'bar' }} addTooltip={false} />);
    await userEvent.hover(screen.getByText('foo=bar'));
    expect(screen.getAllByText('foo=bar')).toHaveLength(1);
  });
  describe('displayMax', () => {
    it('renders up to displayMax labels', () => {
      render(<LogLabels labels={{ foo: 'bar', baz: '42' }} displayMax={1} />);
      expect(screen.getByText('foo=bar')).toBeInTheDocument();
      expect(screen.getByLabelText('Expand labels')).toBeInTheDocument();
      expect(screen.queryByText('baz=42')).not.toBeInTheDocument();
    });

    it('allows to render all labels', async () => {
      const onDisplayMaxToggle = jest.fn();
      const { rerender } = render(
        <LogLabels labels={{ foo: 'bar', baz: '42' }} displayMax={1} onDisplayMaxToggle={onDisplayMaxToggle} />
      );

      await userEvent.click(screen.getByLabelText('Expand labels'));
      expect(onDisplayMaxToggle).toHaveBeenCalledTimes(1);
      expect(onDisplayMaxToggle).toHaveBeenCalledWith(true);

      rerender(<LogLabels labels={{ foo: 'bar', baz: '42' }} displayMax={1} onDisplayMaxToggle={onDisplayMaxToggle} />);

      expect(screen.getByText('foo=bar')).toBeInTheDocument();
      expect(screen.getByText('baz=42')).toBeInTheDocument();
      expect(screen.getByLabelText('Collapse labels')).toBeInTheDocument();
    });

    it('allows to collapse labels', async () => {
      const onDisplayMaxToggle = jest.fn();
      const { rerender } = render(
        <LogLabels
          labels={{ foo: 'bar', baz: '42' }}
          displayMax={1}
          displayAll
          onDisplayMaxToggle={onDisplayMaxToggle}
        />
      );

      await userEvent.click(screen.getByLabelText('Collapse labels'));
      expect(onDisplayMaxToggle).toHaveBeenCalledTimes(1);
      expect(onDisplayMaxToggle).toHaveBeenCalledWith(false);

      rerender(
        <LogLabels
          labels={{ foo: 'bar', baz: '42' }}
          displayMax={1}
          displayAll
          onDisplayMaxToggle={onDisplayMaxToggle}
        />
      );

      expect(screen.getByText('foo=bar')).toBeInTheDocument();
      expect(screen.getByLabelText('Expand labels')).toBeInTheDocument();
      expect(screen.queryByText('baz=42')).not.toBeInTheDocument();
    });
  });
});

it('keeps protected label chips interactive without changing source labels or exposing plaintext in tooltips', async () => {
  const value = `lenc:v1:${'a'.repeat(32)}:AAAAAAAAAAAAAAAAAAAAAA`;
  const labels = { namespace: value, region: 'public' };
  const resolveField = jest.fn(() => 'secret-namespace');
  Reflect.set(globalThis, protectedDisplay, {
    epoch: () => 1,
    subscribe: () => () => {},
    resolveField,
  });
  const { container } = render(<LogLabels labels={labels} />);
  expect(container).toHaveTextContent('namespace=secret-namespace');
  expect(container).toHaveTextContent('region=public');
  expect(container).not.toHaveTextContent(value);
  await userEvent.click(screen.getByRole('button', { name: 'Show ciphertext for namespace' }));
  expect(container).toHaveTextContent(`namespace=${value}`);
  expect(container).not.toHaveTextContent('secret-namespace');
  expect(resolveField).toHaveBeenCalledWith('label', 'namespace', value);
  expect(labels.namespace).toBe(value);
});

describe('<LogLabelsList />', () => {
  it('renders labels', () => {
    render(<LogLabelsList labels={['bar', '42', LOG_LINE_BODY_FIELD_NAME]} />);
    expect(screen.queryByText('bar')).toBeInTheDocument();
    expect(screen.queryByText('42')).toBeInTheDocument();
    expect(screen.queryByText(getNormalizedFieldName(LOG_LINE_BODY_FIELD_NAME))).toBeInTheDocument();
  });
});
