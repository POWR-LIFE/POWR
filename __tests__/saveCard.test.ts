/**
 * lib/saveCard — "keep the image" without a camera-roll write (the package
 * for that is what Google Play rejected POWR for). Android goes through the
 * Storage Access Framework and remembers the folder; iOS goes through the
 * share sheet's Save Image row. Pins the routing and the remember/forget
 * behaviour, since a wrong turn here either re-prompts every time or throws
 * a raw SAF error at the member.
 */

const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
const mockRemoveItem = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => ({
    __esModule: true,
    default: { getItem: (...a: unknown[]) => mockGetItem(...a), setItem: (...a: unknown[]) => mockSetItem(...a), removeItem: (...a: unknown[]) => mockRemoveItem(...a) },
}));

const mockRequestDir = jest.fn();
const mockCreateFile = jest.fn();
const mockWrite = jest.fn();
const mockRead = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
    EncodingType: { Base64: 'base64' },
    readAsStringAsync: (...a: unknown[]) => mockRead(...a),
    writeAsStringAsync: (...a: unknown[]) => mockWrite(...a),
    StorageAccessFramework: {
        getUriForDirectoryInRoot: (name: string) => `content://root/${name}`,
        requestDirectoryPermissionsAsync: (...a: unknown[]) => mockRequestDir(...a),
        createFileAsync: (...a: unknown[]) => mockCreateFile(...a),
    },
}));

const mockIsAvailable = jest.fn();
const mockShareAsync = jest.fn();
jest.mock('expo-sharing', () => ({
    isAvailableAsync: (...a: unknown[]) => mockIsAvailable(...a),
    shareAsync: (...a: unknown[]) => mockShareAsync(...a),
}));

const mockPlatform = { OS: 'android' as string };
jest.mock('react-native', () => ({ get Platform() { return mockPlatform; } }));

import { SAVE_DIR_KEY, cardFilename, saveCardImage, saveCardNotice } from '@/lib/saveCard';

beforeEach(() => {
    jest.clearAllMocks();
    mockPlatform.OS = 'android';
    mockRead.mockResolvedValue('QUJD');
    mockCreateFile.mockResolvedValue('content://dir/powr.png');
    mockWrite.mockResolvedValue(undefined);
    mockGetItem.mockResolvedValue(null);
});

test('filename sorts by time and never carries odd characters', () => {
    expect(cardFilename('Check-In', new Date('2026-08-19T14:05:09Z'))).toBe('powr-check-in-20260819-140509.png');
    expect(cardFilename('reward-Mandarin Oriental!', new Date('2026-08-19T14:05:09Z'))).toBe('powr-reward-mandarin-oriental-20260819-140509.png');
    expect(cardFilename('', new Date('2026-08-19T14:05:09Z'))).toBe('powr-card-20260819-140509.png');
});

test('android, first time: picker opens on Pictures, the folder is remembered, the file is written', async () => {
    mockRequestDir.mockResolvedValue({ granted: true, directoryUri: 'content://dir' });
    await expect(saveCardImage('file:///tmp/c.png', 'powr-x.png')).resolves.toBe('saved');
    expect(mockRequestDir).toHaveBeenCalledWith('content://root/Pictures');
    expect(mockCreateFile).toHaveBeenCalledWith('content://dir', 'powr-x.png', 'image/png');
    expect(mockWrite).toHaveBeenCalledWith('content://dir/powr.png', 'QUJD', { encoding: 'base64' });
    expect(mockSetItem).toHaveBeenCalledWith(SAVE_DIR_KEY, 'content://dir');
});

test('android, picker dismissed: cancelled, nothing written, nothing remembered', async () => {
    mockRequestDir.mockResolvedValue({ granted: false });
    await expect(saveCardImage('file:///tmp/c.png', 'powr-x.png')).resolves.toBe('cancelled');
    expect(mockCreateFile).not.toHaveBeenCalled();
    expect(mockSetItem).not.toHaveBeenCalled();
});

test('android, remembered folder: no picker at all', async () => {
    mockGetItem.mockResolvedValue('content://kept');
    await expect(saveCardImage('file:///tmp/c.png', 'powr-x.png')).resolves.toBe('saved');
    expect(mockRequestDir).not.toHaveBeenCalled();
    expect(mockCreateFile).toHaveBeenCalledWith('content://kept', 'powr-x.png', 'image/png');
});

test('android, remembered folder gone: forget it and fall back to the picker instead of throwing', async () => {
    mockGetItem.mockResolvedValue('content://gone');
    mockCreateFile
        .mockRejectedValueOnce(new Error('SecurityException'))
        .mockResolvedValueOnce('content://new/powr.png');
    mockRequestDir.mockResolvedValue({ granted: true, directoryUri: 'content://new' });
    await expect(saveCardImage('file:///tmp/c.png', 'powr-x.png')).resolves.toBe('saved');
    expect(mockRemoveItem).toHaveBeenCalledWith(SAVE_DIR_KEY);
    expect(mockRequestDir).toHaveBeenCalledTimes(1);
    expect(mockSetItem).toHaveBeenCalledWith(SAVE_DIR_KEY, 'content://new');
});

test('ios: the share sheet (Save Image lives there), never SAF', async () => {
    mockPlatform.OS = 'ios';
    mockIsAvailable.mockResolvedValue(true);
    await expect(saveCardImage('file:///tmp/c.png', 'powr-x.png')).resolves.toBe('sheet');
    expect(mockShareAsync).toHaveBeenCalledWith('file:///tmp/c.png', expect.objectContaining({ mimeType: 'image/png', dialogTitle: 'Save Image' }));
    expect(mockRequestDir).not.toHaveBeenCalled();
});

test('no sheet available (web): unavailable', async () => {
    mockPlatform.OS = 'web';
    mockIsAvailable.mockResolvedValue(false);
    await expect(saveCardImage('file:///tmp/c.png', 'powr-x.png')).resolves.toBe('unavailable');
});

test('notices', () => {
    expect(saveCardNotice('saved')).toBe('Saved to your phone.');
    expect(saveCardNotice('sheet')).toMatch(/Save Image/);
    expect(saveCardNotice('cancelled')).toBeNull();
    expect(saveCardNotice('unavailable')).toMatch(/isn’t available/);
});
