const { withPodfile } = require('@expo/config-plugins');

/**
 * Fix: FirebaseCoreInternal (Swift) requires GoogleUtilities to define modules.
 * This patch persists through `expo prebuild --clean`.
 */
module.exports = function withGoogleUtilitiesModularHeaders(config) {
  return withPodfile(config, config => {
    if (!config.modResults || typeof config.modResults.contents !== 'string') {
      return config;
    }

    config.modResults.contents = config.modResults.contents.replace(
      /target 'POWR' do\n  use_expo_modules!/,
      "target 'POWR' do\n  use_expo_modules!\n  pod 'GoogleUtilities', :modular_headers => true"
    );

    return config;
  });
};
