/**
 * lib/saveCard — native "keep the image": a WRITE-ONLY gallery save on both
 * platforms (expo-media-library; the READ_MEDIA_* permissions its plugin
 * declares are stripped by android.blockedPermissions — the July 2026 Play
 * rejection), falling back to the share sheet's Save Image row when the
 * permission is declined or the write throws. Pins the routing, the
 * member-facing filename handed to the gallery, and the fallback order.
 */

const mockRequestPerms = jest.fn();
const mockSaveToLibrary = jest.fn();
jest.mock('expo-media-library', () => ({
    requestPermissionsAsync: (...a: unknown[]) => mockRequestPerms(...a),
    saveToLibraryAsync: (...a: unknown[]) => mockSaveToLibrary(...a),
}));

const mockCopy = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
    cacheDirectory: 'file:///cache/',
    copyAsync: (...a: unknown[]) => mockCopy(...a),
}));

const mockIsAvailable = jest.fn();
const mockShareAsync = jest.fn();
jest.mock('expo-sharing', () => ({
    isAvailableAsync: (...a: unknown[]) => mockIsAvailable(...a),
    shareAsync: (...a: unknown[]) => mockShareAsync(...a),
}));

const mockPlatform = { OS: 'android' as string };
jest.mock('react-native', () => ({ get Platform() { return mockPlatform; } }));

import { cardFilename, saveCardImage, saveCardNotice } from '@/lib/saveCard';

beforeEach(() => {
    jest.clearAllMocks();
    mockPlatform.OS = 'android';
    mockRequestPerms.mockResolvedValue({ granted: true });
    mockCopy.mockResolvedValue(undefined);
    mockSaveToLibrary.mockResolvedValue(undefined);
    mockIsAvailable.mockResolvedValue(true);
});

test('filename sorts by time and never carries odd characters', () => {
    expect(cardFilename('Check-In', new Date('2026-08-19T14:05:09Z'))).toBe('powr-check-in-20260819-140509.png');
    expect(cardFilename('reward-Mandarin Oriental!', new Date('2026-08-19T14:05:09Z'))).toBe('powr-reward-mandarin-oriental-20260819-140509.png');
    expect(cardFilename('', new Date('2026-08-19T14:05:09Z'))).toBe('powr-card-20260819-140509.png');
});

test.each(['android', 'ios'])('%s: write-only permission, member-facing filename, gallery write', async (os) => {
    mockPlatform.OS = os;
    await expect(saveCardImage('file:///tmp/c.png', 'powr-x.png')).resolves.toBe('saved');
    expect(mockRequestPerms).toHaveBeenCalledWith(true); // writeOnly — never a library read
    expect(mockCopy).toHaveBeenCalledWith({ from: 'file:///tmp/c.png', to: 'file:///cache/powr-x.png' });
    expect(mockSaveToLibrary).toHaveBeenCalledWith('file:///cache/powr-x.png');
    expect(mockShareAsync).not.toHaveBeenCalled();
});

test('permission declined: falls back to the share sheet, nothing written', async () => {
    mockRequestPerms.mockResolvedValue({ granted: false });
    await expect(saveCardImage('file:///tmp/c.png', 'powr-x.png')).resolves.toBe('sheet');
    expect(mockSaveToLibrary).not.toHaveBeenCalled();
    expect(mockShareAsync).toHaveBeenCalledWith('file:///tmp/c.png', expect.objectContaining({ mimeType: 'image/png', dialogTitle: 'Save Image' }));
});

test('gallery write throws: falls back to the share sheet instead of surfacing the error', async () => {
    mockSaveToLibrary.mockRejectedValue(new Error('boom'));
    await expect(saveCardImage('file:///tmp/c.png', 'powr-x.png')).resolves.toBe('sheet');
    expect(mockShareAsync).toHaveBeenCalled();
});

test('permission declined and no sheet either: unavailable', async () => {
    mockRequestPerms.mockResolvedValue({ granted: false });
    mockIsAvailable.mockResolvedValue(false);
    await expect(saveCardImage('file:///tmp/c.png', 'powr-x.png')).resolves.toBe('unavailable');
    expect(mockShareAsync).not.toHaveBeenCalled();
});

test('web: never touches the media library, goes straight to the sheet', async () => {
    mockPlatform.OS = 'web';
    await expect(saveCardImage('file:///tmp/c.png', 'powr-x.png')).resolves.toBe('sheet');
    expect(mockRequestPerms).not.toHaveBeenCalled();
});

test('notices', () => {
    expect(saveCardNotice('saved')).toBe('Saved to your Photos.');
    expect(saveCardNotice('sheet')).toMatch(/Save Image/);
    expect(saveCardNotice('cancelled')).toBeNull();
    expect(saveCardNotice('unavailable')).toMatch(/isn’t available/);
});
