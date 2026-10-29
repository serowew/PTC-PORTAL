import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import Footer from "./Footer";
import Sidebars from "./Sidebar";
import { authService } from "../../services/auth.service";

type Props = { children: ReactNode };
type Theme = "ptc-green" | "dark";
type FontSize = "small" | "default" | "large" | "extra-large";
type Appearance = { theme: Theme; fontSize: FontSize; compactMode: boolean };

const DEFAULT_APPEARANCE: Appearance = {
  theme: "ptc-green",
  fontSize: "default",
  compactMode: false,
};

function readAppearance(): Appearance {
  const userId = authService.getSession()?.user_id;
  if (userId == null) return { ...DEFAULT_APPEARANCE };

  try {
    const raw = localStorage.getItem(`ptc-appearance-user-${userId}`);
    if (!raw) return { ...DEFAULT_APPEARANCE };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_APPEARANCE };
    }
    const preferences = parsed as Record<string, unknown>;
    return {
      // Previously saved Ocean Blue and Lavender are treated as Light Mode.
      theme: preferences.theme === "dark" ? "dark" : "ptc-green",
      fontSize:
        preferences.fontSize === "small" ||
        preferences.fontSize === "large" ||
        preferences.fontSize === "extra-large"
          ? preferences.fontSize
          : "default",
      compactMode: preferences.compactMode === true,
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export default function DashboardLayout({ children }: Props) {
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);

  // Keep the document backdrop stable across route unmounts.
  // Restoring an old light color in effect cleanup caused a brief flash
  // between authenticated pages while the shared layout was remounting.
  useLayoutEffect(() => {
    const background = appearance.theme === "dark" ? "#111719" : "";
    document.documentElement.style.backgroundColor = background;
    document.body.style.backgroundColor = background;
    const root = document.getElementById("root");
    if (root) root.style.backgroundColor = background;
    // Intentionally no cleanup: the next layout/theme selection overwrites
    // this value. Cleaning up on every route unmount exposed the light body.
  }, [appearance.theme]);

  useEffect(() => {
    const refreshAppearance = () => setAppearance(readAppearance());
    window.addEventListener("storage", refreshAppearance);
    window.addEventListener("ptc-appearance-updated", refreshAppearance);
    window.addEventListener("focus", refreshAppearance);
    return () => {
      window.removeEventListener("storage", refreshAppearance);
      window.removeEventListener("ptc-appearance-updated", refreshAppearance);
      window.removeEventListener("focus", refreshAppearance);
    };
  }, []);

  const darkBackdrop = appearance.theme === "dark" ? "#111719" : undefined;

  return (
    <div
      className="dashboard-wrapper"
      style={{ backgroundColor: darkBackdrop }}
      data-ptc-sidebar-theme={appearance.theme}
      data-ptc-font-size={appearance.fontSize}
      data-ptc-compact={appearance.compactMode ? "true" : "false"}
    >
      <style>{`
        /* Only dark styling is added to the shared sidebar.
           Light Mode uses the original project CSS without overrides. */
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .sidebar {
          --sb-green-950:#0d3427; --sb-green-900:#0d4931;
          --sb-green-850:#125c3c; --sb-green-800:#156c46;
          --sb-green-700:#1c8655; --sb-green-600:#22a06b;
          --sb-green-500:#39bd81; --sb-green-100:#203e33;
          --sb-green-50:#1a3129;
          --sb-text-950:#f3f6f4; --sb-text-800:#e1e9e4;
          --sb-text-700:#c5d2ca; --sb-text-600:#b2c3b8;
          --sb-text-500:#a6b9ac;
          --sb-border:#34443c; --sb-border-strong:#45564b;
          background: linear-gradient(180deg, #0f1312 0%, #141a18 42%, #101513 100%);
          border-right-color:#2a3730; color:#f3f6f4;
          box-shadow: inset -1px 0 0 rgba(81, 110, 94, 0.32);
        }
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .sidebar-header {
          background: radial-gradient(circle at 100% 0%, rgba(23, 116, 67, 0.34), transparent 34%), linear-gradient(145deg, #0a2a1e 0%, #0f4c31 62%, #12683f 100%);
        }
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .sidebar-content,
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .sidebar-footer {
          background: radial-gradient(circle at 20% 74%, rgba(20, 120, 72, 0.12), transparent 28%), linear-gradient(180deg, rgba(18, 23, 21, 0.98), rgba(17, 22, 20, 0.98)); color:#f3f6f4;
        }
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .sidebar-nav__item--root:not(.is-active):not(.is-open),
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .sidebar-nav__item--nested:not(.is-active):not(.is-open) {
          color:#e1e9e4;
        }
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .sidebar-nav__item--root.is-open,
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .sidebar-nav__item--nested.is-open {
          color:#f3f6f4; background:#263c30; border-color:#3e5547;
        }
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .sidebar-user {
          background: linear-gradient(180deg, #1a2320 0%, #1c2723 100%); color:#f3f6f4; border-color:#3f5147;
          box-shadow: inset 0 0 0 1px rgba(57, 189, 129, 0.08);
        }
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .sidebar-nav__item--root.is-active,
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .sidebar-nav__item--nested.is-active {
          color: #ffffff;
          background: linear-gradient(90deg, #1b8e56 0%, #1f9f5e 100%);
          border-color: #48c985;
          box-shadow: 0 8px 20px rgba(18, 97, 58, 0.32);
        }
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .sidebar-nav__item-icon {
          color: inherit;
        }
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .dashboard-content {
          background: radial-gradient(circle at 12% 18%, rgba(23, 109, 66, 0.10), transparent 24%), #151a18;
        }


        /* One consistent charcoal sidebar across all roles in Dark Mode.
           No font sizing, geometry, or navigation behavior changes. */
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .sidebar {
          background: #101518 !important;
          background-image: none !important;
          border-right-color: #29363b !important;
          color: #eaf1ed;
        }
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .sidebar-content,
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .sidebar-footer {
          background: #101518 !important;
          background-image: none !important;
          color: #eaf1ed;
        }
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .sidebar-user {
          background: #1e2a28 !important;
          border-color: #40534b !important;
          color: #f0f5f2;
        }

        /* Route-transition backdrop. The shared shell never paints white
           while Dark Mode is active; page-specific rules can layer above it. */
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"],
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .dashboard-main,
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .dashboard-content {
          background-color: #111719;
        }

        /* Keep font-size and compact-mode variables in the page content.
           Sidebar and Footer are deliberately excluded. */
        .dashboard-wrapper .dashboard-content {
          --ptc-font-scale: 1;
          --ptc-compact-scale: 1;
        }
        .dashboard-wrapper[data-ptc-font-size="small"] .dashboard-content {
          --ptc-font-scale: .9;
        }
        .dashboard-wrapper[data-ptc-font-size="large"] .dashboard-content {
          --ptc-font-scale: 1.14;
        }
        .dashboard-wrapper[data-ptc-font-size="extra-large"] .dashboard-content {
          --ptc-font-scale: 1.28;
        }
        .dashboard-wrapper[data-ptc-compact="true"] .dashboard-content {
          --ptc-compact-scale: .8;
        }
        /* Dark canvas tokens for page-level CSS to consume gradually. */
        .dashboard-wrapper[data-ptc-sidebar-theme="dark"] .dashboard-content {
          background-color: #171c1a;
          color: #e9eee9;
          color-scheme: dark;
          --ptc-accent: #39bd81;
          --ptc-accent-dark: #125c3c;
          --ptc-page-bg: #171c1a;
          --ptc-surface: #222b26;
          --ptc-text: #e9eee9;
          --ptc-border: #38463c;
        }
      `}</style>
      <Sidebars />
      <div className="dashboard-main" style={{ backgroundColor: darkBackdrop }}>
        <div className="dashboard-content" style={{ backgroundColor: darkBackdrop }}>
          {children}
        </div>
        <Footer />
      </div>
    </div>
  );
}
