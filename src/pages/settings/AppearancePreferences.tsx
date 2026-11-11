import "../../styles/AppearancePreferences.css";
import { useState } from "react";
import { Check, RotateCcw, Save, Settings2 } from "lucide-react";
import { authService } from "../../services/auth.service";

type Theme = "ptc-green" | "dark";
type FontSize = "small" | "default" | "large" | "extra-large";

type AppearanceSettings = {
  theme: Theme;
  fontSize: FontSize;
  compactMode: boolean;
};

const DEFAULT_SETTINGS: AppearanceSettings = {
  theme: "ptc-green",
  fontSize: "default",
  compactMode: false,
};

const THEMES: { id: Theme; label: string; description: string; accent: string; surface: string; background: string; dark?: boolean }[] = [
  { id: "ptc-green", label: "Light Mode", description: "Original PTC Portal design", accent: "#11633e", surface: "#ffffff", background: "#e9f4ec" },
  { id: "dark", label: "Dark Mode", description: "Dark surfaces with PTC green accents", accent: "#188451", surface: "#242b2e", background: "#151c1e", dark: true },
];

const FONT_OPTIONS: { id: FontSize; label: string; px: number }[] = [
  { id: "small", label: "Small", px: 13 },
  { id: "default", label: "Default", px: 15 },
  { id: "large", label: "Large", px: 17 },
  { id: "extra-large", label: "Extra Large", px: 19 },
];

function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme.id === value);
}

function isFontSize(value: unknown): value is FontSize {
  return FONT_OPTIONS.some((option) => option.id === value);
}

