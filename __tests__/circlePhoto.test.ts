import { awaitCirclePhoto, circleToPhotoCrop, settleCirclePhoto } from '@/lib/circlePhoto';

describe('circleToPhotoCrop', () => {
  // iPhone-ish preview, 3:4 portrait photo: the photo is height-fitted and
  // overflows the view horizontally.
  const view = { width: 390, height: 844 };
  const photo = { width: 3024, height: 4032 };

  it('maps a centred ring to a square centred on the photo', () => {
    const crop = circleToPhotoCrop(view, { cx: 195, cy: 422, diameter: 300 }, photo);
    // centre of the crop square, in photo fractions
    const centreX = crop.x + crop.size / 2;
    const centreY = crop.y + (crop.size * photo.width) / photo.height / 2;
    expect(centreX).toBeCloseTo(0.5, 6);
    expect(centreY).toBeCloseTo(0.5, 6);
    // height-fitted: scale = 844/4032, so 300dp of ring = 300/scale px
    expect(crop.size * photo.width).toBeCloseTo(300 / (844 / 4032), 6);
  });

  it('keeps the square inside the photo for a ring inside the view', () => {
    const crop = circleToPhotoCrop(view, { cx: 195, cy: 844 * 0.42, diameter: 390 * 0.78 }, photo);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.size).toBeLessThanOrEqual(1);
    expect(crop.y + (crop.size * photo.width) / photo.height).toBeLessThanOrEqual(1);
  });

  it('shifts the square up when the ring sits above centre', () => {
    const above = circleToPhotoCrop(view, { cx: 195, cy: 300, diameter: 300 }, photo);
    const centred = circleToPhotoCrop(view, { cx: 195, cy: 422, diameter: 300 }, photo);
    expect(above.y).toBeLessThan(centred.y);
    expect(above.x).toBeCloseTo(centred.x, 6);
  });

  it('handles a width-fitted photo (wide view, tall photo)', () => {
    const wide = { width: 800, height: 400 };
    const crop = circleToPhotoCrop(wide, { cx: 400, cy: 200, diameter: 200 }, photo);
    // width-fitted: scale = 800/3024
    expect(crop.size).toBeCloseTo(200 / 800, 6);
    expect(crop.x).toBeCloseTo(0.5 - 0.125, 6);
  });
});

describe('circle photo hand-off', () => {
  it('resolves the pending request with the settled photo', async () => {
    const p = awaitCirclePhoto();
    const photo = { uri: 'file://x.jpg', width: 3, height: 4, crop: { x: 0, y: 0, size: 1 } };
    settleCirclePhoto(photo);
    await expect(p).resolves.toBe(photo);
  });

  it('supersedes an earlier request with null', async () => {
    const first = awaitCirclePhoto();
    const second = awaitCirclePhoto();
    settleCirclePhoto(null);
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
  });
});
