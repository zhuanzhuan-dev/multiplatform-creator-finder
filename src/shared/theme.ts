import "./theme.css";

export type ThemePreference = "system" | "light" | "dark";
const THEME_KEY = "draTheme";
const listeners = new Set<() => void>();
let preference: ThemePreference = "system";
let revision = 0;

function apply(value: unknown) {
  preference = value === "light" || value === "dark" ? value : "system";
  document.documentElement.dataset.theme = preference;
  listeners.forEach(listener => listener());
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && THEME_KEY in changes) {
    revision += 1;
    apply(changes[THEME_KEY].newValue);
  }
});

// Render with the stored preference. An absent preference follows the OS via CSS.
export const themeReady = chrome.storage.local.get(THEME_KEY).then(saved => {
  if (!revision) apply(saved[THEME_KEY]);
}).catch(() => { if (!revision) apply("system"); });

export const readTheme = () => preference;
export const subscribeTheme = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export async function saveTheme(value: ThemePreference) {
  const before = revision;
  await chrome.storage.local.set({ [THEME_KEY]: value });
  if (revision === before) apply(value);
}
