import { Routes, Route, Navigate } from "react-router-dom";
import type { UserRole } from "../services/auth.service";
import { authService } from "../services/auth.service";
import Home from "../pages/auth/Index";
import LoginAuth from "../pages/auth/Login";
import RegisterAuth from "../pages/auth/Register";
import OtpAuth from "../pages/auth/Otp";
// Student pages
import StudentDashboard from "../pages/student/Dashboard";
import StudentProfile from "../pages/student/Profile";
import StudentSchedule from "../pages/student/Schedule";
import StudentAdmission from "../pages/student/Admission";
import StudentAnnouncement from "../pages/student/Announcement";
import StudentRecord from "../pages/student/StudentRecord";
// Faculty pages
import FacultyDashboard from "../pages/faculty/FacultyDashboard";
// Admin pages
import AdminDashboard from "../pages/admin/AdminDashboard";
import ManageAdmissions from "../pages/admin/ManageAdmissions";
import ManageStudents from "../pages/admin/ManageStudents";
import ManageAnnouncements from "../pages/admin/ManageAnnouncement";
import type { ReactElement } from "react";

// ─── Role guard ───────────────────────────────────────────────
// Wraps any route that requires a specific role.
// If the user is not logged in  → redirect to /login
// If the user has the wrong role → redirect to their own dashboard
function ProtectedRoute({
  children,
  allowedRole,
}: {
  children: ReactElement;
  allowedRole: UserRole;
}) {
  const user = authService.getSession();

  if (!user) return <Navigate to="/login" replace />;

  if (user.role !== allowedRole) {
    // Send each role back to their own home instead of a blank page
    const fallback: Record<UserRole, string> = {
      admin: "/admin/dashboard",
      faculty: "/faculty/dashboard",
      student: "/student/dashboard",
    };
    return <Navigate to={fallback[user.role]} replace />;
  }

  return children;
}

// ─── Routes ───────────────────────────────────────────────────
export default function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<LoginAuth />} />
      <Route path="/register" element={<RegisterAuth />} />
      <Route path="/otp" element={<OtpAuth />} />

      {/* Student — only role === "student" may enter */}
      <Route
        path="/student/dashboard"
        element={
          <ProtectedRoute allowedRole="student">
            <StudentDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/profile"
        element={
          <ProtectedRoute allowedRole="student">
            <StudentProfile />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/schedule"
        element={
          <ProtectedRoute allowedRole="student">
            <StudentSchedule />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/admission"
        element={
          <ProtectedRoute allowedRole="student">
            <StudentAdmission />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/announcements"
        element={
          <ProtectedRoute allowedRole="student">
            <StudentAnnouncement />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/records"
        element={
          <ProtectedRoute allowedRole="student">
            <StudentRecord />
          </ProtectedRoute>
        }
      />

      {/* Faculty — only role === "faculty" may enter */}
      <Route
        path="/faculty/dashboard"
        element={
          <ProtectedRoute allowedRole="faculty">
            <FacultyDashboard />
          </ProtectedRoute>
        }
      />

      {/* Admin — only role === "admin" may enter */}
      <Route
        path="/admin/dashboard"
        element={
          <ProtectedRoute allowedRole="admin">
            <AdminDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/Admissions"
        element={
          <ProtectedRoute allowedRole="admin">
            <ManageAdmissions />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/Students"
        element={
          <ProtectedRoute allowedRole="admin">
            <ManageStudents />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/Announcements"
        element={
          <ProtectedRoute allowedRole="admin">
            <ManageAnnouncements />
          </ProtectedRoute>
        }
      />

      {/* Catch-all → home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
