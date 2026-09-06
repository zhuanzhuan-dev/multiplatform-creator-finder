import { useState, useSyncExternalStore } from "react";
import { readTheme, saveTheme, subscribeTheme, type ThemePreference } from "./theme";

export function ThemePicker() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const change = async (value: ThemePreference) => {
    setSaving(true);
    setError("");
    try { await saveTheme(value); }
    catch { setError("主题保存失败，请重试"); }
    finally { setSaving(false); }
  };

  return (
    <section className="appearance-settings" aria-label="外观设置">
      <label htmlFor="themePreference">外观主题</label>
      <select id="themePreference" value={theme} disabled={saving} onChange={event => void change(event.target.value as ThemePreference)}>
        <option value="system">跟随系统</option>
        <option value="light">浅色（白色）</option>
        <option value="dark">深色（黑色）</option>
      </select>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
