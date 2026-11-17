/**
 * publishShareImage with a link preview: the landscape copy goes up beside
 * the card as `<card>-og.jpg` and its path rides on the share_cards row, so
 * share-card-og can serve it (WhatsApp draws a wide image large). The preview
 * is extra, never a reason the share fails.
 */
import { publishShareImage } from '@/lib/api/share';

const mockUpload = jest.fn();
const mockInsert = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
    readAsStringAsync: jest.fn(async () => 'AAAA'),
    EncodingType: { Base64: 'base64' },
}));
jest.mock('@/lib/supabase', () => ({
    getSessionUser: jest.fn(async () => ({ id: '11111111-2222-4333-8444-555555555555' })),
    supabase: {
        storage: { from: () => ({ upload: (...a: unknown[]) => mockUpload(...a) }) },
        from: () => ({ insert: (row: unknown) => ({ select: () => ({ single: () => mockInsert(row) }) }) }),
    },
}));

const meta = { title: '#123 in London · Autumn Series', subtitle: 'Round 01 is on.', referralCode: 'ABCD1234' };

beforeEach(() => {
    mockUpload.mockReset().mockResolvedValue({ error: null });
    mockInsert.mockReset().mockResolvedValue({ data: { id: 'card-1' }, error: null });
});

test('the preview goes up as <card>-og.jpg and its path is on the row', async () => {
    const url = await publishShareImage('file:///card.jpg', { ...meta, previewUri: 'file:///preview.jpg' });
    expect(url).toBe('https://powr.life/s/card-1');
    const [cardPath] = mockUpload.mock.calls[0];
    const [previewPath] = mockUpload.mock.calls[1];
    expect(cardPath).toMatch(/^11111111-2222-4333-8444-555555555555\/\d+-[a-z0-9]+\.jpg$/);
    expect(previewPath).toBe(cardPath.replace(/\.jpg$/, '-og.jpg'));
    // The same shape the column's CHECK and share-card-og hold it to.
    expect(previewPath).toMatch(/^[0-9a-f-]{36}\/[A-Za-z0-9_-]+\.jpg$/);
    expect(mockInsert.mock.calls[0][0]).toMatchObject({ image_path: cardPath, preview_path: previewPath, title: meta.title });
});

test('no preview: one upload and no preview_path key (older servers take the row)', async () => {
    await publishShareImage('file:///card.jpg', meta);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockInsert.mock.calls[0][0]).not.toHaveProperty('preview_path');
});

test('a failed preview upload still shares the card', async () => {
    mockUpload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'boom' } });
    await expect(publishShareImage('file:///card.jpg', { ...meta, previewUri: 'file:///preview.jpg' })).resolves.toBe('https://powr.life/s/card-1');
    expect(mockInsert.mock.calls[0][0]).not.toHaveProperty('preview_path');
});

test('a server without the column: the row again without preview_path', async () => {
    mockInsert
        .mockResolvedValueOnce({ data: null, error: { message: "Could not find the 'preview_path' column of 'share_cards' in the schema cache" } })
        .mockResolvedValueOnce({ data: { id: 'card-2' }, error: null });
    await expect(publishShareImage('file:///card.jpg', { ...meta, previewUri: 'file:///preview.jpg' })).resolves.toBe('https://powr.life/s/card-2');
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockInsert.mock.calls[1][0]).not.toHaveProperty('preview_path');
});
