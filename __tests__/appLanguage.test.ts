import type AsyncStorageType from '@react-native-async-storage/async-storage';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(),
  useLocales: jest.fn(() => []),
}));

const mockEq = jest.fn();
const mockUpdate = jest.fn(() => ({ eq: mockEq }));
jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(() => ({ update: mockUpdate })) },
}));

type I18nModule = typeof import('@/lib/i18n');

/**
 * lib/i18n holds module-level state (it IS the app's language), so every test
 * loads a fresh copy after seeding the phone's language and the saved pick.
 */
async function load(opts: { device?: string; saved?: Record<string, string>; drafts?: boolean } = {}) {
  jest.resetModules();
  // The draft gate is tested against a stand-in list: French and Spanish are
  // live now, so `drafts` puts them back where a new language would sit.
  if (opts.drafts) {
    jest.doMock('@/shared/i18n', () => ({
      ...jest.requireActual('@/shared/i18n'),
      APP_LANGUAGES: ['en'],
      APP_DRAFT_LANGUAGES: ['fr', 'es'],
    }));
  } else {
    jest.dontMock('@/shared/i18n');
  }
  const tag = opts.device ?? 'en-GB';
  (require('expo-localization').getLocales as jest.Mock).mockReturnValue([
    { languageTag: tag, languageCode: tag.split('-')[0], regionCode: tag.split('-')[1] ?? null, textDirection: 'ltr' },
  ]);
  const storage: typeof AsyncStorageType = require('@react-native-async-storage/async-storage');
  await storage.clear();
  for (const [key, value] of Object.entries(opts.saved ?? {})) await storage.setItem(key, value);
  const mod: I18nModule = require('@/lib/i18n');
  await mod.languageReady;
  return { mod, storage, i18n: mod.default };
}

describe('the app language', () => {
  it('follows a French phone now French is live', async () => {
    const { mod, i18n } = await load({ device: 'fr-FR' });
    expect(mod.getLanguageState()).toMatchObject({ language: 'fr', deviceLanguage: 'fr', preview: false, available: ['en', 'fr', 'es'] });
    expect(i18n.t('settings:language.title')).toBe('Langue');
  });

  it('stays English on a phone in a language POWR does not speak', async () => {
    const { mod, i18n } = await load({ device: 'de-DE' });
    expect(mod.getLanguageState()).toMatchObject({ language: 'en', deviceLanguage: 'de' });
    expect(i18n.t('settings:language.title')).toBe('Language');
  });

  it('stays English on a French phone while French is only a draft', async () => {
    const { mod, i18n } = await load({ device: 'fr-FR', drafts: true });
    expect(mod.getLanguageState()).toMatchObject({ language: 'en', deviceLanguage: 'fr', preview: false, available: ['en'] });
    expect(i18n.t('settings:language.title')).toBe('Language');
  });

  it('follows a French phone into the draft once the translation preview is on', async () => {
    const { mod, i18n } = await load({ device: 'fr-FR', saved: { 'powr:language:preview': '1' }, drafts: true });
    expect(mod.getLanguageState().language).toBe('fr');
    expect(i18n.t('settings:language.title')).toBe('Langue');
  });

  it('applies a pick, and remembers it on the device', async () => {
    const { mod, storage, i18n } = await load({ device: 'en-GB' });
    await mod.setTranslationPreview(true);
    await mod.setLanguagePreference('es');
    expect(mod.getLanguageState()).toMatchObject({ language: 'es', preference: 'es' });
    expect(i18n.t('common:actions.cancel')).toBe('Cancelar');
    expect(await storage.getItem('powr:language')).toBe('es');
  });

  it('ignores a draft pick while the preview is off, and restores it when it comes back', async () => {
    const { mod } = await load({ device: 'en-GB', saved: { 'powr:language': 'fr' }, drafts: true });
    expect(mod.getLanguageState()).toMatchObject({ language: 'en', preference: 'fr' });
    await mod.setTranslationPreview(true);
    expect(mod.getLanguageState().language).toBe('fr');
  });

  it('follows the phone again when the pick is cleared', async () => {
    const { mod, storage } = await load({ device: 'es-ES', saved: { 'powr:language:preview': '1', 'powr:language': 'fr' } });
    expect(mod.getLanguageState().language).toBe('fr');
    await mod.setLanguagePreference(null);
    expect(mod.getLanguageState()).toMatchObject({ language: 'es', preference: null });
    expect(await storage.getItem('powr:language')).toBeNull();
  });

  it('falls back to English, never a blank, for a string a draft has not translated', async () => {
    const { mod, i18n } = await load();
    await mod.setTranslationPreview(true);
    await mod.setLanguagePreference('fr');
    i18n.addResource('fr', 'settings', 'language.hint', '');
    expect(i18n.t('settings:language.hint')).toBe("POWR follows your phone's language unless you pick one here.");
  });

  it('reports what the person reads: their pick, else the phone, supported or not', async () => {
    const { mod } = await load({ device: 'de-DE' });
    expect(mod.getPreferredLanguage()).toBe('de');
    await mod.setLanguagePreference('fr');
    expect(mod.getPreferredLanguage()).toBe('fr');
  });

  it('formats English as en-GB and French by the phone region it is shown on', async () => {
    const { mod } = await load({ device: 'fr-CA', saved: { 'powr:language:preview': '1' } });
    expect(mod.getFormatLocale()).toBe('fr-CA');
    await mod.setLanguagePreference('en');
    expect(mod.getFormatLocale()).toBe('en-GB');
  });
});

describe('reportUserLanguage', () => {
  beforeEach(() => {
    mockUpdate.mockClear();
    mockEq.mockReset();
    mockEq.mockResolvedValue({ error: null });
  });

  async function loadReporter(device: string, appState: string = 'active') {
    await load({ device });
    const { AppState } = require('react-native');
    Object.defineProperty(AppState, 'currentState', { value: appState, configurable: true });
    return require('@/lib/i18n/reportLanguage') as typeof import('@/lib/i18n/reportLanguage');
  }

  it('writes the language once, then stays quiet until it changes', async () => {
    const { reportUserLanguage } = await loadReporter('fr-FR');
    await reportUserLanguage('user-1');
    await reportUserLanguage('user-1');
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ language: 'fr' });
    expect(mockEq).toHaveBeenCalledWith('id', 'user-1');

    await require('@/lib/i18n').setLanguagePreference('es');
    await reportUserLanguage('user-1');
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenLastCalledWith({ language: 'es' });
  });

  it('writes again for a different account on the same phone', async () => {
    const { reportUserLanguage } = await loadReporter('fr-FR');
    await reportUserLanguage('user-1');
    await reportUserLanguage('user-2');
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it('retries next time when the write fails', async () => {
    const { reportUserLanguage } = await loadReporter('fr-FR');
    mockEq.mockResolvedValueOnce({ error: { message: 'offline' } });
    await reportUserLanguage('user-1');
    await reportUserLanguage('user-1');
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it('never touches the network on a background wake', async () => {
    const { reportUserLanguage } = await loadReporter('fr-FR', 'background');
    await reportUserLanguage('user-1');
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
