import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { useNavigate } from "react-router-dom";

export default function Facultylist() {
  const navigate = useNavigate();
  const user = authService.getSession();

  if (!user || user.role !== "Program Head") {
    navigate("/login");
    return null;
  }

  return (
    <DashboardLayout>
      <div className="programhead-Faculty">
        <p>Announcement</p>
      </div>
    </DashboardLayout>
  );
}
