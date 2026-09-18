import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { useNavigate } from "react-router-dom";
import "../../../styles/userrole.css";
interface Role {
  id: number;
  name: string;
  description: string;
  users: number;
  permissions: string[];
  color: string;
}

export default function UserRoles() {
  const navigate = useNavigate();
  const user = authService.getSession();

  if (!user || user.role !== "Admin") {
    navigate("/login");
    return null;
  }

  const roles: Role[] = [
    {
      id: 1,
      name: "Admin",
      description:
        "Full access to system settings, users, reports, and configurations.",
      users: 2,
      permissions: [
        "Manage Users",
        "Manage Roles",
        "View Reports",
        "System Settings",
      ],
      color: "#4f46e5",
    },
    {
      id: 2,
      name: "Registrar",
      description:
        "Handles student records, enrollment, admission, and academic information.",
      users: 3,
      permissions: [
        "Manage Student Records",
        "Enrollment Processing",
        "Generate Reports",
      ],
      color: "#0d9488",
    },
    {
      id: 3,
      name: "Faculty",
      description:
        "Manages classes, grades, schedules, and student performance.",
      users: 25,
      permissions: ["View Students", "Submit Grades", "Manage Classes"],
      color: "#d97706",
    },
    {
      id: 4,
      name: "Program Head",
      description:
        "Supervises programs, faculty assignments, and academic reports.",
      users: 5,
      permissions: ["Approve Grades", "Manage Faculty", "View Program Reports"],
      color: "#7c3aed",
    },
    {
      id: 5,
      name: "Student",
      description:
        "Accesses academic records, enrollment, and student services.",
      users: 850,
      permissions: ["View Grades", "View Schedule", "Submit Requests"],
      color: "#64748b",
    },
  ];

  return (
    <DashboardLayout>
      <div className="user-role-container">
        <div className="role-header">
          <div>
            <h1>User Roles Management</h1>
            <p>Manage user permissions and access control in the portal.</p>
          </div>
        </div>

        <div className="roles-grid">
          {roles.map((role) => (
            <div
              className="role-card"
              key={role.id}
              style={{ "--role-color": role.color } as React.CSSProperties}
            >
              <div className="role-title">
                <div className="role-title-left">
                  <div className="role-avatar">{role.name.charAt(0)}</div>
                  <h2>{role.name}</h2>
                </div>

                <span>{role.users} Users</span>
              </div>

              <p className="role-description">{role.description}</p>

              <div className="permission-section">
                <h3>Permissions</h3>

                <ul>
                  {role.permissions.map((permission, index) => (
                    <li key={index}>{permission}</li>
                  ))}
                </ul>
              </div>

              <button className="edit-role-btn">Edit Permissions</button>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
