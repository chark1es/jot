require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'JotEditor'
  s.version        = package['version']
  s.summary        = 'Jot Phase 0.5 native UITextView editor'
  s.description    = 'TextKit 2 UITextView Expo module. No WebView.'
  s.author         = 'Jot'
  s.homepage       = 'https://github.com/chark1es/jot'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'
  s.dependency 'ExpoModulesCore'
  s.libraries      = 'sqlite3'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'IPHONEOS_DEPLOYMENT_TARGET' => '16.4'
  }
  s.source_files   = '*.{h,m,mm,swift}'
  s.exclude_files  = 'Tests/**/*'
end
