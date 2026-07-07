// Native bridge for the Crafters Market iOS app (Capacitor shell).
// The Capacitor runtime is injected into the live site only when the page
// is loaded inside the native app, so everything here is a no-op on the web.

export const isNativeApp = () => {
  try {
    return !!window.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
};

const plugin = (name) => window.Capacitor?.Plugins?.[name];

// Haptic tap — style: "light" | "medium" | "heavy"
export function nativeHaptic(style = "light") {
  if (!isNativeApp()) return;
  try {
    const styleMap = { light: "LIGHT", medium: "MEDIUM", heavy: "HEAVY" };
    plugin("Haptics")?.impact({ style: styleMap[style] || "LIGHT" });
  } catch {}
}

// Success/error notification haptic — type: "success" | "warning" | "error"
export function nativeNotificationHaptic(type = "success") {
  if (!isNativeApp()) return;
  try {
    plugin("Haptics")?.notification({ type: type.toUpperCase() });
  } catch {}
}

// Route navigator.share through the native iOS share sheet so every
// existing share button in the app gets the native experience for free.
function overrideShare() {
  const Share = plugin("Share");
  if (!Share) return;
  const nativeShare = async (data = {}) => {
    await Share.share({
      title: data.title,
      text: data.text,
      url: data.url,
      dialogTitle: data.title || "Share",
    });
  };
  try {
    Object.defineProperty(window.navigator, "share", { value: nativeShare, configurable: true });
    Object.defineProperty(window.navigator, "canShare", { value: () => true, configurable: true });
  } catch {}
}

export function bootNativeBridge() {
  if (!isNativeApp()) return;
  document.documentElement.classList.add("cm-native-ios");
  overrideShare();
  try {
    plugin("StatusBar")?.setStyle({ style: "DARK" });
  } catch {}
}

bootNativeBridge();
