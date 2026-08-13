import { Routes, Route, Navigate } from "react-router-dom";
import type { UserRole } from "../services/auth.service";
import { authService } from "../services/auth.service";
// login and otp form here
import Home from "../pages/auth/Index";
import LoginAuth from "../pages/auth/Login";
import RegisterAuth from "../pages/auth/Register";
import OtpAuth from "../pages/auth/Otp";

// Student pages
import StudentDashboard from "../pages/student/Dashboard";
import StudentProfile from "../pages/student/Profile";
import StudentSchedule from "../pages/student/AcademicRecord/Schedule";

// Student pages — Academic Records
import StudentTranscript from "../pages/student/AcademicRecord/Transcript";
import StudentCourseHistory from "../pages/student/AcademicRecord/CourseHistory";
import StudentRecord from "../pages/student/AcademicRecord/StudentRecord";

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

// Student pages — Document
import RequestDocument from "../pages/student/Documents/RequestDocument";
import DocumentRelease from "../pages/student/Documents/DocumentRelease";

// Student pages — Settings
import SettingUser from "../pages/student/Settings/Usermanagement";

// Student Announcement
import AnnouncementS from "../pages/student/announcement/Announcement";
import AnnouncementDetailsS from "../pages/student/announcement/AnnouncementDetailsS";

// Faculty pages
import FacultyDashboard from "../pages/faculty/FacultyDashboard";
import FacultyProfile from "../pages/faculty/Profile";

// Faculty Class module
import MyClasses from "../pages/faculty/Classes/MyClasses";
import ClassSchedule from "../pages/faculty/Classes/ClassSchedule";
import FacultyStudentList from "../pages/faculty/Classes/StudentList";
import FacultyLectureNotes from "../pages/faculty/Materials/LectureNotes";
import FacultySyllabus from "../pages/faculty/Materials/Syllabus";

// Faculty Grades
import EnterGrades from "../pages/faculty/Grades/EnterGrades";
import GradeSummary from "../pages/faculty/Grades/GradeSummary";
import GradeHistory from "../pages/faculty/Grades/GradeHistory";
import TakeAttendance from "../pages/faculty/Attendance/Takeattendance";
import AttendanceRecords from "../pages/faculty/Attendance/AttendanceRecord";
import AttendanceReports from "../pages/faculty/Attendance/AttendanceReport";

import FacultyMessages from "../pages/faculty/Communication/Message";
import FacultyAnnouncements from "../pages/faculty/Communication/Announcement";
import SendNotice from "../pages/faculty/Communication/SendNotice";
// Faculty Announcement
import FacultyAnnouncementsF from "../pages/faculty/Announcement/AnnouncementF";
import FacultyAnnouncementsDF from "../pages/faculty/Announcement/AnnouncementDetailsF";

// Admin Announcement
import Announcementlist from "../pages/admin/Announcement/Announcementlist";
import Announcementcreate from "../pages/admin/Announcement/CreateAnnouncement";
import Announcementedit from "../pages/admin/Announcement/EditAnnouncement";
import AnnouncementDetails from "../pages/admin/Announcement/AnnouncementDetails";

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
<<<<<<< HEAD
import PendingRequests from "../pages/admin/Enrollment/PendingRequests";
import EnrolledStudents from "../pages/admin/Enrollment/EnrolledStudents";
=======
>>>>>>> 358a6e3c84374d2dcbfba7473f349cb250628467

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

// ── Admin: USERs modification roles etc ──
import UserList from "../pages/admin/UserManagement/Userlist";
import CreateUser from "../pages/admin/UserManagement/CreateUser";
import UserActivity from "../pages/admin/UserManagement/UserActivity";
import UserRoles from "../pages/admin/UserManagement/UserRoles";
import EditUser from "../pages/admin/UserManagement/EditUser";

// ProgramHead
import ProgramHeadDashboard from "../pages/programhead/dashboard/Dashboard";
import AnnouncementProg from "../pages/programhead/Announcement/AnnouncementProg";
import AnnouncementProgD from "../pages/programhead/Announcement/AnnouncementDProg";
import PendingGrades from "../pages/programhead/GradeApproval/PendingGrades";

//Registrar
import RegistrarDashboard from "../pages/registrar/Dashboard";

// ── Registrar: Announcement ──
import AnnouncementListR from "../pages/registrar/Announcement/AnnouncementListR";

import AnnouncementDetailR from "../pages/registrar/Announcement/AnnouncementDetailsR";
import AnnouncementCreateR from "../pages/registrar/Announcement/CreateAnnouncementR";
import AnnouncementEditR from "../pages/registrar/Announcement/EditAnnouncementR";

