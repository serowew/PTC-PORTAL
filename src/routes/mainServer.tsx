import { Routes, Route, Navigate } from "react-router-dom";
import type { UserRole } from "../services/auth.service";
import type { ReactElement } from "react";
import { authService } from "../services/auth.service";

import Navbar from "../components/Forms/HomeNavbar";

// ============================================================
// AUTH / PUBLIC PAGES
// ============================================================
import Home from "../pages/auth/Index";
import LoginAuth from "../pages/auth/Login";
import OtpAuth from "../pages/auth/Otp";
import About from "../components/Forms/about";
import Programs from "../components/Forms/programs";
import Contact from "../components/Forms/contact";
import ForgotPassword from "../pages/auth/ForgotPassword";
import VerifyResetOtp from "../pages/auth/VerifyResetOtp";
import ResetPassword from "../pages/auth/ResetPassword";

// ============================================================
// STUDENT PAGES
// ============================================================
import StudentDashboard from "../pages/student/Dashboard";
import StudentProfile from "../pages/student/Profile";
import StudentSchedule from "../pages/student/AcademicRecord/Schedule";

// Student Academic Records
import StudentTranscript from "../pages/student/AcademicRecord/Transcript";
import StudentCourseHistory from "../pages/student/AcademicRecord/CourseHistory";
import StudentRecord from "../pages/student/AcademicRecord/StudentRecord";

// Student Enrollment
import Enrollmentmain from "../pages/student/Enrollment/Enrollmentmain";

// Student Documents
import RequestDocument from "../pages/student/Documents/RequestDocument";
import DocumentRelease from "../pages/student/Documents/DocumentRelease";

// Student Settings
import SettingUser from "../pages/student/Settings/Usermanagement";

// Student Announcements
import AnnouncementS from "../pages/student/announcement/Announcement";
import AnnouncementDetailsS from "../pages/student/announcement/AnnouncementDetailsS";

// Student Financial
import MyTransactions from "../pages/student/Financial/MyTransactions";

// ============================================================
// FACULTY PAGES
// ============================================================
import FacultyDashboard from "../pages/faculty/FacultyDashboard";
import FacultyProfile from "../pages/faculty/Profile";

// Faculty Classes
import MyClasses from "../pages/faculty/Classes/MyClasses";
import ClassSchedule from "../pages/faculty/Classes/ClassSchedule";
import FacultyStudentList from "../pages/faculty/Classes/StudentList";

// Faculty Grades
import EnterGrades from "../pages/faculty/Grades/EnterGrades";
import GradeSummary from "../pages/faculty/Grades/GradeSummary";
import GradeHistory from "../pages/faculty/Grades/GradeHistory";

// Faculty Announcements
import FacultyAnnouncementsF from "../pages/faculty/Announcement/AnnouncementF";
import FacultyAnnouncementsDF from "../pages/faculty/Announcement/AnnouncementDetailsF";

// ============================================================
// ADMIN PAGES
// ============================================================

// Admin Dashboard
import AdminDashboard from "../pages/admin/AdminDashboard";

// Admin Students
import ManageStudentsNew from "../pages/admin/Students/StudentLists";
import AddEditDrop from "../pages/admin/Students/AddEditDrop";
import CreateStudent from "../pages/admin/Students/createstudent";
import EditStudent from "../pages/admin/Students/editstudent";
import Sprofile from "../pages/admin/Students/Sprofile";

// Admin Announcements
import Announcementlist from "../pages/admin/Announcement/Announcementlist";
import Announcementcreate from "../pages/admin/Announcement/CreateAnnouncement";
import Announcementedit from "../pages/admin/Announcement/EditAnnouncement";
import AnnouncementDetails from "../pages/admin/Announcement/AnnouncementDetails";

// Admin Financial Management
import Payment from "../pages/admin/FinancialManagement/Payments";
import Billing from "../pages/admin/FinancialManagement/Billings";
import Scholarship from "../pages/admin/FinancialManagement/Scholarship";
import FinancialReport from "../pages/admin/FinancialManagement/FinancialReport";

// Admin System Management
import BackupManagement from "../pages/admin/System/BackupManagement";
import AcademicSetting from "../pages/admin/System/AcademicSetting";
import GeneralSettings from "../pages/admin/System/GeneralSetting";
import SecuritySetting from "../pages/admin/System/SecuritySetting";
import EmailSetting from "../pages/admin/System/EmailSetting";

