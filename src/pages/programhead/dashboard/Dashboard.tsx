import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpenCheck,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/ProgramHeadDashboard.css";

const CLASSES_API_URL = "http://localhost:3000/api/program-head/classes";
const SUBMITTED_GRADES_API_URL =
  "http://localhost:3000/api/program-head/grades/submitted";

interface ProgramHeadInfo {
  program_head_id: number;
  faculty_id: number | null;
  user_id: number;
  employee_number: string;
  username: string;
  program_head_name: string;
  department: {
    department_id: number;
    department_code: string;
    department_name: string;
  };
}

interface ProgramHeadClassSummary {
  total_classes: number;
  grading_ready: number;
  without_faculty: number;
  open: number;
  closed: number;
  total_official_students: number;
  total_submitted_grades: number;
  total_approved_grades: number;
}

interface ProgramHeadClass {
  offering_id: number;
  offering_status: string;
  grading_ready: boolean;
  subject: {
    subject_code: string;
    subject_name: string;
  };
  section: {
    section_name: string;
    year_level: number;
    course: {
      course_code: string;
      course_name: string;
    };
  };
  faculty: {
    faculty_id: number;
    faculty_name: string;
  } | null;
  academic_period: {
    academic_year_id: number;
    academic_year: string;
    is_current_academic_year: boolean;
    semester_id: number;
    semester_name: string;
  };
  capacity: {
    official_students: number;
  };
  grades: {
    submitted: number;
    approved: number;
  };
}

interface ProgramHeadClassesResponse {
  success: boolean;
  program_head?: ProgramHeadInfo;
  summary?: ProgramHeadClassSummary;
  classes?: ProgramHeadClass[];
  message?: string;
  error?: string;
}

interface SubmittedGrade {
  grade_id: number;
  submitted_at: string | null;
  student: {
    student_number: string;
    full_name: string;
  };
  faculty: {
    faculty_name: string;
  };
  class: {
    subject: {
      subject_code: string;
      subject_name: string;
    };
    section: {
      section_name: string;
      course: {
        course_code: string;
      };
    };
    academic_period: {
      academic_year: string;
      semester_name: string;
    };
  };
}

interface SubmittedGradesResponse {
  success: boolean;
  program_head?: ProgramHeadInfo;
  summary?: {
    total_submitted: number;
  };
  grades?: SubmittedGrade[];
  message?: string;
  error?: string;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();

    throw new Error(
      `Server returned a non-JSON response (${response.status}): ${text.slice(
        0,
        180,
      )}`,
    );
  }

  return response.json() as Promise<T>;
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Submission time unavailable";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getPercentage(value: number, total: number) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round((value / total) * 100)));
}