//Registrar Student Record
import StudentDetailsR from "../pages/registrar/StudentRecord/StudentDetailsR";
import RStudentlist from "../pages/registrar/StudentRecord/StudentlistR";
import AcademicRecordsR from "../pages/registrar/StudentRecord/AcademicRecordsR";
import StudentDocumentsR from "../pages/registrar/StudentRecord/StudentDocumentsR";
import TranscriptPreviewR from "../pages/registrar/StudentRecord/TranscriptPreviewR";

//This is the last one

import type { ReactElement } from "react";

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

      {/* ── Student: announcement ── */}
      <Route
        path="/student/announcement"
        element={<StudentRoute element={<AnnouncementS />} />}
      />
      <Route
        path="/student/announcementD/:id"
        element={<StudentRoute element={<AnnouncementDetailsS />} />}
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

      {/* ── Student: Document ── */}
      <Route
        path="/student/document/request"
        element={<StudentRoute element={<RequestDocument />} />}
      />
      <Route
        path="/student/document/release"
        element={<StudentRoute element={<DocumentRelease />} />}
      />

      {/* ── Student: Settings ── */}
      <Route
        path="/student/setting/user"
        element={<StudentRoute element={<SettingUser />} />}
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

      {/* ── Faculty: Announcement ── */}
      <Route
        path="/faculty/announcementF"
        element={<FacultyRoute element={<FacultyAnnouncementsF />} />}
      />

      <Route
        path="/faculty/announcementDF/:id"
        element={<FacultyRoute element={<FacultyAnnouncementsDF />} />}
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

<<<<<<< HEAD
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
              
=======
>>>>>>> 358a6e3c84374d2dcbfba7473f349cb250628467
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

<<<<<<< HEAD
          <Route
      path="/admin/enrollment/pending"
      element={<AdminRoute element={<PendingRequests />} />}
    />


      <Route
        path="/admin/enrollment/students"
        element={<EnrolledStudents />}
      />
      
=======
>>>>>>> 358a6e3c84374d2dcbfba7473f349cb250628467
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

      {/* ── Admin: Announcement ── */}
      <Route
        path="/admin/announcement/list"
        element={<AdminRoute element={<Announcementlist />} />}
      />
      <Route
        path="/admin/announcement/create"
        element={<AdminRoute element={<Announcementcreate />} />}
      />
      <Route
        path="/admin/announcement/edit/:id"
        element={<AdminRoute element={<Announcementedit />} />}
      />
      <Route
        path="/admin/announcement/details/:id"
        element={<AdminRoute element={<AnnouncementDetails />} />}
      />

      {/* ── programhead: Dashboard ── */}
      <Route
        path="/programhead/dashboard"
        element={<ProgramHeadRoute element={<ProgramHeadDashboard />} />}
      />
      <Route
        path="/programhead/announcementprog"
        element={<ProgramHeadRoute element={<AnnouncementProg />} />}
      />
      <Route
        path="/programhead/announcementprogD/:id"
        element={<ProgramHeadRoute element={<AnnouncementProgD />} />}
      />
      <Route
        path="/programhead/gradeapproval/pending"
        element={<ProgramHeadRoute element={<PendingGrades />} />}
      />

<<<<<<< HEAD

    {/* ── registar: Dashboard ── */}
=======
      {/* ── Registrar ── */}
>>>>>>> 358a6e3c84374d2dcbfba7473f349cb250628467
      <Route
        path="/registrar/dashboard"
        element={<RegistrarRoute element={<RegistrarDashboard />} />}
      />
<<<<<<< HEAD
 
=======

      {/* ── Registrar StudentRecord ── */}
>>>>>>> 358a6e3c84374d2dcbfba7473f349cb250628467
      <Route
        path="/registrar/student/listR"
        element={<RegistrarRoute element={<RStudentlist />} />}
      />
<<<<<<< HEAD

    
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
=======
      <Route
        path="/registrar/student/:id/transcriptR"
        element={<TranscriptPreviewR />}
      />
      <Route
        path="/registrar/student/DetailsR/:id"
        element={<RegistrarRoute element={<StudentDetailsR />} />}
      />
      <Route
        path="/registrar/student/:id/AcadRecR"
        element={<RegistrarRoute element={<AcademicRecordsR />} />}
      />
      <Route
        path="/registrar/student/:id/DocumentsR"
        element={<RegistrarRoute element={<StudentDocumentsR />} />}
      />

      {/* ── Registrar Announcements ── */}
      <Route
        path="/registrar/announcement/listR"
        element={<RegistrarRoute element={<AnnouncementListR />} />}
      />
      <Route
        path="/registrar/announcement/DetailR/:id"
        element={<RegistrarRoute element={<AnnouncementDetailR />} />}
      />

      <Route
        path="/registrar/announcement/editR/:id"
        element={<RegistrarRoute element={<AnnouncementEditR />} />}
      />

      <Route
        path="/registrar/announcement/createR"
        element={<RegistrarRoute element={<AnnouncementCreateR />} />}
>>>>>>> 358a6e3c84374d2dcbfba7473f349cb250628467
      />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>

    
  );
}
