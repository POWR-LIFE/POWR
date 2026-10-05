// POWR: iOS visit monitoring (CLVisit) as an expo-task-manager task consumer.
//
// Why: nothing on iOS reliably says a member has LEFT the gym (09-06 review:
// exit detected on 37/100 visits). Visit monitoring is CoreLocation's cheapest
// service, and "if your app is terminated while this service is active, the
// system relaunches your app when new visit events are ready to be delivered"
// (Apple, startMonitoringVisits). A departure event carries the real departure
// time even when it is delivered late, which is exactly an exit witness.
//
// Lifecycle: EXTaskService persists the task and, on a relaunch, restores it in
// didFinishLaunching → didRegisterTask: below recreates the manager and sets the
// delegate, which is all CoreLocation needs to hand over the stored visit.

#import <CoreLocation/CoreLocation.h>

#import <ExpoModulesCore/EXUtilities.h>
#import <ExpoModulesCore/EXTaskInterface.h>

#import "PowrVisitTaskConsumer.h"

// Year 3000: anything past this is CoreLocation's distantFuture sentinel.
static const NSTimeInterval kPowrVisitMaxEpochSeconds = 32503680000.0;

@interface PowrVisitTaskConsumer ()

@property (nonatomic, strong, nullable) CLLocationManager *locationManager;

@end

@implementation PowrVisitTaskConsumer

- (void)dealloc
{
  // Only detach. Visit monitoring is APP-WIDE ("enabling visit events for one
  // location manager enables visit events for all"), so stopping it here could
  // switch off a replacement consumer that already started it. Only an explicit
  // unregister (didUnregister) stops the service.
  _locationManager.delegate = nil;
}

# pragma mark - EXTaskConsumerInterface

- (NSString *)taskType
{
  return @"powr-visits";
}

+ (NSUInteger)taskConsumerVersion
{
  return 1;
}

- (void)didRegisterTask:(id<EXTaskInterface>)task
{
  [EXUtilities performSynchronouslyOnMainThread:^{
    self->_task = task;
    [self startMonitoring];
  }];
}

- (void)setOptions:(nonnull NSDictionary *)options
{
  // Re-registering an existing task lands here. There are no options; just make
  // sure the service is on (calling start again is documented as harmless).
  [EXUtilities performSynchronouslyOnMainThread:^{
    [self startMonitoring];
  }];
}

- (void)didUnregister
{
  [EXUtilities performSynchronouslyOnMainThread:^{
    [self->_locationManager stopMonitoringVisits];
    self->_locationManager.delegate = nil;
    self->_locationManager = nil;
    self->_task = nil;
  }];
}

# pragma mark - helpers

// Main thread only: CLLocationManager delivers to the run loop it was made on.
- (void)startMonitoring
{
  if (_locationManager == nil) {
    _locationManager = [CLLocationManager new];
    _locationManager.delegate = self;
  }
  [_locationManager startMonitoringVisits];
}

+ (id)exportTimestamp:(nullable NSDate *)date
{
  // CoreLocation marks an arrival that predates monitoring with distantPast and
  // a visit still in progress with distantFuture — both mean "unknown" here.
  NSTimeInterval seconds = date.timeIntervalSince1970;
  if (date == nil || seconds <= 0 || seconds >= kPowrVisitMaxEpochSeconds) {
    return [NSNull null];
  }
  return @(seconds * 1000.0);
}

+ (NSDictionary *)exportVisit:(CLVisit *)visit
{
  return @{
    @"arrivalTimestamp": [self exportTimestamp:visit.arrivalDate],
    @"departureTimestamp": [self exportTimestamp:visit.departureDate],
    @"latitude": @(visit.coordinate.latitude),
    @"longitude": @(visit.coordinate.longitude),
    @"horizontalAccuracy": @(visit.horizontalAccuracy),
    // When the event reached us — departure minus this is the delivery lag.
    @"receivedAt": @([NSDate date].timeIntervalSince1970 * 1000.0),
  };
}

# pragma mark - CLLocationManagerDelegate

- (void)locationManager:(CLLocationManager *)manager didVisit:(CLVisit *)visit
{
  if (_task == nil) {
    return;
  }
  [_task executeWithData:@{ @"visit": [self.class exportVisit:visit] } withError:nil];
}

- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error
{
  // kCLErrorLocationUnknown is CoreLocation saying "still trying" — waking JS
  // for it would be a headless boot for nothing.
  if (_task == nil || ([error.domain isEqualToString:kCLErrorDomain] && error.code == kCLErrorLocationUnknown)) {
    return;
  }
  [_task executeWithData:nil withError:error];
}

@end
