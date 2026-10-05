import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // Arranque en frío desde el acceso directo «Urgente»: lo dejamos
        // pendiente ANTES de crear la ventana, así ya está cuando la web
        // pregunta con getLaunchAction().
        if let item = connectionOptions.shortcutItem, let action = WCLaunchActions.action(for: item) {
            WCLaunchActions.shared.setPending(action)
        }

        // La ventana se arma acá (Info.plist ya no apunta a Main.storyboard:
        // si no, UIKit crearía un segundo bridge con otra copia de la web).
        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    // Acceso directo con la app ya abierta (o suspendida): avisa al plugin,
    // que emite «launchAction».
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        guard let action = WCLaunchActions.action(for: shortcutItem) else {
            completionHandler(false)
            return
        }
        WCLaunchActions.shared.deliver(action)
        completionHandler(true)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
