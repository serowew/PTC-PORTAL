import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  BadgeCheck,
  BookMarked,
  BookOpenCheck,
  Building2,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  FilePlus2,
  FileText,
  GraduationCap,
  History,
  Layers3,
  LayoutDashboard,
  Library,
  Menu,
  Megaphone,
  School,
  ShieldCheck,
  UserCircle,
  UserRoundPlus,
  UsersRound,
  X,
} from "lucide-react";

import { authService } from "../../services/auth.service";
import logo from "../../assets/ptclogo.jpg";
import { studentNavGroups, studentSoloLinks } from "../../config/studentNav";
import { adminNavGroups, adminSoloLinks } from "../../config/adminNav";
import { facultyNavGroups, facultySoloLinks } from "../../config/facultyNav";
import {
  registrarNavGroups,
  registrarSoloLinks,
} from "../../config/registrarNav";
import {
  programHeadNavGroups,
  programHeadSoloLinks,
} from "../../config/progheadNav";
import "../../styles/sidebar.css";

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

function getNavByRole(role: string) {
  switch (role) {
    case "Student":
      return { groups: studentNavGroups, soloLinks: studentSoloLinks };
    case "Faculty":
      return { groups: facultyNavGroups, soloLinks: facultySoloLinks };
    case "Admin":
      return { groups: adminNavGroups, soloLinks: adminSoloLinks };
    case "Registrar":
      return { groups: registrarNavGroups, soloLinks: registrarSoloLinks };
    case "Program Head":
      return {
        groups: programHeadNavGroups,
        soloLinks: programHeadSoloLinks,
      };
    default:
      return { groups: [], soloLinks: [] };
  }
}

function normalizeNode(
  node: NavChild,
  parentId: string,
  index: number,
): NavItem {
  const id = node.id ?? node.path ?? `${parentId}-${index}`;

  return {
    id,
    label: node.label,
    icon: node.icon,
    path: node.path,
    badge: node.badge,
    children: node.children?.map((child, childIndex) =>
      normalizeNode(child, id, childIndex),
    ),
  };
}

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
    children: group.children.map((child, index) =>
      normalizeNode(child, group.id, index),
    ),
  }));

  return [...soloItems, ...groupItems];
}

function normalizeRoutePath(pathname: string) {
  if (!pathname) return "/";

  const normalized = pathname.replace(/\/+$/, "");
  return normalized || "/";
}

function routeMatches(
  pathname: string,
  itemPath: string,
  exactMatch: boolean,
) {
  const currentPath = normalizeRoutePath(pathname);
  const targetPath = normalizeRoutePath(itemPath);

  if (exactMatch) {
    return currentPath === targetPath;
  }

  return currentPath.startsWith(targetPath);
}

function findOpenChain(
  items: NavItem[],
  pathname: string,
  exactMatch = false,
  trail: NavItem[] = [],
): NavItem[] | null {
  for (const item of items) {
    const nextTrail = [...trail, item];

    if (item.children && item.children.length > 0) {
      const found = findOpenChain(
        item.children,
        pathname,
        exactMatch,
        nextTrail,
      );
      if (found) return found;
    } else if (
      item.path &&
      routeMatches(pathname, item.path, exactMatch)
    ) {
      return nextTrail;
    }
  }

  return null;
}

function getRoleMeta(role: string) {
  switch (role) {
    case "Admin":
      return {
        shortLabel: "Admin",
        description: "System Administration",
        icon: <ShieldCheck size={15} strokeWidth={2.2} />,
      };
    case "Registrar":
      return {
        shortLabel: "Registrar",
        description: "Academic Records",
        icon: <BookOpenCheck size={15} strokeWidth={2.2} />,
      };
    case "Program Head":
      return {
        shortLabel: "Program Head",
        description: "Academic Oversight",
        icon: <BadgeCheck size={15} strokeWidth={2.2} />,
      };
    case "Faculty":
      return {
        shortLabel: "Faculty",
        description: "Teaching Workspace",
        icon: <School size={15} strokeWidth={2.2} />,
      };
    case "Student":
      return {
        shortLabel: "Student",
        description: "Student Portal",
        icon: <GraduationCap size={15} strokeWidth={2.2} />,
      };
    default:
      return {
        shortLabel: role || "Portal User",
        description: "PTC Portal",
        icon: <UserCircle size={15} strokeWidth={2.2} />,
      };
  }
}

