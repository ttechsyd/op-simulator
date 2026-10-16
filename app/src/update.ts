import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { App } from "@capacitor/app";
import { CapacitorUpdater } from "@capgo/capacitor-updater";

// stamped by the bundle workflow; a local build is just "dev"
export const bundleVersion: string = __BUNDLE_VERSION__;

const VERSION_URL = "https://github.com/ttechsyd/op-simulator/releases/latest/download/version.json";

export type Release = {
  version: string;
  engine: string;
  cards: number;
  url: string;
  checksum?: string;
  // fingerprint of the android shell the bundle was built against, and the apk for it
  native?: string;
  apk?: string;
};

const native = Capacitor.isNativePlatform();

// the updater rolls back to the previous bundle unless the new one reports in
export function appReady() {
  if (native) CapacitorUpdater.notifyAppReady().catch(() => {});
}

export type Check =
  | { status: "update"; release: Release }
  | { status: "native"; release: Release }
  | { status: "current" }
  | { status: "unreachable" }
  | { status: "browser" };

async function nativeHash() {
  const v = (await App.getInfo()).version;
  return v.split(".").pop() ?? "";
}

export async function checkForUpdate(): Promise<Check> {
  if (!native) return { status: "browser" };
  try {
    // native http: the webview's origin can't fetch from github under CORS
    const r = await CapacitorHttp.get({ url: VERSION_URL, responseType: "json" });
    if (r.status !== 200) return { status: "unreachable" };
    const rel = (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as Release;
    if (!rel.version || rel.version === bundleVersion) return { status: "current" };
    // a bundle built for a different shell would boot into missing plugins; send them to the apk instead
    if (rel.native && rel.apk && rel.native !== (await nativeHash())) return { status: "native", release: rel };
    return { status: "update", release: rel };
  } catch {
    return { status: "unreachable" };
  }
}

// downloads the zip and switches to it; the page reloads, so nothing runs after this
export async function applyUpdate(rel: Release, onProgress: (pct: number) => void) {
  const sub = await CapacitorUpdater.addListener("download", (e) => onProgress(e.percent));
  try {
    // the updater refuses a download it can't verify
    const bundle = await CapacitorUpdater.download({ url: rel.url, version: rel.version, checksum: rel.checksum });
    await CapacitorUpdater.set({ id: bundle.id });
  } finally {
    sub.remove();
  }
}

// hands the apk to the system browser; android then offers to install it over this app
export function openApk(rel: Release) {
  window.open(rel.apk!, "_system");
}
