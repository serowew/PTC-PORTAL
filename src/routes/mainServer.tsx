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
import ManageStudentsNew from "../pages/admin/Students/StudentLists";
import AddEditDrop from "../pages/admin/Students/AddEditDrop";
import CreateStudent from "../pages/admin/Students/createstudent";
import EditStudent from "../pages/admin/Students/editstudent";
import Sprofile from "../pages/admin/Students/Sprofile";
import StudentsForSetup from "../pages/admin/Students/StudentsForSetup";
import ManageStudentSetup from "../pages/admin/Students/ManageStudentSetup";

// ── Admin: Enrollment Management ──

import EnrollmentRequests from "../pages/admin/Enrollment/EnrollmentRequests";
import EnrollmentHistory from "../pages/admin/Enrollment/EnrollmentHistory";
import EnrollmentAnalytics from "../pages/admin/Enrollment/EnrollmentAnalytics";
import PendingRequests from "../pages/admin/Enrollment/PendingRequests";
import EnrolledStudents from "../pages/admin/Enrollment/EnrolledStudents";

// ── Admin: Financial Management ──
import Payment from "../pages/admin/FinancialManagement/Payments";
import Billing from "../pages/admin/FinancialManagement/Billings";
import Scholarship from "../pages/admin/FinancialManagement/Scholarship";
import FinancialReport from "../pages/admin/FinancialManagement/FinancialReport";
// ── Admin: System Management ──
import BackupManagement from "../pages/admin/System/BackupManagement";
import AcademicSetting from "../pages/admin/System/AcademicSetting";
import GeneralSettings from "../pages/admin/System/GeneralSetting";
import SecuritySetting from "../pages/admin/System/SecuritySetting";
import EmailSetting from "../pages/admin/System/EmailSetting";
// ── Admin: Reports ──
import DashboardReport from "../pages/admin/Reports/DashboardReport";
import ExportReports from "../pages/admin/Reports/ExportReport";
import AuditlogReport from "../pages/admin/Reports/AuditlogReport";
import UsageAnalytics from "../pages/admin/Reports/UsageAnalytics";
// ── Admin: USER ──
import UserList from "../pages/admin/UserManagement/Userlist";
import CreateUser from "../pages/admin/UserManagement/CreateUser";
import UserActivity from "../pages/admin/UserManagement/UserActivity";
import UserRoles from "../pages/admin/UserManagement/UserRoles";
import EditUser from "../pages/admin/UserManagement/EditUser";

import ProgramHeadDashboard from "../pages/programhead/dashboard/Dashboard";
import RegistrarDashboard from "../pages/registrar/Dashboard";

import type { ReactElement } from "react";
import PendingGrades from "../pages/programhead/GradeApproval/PendingGrades";
import RStudentRecord from "../pages/registrar/GradeApproval/Studentrecord";

// ── Registar: Enrollment ──
import ModifyEnrollment from "../pages/registrar/Enrollment/ModifyEnrollment";
import MyRequests from "../pages/registrar/Enrollment/MyRequests";
import NewEnrollment from "../pages/registrar/Enrollment/NewEnrollment";


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
      Admin: "/admin/dashboard",
      Registrar: "/registrar/dashboard",
      Student: "/student/dashboard",
      Faculty: "/faculty/dashboard",
      "Program Head": "/programhead/dashboard",
    };

    return <Navigate to={fallback[user.role]} replace />;
  }

  return children;
}
function StudentRoute({ element }: { element: ReactElement }) {
  return <ProtectedRoute allowedRole="Student">{element}</ProtectedRoute>;
}

function FacultyRoute({ element }: { element: ReactElement }) {
  return <ProtectedRoute allowedRole="Faculty">{element}</ProtectedRoute>;
}

function AdminRoute({ element }: { element: ReactElement }) {
  return <ProtectedRoute allowedRole="Admin">{element}</ProtectedRoute>;
}

function ProgramHeadRoute({ element }: { element: ReactElement }) {
  return <ProtectedRoute allowedRole="Program Head">{element}</ProtectedRoute>;
}

