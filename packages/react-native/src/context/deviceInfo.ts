/**
 * Device / app / connectivity facts for a report.
 *
 * Uses only what React Native ships (Platform, Dimensions, PixelRatio,
 * Appearance, I18nManager). Optional Expo / community modules, when the host
 * has them, add model name, bundle id, build number, connectivity, battery and
 * OTA update info. Nothing here needs a new native dependency.
 */

export type RnEnv = {
  Platform: { OS: string; Version: string | number; constants?: Record<string, unknown> };
  Dimensions?: {
    get(k: 'window' | 'screen'): { width: number; height: number; scale?: number; fontScale?: number };
  };
  PixelRatio?: { get(): number; getFontScale(): number };
  Appearance?: { getColorScheme(): string | null | undefined };
  I18nManager?: { isRTL: boolean };
};

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type OptionalModules = {
  application?: Loose;
  device?: Loose;
  netinfo?: Loose;
  constants?: Loose;
  battery?: Loose;
  updates?: Loose;
};

function unwrap(mod: unknown): Loose | undefined {
  const m = mod as Loose | undefined;
  return m && typeof m === 'object' ? ((m.default ?? m) as Loose) : undefined;
}

/**
 * Each require sits lexically inside its own `try` with a static string:
 * Metro only treats a require as an optional dependency in that form, so hosts
 * without a given module still bundle.
 */
export function loadOptionalModules(): OptionalModules {
  const out: OptionalModules = {};
  /* eslint-disable @typescript-eslint/no-require-imports */
  try {
    out.application = unwrap(require('expo-application'));
  } catch {
    // not installed
  }
  try {
    out.device = unwrap(require('expo-device'));
  } catch {
    // not installed
  }
  try {
    out.netinfo = unwrap(require('@react-native-community/netinfo'));
  } catch {
    // not installed
  }
  try {
    out.constants = unwrap(require('expo-constants'));
  } catch {
    // not installed
  }
  try {
    out.battery = unwrap(require('expo-battery'));
  } catch {
    // not installed
  }
  try {
    out.updates = unwrap(require('expo-updates'));
  } catch {
    // not installed
  }
  /* eslint-enable @typescript-eslint/no-require-imports */
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(undefined);
      },
    );
  });
}

function put(out: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  out[key] = value;
}

export async function collectDeviceInfo(
  rn: RnEnv,
  mods: OptionalModules = {},
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  try {
    const c = rn.Platform.constants ?? {};
    if (rn.Platform.OS === 'android') {
      put(out, 'deviceBrand', c.Brand);
      put(out, 'deviceManufacturer', c.Manufacturer);
      put(out, 'deviceModel', c.Model);
      put(out, 'osApiLevel', c.Version);
    } else {
      put(out, 'deviceIdiom', c.interfaceIdiom);
    }

    const win = rn.Dimensions?.get('window');
    if (win) {
      put(out, 'screen', `${Math.round(win.width)}x${Math.round(win.height)}`);
      put(out, 'orientation', win.width > win.height ? 'landscape' : 'portrait');
    }
    put(out, 'pixelRatio', rn.PixelRatio?.get() ?? rn.Dimensions?.get('window').scale);
    put(out, 'fontScale', rn.PixelRatio?.getFontScale() ?? rn.Dimensions?.get('window').fontScale);
    put(out, 'colorScheme', rn.Appearance?.getColorScheme());
    if (rn.I18nManager?.isRTL) out.rtl = true;

    try {
      const dt = new Intl.DateTimeFormat().resolvedOptions();
      put(out, 'locale', dt.locale);
      put(out, 'timezone', dt.timeZone);
    } catch {
      // Intl unavailable
    }

    out.jsEngine = (globalThis as { HermesInternal?: unknown }).HermesInternal ? 'hermes' : 'jsc';
    out.isDebugBuild = typeof __DEV__ !== 'undefined' ? Boolean(__DEV__) : undefined;

    const dev = mods.device;
    if (dev) {
      put(out, 'deviceModel', dev.modelName ?? out.deviceModel);
      put(out, 'deviceBrand', dev.brand ?? out.deviceBrand);
      if (typeof dev.isDevice === 'boolean') out.isPhysicalDevice = dev.isDevice;
      put(out, 'deviceType', dev.deviceType);
      if (typeof dev.totalMemory === 'number') out.memoryMb = Math.round(dev.totalMemory / 1048576);
    }

    const app = mods.application;
    if (app) {
      put(out, 'bundleId', app.applicationId);
      put(out, 'nativeAppVersion', app.nativeApplicationVersion);
      put(out, 'appVersion', app.nativeApplicationVersion);
      put(out, 'buildNumber', app.nativeBuildVersion);
    }

    const ex = mods.constants;
    if (ex) {
      put(out, 'executionEnvironment', ex.executionEnvironment);
      put(out, 'expoSdk', ex.expoConfig?.sdkVersion);
      if (!out.appVersion) put(out, 'appVersion', ex.expoConfig?.version);
    }

    const upd = mods.updates;
    if (upd) {
      put(out, 'updateId', upd.updateId);
      put(out, 'updateChannel', upd.channel);
    }

    const [net, battery, lowPower] = await Promise.all([
      mods.netinfo?.fetch ? withTimeout(Promise.resolve(mods.netinfo.fetch()), 1500) : undefined,
      mods.battery?.getBatteryLevelAsync
        ? withTimeout(Promise.resolve(mods.battery.getBatteryLevelAsync()), 1500)
        : undefined,
      mods.battery?.isLowPowerModeEnabledAsync
        ? withTimeout(Promise.resolve(mods.battery.isLowPowerModeEnabledAsync()), 1500)
        : undefined,
    ]);
    if (net) {
      put(out, 'networkType', net.type);
      if (typeof net.isConnected === 'boolean') out.networkConnected = net.isConnected;
      if (typeof net.isInternetReachable === 'boolean') out.internetReachable = net.isInternetReachable;
      put(out, 'cellularGeneration', net.details?.cellularGeneration);
    }
    if (typeof battery === 'number' && battery >= 0) out.batteryPercent = Math.round(battery * 100);
    if (typeof lowPower === 'boolean') out.lowPowerMode = lowPower;
  } catch {
    // partial info is still useful
  }
  return out;
}