function getFallbackIcon(item: NavItem) {
  const key = `${item.id} ${item.label} ${item.path ?? ""}`.toLowerCase();

  if (key.includes("dashboard")) return <LayoutDashboard size={18} />;
  if (key.includes("announcement")) return <Megaphone size={18} />;
  if (key.includes("user activity")) return <Activity size={18} />;
  if (key.includes("user role")) return <ShieldCheck size={18} />;
  if (key.includes("user list")) return <UsersRound size={18} />;
  if (key.includes("student management")) return <UserRoundPlus size={18} />;
  if (key.includes("student list") || key.includes("students"))
    return <UsersRound size={18} />;
  if (key.includes("profile")) return <UserCircle size={18} />;

  if (key.includes("enrollment period")) return <CalendarClock size={18} />;
  if (key.includes("class offering")) return <Layers3 size={18} />;
  if (key.includes("enrollment")) return <ClipboardCheck size={18} />;

  if (key.includes("curriculum")) return <BookOpenCheck size={18} />;
  if (key.includes("department")) return <Building2 size={18} />;
  if (key.includes("subject")) return <BookMarked size={18} />;
  if (key.includes("course")) return <Library size={18} />;
  if (key.includes("academic")) return <GraduationCap size={18} />;

  if (key.includes("grade approval")) return <BadgeCheck size={18} />;
  if (key.includes("grade history")) return <History size={18} />;
  if (key.includes("grade")) return <ClipboardList size={18} />;

  if (key.includes("schedule")) return <CalendarDays size={18} />;
  if (key.includes("class")) return <School size={18} />;

  if (key.includes("request document")) return <FilePlus2 size={18} />;
  if (key.includes("document release")) return <FileCheck2 size={18} />;
  if (key.includes("document")) return <FileText size={18} />;

  return <ChevronRight size={18} />;
}

function NavIcon({ item }: { item: NavItem }) {
  if (item.icon && typeof item.icon !== "string") {
    return <>{item.icon}</>;
  }

  return getFallbackIcon(item);
}

