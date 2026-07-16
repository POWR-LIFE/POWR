import { storageImage } from '@/lib/storageImage';

const ORIGINAL =
  'https://example.supabase.co/storage/v1/object/public/reward-images/heroes/pic.png';

describe('storageImage', () => {
  it('rewrites a public storage URL to the render endpoint with both dimensions', () => {
    expect(storageImage(ORIGINAL, 1080, 1080)).toBe(
      'https://example.supabase.co/storage/v1/render/image/public/reward-images/heroes/pic.png?width=1080&height=1080&resize=contain',
    );
  });

  it('leaves non-storage URLs untouched', () => {
    expect(storageImage('https://cdn.example.com/pic.png', 400, 400)).toBe(
      'https://cdn.example.com/pic.png',
    );
  });

  it('returns null for null, undefined and empty string', () => {
    expect(storageImage(null, 400, 400)).toBeNull();
    expect(storageImage(undefined, 400, 400)).toBeNull();
    expect(storageImage('', 400, 400)).toBeNull();
  });
});
