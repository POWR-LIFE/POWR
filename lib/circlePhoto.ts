/**
 * Hand-off between a caller (share-stats) and the circle-camera screen.
 *
 * expo-router screens can't return values, so the caller parks a resolver
 * here, pushes the screen, and the screen settles it on capture or dismiss.
 * Only one request is ever in flight — a second caller supersedes the first.
 */

export interface CirclePhoto {
  uri: string;
  /** Oriented photo size in px — as it displays, not as the sensor stored it. */
  width: number;
  height: number;
  /**
   * The square the on-screen circle covered, normalised to the photo:
   * x/y as fractions of width/height, size as a fraction of width.
   */
  crop: { x: number; y: number; size: number };
}

let pending: ((photo: CirclePhoto | null) => void) | null = null;

/** Resolves with the photo, or null if the user closed the camera. */
export function awaitCirclePhoto(): Promise<CirclePhoto | null> {
  pending?.(null);
  return new Promise(resolve => { pending = resolve; });
}

export function settleCirclePhoto(photo: CirclePhoto | null): void {
  const resolve = pending;
  pending = null;
  resolve?.(photo);
}

/**
 * Maps a circle drawn over a cover-scaled camera preview onto the captured
 * photo. The preview fills its view (`resizeAspectFill` on iOS, `FILL_CENTER`
 * on Android), so the photo is scaled to cover the view and centred; anything
 * past the view edges is simply not shown.
 *
 * @param view   on-screen size of the preview
 * @param circle centre and diameter of the overlay, in the same coordinates
 * @param photo  oriented photo size
 */
export function circleToPhotoCrop(
  view: { width: number; height: number },
  circle: { cx: number; cy: number; diameter: number },
  photo: { width: number; height: number },
): CirclePhoto['crop'] {
  const scale = Math.max(view.width / photo.width, view.height / photo.height);
  const offsetX = (photo.width * scale - view.width) / 2;
  const offsetY = (photo.height * scale - view.height) / 2;
  const r = circle.diameter / 2;
  const xPx = (circle.cx - r + offsetX) / scale;
  const yPx = (circle.cy - r + offsetY) / scale;
  const sizePx = circle.diameter / scale;
  return {
    x: xPx / photo.width,
    y: yPx / photo.height,
    size: sizePx / photo.width,
  };
}
