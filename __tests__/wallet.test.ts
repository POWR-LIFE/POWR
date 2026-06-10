/**
 * Tests for the pure wallet helpers in lib/api/rewards.ts:
 *   - walletEntryStatus: status + expiry → display state
 * (Active/history split and ordering now happen server-side in
 * fetchActiveWallet / fetchWalletHistory.)
 */

import {
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
    reward_hero_image_url: null,
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
