import { useCallback, useMemo, useState } from "react";import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { authService } from "../../services/auth.service";
import logo from "../../assets/ptclogo.jpg";
import { studentNavGroups, studentSoloLinks } from "../../config/studentNav";
import { adminNavGroups, adminSoloLinks } from "../../config/adminNav";
import { facultyNavGroups, facultySoloLinks } from "../../config/facultyNav";
import "../../styles/sidebar.css";

/* ────────────────────────────────────────────────────────────────────────
 * Types
 *
 * NavChild/NavGroup/SoloLink match exactly what studentNav.ts, facultyNav.ts
 * and adminNav.ts already export — those three files do NOT need to change.
 * The only difference from before is that NavChild now optionally accepts
 * its own `children`, so if you ever want a folder nested inside a folder
 * (e.g. Courses -> BSIT -> 1st Year -> First Semester), you can just add a
 * `children` array to that child in the config file and it'll work, no
 * limit on how deep.
 * ──────────────────────────────────────────────────────────────────────── */

interface NavChild {
  id?: string;
  label: string;
  icon?: string | ReactNode;
  path?: string;
  badge?: number;
  children?: NavChild[];
}

interface NavGroup {
  id: string;
  label: string;
  icon: string | ReactNode;
  badge?: number;
  children: NavChild[];
}

interface SoloLink {
  label: string;
  path: string;
  badge?: number;
  icon: string | ReactNode;
}

/** Normalized shape the sidebar actually renders from, after merging
 * soloLinks + groups into one recursive tree. Every node has a guaranteed
 * `id`, even if the config file didn't provide one. */
interface NavItem {
  id: string;
  label: string;
  icon?: string | ReactNode;
  path?: string;
  badge?: number;
  children?: NavItem[];
}

interface SidebarProps {
  groups?: NavGroup[];
  soloLinks?: SoloLink[];
}

/* ────────────────────────────────────────────────────────────────────────
 * Small helpers
 * ──────────────────────────────────────────────────────────────────────── */

