const { withAndroidManifest } = require('@expo/config-plugins');

// Android 14+ ships Health Connect inside the platform, and the platform only
// grants health permissions to apps that can show WHY they want them: an
// activity answering VIEW_PERMISSION_USAGE in the HEALTH_PERMISSIONS category.
// react-native-health-connect's own plugin only adds the Android ≤13 filter
// (ACTION_SHOW_PERMISSIONS_RATIONALE on MainActivity), so without this alias
// the grant has nothing to point at on Android 14+ — Google's setup guide marks
// it "Required to support Android 14+ devices with platform Health Connect".
// Targets MainActivity, the same screen the ≤13 rationale filter opens.
const ALIAS_NAME = 'ViewPermissionUsageActivity';

module.exports = function withHealthConnectPermissionUsage(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application[0];
    application['activity-alias'] = application['activity-alias'] || [];

    const already = application['activity-alias'].some(a => a.$['android:name'] === ALIAS_NAME);
    if (already) return cfg;

    application['activity-alias'].push({
      $: {
        'android:name': ALIAS_NAME,
        'android:exported': 'true',
        'android:targetActivity': '.MainActivity',
        'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE',
      },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': 'android.intent.action.VIEW_PERMISSION_USAGE' } }],
          category: [{ $: { 'android:name': 'android.intent.category.HEALTH_PERMISSIONS' } }],
        },
      ],
    });
    return cfg;
  });
};
