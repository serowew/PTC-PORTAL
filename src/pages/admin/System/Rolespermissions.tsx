import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { useNavigate } from "react-router-dom";

export default function RolesPermissions() {
  const navigate = useNavigate();
  const user = authService.getSession();

  if (!user || user.role !== "admin") {
    navigate("/login");
    return null;
  }

  return (
    <DashboardLayout>
      <div className="admin-roles-permissions">
        <h1>Roles & Permissions</h1>
        <p>This page is under construction.</p>
      </div>
    </DashboardLayout>
  );
}