function getUserInitial(username?: string) {
  const value = username?.trim();
  return value ? value.charAt(0).toUpperCase() : "P";
}

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
  const selectedIndex = selectedId
    ? items.findIndex((item) => item.id === selectedId)
    : -1;

  const visibleItems =
    levelIndex === 0 || selectedIndex === -1
      ? items
      : items.slice(0, selectedIndex + 1);

  return (
    <>
      {visibleItems.map((item, index) => {
        const isFolder = Boolean(item.children?.length);
        const isOpen = index === selectedIndex;
        const itemIsActive = isActive(item.path);
        const badge =
          typeof item.badge === "number" && item.badge > 0 ? (
            <span className="sidebar-nav__badge">{item.badge}</span>
          ) : null;

        if (levelIndex === 0) {
          if (!isFolder) {
            return (
              <button
                key={item.id}
                type="button"
                className={`sidebar-nav__item sidebar-nav__item--root sidebar-nav__item--link ${
                  itemIsActive ? "is-active" : ""
                }`}
                onClick={() => onNavigatePage(item)}
                aria-current={itemIsActive ? "page" : undefined}
              >
                <span className="sidebar-nav__icon">
                  <NavIcon item={item} />
                </span>
                <span className="sidebar-nav__label">{item.label}</span>
                {badge}
              </button>
            );
          }

          return (
            <div key={item.id} className="sidebar-nav__group">
              <button
                type="button"
                className={`sidebar-nav__item sidebar-nav__item--root sidebar-nav__item--folder ${
                  isOpen ? "is-open" : ""
                }`}
                onClick={() =>
                  onToggleFolder(levelIndex, isOpen ? undefined : item)
                }
                aria-expanded={isOpen}
              >
                <span className="sidebar-nav__icon">
                  <NavIcon item={item} />
                </span>
                <span className="sidebar-nav__label">{item.label}</span>
                {badge}
                <ChevronRight
                  className="sidebar-nav__chevron"
                  size={16}
                  strokeWidth={2.2}
                />
              </button>

              {isOpen && item.children && (
                <div className="sidebar-nav__children">
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

        const depth = Math.max(1, levelIndex);

        if (!isFolder) {
          return (
            <button
              key={item.id}
              type="button"
              className={`sidebar-nav__item sidebar-nav__item--nested ${
                itemIsActive ? "is-active" : ""
              }`}
              style={{ "--nav-depth": depth } as CSSProperties}
              onClick={() => onNavigatePage(item)}
              aria-current={itemIsActive ? "page" : undefined}
            >
              <span className="sidebar-nav__nested-icon">
                <NavIcon item={item} />
              </span>
              <span className="sidebar-nav__label">{item.label}</span>
              {badge}
            </button>
          );
        }

        return (
          <div key={item.id} className="sidebar-nav__group">
            <button
              type="button"
              className={`sidebar-nav__item sidebar-nav__item--nested sidebar-nav__item--folder ${
                isOpen ? "is-open" : ""
              }`}
              style={{ "--nav-depth": depth } as CSSProperties}
              onClick={() =>
                onToggleFolder(levelIndex, isOpen ? undefined : item)
              }
              aria-expanded={isOpen}
            >
              <span className="sidebar-nav__nested-icon">
                <NavIcon item={item} />
              </span>
              <span className="sidebar-nav__label">{item.label}</span>
              {badge}
              <ChevronRight
                className="sidebar-nav__chevron"
                size={14}
                strokeWidth={2.2}
              />
            </button>

            {isOpen && item.children && (
              <div className="sidebar-nav__children">
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

export default function Sidebars({ groups, soloLinks }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = authService.getSession();

  const roleNav = getNavByRole(user?.role ?? "");
  const navGroups = groups ?? roleNav.groups;
  const navSoloLinks = soloLinks ?? roleNav.soloLinks;

  const navItems = useMemo(
    () => buildNavTree(navSoloLinks, navGroups),
    [navSoloLinks, navGroups],
  );

  const facultyUsesExactActiveRoute = user?.role === "Faculty";

  const [activePath, setActivePath] = useState<NavItem[]>(() => {
    const chain = findOpenChain(
      navItems,
      location.pathname,
      facultyUsesExactActiveRoute,
    );
    return chain ? chain.slice(0, -1) : [];
  });

  const [mobileOpen, setMobileOpen] = useState(false);
  const [syncedPathname, setSyncedPathname] = useState(location.pathname);

  if (location.pathname !== syncedPathname) {
    setSyncedPathname(location.pathname);
    const chain = findOpenChain(
      navItems,
      location.pathname,
      facultyUsesExactActiveRoute,
    );
    if (chain) setActivePath(chain.slice(0, -1));
  }

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [mobileOpen]);

  const handleToggleFolder = useCallback(
    (levelIndex: number, item?: NavItem) => {
      setActivePath((previous) =>
        item
          ? [...previous.slice(0, levelIndex), item]
          : previous.slice(0, levelIndex),
      );
    },
    [],
  );

  const handleNavigatePage = useCallback(
    (item: NavItem) => {
      if (!item.path) return;
      navigate(item.path);
      setMobileOpen(false);
    },
    [navigate],
  );

  if (!user) return null;

  const roleMeta = getRoleMeta(user.role);

  function isActive(path?: string) {
    if (!path) return false;

    return routeMatches(
      location.pathname,
      path,
      facultyUsesExactActiveRoute,
    );
  }

  return (
    <>
      <button
        type="button"
        className="sidebar-mobile-toggle"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={mobileOpen}
      >
        <Menu size={20} strokeWidth={2.2} />
      </button>

      <button
        type="button"
        className={`sidebar-overlay ${mobileOpen ? "is-visible" : ""}`}
        onClick={() => setMobileOpen(false)}
        aria-label="Close navigation menu"
        tabIndex={mobileOpen ? 0 : -1}
      />

      <nav
        className={`sidebar ${mobileOpen ? "sidebar--mobile-open" : ""}`}
        aria-label={`${roleMeta.shortLabel} navigation`}
      >
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="sidebar-logo-mark">
              <img src={logo} alt="PTC Logo" />
            </div>

            <div className="sidebar-brand-copy">
              <strong>PTC Portal</strong>
              <span>Academic Management System</span>
            </div>

            <button
              type="button"
              className="sidebar-mobile-close"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation menu"
            >
              <X size={18} strokeWidth={2.2} />
            </button>
          </div>

          <div className="sidebar-role-card">
            <span className="sidebar-role-card__icon">{roleMeta.icon}</span>
            <span className="sidebar-role-card__copy">
              <strong>{roleMeta.shortLabel}</strong>
              <small>{roleMeta.description}</small>
            </span>
          </div>
        </div>

        <div className="sidebar-content">
          <div className="sidebar-section-label">
            <span>Workspace</span>
            <span className="sidebar-section-label__line" />
          </div>

          <div className="sidebar-nav">
            <NavLevel
              items={navItems}
              activePath={activePath}
              levelIndex={0}
              isActive={isActive}
              onToggleFolder={handleToggleFolder}
              onNavigatePage={handleNavigatePage}
            />
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="sidebar-user__avatar">
              {getUserInitial(user.username)}
            </span>
            <span className="sidebar-user__copy">
              <strong>{user.username || "PTC User"}</strong>
              <small>{user.role}</small>
            </span>
            <span className="sidebar-user__status" title="Signed in" />
          </div>
        </div>
      </nav>
    </>
  );
}
