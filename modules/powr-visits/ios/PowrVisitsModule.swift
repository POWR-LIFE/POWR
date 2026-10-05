// POWR: JS entry points for iOS visit monitoring. The work happens in
// PowrVisitTaskConsumer; this only registers it with expo-task-manager, the
// same way expo-location registers its geofencing consumer.

import CoreLocation
import ExpoModulesCore

public final class PowrVisitsModule: Module {
  private var taskManager: EXTaskManagerInterface {
    get throws {
      guard let taskManager: EXTaskManagerInterface = appContext?.legacyModule(implementing: EXTaskManagerInterface.self) else {
        throw TaskManagerUnavailableException()
      }
      return taskManager
    }
  }

  public func definition() -> ModuleDefinition {
    Name("PowrVisits")

    // Registers (or re-asserts) the task. Visits only flow once the member has
    // granted Always location — the caller checks that; registering earlier is
    // harmless and starts delivering the moment Always is granted.
    AsyncFunction("startVisitMonitoringAsync") { (taskName: String) in
      let options: [String: Any] = [:]
      try taskManager.registerTask(withName: taskName, consumer: PowrVisitTaskConsumer.self, options: options)
    }

    AsyncFunction("stopVisitMonitoringAsync") { (taskName: String) in
      let taskManager = try taskManager

      try EXUtilities.catchException {
        taskManager.unregisterTask(withName: taskName, consumerClass: PowrVisitTaskConsumer.self)
      }
    }

    AsyncFunction("hasStartedVisitMonitoringAsync") { (taskName: String) -> Bool in
      return try taskManager.task(withName: taskName, hasConsumerOf: PowrVisitTaskConsumer.self)
    }
  }
}

internal final class TaskManagerUnavailableException: Exception {
  override var reason: String {
    "expo-task-manager is not available, so visit monitoring cannot be registered"
  }
}
