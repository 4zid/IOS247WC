import Foundation
import UIKit
import WebKit
import CoreLocation
import Capacitor

// MARK: - Acciones de arranque (acceso directo «Urgente»)

/// Puente entre `SceneDelegate` y el plugin.
///
/// En un arranque en frío la web todavía no existe: la acción queda pendiente
/// hasta que la pida con `getLaunchAction()`. Con la app abierta se la pasamos
/// al plugin vivo, que emite `launchAction`.
final class WCLaunchActions {
    static let shared = WCLaunchActions()

    static let urgent = "urgent"

    // SceneDelegate escribe en el hilo principal y el plugin lee desde la cola
    // del bridge: con un candado chico alcanza.
    private let lock = NSLock()
    private var pending: String?
    private weak var plugin: WCNativePlugin?

    private init() {}

    /// La acción que corresponde a un acceso directo del ícono, si es nuestro.
    static func action(for item: UIApplicationShortcutItem) -> String? {
        return item.type.hasSuffix(".urgent") ? urgent : nil
    }

    func attach(_ plugin: WCNativePlugin) {
        lock.lock()
        defer { lock.unlock() }
        self.plugin = plugin
    }

    /// Arranque en frío: se guarda hasta que la web la pida.
    func setPending(_ action: String) {
        lock.lock()
        defer { lock.unlock() }
        pending = action
    }

    /// App abierta: si el plugin ya cargó emite el evento; si no, queda pendiente.
    func deliver(_ action: String) {
        lock.lock()
        let live = plugin
        if live == nil { pending = action }
        lock.unlock()
        live?.emitLaunchAction(action)
    }

    /// Devuelve la acción pendiente y la borra: la segunda llamada da `nil`.
    func consume() -> String? {
        lock.lock()
        defer { lock.unlock() }
        let action = pending
        pending = nil
        return action
    }
}

// MARK: - Plugin

