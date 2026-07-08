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

    // 2. Inject the initialization inside onCreate.
    //
    // IMPORTANT: setPermissionDelegate() calls activity.registerForActivityResult(),
    // which androidx.activity only allows once the activity has passed through
    // ComponentActivity.onCreate() (i.e. it must run AFTER super.onCreate(), not
    // before). Registering too early throws IllegalStateException ("attempting to
    // register while current state is INITIALIZED") / leaves the launcher as an
    // uninitialized lateinit, so the Health Connect permission dialog never appears
    // and requestPermission() resolves empty. So we insert AFTER super.onCreate(...).
    const delegateStatement = `HealthConnectPermissionDelegate.setPermissionDelegate(this)`;

    if (!mainActivity.includes(delegateStatement)) {
      if (mainActivity.includes('super.onCreate(')) {
        // Find super.onCreate(...) and put the delegate statement right after it.
        mainActivity = mainActivity.replace(
          /(super\.onCreate\(.*?\))/,
          `$1\n    ${delegateStatement}`
        );
      } else {
        // Fallback if onCreate doesn't exist (unlikely in Expo)
        const onCreateStatement = `
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    ${delegateStatement}
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
