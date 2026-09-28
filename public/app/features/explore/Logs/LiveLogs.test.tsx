import { act, fireEvent, render, screen } from '@testing-library/react';

import { type LogRowModel } from '@grafana/data';

import { makeLogs } from '../mocks/makeLogs';

import { LiveLogs } from './LiveLogs';

// Avoids errors caused by circular dependencies
jest.mock('app/features/live/dashboard/dashboardWatcher', () => ({
  ignoreNextSave: jest.fn(),
}));

const setup = (rows: LogRowModel[]) =>
  render(
    <LiveLogs
      logRows={rows}
      timeZone={'utc'}
      stopLive={() => {}}
      onPause={() => {}}
      onResume={() => {}}
      onClear={() => {}}
      clearedAtIndex={null}
      isPaused={true}
    />
  );

describe('LiveLogs', () => {
  it('renders logs', () => {
    const logRows = makeLogs(3);
    setup(logRows);

    expect(screen.getByRole('cell', { name: 'log message 1' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'log message 2' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'log message 3' })).toBeInTheDocument();
  });

  it('renders new logs only when not paused', () => {
    const logRows = makeLogs(6);
    const firstLogs = logRows.slice(0, 3);
    const secondLogs = logRows.slice(3, 6);
    const { rerender } = setup(firstLogs);

    rerender(
      <LiveLogs
        logRows={secondLogs}
        timeZone={'utc'}
        stopLive={() => {}}
        onPause={() => {}}
        onClear={() => {}}
        clearedAtIndex={null}
        onResume={() => {}}
        isPaused={true}
      />
    );

    expect(screen.getByRole('cell', { name: 'log message 1' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'log message 2' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'log message 3' })).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'log message 4' })).not.toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'log message 5' })).not.toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'log message 6' })).not.toBeInTheDocument();

    rerender(
      <LiveLogs
        logRows={secondLogs}
        timeZone={'utc'}
        stopLive={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onClear={() => {}}
        clearedAtIndex={null}
        isPaused={false}
      />
    );

    expect(screen.getByRole('cell', { name: 'log message 4' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'log message 5' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'log message 6' })).toBeInTheDocument();
  });

  it('clears rendered logs when cleared while paused', () => {
    const logRows = makeLogs(3);
    const { rerender } = setup(logRows);

    rerender(
      <LiveLogs
        logRows={[]}
        timeZone={'utc'}
        stopLive={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onClear={() => {}}
        clearedAtIndex={logRows.length - 1}
        isPaused={true}
      />
    );

    expect(screen.queryByRole('cell', { name: /log message/ })).not.toBeInTheDocument();
  });

  it('renders ansi logs', () => {
    const commonLog = makeLogs(1);
    const firstAnsiLog = makeLogs(1, { hasAnsi: true, raw: 'log message \u001B[31m2\u001B[0m', uid: '2' });
    const secondAnsiLog = makeLogs(1, { hasAnsi: true, raw: 'log message \u001B[33m3\u001B[0m', uid: '3' });
    const logRows = [...commonLog, ...firstAnsiLog, ...secondAnsiLog];

    setup(logRows);

    expect(screen.getByRole('cell', { name: 'log message 1' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'log message 2' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'log message 3' })).toBeInTheDocument();

    const logList = screen.getAllByTestId('ansiLogLine');
    expect(logList).toHaveLength(2);
    expect(logList[0]).toHaveAttribute('style', 'color: rgb(204, 0, 0);');
    expect(logList[1]).toHaveAttribute('style', 'color: rgb(204, 102, 0);');
  });
  it('updates live encrypted fragments on key changes without modifying streamed row bytes', () => {
    const envelope = `lenc:v1:${'a'.repeat(32)}:AAAAAAAAAAAAAAAAAAAAAA`;
    const entry = `event=login email=\"${envelope}\" outcome=accepted`;
    const rows = makeLogs(1, { entry, raw: entry });
    const symbol = Symbol.for('grafana.loki.protectedLogDisplay.v1');
    const listeners = new Set<() => void>();
    let epoch = 0;
    let available = false;
    Reflect.set(globalThis, symbol, {
      epoch: () => epoch,
      subscribe: (notify: () => void) => { listeners.add(notify); return () => listeners.delete(notify); },
      resolveField: () => available ? 'alice@example.invalid' : '[encrypted: key unavailable]',
    });
    try {
      const { container } = setup(rows);
      expect(container).toHaveTextContent('event=login email=\"Locked\" outcome=accepted');
      expect(container).not.toHaveTextContent(envelope);
      act(() => { available = true; epoch++; listeners.forEach((notify) => notify()); });
      expect(container).toHaveTextContent('email=\"alice@example.invalid\"');
      fireEvent.click(screen.getByRole('button', { name: 'Show ciphertext for email' }));
      expect(container).toHaveTextContent(`email=\"${envelope}\"`);
      act(() => { epoch++; listeners.forEach((notify) => notify()); });
      expect(container).toHaveTextContent('email=\"alice@example.invalid\"');
      expect(rows[0].entry).toBe(entry);
      expect(rows[0].raw).toBe(entry);
    } finally {
      Reflect.deleteProperty(globalThis, symbol);
    }
  });
});
