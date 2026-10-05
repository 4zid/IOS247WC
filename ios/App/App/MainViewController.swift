import UIKit
import Capacitor

/// La vista principal: el bridge de Capacitor más nuestro plugin «WCNative».
///
/// Los plugins de npm se registran solos (capacitor.config.json →
/// packageClassList); el nuestro vive dentro de la app, así que lo
/// registramos a mano apenas existe el bridge y antes de cargar la web.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WCNativePlugin())
    }
}