export default function ProgramHeadDashboard() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();
  const authenticated = Boolean(session && token);
  const userRole = session?.role;

  const [programHead, setProgramHead] = useState<ProgramHeadInfo | null>(null);
  const [classSummary, setClassSummary] =
    useState<ProgramHeadClassSummary | null>(null);
  const [classes, setClasses] = useState<ProgramHeadClass[]>([]);
  const [submittedGrades, setSubmittedGrades] = useState<SubmittedGrade[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [classError, setClassError] = useState("");
  const [gradeError, setGradeError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Program Head") {
      navigate(authService.getDashboardRoute(session!.role), {
        replace: true,
      });
    }
  }, [authenticated, userRole, session, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Program Head") {
      return;
    }

    const controller = new AbortController();

    const handleUnauthorized = () => {
      authService.logout();
      navigate("/login", { replace: true });
      controller.abort();
    };

    const loadClasses = async () => {
      try {
        const response = await authService.authFetch(CLASSES_API_URL, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

        if (response.status === 401) {
          handleUnauthorized();
          return;
        }

        const data =
          await readJsonResponse<ProgramHeadClassesResponse>(response);

        if (!response.ok || !data.success) {
          throw new Error(
            data.message ||
              data.error ||
              "Unable to load Program Head class information.",
          );
        }

        if (data.program_head) {
          setProgramHead(data.program_head);
        }

        setClassSummary(data.summary || null);
        setClasses(Array.isArray(data.classes) ? data.classes : []);
      } catch (requestError) {
        if (controller.signal.aborted) {
          return;
        }

        console.error(
          "LOAD PROGRAM HEAD DASHBOARD CLASSES ERROR:",
          requestError,
        );

        setClassError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load class information.",
        );
      }
    };

    const loadSubmittedGrades = async () => {
      try {
        const response = await authService.authFetch(
          SUBMITTED_GRADES_API_URL,
          {
            method: "GET",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          },
        );

        if (response.status === 401) {
          handleUnauthorized();
          return;
        }

        const data =
          await readJsonResponse<SubmittedGradesResponse>(response);

        if (!response.ok || !data.success) {
          throw new Error(
            data.message ||
              data.error ||
              "Unable to load the submitted-grade review queue.",
          );
        }

        if (!programHead && data.program_head) {
          setProgramHead(data.program_head);
        }

        const rows = Array.isArray(data.grades) ? data.grades : [];

        setSubmittedGrades(rows);
        setPendingCount(
          Number.isFinite(Number(data.summary?.total_submitted))
            ? Number(data.summary?.total_submitted)
            : rows.length,
        );
      } catch (requestError) {
        if (controller.signal.aborted) {
          return;
        }

        console.error(
          "LOAD PROGRAM HEAD DASHBOARD GRADES ERROR:",
          requestError,
        );

        setGradeError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load pending grade approvals.",
        );
      }
    };

    const loadDashboard = async () => {
      try {
        if (refreshKey === 0) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }

        setClassError("");
        setGradeError("");

        await Promise.all([loadClasses(), loadSubmittedGrades()]);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void loadDashboard();

    return () => controller.abort();
  }, [authenticated, userRole, navigate, refreshKey]);

  const currentAcademicPeriod = useMemo(() => {
    const currentClass = classes.find(
      (item) => item.academic_period.is_current_academic_year,
    );

    if (!currentClass) {
      return "Current academic period";
    }

    return `${currentClass.academic_period.academic_year} · ${currentClass.academic_period.semester_name}`;
  }, [classes]);

  const uniqueFacultyCount = useMemo(() => {
    const facultyIds = new Set<number>();

    classes.forEach((item) => {
      if (item.faculty?.faculty_id) {
        facultyIds.add(item.faculty.faculty_id);
      }
    });

    return facultyIds.size;
  }, [classes]);

  const recentPendingGrades = useMemo(() => {
    return [...submittedGrades]
      .sort((a, b) => {
        const first = a.submitted_at
          ? new Date(a.submitted_at).getTime()
          : 0;
        const second = b.submitted_at
          ? new Date(b.submitted_at).getTime()
          : 0;

        return second - first;
      })
      .slice(0, 4);
  }, [submittedGrades]);

  const totalClasses = classSummary?.total_classes || 0;
  const gradingReady = classSummary?.grading_ready || 0;
  const openClasses = classSummary?.open || 0;
  const closedClasses = classSummary?.closed || 0;
  const classesWithoutFaculty = classSummary?.without_faculty || 0;
  const officialMemberships = classSummary?.total_official_students || 0;
  const approvedGrades = classSummary?.total_approved_grades || 0;

  const openPercent = getPercentage(openClasses, totalClasses);
  const gradingReadyPercent = getPercentage(gradingReady, totalClasses);
  const hasPartialError = Boolean(classError || gradeError);

  if (!authenticated || !session || userRole !== "Program Head") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="programhead-dashboard">
        <section className="programhead-dashboard__hero">
          <div className="programhead-dashboard__hero-copy">
            <div className="programhead-dashboard__eyebrow">
              <span className="programhead-dashboard__eyebrow-icon">
                <LayoutDashboard size={16} strokeWidth={2.2} />
              </span>
              Program Head · Operations
            </div>

            <h1>Program Head Dashboard</h1>

            <p>
              Welcome back,{" "}
              <strong>
                {programHead?.program_head_name || session.username}
              </strong>
              . Review grade submissions, department classes, faculty
              assignments, and official student memberships from one academic
              management workspace.
            </p>

            <div
              className="programhead-dashboard__hero-meta"
              aria-label="Program Head academic context"
            >
              <span className="programhead-dashboard__hero-meta-item">
                <Building2 size={14} strokeWidth={2} aria-hidden="true" />
                {programHead?.department.department_name ||
                  "Program Head Department"}
              </span>

              <span
                className="programhead-dashboard__hero-meta-divider"
                aria-hidden="true"
              >
                ·
              </span>

              <span className="programhead-dashboard__hero-meta-item">
                <CalendarDays size={14} strokeWidth={2} aria-hidden="true" />
                {currentAcademicPeriod}
              </span>
            </div>
          </div>

          <div className="programhead-dashboard__hero-actions">
            <div className="programhead-dashboard__identity">
              <span className="programhead-dashboard__identity-icon">
                <ShieldCheck size={19} strokeWidth={2.1} />
              </span>

              <span className="programhead-dashboard__identity-copy">
                <small>Program Head Workspace</small>
                <strong>
                  {programHead?.department.department_code ||
                    "Department Management"}
                </strong>
              </span>
            </div>

            <button
              type="button"
              className="programhead-dashboard__refresh"
              onClick={() => setRefreshKey((current) => current + 1)}
              disabled={loading || refreshing}
            >
              <RefreshCw
                size={16}
                className={refreshing ? "is-spinning" : ""}
              />
              {refreshing ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </section>

        {hasPartialError && !loading && (
          <section className="programhead-dashboard__notice" role="status">
            <CircleAlert size={18} />

            <div>
              <strong>Some dashboard information is unavailable</strong>
              <p>
                {classError && `Classes: ${classError}`}
                {classError && gradeError && " · "}
                {gradeError && `Grades: ${gradeError}`}
              </p>
            </div>
          </section>
        )}

        <section
          className="programhead-dashboard__summary"
          aria-label="Program Head overview"
        >
          <article className="programhead-dashboard__stat-card programhead-dashboard__stat-card--priority">
            <span className="programhead-dashboard__stat-icon programhead-dashboard__stat-icon--primary">
              <ClipboardCheck size={20} />
            </span>

            <div className="programhead-dashboard__stat-content">
              <span className="programhead-dashboard__stat-label">
                Pending Grade Reviews
              </span>

              <strong className="programhead-dashboard__stat-number">
                {loading ? "…" : pendingCount}
              </strong>

              <small>Faculty submissions awaiting your decision</small>
            </div>
          </article>

          <article className="programhead-dashboard__stat-card">
            <span className="programhead-dashboard__stat-icon">
              <BookOpenCheck size={20} />
            </span>

            <div className="programhead-dashboard__stat-content">
              <span className="programhead-dashboard__stat-label">
                Department Classes
              </span>

              <strong className="programhead-dashboard__stat-number">
                {loading ? "…" : totalClasses}
              </strong>

              <small>Non-cancelled classes in your department</small>
            </div>
          </article>

          <article className="programhead-dashboard__stat-card">
            <span className="programhead-dashboard__stat-icon">
              <UsersRound size={20} />
            </span>

            <div className="programhead-dashboard__stat-content">
              <span className="programhead-dashboard__stat-label">
                Official Memberships
              </span>

              <strong className="programhead-dashboard__stat-number">
                {loading ? "…" : officialMemberships}
              </strong>

              <small>Approved student memberships across classes</small>
            </div>
          </article>

          <article className="programhead-dashboard__stat-card">
            <span className="programhead-dashboard__stat-icon">
              <CheckCircle2 size={20} />
            </span>

            <div className="programhead-dashboard__stat-content">
              <span className="programhead-dashboard__stat-label">
                Approved Grades
              </span>

              <strong className="programhead-dashboard__stat-number">
                {loading ? "…" : approvedGrades}
              </strong>

              <small>Grades already finalized as official results</small>
            </div>
          </article>
        </section>

        <section className="programhead-dashboard__quick-access">
          <header className="programhead-dashboard__section-header">
            <div>
              <span className="programhead-dashboard__section-kicker">
                <LayoutDashboard size={13} />
                Academic Operations
              </span>

              <h2>Quick Access</h2>

              <p>
                Open the Program Head tools currently connected to your portal.
              </p>
            </div>
          </header>

          <div className="programhead-dashboard__action-grid">
            <button
              type="button"
              className="programhead-dashboard__action-card programhead-dashboard__action-card--featured"
              onClick={() => navigate("/programhead/gradeapproval/pending")}
            >
              <span className="programhead-dashboard__action-icon">
                <ClipboardCheck size={19} />
              </span>

              <span className="programhead-dashboard__action-copy">
                <strong>Pending Grades</strong>
                <small>
                  Review, approve, or return Faculty-submitted grades.
                </small>
              </span>

              {pendingCount > 0 && !loading && (
                <span className="programhead-dashboard__action-count">
                  {pendingCount}
                </span>
              )}

              <ArrowRight
                size={16}
                className="programhead-dashboard__action-arrow"
              />
            </button>

            <button
              type="button"
              className="programhead-dashboard__action-card"
              onClick={() => navigate("/programhead/class/management")}
            >
              <span className="programhead-dashboard__action-icon">
                <BookOpenCheck size={19} />
              </span>

              <span className="programhead-dashboard__action-copy">
                <strong>Class Management</strong>
                <small>
                  Monitor department classes, sections, faculty, and grading.
                </small>
              </span>

              <ArrowRight
                size={16}
                className="programhead-dashboard__action-arrow"
              />
            </button>

            <button
              type="button"
              className="programhead-dashboard__action-card"
              onClick={() => navigate("/programhead/announcementprog")}
            >
              <span className="programhead-dashboard__action-icon">
                <Megaphone size={19} />
              </span>

              <span className="programhead-dashboard__action-copy">
                <strong>Announcements</strong>
                <small>
                  Read notices available to the Program Head role.
                </small>
              </span>

              <ArrowRight
                size={16}
                className="programhead-dashboard__action-arrow"
              />
            </button>
          </div>
        </section>

        <div className="programhead-dashboard__content-grid">
          <section className="programhead-dashboard__panel">
            <header className="programhead-dashboard__section-header programhead-dashboard__section-header--row">
              <div>
                <span className="programhead-dashboard__section-kicker">
                  <ClipboardCheck size={13} />
                  Review Queue
                </span>

                <h2>Recent Grade Submissions</h2>

                <p>
                  Latest Faculty grades waiting for Program Head review.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  navigate("/programhead/gradeapproval/pending")
                }
              >
                View Queue
                <ArrowRight size={14} />
              </button>
            </header>

            <div className="programhead-dashboard__grade-list">
              {loading ? (
                [1, 2, 3].map((item) => (
                  <div
                    className="programhead-dashboard__grade-skeleton"
                    key={item}
                  >
                    <i />
                    <span>
                      <i />
                      <i />
                    </span>
                    <i />
                  </div>
                ))
              ) : gradeError ? (
                <div className="programhead-dashboard__empty">
                  <CircleAlert size={22} />
                  <strong>Review queue unavailable</strong>
                  <p>{gradeError}</p>
                </div>
              ) : recentPendingGrades.length === 0 ? (
                <div className="programhead-dashboard__empty">
                  <CheckCircle2 size={23} />
                  <strong>No pending grade reviews</strong>
                  <p>
                    There are currently no Faculty-submitted grades waiting for
                    approval.
                  </p>
                </div>
              ) : (
                recentPendingGrades.map((grade) => (
                  <button
                    type="button"
                    className="programhead-dashboard__grade-item"
                    key={grade.grade_id}
                    onClick={() =>
                      navigate("/programhead/gradeapproval/pending")
                    }
                  >
                    <span className="programhead-dashboard__grade-icon">
                      <GraduationCap size={16} />
                    </span>

                    <span className="programhead-dashboard__grade-copy">
                      <span>
                        {grade.class.subject.subject_code} ·{" "}
                        {grade.class.section.section_name}
                      </span>

                      <strong>{grade.student.full_name}</strong>

                      <small>
                        {grade.student.student_number} · Submitted by{" "}
                        {grade.faculty.faculty_name}
                      </small>
                    </span>

                    <span className="programhead-dashboard__grade-time">
                      <Clock3 size={12} />
                      {formatDateTime(grade.submitted_at)}
                    </span>

                    <ArrowRight size={14} />
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="programhead-dashboard__panel">
            <header className="programhead-dashboard__section-header">
              <div>
                <span className="programhead-dashboard__section-kicker">
                  <Building2 size={13} />
                  Department Overview
                </span>

                <h2>Class Readiness</h2>

                <p>
                  Current class and Faculty-assignment status for your
                  department.
                </p>
              </div>
            </header>

            <div className="programhead-dashboard__readiness">
              {loading ? (
                <div className="programhead-dashboard__readiness-loading">
                  <div />
                  <div />
                  <div />
                </div>
              ) : classError ? (
                <div className="programhead-dashboard__empty">
                  <CircleAlert size={22} />
                  <strong>Department overview unavailable</strong>
                  <p>{classError}</p>
                </div>
              ) : (
                <>
                  <div className="programhead-dashboard__readiness-row">
                    <div>
                      <span>Open Classes</span>
                      <strong>
                        {openClasses} of {totalClasses}
                      </strong>
                    </div>

                    <div className="programhead-dashboard__progress">
                      <span style={{ width: `${openPercent}%` }} />
                    </div>

                    <small>{openPercent}% currently open</small>
                  </div>

                  <div className="programhead-dashboard__readiness-row">
                    <div>
                      <span>Grading Ready</span>
                      <strong>
                        {gradingReady} of {totalClasses}
                      </strong>
                    </div>

                    <div className="programhead-dashboard__progress">
                      <span style={{ width: `${gradingReadyPercent}%` }} />
                    </div>

                    <small>
                      {gradingReadyPercent}% have valid Faculty assignment
                    </small>
                  </div>

                  <div className="programhead-dashboard__mini-grid">
                    <div>
                      <small>Assigned Faculty</small>
                      <strong>{uniqueFacultyCount}</strong>
                    </div>

                    <div>
                      <small>Closed Classes</small>
                      <strong>{closedClasses}</strong>
                    </div>

                    <div>
                      <small>Without Faculty</small>
                      <strong>{classesWithoutFaculty}</strong>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="programhead-dashboard__manage-classes"
                    onClick={() =>
                      navigate("/programhead/class/management")
                    }
                  >
                    Open Class Management
                    <ArrowRight size={14} />
                  </button>
                </>
              )}
            </div>
          </section>
        </div>
      </main>
    </DashboardLayout>
  );
}
