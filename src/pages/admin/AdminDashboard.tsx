import DashboardLayout from "../../components/Layout/DashboardLayout";
import { authService } from "../../services/auth.service";
import { useNavigate } from "react-router-dom";
import "../styles/dashboard.css";
import {
  Users,
  FileText,
  Calendar,
  Megaphone,
  UserCheck,
  CheckCircle
} from "lucide-react";
import Notifications from "./dashboard/Notifications";
import DashboardAnnouncements from "./dashboard/Announcements";
import QuickAccessMenu from "./dashboard/QuickAccessMenu";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const user = authService.getSession();

  if (!user || user.role !== "admin") {
    navigate("/login");
    return null;
  }

  return (
    <DashboardLayout>
      <div className="admin-dashboard">
        <div className="dashboard-header">
          <div className="header-content">
            <div>
              <h1>Admin Control Panel</h1>
              <p>Manage admissions, students, exams, and system activities</p>
            </div>
            <div className="header-stats">
              <div className="header-stat">
                <Users size={20} />
                <span>1,245 Students</span>
              </div>
              <div className="header-stat">
                <FileText size={20} />
                <span>245 Applications</span>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">
              <FileText size={32} />
            </div>
            <div className="stat-content">
              <h3>Total Admissions</h3>
              <p className="stat-number">245</p>
              <div className="stat-breakdown">
                <span className="stat-approved">200 Approved</span>
                <span className="stat-pending">12 Pending</span>
                <span className="stat-rejected">33 Rejected</span>
              </div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon">
              <Users size={32} />
            </div>
            <div className="stat-content">
              <h3>Total Students</h3>
              <p className="stat-number">1,250</p>
              <div className="stat-breakdown">
                <span className="stat-active">1,200 Active</span>
                <span className="stat-inactive">50 Inactive</span>
              </div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon">
              <Calendar size={32} />
            </div>
            <div className="stat-content">
              <h3>Exams Scheduled</h3>
              <p className="stat-number">8</p>
              <div className="stat-breakdown">
                <span className="stat-upcoming">3 Upcoming</span>
                <span className="stat-ongoing">1 Ongoing</span>
                <span className="stat-completed">4 Completed</span>
              </div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon">
              <Megaphone size={32} />
            </div>
            <div className="stat-content">
              <h3>Announcements</h3>
              <p className="stat-number">34</p>
              <div className="stat-breakdown">
                <span className="stat-active">12 Active</span>
                <span className="stat-month">8 This Month</span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Access Menu */}
        <QuickAccessMenu />

        {/* Notifications & Announcements */}
        <div className="dashboard-section split-section">
          <Notifications />
          <DashboardAnnouncements />
        </div>

        {/* Recent Activity */}
        <div className="dashboard-section">
          <h2>Recent Activity</h2>
          <div className="activity-timeline">
            <div className="activity-item">
              <div className="activity-icon success">
                <CheckCircle size={20} />
              </div>
              <div className="activity-content">
                <p><strong>3 new admissions approved</strong></p>
                <small>2 hours ago • Automated approval system</small>
              </div>
            </div>

            <div className="activity-item">
              <div className="activity-icon info">
                <Calendar size={20} />
              </div>
              <div className="activity-content">
                <p><strong>Entrance Exam scheduled</strong> for March 25, 2026</p>
                <small>4 hours ago • Mathematics Department</small>
              </div>
            </div>

            <div className="activity-item">
              <div className="activity-icon warning">
                <Megaphone size={20} />
              </div>
              <div className="activity-content">
                <p><strong>Announcement posted:</strong> "Semester Break Extended"</p>
                <small>1 day ago • Administration</small>
              </div>
            </div>

            <div className="activity-item">
              <div className="activity-icon primary">
                <UserCheck size={20} />
              </div>
              <div className="activity-content">
                <p><strong>15 new students registered</strong> in the portal</p>
                <small>2 days ago • Registration system</small>
              </div>
            </div>
          </div>
        </div>

        {/* System Overview */}
        <div className="dashboard-section">
          <h2>System Overview</h2>
          <div className="overview-grid">
            <div className="overview-card">
              <div className="overview-icon">
                <FileText size={32} />
              </div>
              <h3>Admission Process</h3>
              <p>Streamlined online application system with automated document verification and status tracking.</p>
              <div className="overview-metrics">
                <span>245 Applications</span>
                <span>95% Approval Rate</span>
              </div>
            </div>

            <div className="overview-card">
              <div className="overview-icon">
                <Calendar size={32} />
              </div>
              <h3>Entrance Examination</h3>
              <p>Comprehensive testing system with real-time monitoring and instant result generation.</p>
              <div className="overview-metrics">
                <span>8 Active Exams</span>
                <span>1,200+ Test Takers</span>
              </div>
            </div>

            <div className="overview-card">
              <div className="overview-icon">
                <Calendar size={32} />
              </div>
              <h3>Scheduling System</h3>
              <p>Intelligent scheduling platform for exams, classes, and events with conflict detection.</p>
              <div className="overview-metrics">
                <span>50+ Events</span>
                <span>Auto-conflict Resolution</span>
              </div>
            </div>

            <div className="overview-card">
              <div className="overview-icon">
                <Users size={32} />
              </div>
              <h3>Student Portal</h3>
              <p>Complete student information system with grade tracking, announcements, and academic records.</p>
              <div className="overview-metrics">
                <span>1,250 Active Users</span>
                <span>24/7 Access</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
