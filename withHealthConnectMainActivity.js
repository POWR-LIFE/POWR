const { withMainActivity } = require('@expo/config-plugins');

module.exports = function withHealthConnectMainActivity(config) {
  return withMainActivity(config, (config) => {
    let mainActivity = config.modResults.contents;

    // 1. Add missing imports
    const importStatement = `import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate\n`;
    
    if (!mainActivity.includes('import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate')) {
      mainActivity = mainActivity.replace(
        /import com\.facebook\.react\.ReactActivity/,
        `${importStatement}import com.facebook.react.ReactActivity`
      );
    }

    // 2. Inject the initialization inside onCreate
    const delegateStatement = `HealthConnectPermissionDelegate.setPermissionDelegate(this)`;

    if (!mainActivity.includes(delegateStatement)) {
      if (mainActivity.includes('super.onCreate(')) {
        // Find super.onCreate(...) and put the delegate statement right before it.
        mainActivity = mainActivity.replace(
          /(super\.onCreate\(.*?\))/,
          `${delegateStatement}\n    $1`
        );
      } else {
        // Fallback if onCreate doesn't exist (unlikely in Expo)
        const onCreateStatement = `
  override fun onCreate(savedInstanceState: Bundle?) {
    ${delegateStatement}
    super.onCreate(savedInstanceState)
  }
`;
        mainActivity = mainActivity.replace(
          /class MainActivity : ReactActivity\(\) \{/,
          `class MainActivity : ReactActivity() {${onCreateStatement}`
        );
      }
    }

    config.modResults.contents = mainActivity;
    return config;
  });
};
