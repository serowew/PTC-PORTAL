import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { useNavigate } from "react-router-dom";

export default function Assignments() {
  const navigate = useNavigate();
  const user = authService.getSession();

  if (!user || user.role !== "student") {
    navigate("/login");
    return null;
  }

  return (
    <DashboardLayout>
      <div className="assignments">
        <p>This is your assignments page.</p>
      </div>
    </DashboardLayout>
  );
}
