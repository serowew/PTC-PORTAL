import DashboardLayout from "../../components/Layout/DashboardLayout";
import { authService } from "../../services/auth.service";
import { useNavigate } from "react-router-dom";
import "../styles/student-dashboard.css";
import {
  CheckCircle,
  Clock,
  BookOpen,
  Megaphone,
  Calendar,
  FileText,
  User,
  Award
} from "lucide-react";

export default function StudentDashboard() {
  const navigate = useNavigate();
  const user = authService.getSession();

  if (!user || user.role !== "student") {
    navigate("/login");
    return null;
  }

  return (
    <DashboardLayout>
      <div className="student-dashboard">
        <div className="dashboard-header">
          <div className="header-content">
            <div>
              <h1>Welcome, {user.username}!</h1>
              <p>Student Portal - View your schedule, grades, announcements, and admission status</p>
            </div>
            <div className="header-stats">
              <div className="header-stat">
                <Award size={20} />
                <span>GPA: 3.85</span>
              </div>
              <div className="header-stat">
                <BookOpen size={20} />
                <span>45 Credits</span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Info Cards */}
        <div className="info-grid">
          <div className="info-card success">
            <div className="info-icon">
              <CheckCircle size={28} />
            </div>
            <div className="info-content">
              <h3>Admission Status</h3>
              <p className="info-status">Approved</p>
              <small>Confirmed on March 15, 2026</small>
            </div>
          </div>

          <div className="info-card warning">
            <div className="info-icon">
              <Clock size={28} />
            </div>
            <div className="info-content">
              <h3>Entrance Exam</h3>
              <p className="info-status">Scheduled</p>
              <small>March 25, 2026 at 10:00 AM</small>
            </div>
          </div>

          <div className="info-card info">
            <div className="info-icon">
              <Award size={28} />
            </div>
            <div className="info-content">
              <h3>GPA</h3>
              <p className="info-status">3.85</p>
              <small>Current Semester</small>
            </div>
          </div>

          <div className="info-card primary">
            <div className="info-icon">
              <Megaphone size={28} />
            </div>
            <div className="info-content">
              <h3>New Announcements</h3>
              <p className="info-status">5</p>
              <small>Unread messages</small>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="dashboard-section">
          <h2>Quick Access</h2>
          <div className="action-grid">
            <button
              className="quick-action primary"
              onClick={() => navigate("/student/schedule")}
            >
              <Calendar size={24} />
              <span className="action-label">View Schedule</span>
            </button>

            <button
              className="quick-action secondary"
              onClick={() => navigate("/student/records")}
            >
              <FileText size={24} />
              <span className="action-label">View Grades</span>
            </button>

            <button
              className="quick-action accent"
              onClick={() => navigate("/student/announcements")}
            >
              <Megaphone size={24} />
              <span className="action-label">Announcements</span>
            </button>

            <button
              className="quick-action info"
              onClick={() => navigate("/student/profile")}
            >
              <User size={24} />
              <span className="action-label">My Profile</span>
            </button>
          </div>
        </div>

        {/* Today's Schedule */}
        <div className="dashboard-section">
          <h2>Today's Schedule</h2>
          <div className="schedule-list">
            <div className="schedule-item">
              <div className="time">09:00 AM</div>
              <div className="schedule-details">
                <h4>Mathematics (Algebra)</h4>
                <p>Room 201 | Building A</p>
              </div>
              <div className="duration">2 hours</div>
            </div>

            <div className="schedule-item">
              <div className="time">11:30 AM</div>
              <div className="schedule-details">
                <h4>Filipino</h4>
                <p>Room 305 | Building B</p>
              </div>
              <div className="duration">1.5 hours</div>
            </div>

            <div className="schedule-item">
              <div className="time">01:00 PM</div>
              <div className="schedule-details">
                <h4>English Literature</h4>
                <p>Room 102 | Building A</p>
              </div>
              <div className="duration">2 hours</div>
            </div>
          </div>
        </div>

        {/* Recent Announcements */}
        <div className="dashboard-section">
          <h2>Recent Announcements</h2>
          <div className="announcements-list">
            <div className="announcement-item">
              <div className="announcement-date">Mar 21</div>
              <div className="announcement-content">
                <h4>Midterm Examination Schedule Released</h4>
                <p>Check the academic portal for the complete midterm exam schedule for this semester.</p>
              </div>
            </div>

            <div className="announcement-item">
              <div className="announcement-date">Mar 19</div>
              <div className="announcement-content">
                <h4>Library Extended Hours</h4>
                <p>The library will be open until 10:00 PM on weekdays during exam season.</p>
              </div>
            </div>

            <div className="announcement-item">
              <div className="announcement-date">Mar 17</div>
              <div className="announcement-content">
                <h4>Student Services Office Closed</h4>
                <p>The Student Services office will be closed on March 24 for maintenance.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Academic Information */}
        <div className="dashboard-section">
          <h2>Academic Information</h2>
          <div className="info-boxes">
            <div className="info-box">
              <h3>Current Semester</h3>
              <p className="value">2nd Semester, 2025-2026</p>
            </div>
            <div className="info-box">
              <h3>Total Credits</h3>
              <p className="value">45 Units</p>
            </div>
            <div className="info-box">
              <h3>Status</h3>
              <p className="value active">Active</p>
            </div>
            <div className="info-box">
              <h3>Tuition Fee</h3>
              <p className="value success">Paid</p>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
