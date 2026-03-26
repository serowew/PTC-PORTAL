import { NavLink } from "react-router-dom";
import { authService } from "../../services/auth.service";
import logo from "../../assets/ptclogo.jpg";

const studentLinks = [
  { label: "Dashboard", path: "/student/dashboard" },
  { label: "My Admission", path: "/student/admission" },
  { label: "Announcements", path: "/student/announcements" },
  { label: "My Records", path: "/student/records" },
  { label: "Schedule", path: "/student/schedule" },
  { label: "Profile", path: "/student/profile" },
];

const facultyLinks = [
  { label: "Dashboard", path: "/faculty/dashboard" },
  // add more faculty links here as you build them out
];

const adminLinks = [

  { label: " Dashboard", path: "/admin/dashboard" },
  { label: " Admissions", path: "/admin/Admissions" },
  { label: " Students", path: "/admin/Students" },
  { label: " Announcements", path: "/admin/Announcements" },

  { label: "Dashboard", path: "/admin/dashboard" },
  { label: "Admissions", path: "/admin/Admissions" },
  { label: "Students", path: "/admin/Students" },
  { label: "Announcements", path: "/admin/Announcements" },

];

// Map every role to the right link list
const linksByRole = {
  student: studentLinks,
  faculty: facultyLinks,
  admin: adminLinks,
};

export default function Sidebars() {
  const user = authService.getSession();

  // If somehow there is no session, render nothing
  if (!user) return null;

  const links = linksByRole[user.role] ?? [];

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
