// NOT YET IN app.config.js — adding a plugin moves the EAS fingerprint, so this
// goes in with the next native build, not an OTA.
//
// @kingstinct/react-native-healthkit's BackgroundDeliveryManager re-registers
// the HealthKit observer queries in didFinishLaunchingWithOptions, before JS is
// up. Without it, a POWR that iOS terminated (reboot, memory) is not relaunched
// when Apple Health writes a workout until something else launches it. With it,
// the first workout after a reboot wakes the app too. The types it observes are
// the ones lib/health/healthKitObserver arms at runtime.
const { withAppDelegate } = require('@expo/config-plugins');

const CALL = '    BackgroundDeliveryManager.shared.setupBackgroundObservers()\n';

module.exports = function withHealthKitBackgroundObservers(config) {
  return withAppDelegate(config, (cfg) => {
    const src = cfg.modResults.contents;
    if (src.includes('setupBackgroundObservers')) return cfg;
    if (!src.includes('import ReactNativeHealthkit')) {
      cfg.modResults.contents = src.replace(/^import Expo\n/m, 'import Expo\nimport ReactNativeHealthkit\n');
    }
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /(didFinishLaunchingWithOptions launchOptions: \[UIApplication\.LaunchOptionsKey: Any\]\? = nil\s*\)\s*->\s*Bool\s*\{\n)/,
      `$1${CALL}`,
    );
    return cfg;
  });
};
