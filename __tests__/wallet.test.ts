/**
 * Tests for the pure wallet helpers in lib/api/rewards.ts:
 *   - walletEntryStatus: status + expiry → display state
 *   - partitionWallet: split into "ready to use" vs "past", with ordering
 */

import {
  partitionWallet,
  walletEntryStatus,
  type WalletEntry,
} from '@/lib/api/rewards';

const NOW = Date.parse('2026-06-09T12:00:00Z');

function entry(overrides: Partial<WalletEntry>): WalletEntry {
  return {
    id: Math.random().toString(36).slice(2),
    reward_id: 'r1',
    code: 'POWR-TEST-ABC123',
    powr_spent: 500,
    status: 'active',
    redeemed_at: '2026-06-01T10:00:00Z',
    expires_at: '2026-09-01T10:00:00Z',
    integration_type: 'POOL',
    reward_title: 'Test reward',
    partner_name: 'Test partner',
    reward_image_url: null,
    checkout_url: null,
    ...overrides,
  };
}

describe('walletEntryStatus', () => {
  it('treats an active, unexpired code as ready', () => {
    expect(walletEntryStatus(entry({ status: 'active' }), NOW)).toBe('ready');
  });

  it('treats a used code as used regardless of expiry', () => {
    expect(walletEntryStatus(entry({ status: 'used', expires_at: '2099-01-01T00:00:00Z' }), NOW)).toBe('used');
  });

  it('treats an explicitly expired code as expired', () => {
    expect(walletEntryStatus(entry({ status: 'expired' }), NOW)).toBe('expired');
  });

  it('treats an active code past its expiry as expired', () => {
    expect(walletEntryStatus(entry({ status: 'active', expires_at: '2026-01-01T00:00:00Z' }), NOW)).toBe('expired');
  });

  it('treats an active code with no expiry as ready', () => {
    expect(walletEntryStatus(entry({ status: 'active', expires_at: null }), NOW)).toBe('ready');
  });
});

describe('partitionWallet', () => {
  it('puts ready codes first, used/expired in past, and drops refunded', () => {
    const ready = entry({ id: 'ready', status: 'active', expires_at: '2026-08-01T00:00:00Z' });
    const used = entry({ id: 'used', status: 'used' });
    const expiredByDate = entry({ id: 'exp', status: 'active', expires_at: '2026-01-01T00:00:00Z' });
    const refunded = entry({ id: 'ref', status: 'refunded' });

    const { ready: r, past } = partitionWallet([used, ready, expiredByDate, refunded], NOW);

    expect(r.map((e) => e.id)).toEqual(['ready']);
    expect(past.map((e) => e.id).sort()).toEqual(['exp', 'used']);
    expect([...r, ...past].some((e) => e.id === 'ref')).toBe(false);
  });

  it('orders ready entries by soonest expiry first', () => {
    const soon = entry({ id: 'soon', expires_at: '2026-06-20T00:00:00Z' });
    const later = entry({ id: 'later', expires_at: '2026-12-01T00:00:00Z' });
    const noExpiry = entry({ id: 'noexp', expires_at: null });

    const { ready } = partitionWallet([later, noExpiry, soon], NOW);
    expect(ready.map((e) => e.id)).toEqual(['soon', 'later', 'noexp']);
  });

  it('orders past entries newest-redeemed first', () => {
    const older = entry({ id: 'older', status: 'used', redeemed_at: '2026-05-01T00:00:00Z' });
    const newer = entry({ id: 'newer', status: 'used', redeemed_at: '2026-06-05T00:00:00Z' });

    const { past } = partitionWallet([older, newer], NOW);
    expect(past.map((e) => e.id)).toEqual(['newer', 'older']);
  });
});
