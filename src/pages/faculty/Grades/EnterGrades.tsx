import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { useNavigate } from "react-router-dom";

export default function EnterGrades() {
  const navigate = useNavigate();
  const user = authService.getSession();

  if (!user || user.role !== "faculty") {
    navigate("/login");
    return null;
  }

  return (
    <DashboardLayout>
      <div className="faculty-enter-grades">
        <h1>Enter Grades</h1>
        <p>This page is under construction.</p>
      </div>
    </DashboardLayout>
  );
}
