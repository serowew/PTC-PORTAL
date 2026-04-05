import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { useNavigate } from "react-router-dom";

export default function GradeHistory() {
  const navigate = useNavigate();
  const user = authService.getSession();

  if (!user || user.role !== "faculty") {
    navigate("/login");
    return null;
  }

  return (
    <DashboardLayout>
      <div className="faculty-grade-history">
        <h1>Grade History</h1>
        <p>This page is under construction.</p>
      </div>
    </DashboardLayout>
  );
}
