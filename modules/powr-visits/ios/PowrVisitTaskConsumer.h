// POWR: iOS visit monitoring (CLVisit) as an expo-task-manager task consumer.
// Modelled on expo-location's EXGeofencingTaskConsumer.

#import <CoreLocation/CLLocationManagerDelegate.h>
#import <ExpoModulesCore/EXTaskConsumerInterface.h>

NS_ASSUME_NONNULL_BEGIN

// ⚠ The class NAME is persisted by EXTaskService and resolved with
// NSClassFromString when iOS relaunches the app for a visit — never rename it.
@interface PowrVisitTaskConsumer : NSObject <EXTaskConsumerInterface, CLLocationManagerDelegate>

@property (nonatomic, strong, nullable) id<EXTaskInterface> task;

@end

NS_ASSUME_NONNULL_END
