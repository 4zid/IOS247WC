#!/usr/bin/env ruby
# frozen_string_literal: true

# Deja el proyecto de Xcode como lo necesita 247WC. Idempotente: correrlo de
# nuevo no cambia nada. Usa la gema `xcodeproj` (gem install xcodeproj); el
# project.pbxproj nunca se edita a mano.
#
#   ruby scripts/dev/configure-xcode.rb
#
# Qué hace:
# - suma MainViewController.swift y WCNativePlugin.swift al target App (Sources)
# - suma PrivacyInfo.xcprivacy y InfoPlist.strings (en, es) a Resources
# - agrega «es» a knownRegions
# - solo iPhone (TARGETED_DEVICE_FAMILY = 1) y versión 1.0.0 (1)
# - guarda un scheme compartido «App» (la CI compila con -scheme App)

require 'xcodeproj'

ROOT = File.expand_path('../..', __dir__)
PROJECT_PATH = File.join(ROOT, 'ios/App/App.xcodeproj')
APP_DIR = File.join(ROOT, 'ios/App/App')

SOURCES = %w[MainViewController.swift WCNativePlugin.swift].freeze
LANGUAGES = %w[en es].freeze
BUILD_SETTINGS = {
  'TARGETED_DEVICE_FAMILY' => '1',
  'MARKETING_VERSION' => '1.0.0',
  'CURRENT_PROJECT_VERSION' => '1'
}.freeze

def fail!(message)
  warn "configure-xcode: #{message}"
  exit 1
end

# Referencia a un archivo dentro de un grupo; la crea si no existe.
def file_ref(group, path, file_type = nil)
  fail!("falta #{File.join(APP_DIR, path)}") unless File.exist?(File.join(APP_DIR, path))
  ref = group.files.find { |f| f.path == path } || group.new_reference(path)
  ref.last_known_file_type = file_type if file_type && ref.last_known_file_type != file_type
  ref
end

# Agrega a una fase de build sin duplicar.
def add_to_phase(phase, ref)
  phase.add_file_reference(ref, true) unless phase.files_references.include?(ref)
end

project = Xcodeproj::Project.open(PROJECT_PATH)
target = project.targets.find { |t| t.name == 'App' } || fail!('no encuentro el target App')
group = project.main_group.children.find { |c| c.isa == 'PBXGroup' && c.path == 'App' } ||
        fail!('no encuentro el grupo App')

# Swift propio.
SOURCES.each do |name|
  add_to_phase(target.source_build_phase, file_ref(group, name))
end

# Manifiesto de privacidad (Xcode lo trata como XML).
add_to_phase(target.resources_build_phase, file_ref(group, 'PrivacyInfo.xcprivacy', 'text.xml'))

# InfoPlist.strings localizado: un grupo de variantes con un hijo por idioma.
strings = group.children.find { |c| c.isa == 'PBXVariantGroup' && c.name == 'InfoPlist.strings' } ||
          group.new_variant_group('InfoPlist.strings')
LANGUAGES.each do |lang|
  path = "#{lang}.lproj/InfoPlist.strings"
  fail!("falta #{File.join(APP_DIR, path)}") unless File.exist?(File.join(APP_DIR, path))
  ref = strings.files.find { |f| f.path == path } || strings.new_reference(path)
  ref.name = lang unless ref.name == lang
  ref.last_known_file_type = 'text.plist.strings' unless ref.last_known_file_type == 'text.plist.strings'
end
add_to_phase(target.resources_build_phase, strings)

regions = project.root_object.known_regions
LANGUAGES.each { |lang| regions << lang unless regions.include?(lang) }

target.build_configurations.each do |config|
  BUILD_SETTINGS.each do |key, value|
    config.build_settings[key] = value unless config.build_settings[key] == value
  end
end

# Sin tocar el paquete local CapApp-SPM (lo maneja `cap sync`).
spm = project.root_object.package_references.find { |p| p.isa == 'XCLocalSwiftPackageReference' }
fail!('se perdió la referencia a CapApp-SPM') unless spm && spm.relative_path == 'CapApp-SPM'

project.save

# Scheme compartido: sin él, xcodebuild en la CI no ve «App» (los schemes
# autogenerados viven en xcuserdata, que no se versiona).
scheme = Xcodeproj::XCScheme.new
scheme.configure_with_targets(target, nil, launch_target: true)
scheme.save_as(PROJECT_PATH, 'App', true)

puts 'configure-xcode: listo'
