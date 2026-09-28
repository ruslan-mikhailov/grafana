import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ProtectedValue } from './ProtectedValue';

const value = 'enc:v1:630dcd2966c4336691125448bbb25b4f:7aUwjY5fPtHvu_dUnzcxBJc6XQ';
const another = 'enc:v1:630dcd2966c4336691125448bbb25b4f:AAAAAAAAAAAAAAAAAAAAAA';
const unavailable = '[encrypted: key unavailable]';

it('toggles decrypted text and selectable ciphertext inline using keyboard without activating its parent', async () => {
  const user = userEvent.setup();
  const parent = jest.fn();
  const changes = jest.fn();
  render(
    <div onClick={parent} onKeyDown={parent}>
      <ProtectedValue value={value} fieldName="enc.secret" epoch={1} displayValue="a secret" onDisplayedValueChange={changes} />
    </div>
  );
  const reveal = screen.getByRole('button', { name: 'Show ciphertext for enc.secret' });
  expect(reveal).toHaveTextContent('a secret');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.tab();
  expect(reveal).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(screen.getByText(value)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show decrypted value for enc.secret' })).toHaveFocus();
  expect(changes).toHaveBeenLastCalledWith(value);
  await user.click(screen.getByText(value));
  expect(screen.getByRole('button', { name: 'Show ciphertext for enc.secret' })).toHaveTextContent('a secret');
  await user.click(screen.getByRole('button', { name: 'Show ciphertext for enc.secret' }));
  await user.keyboard(' ');
  expect(screen.getByRole('button', { name: 'Show ciphertext for enc.secret' })).toHaveTextContent('a secret');
  expect(screen.queryByText(value)).not.toBeInTheDocument();
  expect(changes).toHaveBeenLastCalledWith('a secret');
  expect(parent).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('inspects a missing key, routes only its ID, and reveals ciphertext without changing the source', async () => {
  const user = userEvent.setup();
  const request = jest.fn();
  const props = { value, fieldName: 'enc.secret', epoch: 1, displayValue: unavailable, onLoadKey: request };
  render(<ProtectedValue {...props} />);
  await user.click(screen.getByRole('button', { name: 'Inspect locked value for enc.secret' }));
  const dialog = screen.getByRole('dialog', { name: 'Protected value' });
  expect(within(dialog).getByText('630dcd2966c4336691125448bbb25b4f')).toBeInTheDocument();
  expect(within(dialog).queryByText(value)).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Load matching key' }));
  expect(request).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Inspect locked value for enc.secret' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Show ciphertext' }));
  await user.click(screen.getByText(value));
  expect(screen.getByRole('button', { name: 'Inspect locked value for enc.secret' })).toHaveTextContent('Locked');
  expect(props.value).toBe(value);
});

it('remasks immediately across key epochs, value changes, and virtualized field reuse', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<ProtectedValue value={value} fieldName="enc.first" epoch={1} displayValue="first" />);
  await user.click(screen.getByRole('button', { name: 'Show ciphertext for enc.first' }));
  rerender(<ProtectedValue value={value} fieldName="enc.first" epoch={2} displayValue={unavailable} />);
  expect(screen.queryByText(value)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Inspect locked value for enc.first' })).toBeInTheDocument();
  rerender(<ProtectedValue value={value} fieldName="enc.first" epoch={3} displayValue="reimported" />);
  expect(screen.getByRole('button', { name: 'Show ciphertext for enc.first' })).toHaveTextContent('reimported');
  await user.click(screen.getByRole('button', { name: 'Show ciphertext for enc.first' }));
  rerender(<ProtectedValue value={another} fieldName="enc.first" epoch={3} displayValue="second" />);
  expect(screen.queryByText(value)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show ciphertext for enc.first' })).toHaveTextContent('second');
  await user.click(screen.getByRole('button', { name: 'Show ciphertext for enc.first' }));
  rerender(<ProtectedValue value={another} fieldName="enc.second" epoch={3} displayValue="third" />);
  expect(screen.queryByText(another)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show ciphertext for enc.second' })).toHaveTextContent('third');
});

it('keeps the locked inspector actionable when no key editor is mounted', async () => {
  const user = userEvent.setup();
  const request = jest.fn(() => false);
  render(
    <ProtectedValue
      value="lenc:v1:630dcd2966c4336691125448bbb25b4f:7aUwjY5fPtHvu_dUnzcxBJc6XQ"
      fieldName="email"
      kid="630dcd2966c4336691125448bbb25b4f"
      epoch={1}
      displayValue={unavailable}
      onLoadKey={request}
    />
  );
  await user.click(screen.getByRole('button', { name: 'Inspect locked value for email' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('630dcd2966c4336691125448bbb25b4f')).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Load matching key' }));
  expect(request).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('status')).toHaveTextContent('Open this datasource in Explore');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('does not offer an unlock action or a missing-key inspector for invalid authentication', () => {
  render(<ProtectedValue value={value} fieldName="enc.secret" epoch={1} displayValue="[encrypted: invalid data]" />);
  expect(screen.getByText('Invalid data')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
