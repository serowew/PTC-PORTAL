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
      <style>{`
        .ptc-appearance-page { --ap-accent:#11633e; color:#182b21; width:100%; max-width:1020px; margin:0 auto; padding:24px 20px 40px; font-family:inherit; }
        .ptc-appearance-page *, .ptc-appearance-page *::before, .ptc-appearance-page *::after { box-sizing:border-box; }
        .ptc-appearance-page .ap-heading { display:flex; align-items:center; gap:12px; margin-bottom:20px; }
        .ptc-appearance-page .ap-heading-icon { background:#e4f4e8; border:1px solid #cde7d4; color:#11633e; padding:11px; border-radius:13px; flex-shrink:0; }
        .ptc-appearance-page h1 { font-size:clamp(23px, 3vw, 30px); line-height:1.2; margin:0 0 5px; color:#123b27; }
        .ptc-appearance-page .ap-subtitle, .ptc-appearance-page .ap-muted { color:#60746a; font-size:14px; }
        .ptc-appearance-page .ap-panel { background:#fff; border:1px solid #dfe8e1; border-radius:16px; padding:22px; margin-bottom:16px; box-shadow:0 6px 22px rgba(21,70,42,.045); }
        .ptc-appearance-page h2 { font-size:17px; color:#173829; margin:0 0 6px; }
        .ptc-appearance-page p { margin:0; }
        .ptc-appearance-page .ap-theme-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; margin-top:18px; }
        .ptc-appearance-page .ap-theme-card { appearance:none; width:100%; min-width:0; background:#fff; color:#173829; border:2px solid #e3eae4; padding:11px; border-radius:13px; text-align:left; cursor:pointer; font:inherit; }
        .ptc-appearance-page .ap-theme-card[aria-pressed='true'] { border-color:#137347; box-shadow:0 0 0 2px rgba(20,114,68,.09); }
        .ptc-appearance-page .ap-theme-preview { height:100px; border-radius:9px; display:flex; overflow:hidden; border:1px solid rgba(70,90,75,.11); margin-bottom:10px; }
        .ptc-appearance-page .ap-theme-sidebar { width:29%; padding:10px 7px; display:flex; flex-direction:column; gap:7px; }
        .ptc-appearance-page .ap-theme-line { display:block; height:6px; border-radius:10px; background:currentColor; opacity:.3; }
        .ptc-appearance-page .ap-theme-main { flex:1; padding:10px; display:flex; flex-direction:column; gap:9px; }
        .ptc-appearance-page .ap-theme-hero { height:26px; border-radius:6px; }
        .ptc-appearance-page .ap-theme-tiles { display:flex; gap:5px; }
        .ptc-appearance-page .ap-theme-tile { background:rgba(128,142,135,.16); border-radius:5px; flex:1; height:26px; }
        .ptc-appearance-page .ap-theme-label { display:flex; justify-content:space-between; align-items:center; gap:8px; }
        .ptc-appearance-page .ap-theme-name { font-weight:700; font-size:14px; }
        .ptc-appearance-page .ap-theme-description { display:block; font-size:12px; color:#62766a; margin-top:3px; }
        .ptc-appearance-page .ap-selected { display:inline-flex; align-items:center; gap:3px; background:#e4f5e9; color:#14673e; border-radius:99px; font-size:11px; padding:4px 7px; font-weight:700; }
        .ptc-appearance-page .ap-font-options { display:flex; flex-wrap:wrap; gap:9px; margin:16px 0; }
        .ptc-appearance-page .ap-choice { border:1px solid #d7e4db; background:#fff; color:#233b2c; border-radius:9px; padding:10px 14px; cursor:pointer; font:inherit; font-size:13px; font-weight:600; }
        .ptc-appearance-page .ap-choice[aria-pressed='true'] { color:#075c36; background:#e5f4e9; border-color:#107549; }
        .ptc-appearance-page .ap-font-preview { border:1px solid #e0e9e2; background:#f6faf7; border-radius:11px; padding:17px 19px; transition:padding .15s; }
        .ptc-appearance-page .ap-font-preview.ap-compact { padding:9px 12px; }
        .ptc-appearance-page .ap-preview-title { font-weight:750; margin-bottom:12px; }
        .ptc-appearance-page .ap-preview-body { margin-bottom:5px; }
        .ptc-appearance-page .ap-compact-label { display:flex; align-items:center; gap:11px; cursor:pointer; margin-top:15px; }
        .ptc-appearance-page .ap-compact-label input { width:18px; height:18px; accent-color:#147449; flex-shrink:0; }
        .ptc-appearance-page .ap-actions { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:14px; margin-top:20px; }
        .ptc-appearance-page .ap-action-group { display:flex; flex-wrap:wrap; gap:9px; }
        .ptc-appearance-page .ap-button { display:inline-flex; align-items:center; justify-content:center; gap:8px; border-radius:9px; padding:11px 15px; cursor:pointer; font:inherit; font-size:13px; font-weight:700; }
        .ptc-appearance-page .ap-button-primary { background:#11633e; border:1px solid #11633e; color:white; }
        .ptc-appearance-page .ap-button-primary:disabled { opacity:.5; cursor:not-allowed; }
        .ptc-appearance-page .ap-button-secondary { background:#fff; border:1px solid #ccdcd0; color:#245337; }
        .ptc-appearance-page .ap-message { color:#28633e; font-size:13px; }
        .ptc-appearance-page button:focus-visible, .ptc-appearance-page input:focus-visible { outline:3px solid #e2ab35; outline-offset:3px; }
        .ptc-appearance-page .ap-dialog-backdrop { position:fixed; inset:0; z-index:9999; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center; padding:20px; }
        .ptc-appearance-page .ap-dialog { background:#fff; border-radius:14px; padding:24px; width:min(100%,410px); box-shadow:0 18px 60px rgba(0,0,0,.24); }
        .ptc-appearance-page .ap-dialog p { color:#5b6b60; margin:10px 0 20px; line-height:1.5; }
        @media(max-width:640px) { .ptc-appearance-page { padding:16px 12px 28px; } .ptc-appearance-page .ap-panel { padding:15px; } .ptc-appearance-page .ap-theme-grid { gap:9px; } .ptc-appearance-page .ap-theme-preview { height:75px; } .ptc-appearance-page .ap-theme-main { padding:6px; } .ptc-appearance-page .ap-theme-sidebar { padding:7px 4px; } }
      `}</style>

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
