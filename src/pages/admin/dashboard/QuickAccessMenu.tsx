import { FileText, Users, Megaphone, Calendar } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function QuickAccessMenu() {
  const navigate = useNavigate();

  return (
    <div className="dashboard-card quick-access-card">
      <div className="card-header">
        <h3>Quick Access Menu</h3>
      </div>
      <div className="quick-actions-grid">
        <button type="button" onClick={() => navigate("/admin/Admissions")}> 
          <FileText size={20} />
          <span>Manage Admissions</span>
        </button>
        <button type="button" onClick={() => navigate("/admin/Students")}> 
          <Users size={20} />
          <span>Manage Students</span>
        </button>
        <button type="button" onClick={() => navigate("/admin/Announcements")}> 
          <Megaphone size={20} />
          <span>Announcements</span>
        </button>
        <button type="button" onClick={() => navigate("/admin/dashboard")}> 
          <Calendar size={20} />
          <span>Calendar / Events</span>
        </button>
      </div>
    </div>
  );
}
