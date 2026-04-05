import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { useNavigate } from "react-router-dom";

export default function OnlinePayment() {
  const navigate = useNavigate();
  const user = authService.getSession();

  if (!user || user.role !== "student") {
    navigate("/login");
    return null;
  }

  return (
    <DashboardLayout>
      <div className="online-payment">
        <p>This is your online payment page.</p>
      </div>
    </DashboardLayout>
  );
}