function ChevronIcon({
  className = "",
  size = 16,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      className={`chevron ${className}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6 2L12 8L6 14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function getNavByRole(role: string) {
  switch (role) {
    case "student":
      return { groups: studentNavGroups, soloLinks: studentSoloLinks };
    case "faculty":
      return { groups: facultyNavGroups, soloLinks: facultySoloLinks };
    case "admin":
      return { groups: adminNavGroups, soloLinks: adminSoloLinks };
    default:
      return { groups: [], soloLinks: [] };
  }
}

/** Recursively assigns a stable id to a config child and its descendants,
 * so config files never have to supply ids by hand. */
function normalizeNode(node: NavChild, parentId: string, index: number): NavItem {
  const id = node.id ?? node.path ?? `${parentId}-${index}`;
  return {
    id,
    label: node.label,
    icon: node.icon,
    path: node.path,
    badge: node.badge,
    children: node.children?.map((child, i) => normalizeNode(child, id, i)),
  };
}

/** Merges soloLinks + groups (the existing config shape) into a single
 * recursive NavItem[] tree — solo links first, then groups, matching the
 * order they render in today. */
function buildNavTree(soloLinks: SoloLink[], groups: NavGroup[]): NavItem[] {
  const soloItems: NavItem[] = soloLinks.map((link) => ({
    id: link.path,
    label: link.label,
    icon: link.icon,
    path: link.path,
    badge: link.badge,
  }));

  const groupItems: NavItem[] = groups.map((group) => ({
    id: group.id,
    label: group.label,
    icon: group.icon,
    badge: group.badge,
    children: group.children.map((child, i) => normalizeNode(child, group.id, i)),
  }));

  return [...soloItems, ...groupItems];
}

/** Recursively finds the chain of folders leading to the page whose `path`
 * the current URL starts with. Used to auto-open the right folders when the
 * user lands on a page directly (refresh, deep link, browser back/forward)
 * instead of only reacting to clicks. */
function findOpenChain(
  items: NavItem[],
  pathname: string,
  trail: NavItem[] = [],
): NavItem[] | null {
  for (const item of items) {
    const nextTrail = [...trail, item];
    if (item.children && item.children.length > 0) {
      const found = findOpenChain(item.children, pathname, nextTrail);
      if (found) return found;
    } else if (item.path && pathname.startsWith(item.path)) {
      return nextTrail;
    }
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────
 * NavLevel — renders one "screen" of the drill-down sidebar
 *
 * Only the currently selected folder at this level (plus the siblings
 * before it) stay visible; its children render directly underneath. This
 * is what replaces the old accordion. Depth 0 keeps the original
 * solo-link/group-btn look; deeper levels reuse .nav-item so styling stays
 * consistent with what you already have, no matter how deep the tree goes.
 * ──────────────────────────────────────────────────────────────────────── */

interface NavLevelProps {
  items: NavItem[];
  activePath: NavItem[];
  levelIndex: number;
  isActive: (path?: string) => boolean;
  onToggleFolder: (levelIndex: number, item?: NavItem) => void;
  onNavigatePage: (item: NavItem) => void;
}

function NavLevel({
  items,
  activePath,
  levelIndex,
  isActive,
  onToggleFolder,
  onNavigatePage,
}: NavLevelProps) {
  const selectedId = activePath[levelIndex]?.id;
  const selectedIndex = selectedId ? items.findIndex((i) => i.id === selectedId) : -1;

  // Root level (levelIndex 0) always shows every item — Dashboard, Student
  // Management, Financial Management, etc. are independent top-level
  // entries, not part of whatever group is open, so opening one of them
  // shouldn't hide the rest. Nested levels still truncate as before.
  const visibleItems =
    levelIndex === 0 || selectedIndex === -1 ? items : items.slice(0, selectedIndex + 1);

  return (
    <>
      {visibleItems.map((item, index) => {
        const isFolder = !!item.children && item.children.length > 0;
        const isOpen = index === selectedIndex;
        const badge =
          typeof item.badge === "number" && item.badge > 0 ? (
            <span className="badge">{item.badge}</span>
          ) : null;

        // ── Top level: original solo-link / group-btn look ──
        if (levelIndex === 0) {
          if (!isFolder) {
            return (
              <button
                key={item.id}
                className={`solo-link ${isActive(item.path) ? "active" : ""}`}
                onClick={() => onNavigatePage(item)}
              >
                <span className="icon">{item.icon}</span>
                <span className="label">{item.label}</span>
                {badge}
              </button>
            );
          }

          return (
            <div key={item.id} className="nav-group">
              <button
                className={`group-btn ${isOpen ? "open" : ""}`}
                onClick={() => onToggleFolder(levelIndex, isOpen ? undefined : item)}
                aria-expanded={isOpen}
              >
                <span className="icon">{item.icon}</span>
                <span className="label">{item.label}</span>
                {badge}
                <ChevronIcon className={isOpen ? "rotated" : ""} />
              </button>

              {isOpen && item.children && (
                <div className="sub-items open">
                  <NavLevel
                    items={item.children}
                    activePath={activePath}
                    levelIndex={levelIndex + 1}
                    isActive={isActive}
                    onToggleFolder={onToggleFolder}
                    onNavigatePage={onNavigatePage}
                  />
                </div>
              )}
            </div>
          );
        }

        // ── Nested levels: reuse .nav-item, indent a bit more per depth ──
        const depthPadding = 40 + (levelIndex - 1) * 16;
        const style = {
          paddingLeft: isActive(item.path) ? depthPadding - 3 : depthPadding,
        };

        if (!isFolder) {
          return (
            <button
              key={item.id}
              className={`nav-item ${isActive(item.path) ? "active" : ""}`}
              style={style}
              onClick={() => onNavigatePage(item)}
            >
              <span className="dot" />
              {item.label}
              {badge}
            </button>
          );
        }

        return (
          <div key={item.id} className="nav-group">
            <button
              className={`nav-item ${isOpen ? "folder-open" : ""}`}
              style={style}
              onClick={() => onToggleFolder(levelIndex, isOpen ? undefined : item)}
              aria-expanded={isOpen}
            >
              {item.label}
              {badge}
              <ChevronIcon className={isOpen ? "rotated" : ""} size={13} />
            </button>

            {isOpen && item.children && (
              <div className="sub-items open">
                <NavLevel
                  items={item.children}
                  activePath={activePath}
                  levelIndex={levelIndex + 1}
                  isActive={isActive}
                  onToggleFolder={onToggleFolder}
                  onNavigatePage={onNavigatePage}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Sidebar
 * ──────────────────────────────────────────────────────────────────────── */

export default function Sidebars({ groups, soloLinks }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = authService.getSession();

  // ✅ Derive nav before hooks — safe with optional chaining if user is null
  const roleNav = getNavByRole(user?.role ?? "");
  const navGroups = groups ?? roleNav.groups;
  const navSoloLinks = soloLinks ?? roleNav.soloLinks;

  const navItems = useMemo(
    () => buildNavTree(navSoloLinks, navGroups),
    [navSoloLinks, navGroups],
  );

  // Replaces the old `const [openGroup, setOpenGroup] = useState<string | null>(...)`.
  // activePath is the stack of currently-selected FOLDERS (never pages),
  // root to deepest.
const [activePath, setActivePath] = useState<NavItem[]>(() => {
  const chain = findOpenChain(navItems, location.pathname);
  return chain ? chain.slice(0, -1) : [];
});

// Tracks the pathname activePath was last synced to. Adjusting state
// directly during render (React's supported pattern for state derived
// from a changed prop) instead of in an effect avoids the extra
// commit-then-re-render pass the linter is flagging.
const [syncedPathname, setSyncedPathname] = useState(location.pathname);
if (location.pathname !== syncedPathname) {
  setSyncedPathname(location.pathname);
  const chain = findOpenChain(navItems, location.pathname);
  if (chain) setActivePath(chain.slice(0, -1));
}

const handleToggleFolder = useCallback((levelIndex: number, item?: NavItem) => {
  setActivePath((prev) =>
    item ? [...prev.slice(0, levelIndex), item] : prev.slice(0, levelIndex),
  );
}, []);

const handleNavigatePage = useCallback(
  (item: NavItem) => {
    if (item.path) navigate(item.path);
  },
  [navigate],
);

// ✅ Early return AFTER all hooks
if (!user) return null;

function isActive(path?: string) {
  return !!path && location.pathname.startsWith(path);
}

  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <img src={logo} alt="PTC Logo" />
          <h3>PTC Portal</h3>
        </div>
      </div>

      <div className="sidebar-content">
        <NavLevel
          items={navItems}
          activePath={activePath}
          levelIndex={0}
          isActive={isActive}
          onToggleFolder={handleToggleFolder}
          onNavigatePage={handleNavigatePage}
        />
      </div>
    </nav>
  );
}