import { Routes, Route, Navigate } from "react-router-dom";
import type { UserRole } from "../services/auth.service";
import { authService } from "../services/auth.service";

import Navbar from "../components/Forms/HomeNavbar";

// login and otp form here
import Home from "../pages/auth/Index";
import LoginAuth from "../pages/auth/Login";
import OtpAuth from "../pages/auth/Otp";
import About from "../components/Forms/about";
import Programs from "../components/Forms/programs";
import Contact from "../components/Forms/contact";

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
import Enrollmentmain from "../pages/student/Enrollment/Enrollmentmain";

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

// Faculty Grades
import EnterGrades from "../pages/faculty/Grades/EnterGrades";
import GradeSummary from "../pages/faculty/Grades/GradeSummary";
import GradeHistory from "../pages/faculty/Grades/GradeHistory";
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

// ── Admin: Enrollment Management ──
import ApproveEnrollment from "../pages/admin/Enrollment/ApproveEnrollment";
import EnrollmentRequests from "../pages/admin/Enrollment/EnrollmentRequests";
import EnrollmentHistory from "../pages/admin/Enrollment/EnrollmentHistory";
import EnrollmentAnalytics from "../pages/admin/Enrollment/EnrollmentAnalytics";

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
import StudentDocumentsR from "../pages/registrar/StudentRecord/StudentCOGR";
import TranscriptPreviewR from "../pages/registrar/StudentRecord/TranscriptPreviewR";

//This is the last one

import type { ReactElement } from "react";
import EnrollmentManagementR from "../pages/registrar/Enrollment/EnrollmentManagementR";
import EnrollmentDetailsR from "../pages/registrar/Enrollment/EnrollmentDetailsR";
import CurriculumManagementR from "../pages/registrar/Curriculum/CurriculumManagementR";
import CurriculumDetailR from "../pages/registrar/Curriculum/CurriculumDetailsR";
import SubjectmanagementR from "../pages/registrar/Subjects/SubjectManagementR";
import CoursemanagementR from "../pages/registrar/Courses/CourseManagementR";
import DepartmentManagementR from "../pages/registrar/Department/DepartmentManagementR";
import EnrollmentPeriodMR from "../pages/registrar/Enrollment/EnrollmentPeriodMR";
import ClassOfferingManagementR from "../pages/registrar/ClassOffering.tsx/ClassOfferingManagementR";
import ClassPROG from "../pages/programhead/Classmanagement/ClassPROG";
import TransferEvaluationR from "../pages/registrar/StudentRecord/TransferEvaluationR";

// ─── Role guard ───────────────────────────────────────────────
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
    <>
      <Routes>
        {/* ── Public ── */}
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
          path="/student/enrollment/main"
          element={<StudentRoute element={<Enrollmentmain />} />}
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

        {/* ── Admin: Enrollment Management ── */}
        <Route
          path="/admin/enrollment/approve"
          element={<AdminRoute element={<ApproveEnrollment />} />}
        />
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

        <Route
          path="/programhead/class/management"
          element={<ProgramHeadRoute element={<ClassPROG />} />}
        />

        {/* ── Registrar ── */}
        <Route
          path="/registrar/dashboard"
          element={<RegistrarRoute element={<RegistrarDashboard />} />}
        />

        {/* ── Registrar StudentRecord ── */}
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
          path="/registrar/student/:id/TransferEvaluationR"
          element={<RegistrarRoute element={<TransferEvaluationR />} />}
        />

        {/* ── Registrar Enrollment ── */}
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
          element={<RegistrarRoute element={<EnrollmentDetailsR />} />}
        />
        <Route
          path="/registrar/enrollment/periodM"
          element={<RegistrarRoute element={<EnrollmentPeriodMR />} />}
        />

        {/* ── Registrar Curriculum ── */}
        <Route
          path="/registrar/curriculum/management"
          element={<RegistrarRoute element={<CurriculumManagementR />} />}
        />
        <Route
          path="/registrar/curriculum/:id"
          element={<RegistrarRoute element={<CurriculumDetailR />} />}
        />
        {/* ── Registrar Subjects ── */}
        <Route
          path="/registrar/subjects/management"
          element={<RegistrarRoute element={<SubjectmanagementR />} />}
        />

        {/* ── Registrar Courses ── */}
        <Route
          path="/registrar/course/management"
          element={<RegistrarRoute element={<CoursemanagementR />} />}
        />
        {/* ── Registrar Department ── */}
        <Route
          path="/registrar/department/management"
          element={<RegistrarRoute element={<DepartmentManagementR />} />}
        />

        {/* ── Registrar Class Offering ── */}

        <Route
          path="/registrar/offering/managementR"
          element={<RegistrarRoute element={<ClassOfferingManagementR />} />}
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
        />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