function RegistrarRoute({ element }: { element: ReactElement }) {
  return <ProtectedRoute allowedRole="Registrar">{element}</ProtectedRoute>;
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
        element={<AdminRoute element={<AdminDashboard />} />}
      />
      {/* ── Admin: Student Management ── */}
      <Route
        path="/admin/students/manage"
        element={<AdminRoute element={<ManageStudentsNew />} />}
      />
      <Route
        path="/admin/students/addeditdrop"
        element={<AdminRoute element={<AddEditDrop />} />}
      />
      <Route
        path="/admin/students/createstudents"
        element={<AdminRoute element={<CreateStudent />} />}
      />
      <Route
        path="/admin/students/editstudents/:id"
        element={<AdminRoute element={<EditStudent />} />}
      />
      <Route
        path="/admin/students/profile/:id"
        element={<AdminRoute element={<Sprofile />} />}
      />

                    {/* Students for Setup - LIST */}
<Route
  path="/admin/students/setup"
  element={
    <AdminRoute element={<StudentsForSetup />} />
  }
/>

<Route
  path="/admin/students/setup/:studentNumber"
  element={
    <AdminRoute element={<ManageStudentSetup />} />
  }
/>
              
      {/* ── Admin: Enrollment Management ── */}

      <Route
        path="/admin/enrollment/request"
        element={<AdminRoute element={<EnrollmentRequests />} />}
      />
      <Route
        path="/admin/enrollment/history"
        element={<AdminRoute element={<EnrollmentHistory />} />}
      />
      <Route
        path="/admin/enrollment/analytics"
        element={<AdminRoute element={<EnrollmentAnalytics />} />}
      />

          <Route
      path="/admin/enrollment/pending"
      element={<AdminRoute element={<PendingRequests />} />}
    />


      <Route
        path="/admin/enrollment/students"
        element={<EnrolledStudents />}
      />
      
      {/* ── Admin: Financial Management ── */}
      <Route
        path="/admin/financial/payments"
        element={<AdminRoute element={<Payment />} />}
      />
      <Route
        path="/admin/financial/billing"
        element={<AdminRoute element={<Billing />} />}
      />
      <Route
        path="/admin/financial/scholarship"
        element={<AdminRoute element={<Scholarship />} />}
      />
      <Route
        path="/admin/financial/freport"
        element={<AdminRoute element={<FinancialReport />} />}
      />
      {/* ── Admin: System Management ── */}
      <Route
        path="/admin/system/backup"
        element={<AdminRoute element={<BackupManagement />} />}
      />
      <Route
        path="/admin/system/acadsetting"
        element={<AdminRoute element={<AcademicSetting />} />}
      />
      <Route
        path="/admin/system/Gsettings"
        element={<AdminRoute element={<GeneralSettings />} />}
      />
      <Route
        path="/admin/system/security"
        element={<AdminRoute element={<SecuritySetting />} />}
      />
      <Route
        path="/admin/system/email"
        element={<AdminRoute element={<EmailSetting />} />}
      />
      {/* ── Admin: Reports & Analytics ── */}
      <Route
        path="/admin/reports/Dashboard"
        element={<AdminRoute element={<DashboardReport />} />}
      />
      <Route
        path="/admin/reports/export"
        element={<AdminRoute element={<ExportReports />} />}
      />
      <Route
        path="/admin/reports/auditlog"
        element={<AdminRoute element={<AuditlogReport />} />}
      />
      <Route
        path="/admin/reports/analytics"
        element={<AdminRoute element={<UsageAnalytics />} />}
      />
      {/* ── Admin: User Management ── */}
      <Route
        path="/admin/user/list"
        element={<AdminRoute element={<UserList />} />}
      />
      <Route
        path="/admin/user/create"
        element={<AdminRoute element={<CreateUser />} />}
      />

      <Route
        path="/admin/user/activity"
        element={<AdminRoute element={<UserActivity />} />}
      />
      <Route
        path="/admin/user/roles"
        element={<AdminRoute element={<UserRoles />} />}
      />
      <Route
        path="/admin/user/edit/:id"
        element={<AdminRoute element={<EditUser />} />}
      />
      {/* ── programhead: Dashboard ── */}
      <Route
        path="/programhead/dashboard"
        element={<ProgramHeadRoute element={<ProgramHeadDashboard />} />}
      />
      <Route
        path="/programhead/gradeapproval/pending"
        element={<ProgramHeadRoute element={<PendingGrades />} />}
      />


    {/* ── registar: Dashboard ── */}
      <Route
        path="/registrar/dashboard"
        element={<RegistrarRoute element={<RegistrarDashboard />} />}
      />
 
      <Route
        path="/registrar/student/records"
        element={<RegistrarRoute element={<RStudentRecord />} />}
      />

    
      <Route
        path="/registrar/enrollment/modify/:id"
        element={<ModifyEnrollment />}
      />

      <Route
        path="/registrar/enrollment/requests"
        element={<MyRequests />}
      />

      <Route
        path="/registrar/enrollment/new"
        element={<RegistrarRoute element={<NewEnrollment />} />}
      />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>

    
  );
}
