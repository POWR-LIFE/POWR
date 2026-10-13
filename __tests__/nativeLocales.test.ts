import { APP_LANGUAGES } from '../shared/i18n';

// app.config.js is plain CommonJS evaluated by Expo at build time.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { expo } = require('../app.config.js');

// Every usage description the last iOS prebuild shipped (Info.plist), including
// the ones plugins add with their own English defaults (camera, Face ID,
// microphone, "location always"). A new permission means a new line here and a
// translation in every native.json — otherwise iOS shows it in English.
const IOS_USAGE_KEYS = [
  'NSCameraUsageDescription',
  'NSFaceIDUsageDescription',
  'NSHealthShareUsageDescription',
  'NSHealthUpdateUsageDescription',
  'NSLocationAlwaysAndWhenInUseUsageDescription',
  'NSLocationAlwaysUsageDescription',
  'NSLocationWhenInUseUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSPhotoLibraryAddUsageDescription',
  'NSPhotoLibraryUsageDescription',
].sort();

const locales: Record<string, string> = expo.locales ?? {};
const localization = expo.plugins.find(
  (p: unknown) => Array.isArray(p) && p[0] === 'expo-localization',
) as [string, { supportedLocales: { ios: string[]; android: string[] } }] | undefined;

describe('native locales (next native build)', () => {
  it.each(Object.entries(locales))('%s translates every iOS permission prompt', (_lang, file) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const strings: Record<string, string> = require(`../${file}`);
    expect(Object.keys(strings).sort()).toEqual(IOS_USAGE_KEYS);
    for (const [key, text] of Object.entries(strings)) {
      expect({ key, empty: !text.trim() }).toEqual({ key, empty: false });
      // Expo writes `KEY = "value";` with no escaping, and InfoPlist.strings
      // never expands build variables like $(PRODUCT_NAME).
      expect({ key, unsafe: /["\\]|\$\(/.test(text) }).toEqual({ key, unsafe: false });
    }
  });

  it('lists the same languages for iOS and Android, English first', () => {
    expect(localization).toBeDefined();
    const { ios, android } = localization![1].supportedLocales;
    expect(android).toEqual(ios);
    expect(ios[0]).toBe('en');
  });

  it('lists every language with permission prompts and every live app language', () => {
    const listed = localization![1].supportedLocales.ios;
    for (const lang of [...Object.keys(locales), ...APP_LANGUAGES]) expect(listed).toContain(lang);
  });

  it('has permission prompts for every listed language but English', () => {
    for (const lang of localization![1].supportedLocales.ios.filter(l => l !== 'en')) {
      expect(locales[lang]).toBeDefined();
    }
  });
});
