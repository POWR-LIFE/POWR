/**
 * Render tests for CrashRecoveryScreen — what a member sees once a render error
 * has taken the tree down.
 *
 * The assertions that matter most here are the hostile-props ones at the
 * bottom. This component IS the error boundary's fallback, so there is no
 * boundary above it: anything it throws is an uncatchable native abort, at the
 * worst possible moment, on a device already in trouble. Everything else — copy,
 * the retry wiring, the two-attempt cap — is secondary to "it cannot throw".
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import CrashRecoveryScreen from '@/components/CrashRecoveryScreen';

describe('what the member is told', () => {
  it('states what happened, that it was recorded, and offers one action', () => {
    render(<CrashRecoveryScreen error={new Error('boom')} onRetry={jest.fn()} />);

    expect(screen.getByText('SOMETHING BROKE')).toBeTruthy();
    expect(screen.getByText(/That didn’t load\./)).toBeTruthy();
    expect(screen.getByText('We’ve got it.')).toBeTruthy();
    expect(screen.getByText(/points and your streak are untouched/)).toBeTruthy();
    expect(screen.getByText('TRY AGAIN')).toBeTruthy();
  });

  it('never shows the member the error text', () => {
    // A stack trace is diagnostics for us, not copy for them — and it can carry
    // ids and tokens that the reporter scrubs before sending.
    render(<CrashRecoveryScreen error={new Error('TypeError: x is undefined')} onRetry={jest.fn()} />);
    expect(screen.queryByText(/TypeError/)).toBeNull();
  });
});

describe('retrying', () => {
  it('remounts the tree when asked', () => {
    const onRetry = jest.fn();
    render(<CrashRecoveryScreen error={new Error('boom')} onRetry={onRetry} />);

    fireEvent.press(screen.getByText('TRY AGAIN'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('stops offering after two attempts rather than looping', () => {
    // retry() re-runs every provider's startup, so a deterministic error would
    // loop all of it. A button that visibly does nothing is worse than one that
    // admits it.
    const onRetry = jest.fn();
    render(<CrashRecoveryScreen error={new Error('boom')} onRetry={onRetry} />);

    fireEvent.press(screen.getByText('TRY AGAIN'));
    fireEvent.press(screen.getByText('TRY AGAIN'));

    expect(screen.queryByText('TRY AGAIN')).toBeNull();
    expect(screen.getByText('Close POWR and open it again.')).toBeTruthy();
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('survives a retry handler that throws', () => {
    const onRetry = jest.fn(() => {
      throw new Error('retry exploded');
    });
    render(<CrashRecoveryScreen error={new Error('boom')} onRetry={onRetry} />);

    expect(() => fireEvent.press(screen.getByText('TRY AGAIN'))).not.toThrow();
  });
});

describe('hostile props', () => {
  const hostile: [string, unknown][] = [
    ['undefined', undefined],
    ['an empty object', {}],
    ['a bare string', 'went wrong'],
    ['null', null],
  ];

  it.each(hostile)('renders with %s as the error', (_label, value) => {
    expect(() => render(<CrashRecoveryScreen error={value} onRetry={jest.fn()} />)).not.toThrow();
  });

  it('renders when the error’s message getter throws', () => {
    const nasty = new Error('boom');
    Object.defineProperty(nasty, 'message', {
      get() {
        throw new Error('message getter exploded');
      },
    });
    expect(() => render(<CrashRecoveryScreen error={nasty} onRetry={jest.fn()} />)).not.toThrow();
  });

  it('renders with no onRetry at all', () => {
    expect(() => render(<CrashRecoveryScreen error={new Error('boom')} />)).not.toThrow();
    expect(() => fireEvent.press(screen.getByText('TRY AGAIN'))).not.toThrow();
  });
});
