import { useNavigate } from "react-router-dom";
import {
  Activity,
  GraduationCap,
  Megaphone,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";

export default function QuickAccessMenu() {
  const navigate = useNavigate();

  const quickActions = [
    {
      id: "student-list",
      label: "Student List",
      description: "View and manage student records",
      icon: GraduationCap,
      route: "/admin/students/manage",
    },
    {
      id: "student-management",
      label: "Student Management",
      description: "Add, edit, or manage student profiles",
      icon: GraduationCap,
      route: "/admin/students/addeditdrop",
    },
    {
      id: "user-list",
      label: "User List",
      description: "View all system user accounts",
      icon: Users,
      route: "/admin/user/list",
    },
    {
      id: "create-user",
      label: "Create User",
      description: "Create a new system account",
      icon: UserPlus,
      route: "/admin/user/create",
    },
    {
      id: "user-activity",
      label: "User Activity",
      description: "Review recent system activity",
      icon: Activity,
      route: "/admin/user/activity",
    },
    {
      id: "user-roles",
      label: "User Roles",
      description: "Review account roles and access",
      icon: ShieldCheck,
      route: "/admin/user/roles",
    },
    {
      id: "announcements",
      label: "Announcements",
      description: "View and manage announcements",
      icon: Megaphone,
      route: "/admin/announcement/list",
    },
    {
      id: "create-announcement",
      label: "Create Announcement",
      description: "Publish a new announcement",
      icon: Megaphone,
      route: "/admin/announcement/create",
    },
  ];

  return (
    <div className="dashboard-card quick-access-card">
      <div className="card-header">
        <div>
          <h3>Quick Access</h3>

          <p className="card-subtitle">
            Open frequently used Admin management pages.
          </p>
        </div>
      </div>

      <div className="quick-actions-grid">
        {quickActions.map((action) => {
          const Icon = action.icon;

          return (
            <button
              key={action.id}
              type="button"
              className="quick-action-item"
              onClick={() => navigate(action.route)}
            >
              <span className="quick-action-icon">
                <Icon size={20} />
              </span>

              <span className="quick-action-content">
                <strong>{action.label}</strong>

                <small>
                  {action.description}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}