import { Routes, Route, Navigate } from "react-router-dom";
import type { UserRole } from "../services/auth.service";
import { authService } from "../services/auth.service";
import Home from "../pages/auth/Index";
import LoginAuth from "../pages/auth/Login";
import RegisterAuth from "../pages/auth/Register";
import OtpAuth from "../pages/auth/Otp";

// Student pages — existing
import StudentDashboard from "../pages/student/Dashboard";
import StudentProfile from "../pages/student/Profile";
import StudentSchedule from "../pages/student/AcademicRecord/Schedule";
import StudentRecord from "../pages/student/AcademicRecord/StudentRecord";

// Student pages — Academic Records
import StudentTranscript from "../pages/student/AcademicRecord/Transcript";
import StudentCourseHistory from "../pages/student/AcademicRecord/CourseHistory";

// Student pages — Course Management
import ViewSubjects from "../pages/student/CourseManagement/Viewsubjects";
import Assignments from "../pages/student/CourseManagement/Assignments";
import LectureNotes from "../pages/student/CourseManagement/LectureNotes";
import Syllabus from "../pages/student/CourseManagement/Syllabus";
import SubmitRequirements from "../pages/student/CourseManagement/Submission";

// Student pages — Enrollment
import EnrollmentCourses from "../pages/student/Enrollment/AvailableCourses";
import AddDropSubjects from "../pages/student/Enrollment/AddDrop";
import SubmitEnrollment from "../pages/student/Enrollment/SubmitEnrollment";
import EnrollmentStatus from "../pages/student/Enrollment/EnrollmentStatus";

// Student pages — Financial
import TuitionFees from "../pages/student/Financial/Tuitionfees";
import PaymentHistory from "../pages/student/Financial/PaymentHistory";
import BalanceInquiry from "../pages/student/Financial/Balance";
import OnlinePayment from "../pages/student/Financial/OnlinePayment";

// Faculty pages
import FacultyDashboard from "../pages/faculty/FacultyDashboard";
// ── add these imports ──
import FacultyProfile from "../pages/faculty/Profile";
import MyClasses from "../pages/faculty/Classes/MyClasses";
import ClassSchedule from "../pages/faculty/Classes/ClassSchedule";
import FacultyStudentList from "../pages/faculty/Classes/StudentList";
import FacultyLectureNotes from "../pages/faculty/Materials/LectureNotes";
import FacultySyllabus from "../pages/faculty/Materials/Syllabus";
import EnterGrades from "../pages/faculty/Grades/EnterGrades";
import GradeSummary from "../pages/faculty/Grades/GradeSummary";
import GradeHistory from "../pages/faculty/Grades/GradeHistory";
import TakeAttendance from "../pages/faculty/Attendance/Takeattendance";
import AttendanceRecords from "../pages/faculty/Attendance/AttendanceRecord";
import AttendanceReports from "../pages/faculty/Attendance/AttendanceReport";
import FacultyMessages from "../pages/faculty/Communication/Message";
import FacultyAnnouncements from "../pages/faculty/Communication/Announcement";
import SendNotice from "../pages/faculty/Communication/SendNotice";

// ── Admin: Student Management ──
import AdminDashboard from "../pages/admin/AdminDashboard";
import ManageStudentsNew from "../pages/admin/Students/ManageStudents";
import RecordsManagement from "../pages/admin/Students/Recordmanagement";
// ── Admin: Enrollment Management ──
import ApproveEnrollment from "../pages/admin/Enrollment/ApproveEnrollment";
import ClassScheduling from "../pages/admin/Enrollment/ClassScheduling";
// ── Admin: Financial Management ──
import FeesSetup from "../pages/admin/FinancialManagement/FeesSetup";
import PaymentMonitoring from "../pages/admin/FinancialManagement/PaymentMonitoring";
// ── Admin: System Management ──
import UserAccounts from "../pages/admin/System/UserAccounts";
import RolesPermissions from "../pages/admin/System/Rolespermissions";
import SystemSettings from "../pages/admin/System/SystemSettings";
// ── Admin: Reports ──
import StudentReports from "../pages/admin/Reports/StudentReport";
import FinancialReports from "../pages/admin/Reports/FinancialReport";
import UsageAnalytics from "../pages/admin/Reports/UsageAnalytics";

