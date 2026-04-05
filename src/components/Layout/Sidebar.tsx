import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { authService } from "../../services/auth.service";
import logo from "../../assets/ptclogo.jpg";
import { studentNavGroups, studentSoloLinks } from "../../config/studentNav";
import { adminNavGroups, adminSoloLinks } from "../../config/adminNav";
import { facultyNavGroups, facultySoloLinks } from "../../config/facultyNav";
import "../../styles/sidebar.css";

interface NavGroup {
  id: string;
  label: string;
  icon: string | React.ReactNode;
  badge?: number;
  children: { label: string; path: string; badge?: number }[];
}

interface SidebarProps {
  groups?: NavGroup[];
  soloLinks?: {
    label: string;
    path: string;
    badge?: number;
    icon: string | React.ReactNode;
  }[];
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`chevron ${className}`}
      width="16"
      height="16"
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

export default function Sidebars({ groups, soloLinks }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = authService.getSession();

  // ✅ Derive nav before hooks — safe with optional chaining if user is null
  const roleNav = getNavByRole(user?.role ?? "");
  const navGroups = groups ?? roleNav.groups;
  const navSoloLinks = soloLinks ?? roleNav.soloLinks;

  // ✅ ALL hooks must be called before any early return
  const [openGroup, setOpenGroup] = useState<string | null>(() => {
    return (
      navGroups.find((g) =>
        g.children.some((c) => location.pathname.startsWith(c.path)),
      )?.id ?? null
    );
  });

  // ✅ Early return AFTER all hooks
  if (!user) return null;

  function toggle(id: string) {
    setOpenGroup((prev) => (prev === id ? null : id));
  }

  function isActive(path: string) {
    return location.pathname.startsWith(path);
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
        {/* ── Solo links (Dashboard, Profile, etc.) ── */}
        {navSoloLinks.map((link) => (
          <button
            key={link.path}
            className={`solo-link ${isActive(link.path) ? "active" : ""}`}
            onClick={() => navigate(link.path)}
          >
            <span className="icon">{link.icon}</span>
            <span className="label">{link.label}</span>
          </button>
        ))}

        {/* ── Collapsible nav groups ── */}
        {navGroups.map((group) => (
          <div key={group.id} className="nav-group">
            <button
              className={`group-btn ${openGroup === group.id ? "open" : ""}`}
              onClick={() => toggle(group.id)}
            >
              <span className="icon">{group.icon}</span>
              <span className="label">{group.label}</span>
              <ChevronIcon
                className={openGroup === group.id ? "rotated" : ""}
              />
            </button>

            <div
              className={`sub-items ${openGroup === group.id ? "open" : ""}`}
            >
              {group.children.map((child) => (
                <button
                  key={child.path}
                  className={`nav-item ${isActive(child.path) ? "active" : ""}`}
                  onClick={() => navigate(child.path)}
                >
                  <span className="dot" />
                  {child.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}
