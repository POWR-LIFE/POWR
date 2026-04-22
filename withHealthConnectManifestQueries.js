const { withAndroidManifest } = require('@expo/config-plugins');

const HC_PACKAGE = 'com.google.android.apps.healthdata';

module.exports = function withHealthConnectManifestQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.queries = manifest.queries || [];
    const queriesArr = Array.isArray(manifest.queries) ? manifest.queries : [manifest.queries];

    const already = queriesArr.some(q =>
      Array.isArray(q.package) && q.package.some(p => p.$['android:name'] === HC_PACKAGE),
    );
    if (already) return cfg;

    queriesArr[0] = queriesArr[0] || {};
    queriesArr[0].package = queriesArr[0].package || [];
    queriesArr[0].package.push({ $: { 'android:name': HC_PACKAGE } });
    manifest.queries = queriesArr;
    return cfg;
  });
};
