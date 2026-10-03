package expo.modules.powrbatterystate

import android.app.ActivityManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Read-only view of the OS power policy POWR runs under.
 *
 * lib/batteryOptimization.ts can only FIRE the exemption intent; nothing could
 * ever read whether it took, so the single biggest killer of background
 * check-ins on Samsung/Xiaomi was invisible. Every field is null when the OS
 * can't answer (old API level, service unavailable) — null is "unknown", never
 * "restricted".
 */
class PowrBatteryStateModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PowrBatteryState")

    Function("getState") {
      val context = appContext.reactContext ?: return@Function null
      val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
      val activity = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      val usage = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager

      mapOf<String, Any?>(
        // Settings → Battery → "Unrestricted" (the exemption our onboarding asks for).
        "ignoringBatteryOptimizations" to power?.isIgnoringBatteryOptimizations(context.packageName),
        // "Restricted" in app battery settings: background work is cut off entirely.
        "backgroundRestricted" to if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) activity?.isBackgroundRestricted else null,
        // App standby bucket (10 active … 45 restricted): sets job/alarm quotas and
        // whether high-priority FCM is honoured. Readable without any permission.
        "standbyBucket" to if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) usage?.appStandbyBucket else null,
        "powerSaveMode" to power?.isPowerSaveMode,
      )
    }
  }
}