// Admin Reports
import DashboardReport from "../pages/admin/Reports/DashboardReport";
import ExportReports from "../pages/admin/Reports/ExportReport";
import AuditlogReport from "../pages/admin/Reports/AuditlogReport";
import UsageAnalytics from "../pages/admin/Reports/UsageAnalytics";

// Admin User Management
import UserList from "../pages/admin/UserManagement/Userlist";
import CreateUser from "../pages/admin/UserManagement/CreateUser";
import UserActivity from "../pages/admin/UserManagement/UserActivity";
import UserRoles from "../pages/admin/UserManagement/UserRoles";
import EditUser from "../pages/admin/UserManagement/EditUser";

// ============================================================
// PROGRAM HEAD PAGES
// ============================================================
import ProgramHeadDashboard from "../pages/programhead/dashboard/Dashboard";
import AnnouncementProg from "../pages/programhead/Announcement/AnnouncementProg";
import AnnouncementProgD from "../pages/programhead/Announcement/AnnouncementDProg";
import PendingGrades from "../pages/programhead/GradeApproval/PendingGrades";
import TransferEvaluationPROG from "../pages/programhead/TransferEvaluation/TransferEvaluationReview";
import ClassPROG from "../pages/programhead/Classmanagement/ClassPROG";

// Program Head Schedule Verification
import ScheduleList from "../pages/programhead/ScheduleVerification/ScheduleList";
import FacultySchedules from "../pages/programhead/ScheduleVerification/FacultySchedules";

// ============================================================
// REGISTRAR PAGES
// ============================================================
import RegistrarDashboard from "../pages/registrar/Dashboard";

// Registrar Announcements
import AnnouncementListR from "../pages/registrar/Announcement/AnnouncementListR";
import AnnouncementDetailR from "../pages/registrar/Announcement/AnnouncementDetailsR";
import AnnouncementCreateR from "../pages/registrar/Announcement/CreateAnnouncementR";
import AnnouncementEditR from "../pages/registrar/Announcement/EditAnnouncementR";

// Registrar Student Records
import StudentDetailsR from "../pages/registrar/StudentRecord/StudentDetailsR";
import RStudentlist from "../pages/registrar/StudentRecord/StudentlistR";
import AcademicRecordsR from "../pages/registrar/StudentRecord/AcademicRecordsR";
import StudentDocumentsR from "../pages/registrar/StudentRecord/StudentCOGR";
import TranscriptPreviewR from "../pages/registrar/StudentRecord/TranscriptPreviewR";
import StudentCORR from "../pages/registrar/StudentRecord/StudentCORR";
import TransferEvaluationR from "../pages/registrar/StudentRecord/TransferEvaluationR";

// Registrar Enrollment
import EnrollmentManagementR from "../pages/registrar/Enrollment/EnrollmentManagementR";
import EnrollmentDetailsR from "../pages/registrar/Enrollment/EnrollmentDetailsR";
import EnrollmentPeriodMR from "../pages/registrar/Enrollment/EnrollmentPeriodMR";

// Registrar Curriculum
import CurriculumManagementR from "../pages/registrar/Curriculum/CurriculumManagementR";
import CurriculumDetailR from "../pages/registrar/Curriculum/CurriculumDetailsR";

// Registrar Subjects
import SubjectmanagementR from "../pages/registrar/Subjects/SubjectManagementR";

// Registrar Courses
import CoursemanagementR from "../pages/registrar/Courses/CourseManagementR";

// Registrar Department
import DepartmentManagementR from "../pages/registrar/Department/DepartmentManagementR";

// Registrar Class Offering
import ClassOfferingManagementR from "../pages/registrar/ClassOffering.tsx/ClassOfferingManagementR";

// Registrar Faculty Schedules
import FacultySchedulesR from "../pages/registrar/Schedules/FacultySchedulesR";

// Registrar Documents
import DocumentRequest from "../pages/registrar/Documents/DocumentRequests";

// ============================================================
// FINANCE PAGES
// ============================================================
import FinanceDashboard from "../pages/finance/Dashboard";
import FinanceTicketProcessing from "../pages/finance/FinanceTicketProcessing";
import FinancePaymentHistory from "../pages/finance/FinancePaymentHistory";
import CreateStudentTransaction from "../pages/finance/CreateStudentTransaction";
import FinanceTransactionTypes from "../pages/finance/FinanceTransactionTypes";
import FinanceReports from "../pages/finance/FinanceReports";

