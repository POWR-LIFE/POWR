// AsyncStorage's native module is unavailable under Jest — use its official mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// The app's translations, so a component calling useTranslation() renders its
// English text under test rather than raw keys. Initialised straight from the
// catalogs, not through lib/i18n: loading that here would cache lib/locale
// before suites that mock expo-localization get to install their mock.
// Suites that test lib/i18n itself reset modules and load their own copy.
{
  const i18n = require('i18next');
  const { initReactI18next } = require('react-i18next');
  const { APP_I18N_OPTIONS } = require('./shared/i18n/app');
  i18n.use(initReactI18next).init({ ...APP_I18N_OPTIONS, lng: 'en' });
}
