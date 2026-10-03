Pod::Spec.new do |s|
  s.name           = 'PowrVisits'
  s.version        = '0.1.0'
  s.summary        = 'CLVisit monitoring delivered as an expo-task-manager task'
  s.description    = 'Starts iOS visit monitoring and hands each CLVisit to a headless JS task.'
  s.license        = 'UNLICENSED'
  s.author         = 'POWR'
  s.homepage       = 'https://powr.life'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,swift}"
end
