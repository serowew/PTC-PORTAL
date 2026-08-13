import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { useNavigate } from "react-router-dom";

export default function SettingUser() {
  const navigate = useNavigate();
  const user = authService.getSession();

  if (!user || user.role !== "Student") {
    navigate("/login");
    return null;
  }

  return (
    <DashboardLayout>
      <div className="setting-user">
        <p>userere.</p>
      </div>
    </DashboardLayout>
  );
}
