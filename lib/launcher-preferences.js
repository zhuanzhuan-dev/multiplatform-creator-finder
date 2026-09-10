export const LAUNCHER_ENABLED_KEY = 'draLauncherEnabled';
export const LAUNCHER_COMPACT_KEY = 'draLauncherCompact';
export function launcherSiteKey(hostname) {
  return `draLauncherBlocked:${hostname.toLowerCase()}`;
}
export function launcherPreferences(saved = {}, hostname = '') {
  return {
    enabled: saved[LAUNCHER_ENABLED_KEY] !== false,
    compact: saved[LAUNCHER_COMPACT_KEY] === true,
    siteBlocked: saved[launcherSiteKey(hostname)] === true
  };
}
export function launcherIsVisible(preferences, visitHidden = false) {
  return preferences.enabled && !preferences.siteBlocked && !visitHidden;
}