import type { ReactElement } from "react";

// ─── Role guard ───────────────────────────────────────────────

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
    const fallback: Record<UserRole, string> = {
      admin: "/admin/dashboard",
      faculty: "/faculty/dashboard",
      student: "/student/dashboard",
    };
    return <Navigate to={fallback[user.role]} replace />;
  }

  return children;
}

// Helper to reduce boilerplate for protected student routes
function StudentRoute({ element }: { element: ReactElement }) {
  return <ProtectedRoute allowedRole="student">{element}</ProtectedRoute>;
}
// ── add a FacultyRoute helper beside StudentRoute ──
function FacultyRoute({ element }: { element: ReactElement }) {
  return <ProtectedRoute allowedRole="faculty">{element}</ProtectedRoute>;
}
function AdminRoute({ element }: { element: ReactElement }) {
  return <ProtectedRoute allowedRole="admin">{element}</ProtectedRoute>;
}

// ─── Routes ───────────────────────────────────────────────────
export default function AppRoutes() {
  return (
    <Routes>
      {/* ── Public ── */}
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<LoginAuth />} />
      <Route path="/register" element={<RegisterAuth />} />
      <Route path="/otp" element={<OtpAuth />} />
      {/* ── Student: Solo links ── */}
      <Route
        path="/student/dashboard"
        element={<StudentRoute element={<StudentDashboard />} />}
      />
      <Route
        path="/student/profile"
        element={<StudentRoute element={<StudentProfile />} />}
      />
      {/* ── Student: Academic Records ── */}
      <Route
        path="/student/records"
        element={<StudentRoute element={<StudentRecord />} />}
      />
      <Route
        path="/student/transcript"
        element={<StudentRoute element={<StudentTranscript />} />}
      />
      <Route
        path="/student/course-history"
        element={<StudentRoute element={<StudentCourseHistory />} />}
      />
      <Route
        path="/student/schedule"
        element={<StudentRoute element={<StudentSchedule />} />}
      />
      {/* ── Student: Course Management ── */}
      <Route
        path="/student/courses/subjects"
        element={<StudentRoute element={<ViewSubjects />} />}
      />
      <Route
        path="/student/courses/assignments"
        element={<StudentRoute element={<Assignments />} />}
      />
      <Route
        path="/student/courses/notes"
        element={<StudentRoute element={<LectureNotes />} />}
      />
      <Route
        path="/student/courses/syllabus"
        element={<StudentRoute element={<Syllabus />} />}
      />
      <Route
        path="/student/courses/submissions"
        element={<StudentRoute element={<SubmitRequirements />} />}
      />
      {/* ── Student: Enrollment ── */}
      <Route
        path="/student/enrollment/courses"
        element={<StudentRoute element={<EnrollmentCourses />} />}
      />
      <Route
        path="/student/enrollment/add-drop"
        element={<StudentRoute element={<AddDropSubjects />} />}
      />
      <Route
        path="/student/enrollment/submit"
        element={<StudentRoute element={<SubmitEnrollment />} />}
      />
      <Route
        path="/student/enrollment/status"
        element={<StudentRoute element={<EnrollmentStatus />} />}
      />
      {/* ── Student: Financial ── */}
      <Route
        path="/student/financial/tuition"
        element={<StudentRoute element={<TuitionFees />} />}
      />
      <Route
        path="/student/financial/history"
        element={<StudentRoute element={<PaymentHistory />} />}
      />
      <Route
        path="/student/financial/balance"
        element={<StudentRoute element={<BalanceInquiry />} />}
      />
      <Route
        path="/student/financial/pay"
        element={<StudentRoute element={<OnlinePayment />} />}
      />
      {/* ── Faculty ── */}
      <Route
        path="/faculty/dashboard"
        element={
          <ProtectedRoute allowedRole="faculty">
            <FacultyDashboard />
          </ProtectedRoute>
        }
      />
      // ── replace the single faculty route block with these ──
      {/* ── Faculty: Solo links ── */}
      <Route
        path="/faculty/dashboard"
        element={<FacultyRoute element={<FacultyDashboard />} />}
      />
      <Route
        path="/faculty/profile"
        element={<FacultyRoute element={<FacultyProfile />} />}
      />
      {/* ── Faculty: Manage Classes ── */}
      <Route
        path="/faculty/classes"
        element={<FacultyRoute element={<MyClasses />} />}
      />
      <Route
        path="/faculty/classes/schedule"
        element={<FacultyRoute element={<ClassSchedule />} />}
      />
      <Route
        path="/faculty/classes/students"
        element={<FacultyRoute element={<FacultyStudentList />} />}
      />
      {/* ── Faculty: Upload Materials ── */}
      <Route
        path="/faculty/materials/notes"
        element={<FacultyRoute element={<FacultyLectureNotes />} />}
      />
      <Route
        path="/faculty/materials/syllabus"
        element={<FacultyRoute element={<FacultySyllabus />} />}
      />
      {/* ── Faculty: Post Grades ── */}
      <Route
        path="/faculty/grades/enter"
        element={<FacultyRoute element={<EnterGrades />} />}
      />
      <Route
        path="/faculty/grades/summary"
        element={<FacultyRoute element={<GradeSummary />} />}
      />
      <Route
        path="/faculty/grades/history"
        element={<FacultyRoute element={<GradeHistory />} />}
      />
      {/* ── Faculty: Attendance ── */}
      <Route
        path="/faculty/attendance/take"
        element={<FacultyRoute element={<TakeAttendance />} />}
      />
      <Route
        path="/faculty/attendance/records"
        element={<FacultyRoute element={<AttendanceRecords />} />}
      />
      <Route
        path="/faculty/attendance/reports"
        element={<FacultyRoute element={<AttendanceReports />} />}
      />
      {/* ── Faculty: Communication ── */}
      <Route
        path="/faculty/communication/messages"
        element={<FacultyRoute element={<FacultyMessages />} />}
      />
      <Route
        path="/faculty/communication/announcements"
        element={<FacultyRoute element={<FacultyAnnouncements />} />}
      />
      <Route
        path="/faculty/communication/send"
        element={<FacultyRoute element={<SendNotice />} />}
      />
      {/* ── Admin ── */}
      <Route
        path="/admin/dashboard"
        element={
          <ProtectedRoute allowedRole="admin">
            <AdminDashboard />
          </ProtectedRoute>
        }
      />
      {/* ── Admin: Student Management ── */}
      <Route
        path="/admin/students/manage"
        element={<AdminRoute element={<ManageStudentsNew />} />}
      />
      <Route
        path="/admin/students/records"
        element={<AdminRoute element={<RecordsManagement />} />}
      />
      {/* ── Admin: Enrollment Management ── */}
      <Route
        path="/admin/enrollment/approve"
        element={<AdminRoute element={<ApproveEnrollment />} />}
      />
      <Route
        path="/admin/enrollment/scheduling"
        element={<AdminRoute element={<ClassScheduling />} />}
      />
      {/* ── Admin: Financial Management ── */}
      <Route
        path="/admin/financial/fees"
        element={<AdminRoute element={<FeesSetup />} />}
      />
      <Route
        path="/admin/financial/payments"
        element={<AdminRoute element={<PaymentMonitoring />} />}
      />
      {/* ── Admin: System Management ── */}
      <Route
        path="/admin/system/accounts"
        element={<AdminRoute element={<UserAccounts />} />}
      />
      <Route
        path="/admin/system/roles"
        element={<AdminRoute element={<RolesPermissions />} />}
      />
      <Route
        path="/admin/system/settings"
        element={<AdminRoute element={<SystemSettings />} />}
      />
      {/* ── Admin: Reports & Analytics ── */}
      <Route
        path="/admin/reports/students"
        element={<AdminRoute element={<StudentReports />} />}
      />
      <Route
        path="/admin/reports/financial"
        element={<AdminRoute element={<FinancialReports />} />}
      />
      <Route
        path="/admin/reports/analytics"
        element={<AdminRoute element={<UsageAnalytics />} />}
      />
      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
