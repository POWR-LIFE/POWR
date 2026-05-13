const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withFirebaseMessagingManifestFix(config) {
  return withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest;
    const app = manifest.application?.[0];
    if (!app) return config;

    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    const conflicting = [
      { name: 'com.google.firebase.messaging.default_notification_channel_id', attr: 'android:value' },
      { name: 'com.google.firebase.messaging.default_notification_color', attr: 'android:resource' },
    ];

    for (const { name, attr } of conflicting) {
      const entry = (app['meta-data'] ?? []).find(m => m.$['android:name'] === name);
      if (entry) {
        entry.$['tools:replace'] = attr;
      }
    }

    return config;
  });
};