/// Plugin «WCNative»: ubicación, brújula, pantalla encendida, mapas y ajustes.
/// El contrato con la web está en docs/NATIVE-API.md.
///
/// Ubicación propia con CoreLocation (no usamos @capacitor/geolocation: en iOS
/// comparte un solo timeout entre pedidos, manda los errores a todos los
/// callbacks y corta los watch cuando vence uno).
///
/// Capacitor llama a los métodos en una cola de fondo. Todo el estado de abajo,
/// el `CLLocationManager` y UIKit se tocan SOLO en el hilo principal.
@objc(WCNativePlugin)
public class WCNativePlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "WCNativePlugin"
    public let jsName = "WCNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getLocationStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestLocationPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrentPosition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startLocationUpdates", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopLocationUpdates", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startHeading", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopHeading", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKeepAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openDirections", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLaunchAction", returnType: CAPPluginReturnPromise)
    ]

    /// Códigos de error del contrato (la web los traduce a 1/2/3).
    private enum ErrorCode {
        static let permissionDenied = "PERMISSION_DENIED"
        static let servicesDisabled = "SERVICES_DISABLED"
        static let positionUnavailable = "POSITION_UNAVAILABLE"
        static let timeout = "TIMEOUT"
    }

    /// Clave de `NSLocationTemporaryUsageDescriptionDictionary` en Info.plist.
    private static let fullAccuracyPurposeKey = "NearestToilet"

    /// El watch no manda posiciones cacheadas más viejas que esto
    /// (CoreLocation suele entregar primero la última que tenía guardada).
    private static let watchMaxAge: TimeInterval = 10

    /// Un `getCurrentPosition` esperando su posición.
    private final class PositionRequest {
        let call: CAPPluginCall
        let startedAt = Date()
        let maximumAge: TimeInterval
        let highAccuracy: Bool
        var timeoutItem: DispatchWorkItem?

        init(call: CAPPluginCall, maximumAge: TimeInterval, highAccuracy: Bool) {
            self.call = call
            self.maximumAge = maximumAge
            self.highAccuracy = highAccuracy
        }

        /// Sirve si es posterior al pedido o si entra en `maximumAge`.
        func accepts(_ location: CLLocation) -> Bool {
            return location.timestamp >= startedAt || location.timestamp.timeIntervalSinceNow >= -maximumAge
        }
    }

    // MARK: Estado (solo hilo principal)

    private var locationManager: CLLocationManager?
    private var permissionWaiters: [(CLAuthorizationStatus) -> Void] = []
    private var pendingRequests: [PositionRequest] = []
    private var watching = false
    private var watchHighAccuracy = true
    private var updatingLocation = false
    private var headingActive = false
    private var askedFullAccuracy = false
    private var observers: [NSObjectProtocol] = []

    /// Un solo manager, creado la primera vez que hace falta (siempre en el
    /// hilo principal: CoreLocation entrega los eventos en el hilo donde nació).
    private var manager: CLLocationManager {
        if let existing = locationManager { return existing }
        let created = CLLocationManager()
        created.delegate = self
        created.desiredAccuracy = kCLLocationAccuracyBest
        created.distanceFilter = kCLDistanceFilterNone
        // Guía a pie: que iOS no pause las posiciones si la persona se queda
        // quieta esperando para cruzar.
        created.activityType = .fitness
        created.pausesLocationUpdatesAutomatically = false
        created.headingFilter = 1
        created.headingOrientation = .portrait
        locationManager = created
        return created
    }

    override public func load() {
        WCLaunchActions.shared.attach(self)

        let center = NotificationCenter.default
        // Si el diálogo de permiso no llegó a mostrarse (la app no estaba
        // activa) o venció un «Permitir una vez» con la guía en curso, lo
        // volvemos a pedir al volver.
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification,
                                            object: nil, queue: .main) { [weak self] _ in
            self?.retryPermissionRequest()
        })
        // La precisión completa temporal se pide una vez por uso de la app.
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification,
                                            object: nil, queue: .main) { [weak self] _ in
            self?.askedFullAccuracy = false
        })
        // Cuando la página se recarga (idioma, acceso directo «Urgente»),
        // Capacitor suelta los listeners de la web vieja: apagamos lo que
        // haya quedado prendido para no gastar batería sin nadie escuchando.
        observers.append(center.addObserver(forName: .capacitorDecidePolicyForNavigationAction,
                                            object: nil, queue: .main) { [weak self] note in
            guard let action = note.object as? WKNavigationAction else { return }
            self?.pageWillNavigate(action)
        })
    }

    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        locationManager?.delegate = nil
    }

    // MARK: - Permiso

    @objc public func getLocationStatus(_ call: CAPPluginCall) {
        checkServices { enabled in
            call.resolve(self.statusData(servicesEnabled: enabled))
        }
    }

    @objc public func requestLocationPermission(_ call: CAPPluginCall) {
        checkServices { enabled in
            // Con Localización apagada iOS no muestra el diálogo: contestamos ya.
            guard enabled else {
                call.resolve(self.statusData(servicesEnabled: false))
                return
            }
            self.whenPermissionDecided { _ in
                call.resolve(self.statusData(servicesEnabled: true))
            }
        }
    }

    // MARK: - Posición

    @objc public func getCurrentPosition(_ call: CAPPluginCall) {
        let highAccuracy = call.getBool("enableHighAccuracy") ?? true
        let timeout = WCNativePlugin.seconds(fromMs: call.getDouble("timeout"), or: 20)
        let maximumAge = WCNativePlugin.seconds(fromMs: call.getDouble("maximumAge"), or: 0)

        checkServices { enabled in
            guard enabled else {
                call.reject("Location services are disabled", ErrorCode.servicesDisabled)
                return
            }
            // Si el permiso no está decidido lo pedimos y esperamos la respuesta.
            // El timeout corre recién después: no cuenta el tiempo del diálogo.
            self.whenPermissionDecided { status in
                guard WCNativePlugin.isAuthorized(status) else {
                    call.reject("User denied Geolocation", ErrorCode.permissionDenied)
                    return
                }
                self.requestFullAccuracyIfNeeded()

                if let cached = self.manager.location, cached.horizontalAccuracy >= 0,
                   cached.timestamp.timeIntervalSinceNow >= -maximumAge {
                    call.resolve(WCNativePlugin.positionData(cached))
                    return
                }

                let request = PositionRequest(call: call, maximumAge: maximumAge, highAccuracy: highAccuracy)
                let timeoutItem = DispatchWorkItem { [weak self, weak request] in
                    guard let self = self, let request = request else { return }
                    self.expire(request)
                }
                request.timeoutItem = timeoutItem
                self.pendingRequests.append(request)
                self.refreshLocationUpdates()
                DispatchQueue.main.asyncAfter(deadline: .now() + timeout, execute: timeoutItem)
            }
        }
    }

    @objc public func startLocationUpdates(_ call: CAPPluginCall) {
        let highAccuracy = call.getBool("enableHighAccuracy") ?? true

        checkServices { enabled in
            guard enabled else {
                call.reject("Location services are disabled", ErrorCode.servicesDisabled)
                return
            }
            // No pide permiso: eso lo hace getCurrentPosition, que la web llama antes.
            guard WCNativePlugin.isAuthorized(self.manager.authorizationStatus) else {
                call.reject("User denied Geolocation", ErrorCode.permissionDenied)
                return
            }
            // Llamarlo dos veces no duplica nada: es un solo flag.
            self.watching = true
            self.watchHighAccuracy = highAccuracy
            self.refreshLocationUpdates()
            call.resolve([:])
        }
    }

    @objc public func stopLocationUpdates(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.watching = false
            self.refreshLocationUpdates()
            call.resolve([:])
        }
    }

    // MARK: - Brújula

    @objc public func startHeading(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let available = CLLocationManager.headingAvailable()
            if available && !self.headingActive {
                self.headingActive = true
                let manager = self.manager
                manager.headingFilter = 1
                manager.headingOrientation = .portrait
                manager.startUpdatingHeading()
            }
            call.resolve(["available": available])
        }
    }

    @objc public func stopHeading(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopHeadingUpdates()
            call.resolve([:])
        }
    }

    // MARK: - Pantalla, mapas, ajustes, arranque

    @objc public func setKeepAwake(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = enabled
            call.resolve([:])
        }
    }

    @objc public func openDirections(_ call: CAPPluginCall) {
        guard let latitude = call.getDouble("latitude"), let longitude = call.getDouble("longitude"),
              latitude.isFinite, longitude.isFinite, abs(latitude) <= 90, abs(longitude) <= 180 else {
            call.reject("latitude and longitude are required", "INVALID_ARGUMENT")
            return
        }
        // Siempre con punto decimal, sin importar el idioma del teléfono.
        // `name` se ignora a propósito: con q= Apple Maps busca el texto en vez
        // de ir a las coordenadas.
        let destination = String(format: "%.6f,%.6f", locale: Locale(identifier: "en_US_POSIX"),
                                 latitude, longitude)
        let googleURL = WCNativePlugin.makeURL("comgooglemaps://", [
            URLQueryItem(name: "daddr", value: destination),
            URLQueryItem(name: "directionsmode", value: "walking")
        ])
        let appleURL = WCNativePlugin.makeURL("maps://", [
            URLQueryItem(name: "daddr", value: destination),
            URLQueryItem(name: "dirflg", value: "w")
        ])

        DispatchQueue.main.async {
            // canOpenURL necesita «comgooglemaps» en LSApplicationQueriesSchemes.
            guard let googleURL = googleURL, UIApplication.shared.canOpenURL(googleURL) else {
                self.openAppleMaps(appleURL, call)
                return
            }
            UIApplication.shared.open(googleURL, options: [:]) { opened in
                if opened {
                    call.resolve(["app": "google"])
                } else {
                    self.openAppleMaps(appleURL, call)
                }
            }
        }
    }

    @objc public func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // Abre los ajustes de 247WC (ubicación, precisión, idioma).
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                call.reject("Settings are not available", "UNAVAILABLE")
                return
            }
            UIApplication.shared.open(url, options: [:]) { _ in
                call.resolve([:])
            }
        }
    }

    @objc public func getLaunchAction(_ call: CAPPluginCall) {
        if let action = WCLaunchActions.shared.consume() {
            call.resolve(["action": action])
        } else {
            call.resolve(["action": NSNull()])
        }
    }

    /// Acceso directo con la app abierta. Se retiene hasta que la web escuche.
    func emitLaunchAction(_ action: String) {
        notifyListeners("launchAction", data: ["action": action], retainUntilConsumed: true)
    }

    // MARK: - CLLocationManagerDelegate

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        if status == .notDetermined {
            // También llega apenas se crea el manager: si nadie espera nada, no es
            // una respuesta. Con un watch o un pedido en curso es un «Permitir una
            // vez» que venció (iOS lo hace cuando la app deja de usarse): sin
            // permiso no hay posiciones, así que lo pedimos de nuevo. Si no, la
            // guía quedaría congelada en la última posición sin ningún aviso.
            if watching || !pendingRequests.isEmpty {
                refreshLocationUpdates()
                if UIApplication.shared.applicationState == .active {
                    manager.requestWhenInUseAuthorization()
                }
            }
            return
        }

        let waiters = permissionWaiters
        permissionWaiters.removeAll()
        waiters.forEach { $0(status) }

        if WCNativePlugin.isAuthorized(status) {
            // Volvió el permiso (lo dieron de nuevo o lo reactivaron en Ajustes):
            // el watch sigue donde estaba.
            refreshLocationUpdates()
        } else {
            // Lo revocaron: avisamos y frenamos, pero el watch queda pedido para
            // retomar solo si el permiso vuelve.
            failLocation(code: ErrorCode.permissionDenied, message: "User denied Geolocation")
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let valid = locations.filter { $0.horizontalAccuracy >= 0 }
        guard let latest = valid.last else { return }

        if !pendingRequests.isEmpty {
            var stillWaiting: [PositionRequest] = []
            for request in pendingRequests {
                if let location = valid.last(where: { request.accepts($0) }) {
                    request.timeoutItem?.cancel()
                    request.call.resolve(WCNativePlugin.positionData(location))
                } else {
                    stillWaiting.append(request)
                }
            }
            pendingRequests = stillWaiting
        }

        if watching && latest.timestamp.timeIntervalSinceNow >= -WCNativePlugin.watchMaxAge {
            notifyListeners("locationUpdate", data: WCNativePlugin.positionData(latest))
        }

        refreshLocationUpdates()
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let code = (error as? CLError)?.code
        // locationUnknown es transitorio (CoreLocation sigue buscando) y
        // headingFailure es de la brújula, no de la posición.
        if code == .locationUnknown || code == .headingFailure { return }

        if code == .denied {
            failLocation(code: ErrorCode.permissionDenied, message: "User denied Geolocation")
        } else {
            failLocation(code: ErrorCode.positionUnavailable, message: error.localizedDescription)
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        guard headingActive else { return }
        // Norte verdadero si hay (necesita posición); si no, magnético.
        let heading = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
        guard heading.isFinite, heading >= 0 else { return }
        // Negativa = lectura no válida (brújula sin calibrar): la web recibe -1.
        let rawAccuracy = newHeading.headingAccuracy
        let accuracy: Double = rawAccuracy.isFinite && rawAccuracy >= 0 ? rawAccuracy : -1
        notifyListeners("heading", data: ["heading": heading, "accuracy": accuracy])
    }

    // MARK: - Internos (hilo principal)

    /// `locationServicesEnabled()` puede trabar la interfaz: se consulta afuera
    /// del hilo principal y la respuesta vuelve al principal.
    private func checkServices(_ completion: @escaping (Bool) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let enabled = CLLocationManager.locationServicesEnabled()
            DispatchQueue.main.async {
                completion(enabled)
            }
        }
    }

    /// Llama a `completion` con el permiso ya decidido. Si falta decidir, pide
    /// «Al usar la app» y espera a `locationManagerDidChangeAuthorization`.
    private func whenPermissionDecided(_ completion: @escaping (CLAuthorizationStatus) -> Void) {
        let manager = self.manager
        let status = manager.authorizationStatus
        guard status == .notDetermined else {
            completion(status)
            return
        }
        permissionWaiters.append(completion)
        manager.requestWhenInUseAuthorization()
    }

    private func retryPermissionRequest() {
        guard let manager = locationManager, manager.authorizationStatus == .notDetermined,
              !permissionWaiters.isEmpty || watching || !pendingRequests.isEmpty else { return }
        manager.requestWhenInUseAuthorization()
    }

    /// Con «Ubicación precisa» apagada el baño «más cercano» puede estar mal:
    /// pedimos precisión completa temporal sin esperar la respuesta.
    private func requestFullAccuracyIfNeeded() {
        let manager = self.manager
        guard !askedFullAccuracy, manager.accuracyAuthorization == .reducedAccuracy else { return }
        askedFullAccuracy = true
        manager.requestTemporaryFullAccuracyAuthorization(withPurposeKey: WCNativePlugin.fullAccuracyPurposeKey)
    }

    private func statusData(servicesEnabled: Bool) -> [String: Any] {
        let manager = self.manager
        let permission: String
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            permission = "granted"
        case .denied, .restricted:
            permission = "denied"
        case .notDetermined:
            permission = "prompt"
        @unknown default:
            permission = "prompt"
        }
        return [
            "permission": permission,
            "servicesEnabled": servicesEnabled,
            "precise": manager.accuracyAuthorization == .fullAccuracy
        ]
    }

    /// Prende o apaga las actualizaciones según quién las necesita: un watch o
    /// algún getCurrentPosition pendiente, y solo con permiso (sin permiso
    /// quedan pedidas y arrancan cuando vuelve).
    private func refreshLocationUpdates() {
        let authorized = locationManager.map { WCNativePlugin.isAuthorized($0.authorizationStatus) } ?? false
        let needed = (watching || !pendingRequests.isEmpty) && authorized
        guard needed else {
            if updatingLocation {
                locationManager?.stopUpdatingLocation()
                updatingLocation = false
            }
            return
        }

        let highAccuracy = (watching && watchHighAccuracy) || pendingRequests.contains { $0.highAccuracy }
        let accuracy = highAccuracy ? kCLLocationAccuracyBest : kCLLocationAccuracyHundredMeters
        let manager = self.manager
        if manager.desiredAccuracy != accuracy {
            manager.desiredAccuracy = accuracy
        }
        if !updatingLocation {
            manager.startUpdatingLocation()
            updatingLocation = true
        }
    }

    private func expire(_ request: PositionRequest) {
        guard let index = pendingRequests.firstIndex(where: { $0 === request }) else { return }
        pendingRequests.remove(at: index)
        request.call.reject("Timeout expired", ErrorCode.timeout)
        refreshLocationUpdates()
    }

    /// Rechaza los pedidos pendientes y avisa al watch. El watch no se borra:
    /// solo stopLocationUpdates (o una recarga de la página) lo termina, así
    /// retoma solo si el problema se resuelve (por ejemplo, vuelve el permiso).
    private func failLocation(code: String, message: String) {
        let failed = pendingRequests
        pendingRequests.removeAll()
        for request in failed {
            request.timeoutItem?.cancel()
            request.call.reject(message, code)
        }
        if watching {
            notifyListeners("locationError", data: ["code": code, "message": message])
        }
        refreshLocationUpdates()
    }

    private func stopHeadingUpdates() {
        guard headingActive else { return }
        headingActive = false
        locationManager?.stopUpdatingHeading()
    }

    /// Navegación del marco principal dentro de la app = la web vieja se va.
    /// Las navegaciones a otro host las cancela Capacitor (no son recargas) y
    /// un cambio de solo `#fragmento` no recarga la página.
    private func pageWillNavigate(_ action: WKNavigationAction) {
        guard action.targetFrame?.isMainFrame == true, let target = action.request.url else { return }
        if let current = webView?.url {
            guard target.scheme == current.scheme, target.host == current.host else { return }
            if target.fragment != nil, WCNativePlugin.withoutFragment(target) == WCNativePlugin.withoutFragment(current) { return }
        }
        resetSession()
    }

    /// Apaga lo que pidió la página anterior. Los pedidos pendientes se
    /// descartan: la página que los esperaba ya no existe.
    private func resetSession() {
        pendingRequests.forEach { $0.timeoutItem?.cancel() }
        pendingRequests.removeAll()
        watching = false
        refreshLocationUpdates()
        stopHeadingUpdates()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    private func openAppleMaps(_ url: URL?, _ call: CAPPluginCall) {
        guard let url = url else {
            call.reject("Could not open Maps", "UNAVAILABLE")
            return
        }
        UIApplication.shared.open(url, options: [:]) { opened in
            if opened {
                call.resolve(["app": "apple"])
            } else {
                call.reject("Could not open Maps", "UNAVAILABLE")
            }
        }
    }

    // MARK: - Utilidades

    private static func isAuthorized(_ status: CLAuthorizationStatus) -> Bool {
        return status == .authorizedWhenInUse || status == .authorizedAlways
    }

    /// Milisegundos de JS a segundos, con valor por defecto si no vino o no sirve.
    private static func seconds(fromMs value: Double?, or fallback: TimeInterval) -> TimeInterval {
        guard let value = value, value.isFinite, value >= 0 else { return fallback }
        return value / 1000
    }

    /// `null` en JS cuando el valor no es válido (JSON no acepta NaN).
    private static func valueOrNull(_ value: Double, valid: Bool) -> Any {
        if valid && value.isFinite {
            return value
        }
        return NSNull()
    }

    /// `Position` tal cual la espera la web (como la de navigator.geolocation).
    private static func positionData(_ location: CLLocation) -> [String: Any] {
        return [
            "timestamp": (location.timestamp.timeIntervalSince1970 * 1000).rounded(),
            "coords": [
                "latitude": location.coordinate.latitude,
                "longitude": location.coordinate.longitude,
                "accuracy": location.horizontalAccuracy,
                "altitude": valueOrNull(location.altitude, valid: location.verticalAccuracy >= 0),
                "altitudeAccuracy": valueOrNull(location.verticalAccuracy, valid: location.verticalAccuracy >= 0),
                "heading": valueOrNull(location.course, valid: location.course >= 0),
                "speed": valueOrNull(location.speed, valid: location.speed >= 0)
            ] as [String: Any]
        ]
    }

    private static func makeURL(_ base: String, _ queryItems: [URLQueryItem]) -> URL? {
        var components = URLComponents(string: base)
        components?.queryItems = queryItems
        return components?.url
    }

    private static func withoutFragment(_ url: URL) -> URL? {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.fragment = nil
        return components?.url
    }
}