// ============================================================
// ROLE GUARD
// ============================================================
function ProtectedRoute({
  children,
  allowedRole,
}: {
  children: ReactElement;
  allowedRole: UserRole;
}) {
  const user = authService.getSession();

  if (!authService.isLoggedIn() || !user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== allowedRole) {
    const fallback: Record<UserRole, string> = {
      Admin: "/admin/dashboard",
      Registrar: "/registrar/dashboard",
      Student: "/student/dashboard",
      Faculty: "/faculty/dashboard",
      Finance: "/finance/dashboard",
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

function FinanceRoute({ element }: { element: ReactElement }) {
  return <ProtectedRoute allowedRole="Finance">{element}</ProtectedRoute>;
}

// ============================================================
// APPLICATION ROUTES
// ============================================================
export default function AppRoutes() {
  return (
    <Routes>
      {/* ======================================================
          PUBLIC
      ====================================================== */}

      <Route
        path="/"
        element={
          <>
            <Navbar />
            <Home />
          </>
        }
      />

      <Route
        path="/about"
        element={
          <>
            <Navbar />
            <About />
          </>
        }
      />

      <Route
        path="/programs"
        element={
          <>
            <Navbar />
            <Programs />
          </>
        }
      />

      <Route
        path="/contact"
        element={
          <>
            <Navbar />
            <Contact />
          </>
        }
      />

      <Route path="/login" element={<LoginAuth />} />
      <Route path="/otp" element={<OtpAuth />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route
        path="/forgot-password/verify"
        element={<VerifyResetOtp />}
      />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* ======================================================
          STUDENT
      ====================================================== */}

      <Route
        path="/student/dashboard"
        element={<StudentRoute element={<StudentDashboard />} />}
      />

      <Route
        path="/student/profile"
        element={<StudentRoute element={<StudentProfile />} />}
      />

      {/* Student Announcements */}
      <Route
        path="/student/announcement"
        element={<StudentRoute element={<AnnouncementS />} />}
      />

      <Route
        path="/student/announcementD/:id"
        element={<StudentRoute element={<AnnouncementDetailsS />} />}
      />

      {/* Student Academic Records */}
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

      {/* Student Enrollment */}
      <Route
        path="/student/enrollment/main"
        element={<StudentRoute element={<Enrollmentmain />} />}
      />

      {/* Student Documents */}
      <Route
        path="/student/document/request"
        element={<StudentRoute element={<RequestDocument />} />}
      />

      <Route
        path="/student/document/release"
        element={<StudentRoute element={<DocumentRelease />} />}
      />

      {/* Student Financial */}
      <Route
        path="/student/transactions"
        element={<StudentRoute element={<MyTransactions />} />}
      />

      {/* Student Settings */}
      <Route
        path="/student/setting/user"
        element={<StudentRoute element={<SettingUser />} />}
      />

      {/* ======================================================
          FACULTY
      ====================================================== */}

      <Route
        path="/faculty/dashboard"
        element={<FacultyRoute element={<FacultyDashboard />} />}
      />

      <Route
        path="/faculty/profile"
        element={<FacultyRoute element={<FacultyProfile />} />}
      />

      {/* Faculty Announcements */}
      <Route
        path="/faculty/announcementF"
        element={<FacultyRoute element={<FacultyAnnouncementsF />} />}
      />

      <Route
        path="/faculty/announcementDF/:id"
        element={<FacultyRoute element={<FacultyAnnouncementsDF />} />}
      />

      {/* Faculty Classes */}
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

      {/* Faculty Grades */}
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

      {/* ======================================================
          ADMIN
      ====================================================== */}

      <Route
        path="/admin/dashboard"
        element={<AdminRoute element={<AdminDashboard />} />}
      />

      {/* Admin Students */}
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

      {/* ======================================================
          Admin Enrollment Management
          
          The old Admin Enrollment pages were removed from the
          current project, so their imports/routes are removed.
      ====================================================== */}

      {/* Admin Financial Management */}
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

      {/* Admin System Management */}
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

      {/* Admin Reports */}
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

      {/* Admin User Management */}
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

      {/* Admin Announcements */}
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

      {/* ======================================================
          PROGRAM HEAD
      ====================================================== */}

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

      <Route
        path="/programhead/transfer-evaluations"
        element={
          <ProgramHeadRoute element={<TransferEvaluationPROG />} />
        }
      />

      <Route
        path="/programhead/class/management"
        element={<ProgramHeadRoute element={<ClassPROG />} />}
      />

      <Route
        path="/programhead/class/schedule"
        element={<ProgramHeadRoute element={<ScheduleList />} />}
      />

      <Route
        path="/programhead/class/faculty-schedules"
        element={<ProgramHeadRoute element={<FacultySchedules />} />}
      />

      {/* ======================================================
          REGISTRAR
      ====================================================== */}

      <Route
        path="/registrar/dashboard"
        element={<RegistrarRoute element={<RegistrarDashboard />} />}
      />

      {/* Registrar Student Records */}
      <Route
        path="/registrar/student/listR"
        element={<RegistrarRoute element={<RStudentlist />} />}
      />

      <Route
        path="/registrar/student/:id/transcriptR"
        element={<RegistrarRoute element={<TranscriptPreviewR />} />}
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

      <Route
        path="/registrar/student/:id/CORR"
        element={<RegistrarRoute element={<StudentCORR />} />}
      />

      <Route
        path="/registrar/student/:id/TransferEvaluationR"
        element={<RegistrarRoute element={<TransferEvaluationR />} />}
      />

      {/* Registrar Enrollment */}
      <Route
        path="/registrar/enrollment/management"
        element={<RegistrarRoute element={<EnrollmentManagementR />} />}
      />

      <Route
        path="/registrar/enrollment/:id"
        element={<RegistrarRoute element={<EnrollmentDetailsR />} />}
      />

      <Route
        path="/registrar/enrollment/subject/management"
        element={<RegistrarRoute element={<SubjectmanagementR />} />}
      />

      <Route
        path="/registrar/enrollment/periodM"
        element={<RegistrarRoute element={<EnrollmentPeriodMR />} />}
      />

      {/* Registrar Curriculum */}
      <Route
        path="/registrar/curriculum/management"
        element={<RegistrarRoute element={<CurriculumManagementR />} />}
      />

      <Route
        path="/registrar/curriculum/:id"
        element={<RegistrarRoute element={<CurriculumDetailR />} />}
      />

      {/* Registrar Subjects */}
      <Route
        path="/registrar/subjects/management"
        element={<RegistrarRoute element={<SubjectmanagementR />} />}
      />

      {/* Registrar Courses */}
      <Route
        path="/registrar/course/management"
        element={<RegistrarRoute element={<CoursemanagementR />} />}
      />

      {/* Registrar Department */}
      <Route
        path="/registrar/department/management"
        element={
          <RegistrarRoute element={<DepartmentManagementR />} />
        }
      />

      {/* Registrar Class Offering */}
      <Route
        path="/registrar/offering/managementR"
        element={
          <RegistrarRoute element={<ClassOfferingManagementR />} />
        }
      />

      {/* Registrar Faculty Schedules */}
      <Route
        path="/registrar/schedules/faculty"
        element={<RegistrarRoute element={<FacultySchedulesR />} />}
      />

      {/* Registrar Announcements */}
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
      />

      {/* Registrar Documents */}
      <Route
        path="/registrar/document-requests"
        element={<RegistrarRoute element={<DocumentRequest />} />}
      />

      {/* ======================================================
          FINANCE
      ====================================================== */}

      <Route
        path="/finance/dashboard"
        element={<FinanceRoute element={<FinanceDashboard />} />}
      />

      <Route
        path="/finance/transactions/create"
        element={
          <FinanceRoute element={<CreateStudentTransaction />} />
        }
      />

      <Route
        path="/finance/tickets"
        element={<FinanceRoute element={<FinanceTicketProcessing />} />}
      />

      <Route
        path="/finance/transaction-types"
        element={
          <FinanceRoute element={<FinanceTransactionTypes />} />
        }
      />

      <Route
        path="/finance/reports"
        element={<FinanceRoute element={<FinanceReports />} />}
      />

      <Route
        path="/finance/payment-history"
        element={
          <FinanceRoute element={<FinancePaymentHistory />} />
        }
      />

      {/* ======================================================
          CATCH-ALL
      ====================================================== */}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}