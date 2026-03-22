import { NavLink } from "react-router-dom";
import { authService } from "../../services/auth.service";
import logo from "../../assets/ptclogo.jpg";

const studentLinks = [
  { label: " Dashboard", path: "/student/dashboard" },
  { label: " My Admission", path: "/student/admission" },
  { label: " Announcements", path: "/student/announcements" },
  { label: " My Records", path: "/student/records" },
  { label: " Schedule", path: "/student/schedule" },
  { label: " Profile", path: "/student/profile" },
];

const adminLinks = [
  { label: " Dashboard", path: "/admin/dashboard" },
  { label: " Admissions", path: "/admin/Admissions" },
  { label: " Students", path: "/admin/Students" },
  { label: " Announcements", path: "/admin/Announcements" },
];

export default function Sidebars() {
  const user = authService.getSession();
  const links = user?.role === "admin" ? adminLinks : studentLinks;

  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <img src={logo} alt="PTC Logo" />
        <h3>PTC</h3>
      </div>
      <nav className="sidebar-nav">
        {links.map((link) => (
          <NavLink
            key={link.path}
            to={link.path}
            className={({ isActive }) =>
              isActive ? "sidebar-link active" : "sidebar-link"
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