function readSettings(key: string): AppearanceSettings {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_SETTINGS };
    const value = parsed as Partial<AppearanceSettings>;
    return {
      theme: isTheme(value.theme) ? value.theme : DEFAULT_SETTINGS.theme,
      fontSize: isFontSize(value.fontSize) ? value.fontSize : DEFAULT_SETTINGS.fontSize,
      compactMode: typeof value.compactMode === "boolean" ? value.compactMode : DEFAULT_SETTINGS.compactMode,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export default function AppearancePreferences() {
  const session = authService.getSession();
  const storageKey = `ptc-appearance-user-${session?.user_id ?? "guest"}`;
  const [settings, setSettings] = useState<AppearanceSettings>(() => readSettings(storageKey));
  const [savedSettings, setSavedSettings] = useState<AppearanceSettings>(() => readSettings(storageKey));
  const [message, setMessage] = useState("");
  const [resetOpen, setResetOpen] = useState(false);

  const selectedFont = FONT_OPTIONS.find((font) => font.id === settings.fontSize) ?? FONT_OPTIONS[1];
  const hasChanges = JSON.stringify(settings) !== JSON.stringify(savedSettings);

  function updateSettings(next: AppearanceSettings) {
    setSettings(next);
    setMessage("");
  }

  function saveSettings() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings));
      window.dispatchEvent(new Event("ptc-appearance-updated"));
      setSavedSettings({ ...settings });
      setMessage("Preferences saved for this account on this browser.");
    } catch {
      setMessage("Unable to save preferences. Check your browser storage settings.");
    }
  }

  function resetSettings() {
    updateSettings({ ...DEFAULT_SETTINGS });
    setResetOpen(false);
    setMessage("Default settings selected. Select Save Preferences to keep them.");
  }

  return (
    <main className="ptc-appearance-page">


      <header className="ap-heading">
        <div className="ap-heading-icon"><Settings2 size={25} aria-hidden="true" /></div>
        <div>
          <h1>Appearance &amp; Preferences</h1>
          <p className="ap-subtitle">Personalize how the PTC Portal looks and feels.</p>
        </div>
      </header>

      <section className="ap-panel" aria-labelledby="ap-themes-title">
        <h2 id="ap-themes-title">Theme</h2>
        <p className="ap-muted">Choose Light Mode or Dark Mode.</p>
        <div className="ap-theme-grid">
          {THEMES.map((theme) => (
            <button key={theme.id} type="button" className="ap-theme-card" aria-pressed={settings.theme === theme.id} onClick={() => updateSettings({ ...settings, theme: theme.id })}>
              <div className="ap-theme-preview" style={{ background: theme.background }} aria-hidden="true">
                <div className="ap-theme-sidebar" style={{ background: theme.accent, color: "#fff" }}>
                  <span className="ap-theme-line" style={{ width: "72%", opacity: .8 }} />
                  <span className="ap-theme-line" style={{ width: "95%" }} />
                  <span className="ap-theme-line" style={{ width: "78%" }} />
                  <span className="ap-theme-line" style={{ width: "85%" }} />
                </div>
                <div className="ap-theme-main" style={{ background: theme.background }}>
                  <div className="ap-theme-hero" style={{ background: theme.accent }} />
                  <div className="ap-theme-tiles">
                    <div className="ap-theme-tile" style={{ background: theme.surface }} />
                    <div className="ap-theme-tile" style={{ background: theme.surface }} />
                    <div className="ap-theme-tile" style={{ background: theme.surface }} />
                  </div>
                </div>
              </div>
              <div className="ap-theme-label">
                <span className="ap-theme-name">{theme.label}</span>
                {settings.theme === theme.id && <span className="ap-selected"><Check size={12} /> Selected</span>}
              </div>
              <span className="ap-theme-description">{theme.description}</span>
            </button>
          ))}
        </div>
        <p className="ap-muted" style={{ marginTop: 12 }}>Light Mode keeps the original PTC design. Dark Mode support across all pages is being completed one page at a time.</p>
      </section>

      <section className="ap-panel" aria-labelledby="ap-font-title">
        <h2 id="ap-font-title">Font Size</h2>
        <p className="ap-muted">Choose a comfortable text size.</p>
        <div className="ap-font-options" role="group" aria-label="Font size">
          {FONT_OPTIONS.map((option) => (
            <button key={option.id} className="ap-choice" type="button" aria-pressed={settings.fontSize === option.id} onClick={() => updateSettings({ ...settings, fontSize: option.id })}>{option.label}</button>
          ))}
        </div>
        <div className={`ap-font-preview${settings.compactMode ? " ap-compact" : ""}`} style={{ fontSize: selectedFont.px }} aria-live="polite">
          <p className="ap-preview-title">Student Information</p>
          <p className="ap-preview-body">Welcome to PTC Portal</p>
          <p>Your selected font size is {selectedFont.label}.</p>
        </div>
        <p className="ap-muted" style={{ marginTop: 11 }}>This preview updates immediately. Portal-wide font sizing will be enabled in a later step.</p>
      </section>

      <section className="ap-panel" aria-labelledby="ap-compact-title">
        <h2 id="ap-compact-title">Compact Mode</h2>
        <label className="ap-compact-label">
          <input type="checkbox" checked={settings.compactMode} onChange={(event) => updateSettings({ ...settings, compactMode: event.target.checked })} />
          <span>Reduce spacing in the settings preview</span>
        </label>
        <p className="ap-muted" style={{ marginTop: 10 }}>Portal-wide spacing adjustments will be connected after checking each page's layout.</p>
      </section>

      <div className="ap-actions">
        <div className="ap-action-group">
          <button type="button" className="ap-button ap-button-secondary" onClick={() => setResetOpen(true)}><RotateCcw size={16} /> Reset Appearance</button>
          <button type="button" className="ap-button ap-button-primary" onClick={saveSettings} disabled={!hasChanges}><Save size={16} /> Save Preferences</button>
        </div>
        <span className="ap-message" role="status">{message || (hasChanges ? "You have unsaved changes." : "Preferences are saved.")}</span>
      </div>

      {resetOpen && (
        <div className="ap-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setResetOpen(false); }}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="ap-reset-title" aria-describedby="ap-reset-description" className="ap-dialog" onKeyDown={(event) => { if (event.key === "Escape") setResetOpen(false); }}>
            <h2 id="ap-reset-title">Reset appearance?</h2>
            <p id="ap-reset-description">This will select Light Mode, Default font size, and turn off Compact Mode. Save Preferences afterward to keep the reset.</p>
            <div className="ap-action-group" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="ap-button ap-button-secondary" autoFocus onClick={() => setResetOpen(false)}>Cancel</button>
              <button type="button" className="ap-button ap-button-primary" onClick={resetSettings}>Reset</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
