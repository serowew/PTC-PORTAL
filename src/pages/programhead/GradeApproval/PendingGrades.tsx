import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  BookOpenCheck,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  ClipboardCheck,
  Filter,
  GraduationCap,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Undo2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/PendingGrades.css";

const API_BASE_URL = "http://localhost:3000/api/program-head/grades";

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

interface SubmittedGrade {
  grade_id: number;
  enrollment_subject_id: number;
  grade_status: "Submitted";
  grades: {
    prelim_grade: number | null;
    midterm_grade: number | null;
    final_grade: number | null;
    final_rating: number | null;
    remarks: "Passed" | "Failed" | "Incomplete" | null;
  };
  student: {
    student_id: number;
    student_number: string;
    first_name: string;
    middle_name: string | null;
    last_name: string;
    full_name: string;
    enrollment_id: number;
    enrollment_status: string;
    subject_status: string;
  };
  faculty: {
    faculty_id: number;
    employee_number: string;
    first_name: string;
    middle_name: string | null;
    last_name: string;
    faculty_name: string;
    email: string | null;
  };
  class: {
    offering_id: number;
    offering_status: string;
    subject: {
      subject_id: number;
      subject_code: string;
      subject_name: string;
      units: number;
    };
    section: {
      section_id: number;
      section_name: string;
      year_level: number;
      course: {
        course_id: number;
        course_code: string;
        course_name: string;
      };
    };
    academic_period: {
      academic_year_id: number;
      academic_year: string;
      is_current_academic_year: boolean;
      semester_id: number;
      semester_name: string;
    };
    schedule: {
      days: string | null;
      time: string | null;
    };
  };
  submitted_at: string | null;
  review: {
    reviewed_by: number | null;
    reviewed_at: string | null;
    review_remarks: string | null;
  };
  created_at: string | null;
  updated_at: string | null;
}

interface SubmittedGradesResponse {
  success: boolean;
  program_head?: ProgramHeadInfo;
  filters?: {
    academic_year_id: number | null;
    semester_id: number | null;
  };
  summary?: { total_submitted: number };
  grades?: SubmittedGrade[];
  message?: string;
  error?: string;
}

interface MutationResponse {
  success: boolean;
  message?: string;
  error?: string;
}

interface ActionNotice {
  type: "success" | "error";
  message: string;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(
      `Server returned a non-JSON response (${response.status}): ${text.slice(0, 200)}`,
    );
  }
  return response.json() as Promise<T>;
}

function formatGrade(value: number | null) {
  return value === null || value === undefined ? "—" : Number(value).toFixed(2);
}

function formatDateTime(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDays(value: string | null) {
  if (!value) return "Not scheduled";
  return value
    .split(",")
    .map((item) => {
      const day = item.trim();
      return day ? day.charAt(0).toUpperCase() + day.slice(1).toLowerCase() : "";
    })
    .filter(Boolean)
    .join(", ");
}

function getRemarkClass(remark: "Passed" | "Failed" | "Incomplete" | null) {
  return remark ? remark.toLowerCase() : "none";
}

export default function PendingGrades() {
  const navigate = useNavigate();
  const session = authService.getSession();
  const token = authService.getToken();
  const authenticated = Boolean(session && token);
  const userRole = session?.role;

  const [programHead, setProgramHead] = useState<ProgramHeadInfo | null>(null);
  const [grades, setGrades] = useState<SubmittedGrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [search, setSearch] = useState("");
  const [academicYearFilter, setAcademicYearFilter] = useState("All");
  const [semesterFilter, setSemesterFilter] = useState("All");
  const [courseFilter, setCourseFilter] = useState("All");
  const [facultyFilter, setFacultyFilter] = useState("All");

  const [actionGradeId, setActionGradeId] = useState<number | null>(null);
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);
  const [returnGrade, setReturnGrade] = useState<SubmittedGrade | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [returnError, setReturnError] = useState("");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }
    if (userRole !== "Program Head") {
      navigate(authService.getDashboardRoute(session!.role), { replace: true });
    }
  }, [authenticated, userRole, session, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Program Head") return;
    const controller = new AbortController();

    const loadSubmittedGrades = async () => {
      try {
        if (refreshKey === 0) setLoading(true);
        else setRefreshing(true);
        setError("");

        const response = await authService.authFetch(`${API_BASE_URL}/submitted`, {
          method: "GET",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        const data = await readJsonResponse<SubmittedGradesResponse>(response);

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }
        if (response.status === 403) {
          throw new Error(data.message || "Program Head access is required.");
        }
        if (!response.ok || !data.success) {
          throw new Error(data.message || data.error || "Unable to load submitted grades.");
        }

        const loadedGrades = Array.isArray(data.grades)
          ? data.grades.filter(
              (grade) =>
                grade.grade_status === "Submitted" &&
                [1, 2].includes(Number(grade.class.academic_period.semester_id)),
            )
          : [];

        setProgramHead(data.program_head || null);
        setGrades(loadedGrades);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        console.error("LOAD PROGRAM HEAD SUBMITTED GRADES ERROR:", requestError);
        setProgramHead(null);
        setGrades([]);
        setError(
          requestError instanceof Error ? requestError.message : "Unable to load submitted grades.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void loadSubmittedGrades();
    return () => controller.abort();
  }, [authenticated, userRole, navigate, refreshKey]);

  const academicYears = useMemo(() => {
    const values = new Map<number, string>();
    grades.forEach((grade) =>
      values.set(
        grade.class.academic_period.academic_year_id,
        grade.class.academic_period.academic_year,
      ),
    );
    return Array.from(values.entries()).sort((a, b) => b[0] - a[0]);
  }, [grades]);

  const semesters = useMemo(() => {
    const values = new Map<number, string>();
    grades.forEach((grade) => {
      const id = Number(grade.class.academic_period.semester_id);
      if (id === 1 || id === 2) values.set(id, grade.class.academic_period.semester_name);
    });
    return Array.from(values.entries()).sort((a, b) => a[0] - b[0]);
  }, [grades]);

  const courses = useMemo(
    () =>
      Array.from(
        new Map(
          grades.map((grade) => [
            grade.class.section.course.course_id,
            grade.class.section.course.course_code,
          ]),
        ).entries(),
      ).sort((a, b) => a[1].localeCompare(b[1])),
    [grades],
  );

  const faculties = useMemo(
    () =>
      Array.from(
        new Map(
          grades.map((grade) => [grade.faculty.faculty_id, grade.faculty.faculty_name]),
        ).entries(),
      ).sort((a, b) => a[1].localeCompare(b[1])),
    [grades],
  );

  const filteredGrades = useMemo(() => {
    const q = search.trim().toLowerCase();
    return grades.filter((grade) => {
      const matchesSearch =
        !q ||
        grade.student.student_number.toLowerCase().includes(q) ||
        grade.student.full_name.toLowerCase().includes(q) ||
        grade.class.subject.subject_code.toLowerCase().includes(q) ||
        grade.class.subject.subject_name.toLowerCase().includes(q) ||
        grade.class.section.section_name.toLowerCase().includes(q) ||
        grade.faculty.faculty_name.toLowerCase().includes(q);

      return (
        matchesSearch &&
        (academicYearFilter === "All" ||
          String(grade.class.academic_period.academic_year_id) === academicYearFilter) &&
        (semesterFilter === "All" ||
          String(grade.class.academic_period.semester_id) === semesterFilter) &&
        (courseFilter === "All" ||
          String(grade.class.section.course.course_id) === courseFilter) &&
        (facultyFilter === "All" || String(grade.faculty.faculty_id) === facultyFilter)
      );
    });
  }, [grades, search, academicYearFilter, semesterFilter, courseFilter, facultyFilter]);

  const summary = useMemo(() => {
    const classIds = new Set<number>();
    const facultyIds = new Set<number>();
    filteredGrades.forEach((grade) => {
      classIds.add(grade.class.offering_id);
      facultyIds.add(grade.faculty.faculty_id);
    });
    return {
      totalPending: filteredGrades.length,
      classes: classIds.size,
      faculties: facultyIds.size,
      passed: filteredGrades.filter((g) => g.grades.remarks === "Passed").length,
      incomplete: filteredGrades.filter((g) => g.grades.remarks === "Incomplete").length,
      failed: filteredGrades.filter((g) => g.grades.remarks === "Failed").length,
    };
  }, [filteredGrades]);

  const hasActiveFilters =
    search.trim() !== "" ||
    academicYearFilter !== "All" ||
    semesterFilter !== "All" ||
    courseFilter !== "All" ||
    facultyFilter !== "All";

  const clearFilters = () => {
    setSearch("");
    setAcademicYearFilter("All");
    setSemesterFilter("All");
    setCourseFilter("All");
    setFacultyFilter("All");
  };

  const refreshQueue = () => {
    setActionNotice(null);
    setRefreshKey((current) => current + 1);
  };

  const approveGrade = async (grade: SubmittedGrade) => {
    const confirmed = window.confirm(
      `Approve the submitted grade for ${grade.student.student_number} - ${grade.student.full_name}?\n\nSubject: ${grade.class.subject.subject_code}\nFinal Rating: ${formatGrade(
        grade.grades.final_rating,
      )}\nRemarks: ${grade.grades.remarks || "—"}\n\nApproved grades become official and locked.`,
    );
    if (!confirmed) return;

    try {
      setActionGradeId(grade.grade_id);
      setActionNotice(null);
      const response = await authService.authFetch(
        `${API_BASE_URL}/${grade.grade_id}/approve`,
        { method: "PATCH" },
      );
      const data = await readJsonResponse<MutationResponse>(response);
      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }
      if (!response.ok || !data.success) {
        throw new Error(data.message || data.error || "Unable to approve grade.");
      }
      setActionNotice({ type: "success", message: data.message || "Grade approved successfully." });
      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      console.error("PROGRAM HEAD APPROVE GRADE ERROR:", requestError);
      setActionNotice({
        type: "error",
        message: requestError instanceof Error ? requestError.message : "Unable to approve grade.",
      });
    } finally {
      setActionGradeId(null);
    }
  };

  const openReturnModal = (grade: SubmittedGrade) => {
    setReturnGrade(grade);
    setReturnReason("");
    setReturnError("");
  };

  const closeReturnModal = () => {
    if (actionGradeId !== null) return;
    setReturnGrade(null);
    setReturnReason("");
    setReturnError("");
  };

  const submitReturn = async () => {
    if (!returnGrade) return;
    const reason = returnReason.trim();
    if (!reason) {
      setReturnError("A return reason is required.");
      return;
    }
    if (reason.length > 500) {
      setReturnError("Return reason cannot exceed 500 characters.");
      return;
    }

    try {
      setActionGradeId(returnGrade.grade_id);
      setReturnError("");
      setActionNotice(null);
      const response = await authService.authFetch(
        `${API_BASE_URL}/${returnGrade.grade_id}/return`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ review_remarks: reason }),
        },
      );
      const data = await readJsonResponse<MutationResponse>(response);
      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }
      if (!response.ok || !data.success) {
        throw new Error(data.message || data.error || "Unable to return grade.");
      }
      setActionNotice({
        type: "success",
        message: data.message || "Grade returned to Faculty successfully.",
      });
      setReturnGrade(null);
      setReturnReason("");
      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      console.error("PROGRAM HEAD RETURN GRADE ERROR:", requestError);
      setReturnError(requestError instanceof Error ? requestError.message : "Unable to return grade.");
    } finally {
      setActionGradeId(null);
    }
  };

  useEffect(() => {
    if (!returnGrade) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && actionGradeId === null) closeReturnModal();
    };
    window.addEventListener("keydown", handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [returnGrade, actionGradeId]);

  if (!authenticated || !session || userRole !== "Program Head") return null;

  return (
    <DashboardLayout>
      <main className="program-head-pending-grades-page">
        <section className="program-head-grades-header">
          <div className="program-head-grades-header-copy">
            <div className="program-head-grades-eyebrow">
              <span><ClipboardCheck size={16} strokeWidth={2.2} /></span>
              Program Head · Grade Review
            </div>
            <h1>Pending Grade Approvals</h1>
            <p>
              Review Faculty-submitted grades within your department before they become official academic results.
            </p>
            {programHead && (
              <div className="program-head-grades-context">
                <span><Building2 size={14} />{programHead.department.department_name}</span>
                <i />
                <span><UserRound size={14} />{programHead.program_head_name}</span>
              </div>
            )}
          </div>

          <div className="program-head-grades-header-actions">
            <button
              type="button"
              className="program-head-grades-back"
              onClick={() => navigate("/programhead/dashboard")}
            >
              <ArrowLeft size={15} /> Dashboard
            </button>
            <button
              type="button"
              className="program-head-grades-refresh"
              onClick={refreshQueue}
              disabled={loading || refreshing || actionGradeId !== null}
            >
              <RefreshCw size={15} className={refreshing ? "program-head-grades-spin" : ""} />
              {refreshing ? "Refreshing..." : "Refresh Queue"}
            </button>
          </div>
        </section>

        {programHead && (
          <section className="program-head-review-profile">
            <div>
              <span className="program-head-review-profile-icon"><ShieldCheck size={18} /></span>
              <div><small>Program Head</small><strong>{programHead.program_head_name}</strong></div>
            </div>
            <div>
              <span className="program-head-review-profile-icon"><UserRound size={18} /></span>
              <div><small>Employee Number</small><strong>{programHead.employee_number}</strong></div>
            </div>
            <div>
              <span className="program-head-review-profile-icon"><Building2 size={18} /></span>
              <div>
                <small>Department</small>
                <strong>{programHead.department.department_code}</strong>
                <span>{programHead.department.department_name}</span>
              </div>
            </div>
          </section>
        )}

        {actionNotice && (
          <section className={`program-head-action-notice ${actionNotice.type}`} role="status">
            <span>
              {actionNotice.type === "success" ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}
            </span>
            <div>
              <strong>{actionNotice.type === "success" ? "Grade review updated" : "Grade review failed"}</strong>
              <p>{actionNotice.message}</p>
            </div>
          </section>
        )}

        <section className="program-head-grade-summary" aria-label="Grade review summary">
          <article className="program-head-grade-summary-card program-head-grade-summary-card--primary">
            <span className="program-head-grade-summary-icon"><ClipboardCheck size={19} /></span>
            <div><small>Pending Review</small><strong>{loading ? "…" : summary.totalPending}</strong><span>Submitted grades in this view</span></div>
          </article>
          <article className="program-head-grade-summary-card">
            <span className="program-head-grade-summary-icon"><BookOpenCheck size={19} /></span>
            <div><small>Classes</small><strong>{loading ? "…" : summary.classes}</strong><span>Classes represented in queue</span></div>
          </article>
          <article className="program-head-grade-summary-card">
            <span className="program-head-grade-summary-icon"><UsersRound size={19} /></span>
            <div><small>Faculty</small><strong>{loading ? "…" : summary.faculties}</strong><span>Submitting Faculty members</span></div>
          </article>
          <article className="program-head-grade-summary-card">
            <span className="program-head-grade-summary-icon program-head-grade-summary-icon--passed"><Check size={19} /></span>
            <div><small>Passed</small><strong>{loading ? "…" : summary.passed}</strong><span>Submitted passing results</span></div>
          </article>
          <article className="program-head-grade-summary-card">
            <span className="program-head-grade-summary-icon program-head-grade-summary-icon--incomplete"><Clock3 size={19} /></span>
            <div><small>Incomplete</small><strong>{loading ? "…" : summary.incomplete}</strong><span>Incomplete submitted results</span></div>
          </article>
          <article className="program-head-grade-summary-card">
            <span className="program-head-grade-summary-icon program-head-grade-summary-icon--failed"><AlertCircle size={19} /></span>
            <div><small>Failed</small><strong>{loading ? "…" : summary.failed}</strong><span>Submitted failing results</span></div>
          </article>
        </section>

        <section className="program-head-grade-filters">
          <header className="program-head-grade-filters-header">
            <div>
              <span className="program-head-grade-filters-icon"><Filter size={16} /></span>
              <div>
                <strong>Review Filters</strong>
                <p>Find a student or narrow the approval queue by academic period, course, or Faculty.</p>
              </div>
            </div>
            {hasActiveFilters && (
              <button type="button" className="program-head-filter-clear" onClick={clearFilters}>
                <RotateCcw size={14} /> Clear Filters
              </button>
            )}
          </header>

          <div className="program-head-grade-filter-grid">
            <label className="program-head-grade-search">
              <span>Search</span>
              <div>
                <Search size={15} />
                <input
                  id="program-head-grade-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Student, subject, section, faculty..."
                />
              </div>
            </label>
            <label>
              <span>Academic Year</span>
              <select value={academicYearFilter} onChange={(event) => setAcademicYearFilter(event.target.value)}>
                <option value="All">All Years</option>
                {academicYears.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>Semester</span>
              <select value={semesterFilter} onChange={(event) => setSemesterFilter(event.target.value)}>
                <option value="All">All Semesters</option>
                {semesters.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>Course</span>
              <select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}>
                <option value="All">All Courses</option>
                {courses.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>Faculty</span>
              <select value={facultyFilter} onChange={(event) => setFacultyFilter(event.target.value)}>
                <option value="All">All Faculty</option>
                {faculties.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
          </div>
        </section>

        {error && !loading && (
          <section className="program-head-grade-error" role="alert">
            <span><AlertCircle size={20} /></span>
            <div><strong>Pending grades could not be loaded</strong><p>{error}</p></div>
            <button type="button" onClick={refreshQueue}>Try Again</button>
          </section>
        )}

        {loading && (
          <section className="program-head-grade-loading">
            <div className="program-head-grade-loading-header">
              <div><span>Grade Review Queue</span><h2>Submitted Grades</h2></div>
            </div>
            <div className="program-head-grade-skeleton-list">
              {[1, 2, 3].map((item) => (
                <div className="program-head-grade-skeleton" key={item}>
                  <i /><span><i /><i /></span><span><i /><i /></span><i />
                </div>
              ))}
            </div>
          </section>
        )}

        {!loading && !error && filteredGrades.length === 0 && (
          <section className="program-head-grade-empty">
            <span><CheckCircle2 size={24} /></span>
            <strong>No pending grade approvals</strong>
            <p>
              {grades.length === 0
                ? "There are currently no Faculty-submitted grades waiting for your department review."
                : "There are no Faculty-submitted grades matching the current filters."}
            </p>
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters}><RotateCcw size={14} /> Clear Filters</button>
            )}
          </section>
        )}

        {!loading && !error && filteredGrades.length > 0 && (
          <section className="program-head-grade-queue">
            <header className="program-head-grade-queue-header">
              <div>
                <span>Grade Review Queue</span>
                <h2>Submitted Grades</h2>
                <p>
                  Verify the grade components, final rating, remarks, Faculty, and class information before approving an official academic result.
                </p>
              </div>
              <strong>
                {filteredGrades.length} {filteredGrades.length === 1 ? "pending grade" : "pending grades"}
              </strong>
            </header>

            <div className="program-head-grade-table-wrapper">
              <table className="program-head-grade-table">
                <thead>
                  <tr>
                    <th>Student</th><th>Class</th><th>Faculty</th><th>Prelim</th><th>Midterm</th>
                    <th>Final</th><th>Final Rating</th><th>Remarks</th><th>Submitted</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGrades.map((grade) => {
                    const busy = actionGradeId === grade.grade_id;
                    return (
                      <tr key={grade.grade_id}>
                        <td>
                          <div className="program-head-review-student">
                            <span className="program-head-review-avatar"><GraduationCap size={16} /></span>
                            <div>
                              <strong>{grade.student.full_name}</strong>
                              <span>{grade.student.student_number}</span>
                              <small>ES #{grade.enrollment_subject_id}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="program-head-review-class">
                            <strong>{grade.class.subject.subject_code}</strong>
                            <span>{grade.class.subject.subject_name}</span>
                            <small>
                              {grade.class.section.section_name} · {grade.class.section.course.course_code} · {grade.class.academic_period.academic_year} · {grade.class.academic_period.semester_name}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="program-head-review-faculty">
                            <strong>{grade.faculty.faculty_name}</strong>
                            <small>{grade.faculty.employee_number}</small>
                          </div>
                        </td>
                        <td><span className="program-head-grade-value">{formatGrade(grade.grades.prelim_grade)}</span></td>
                        <td><span className="program-head-grade-value">{formatGrade(grade.grades.midterm_grade)}</span></td>
                        <td><span className="program-head-grade-value">{formatGrade(grade.grades.final_grade)}</span></td>
                        <td><strong className="program-head-final-rating">{formatGrade(grade.grades.final_rating)}</strong></td>
                        <td>
                          <span className={`program-head-grade-remark ${getRemarkClass(grade.grades.remarks)}`}>
                            {grade.grades.remarks || "—"}
                          </span>
                        </td>
                        <td>
                          <div className="program-head-submitted-time">
                            <span><CalendarDays size={13} />{formatDateTime(grade.submitted_at)}</span>
                            <small>{formatDays(grade.class.schedule.days)} · {grade.class.schedule.time || "No schedule"}</small>
                          </div>
                        </td>
                        <td>
                          <div className="program-head-grade-actions">
                            <button type="button" className="program-head-return-button" onClick={() => openReturnModal(grade)} disabled={busy}>
                              <Undo2 size={14} /> Return
                            </button>
                            <button type="button" className="program-head-approve-button" onClick={() => void approveGrade(grade)} disabled={busy}>
                              <Check size={14} /> {busy ? "Processing..." : "Approve"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {!loading && !error && (
          <section className="program-head-review-workflow">
            <header>
              <span>Grade Approval Process</span>
              <h2>Review Workflow</h2>
              <p>
                Submitted grades remain pending until the Program Head approves them or returns them to Faculty for correction.
              </p>
            </header>
            <div className="program-head-review-workflow-grid">
              <article><span>1</span><div><strong>Faculty Submits</strong><p>Faculty sends a completed grade to the Program Head review queue.</p></div></article>
              <article><span>2</span><div><strong>Review</strong><p>Verify grade components, final rating, remarks, student, and class information.</p></div></article>
              <article><span>3</span><div><strong>Approve</strong><p>Approval makes the grade an official academic result and locks normal editing.</p></div></article>
              <article><span>4</span><div><strong>Return</strong><p>Returned grades go back to Faculty with your reason for correction and resubmission.</p></div></article>
            </div>
          </section>
        )}

        {returnGrade && (
          <div
            className="program-head-return-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeReturnModal();
            }}
          >
            <section className="program-head-return-modal" role="dialog" aria-modal="true" aria-labelledby="program-head-return-title">
              <header className="program-head-return-modal-header">
                <div>
                  <span className="program-head-return-modal-icon"><Undo2 size={18} /></span>
                  <div>
                    <small>Grade Review</small>
                    <h2 id="program-head-return-title">Return Grade to Faculty</h2>
                    <p>Explain what needs to be reviewed or corrected before resubmission.</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="program-head-return-close"
                  onClick={closeReturnModal}
                  disabled={actionGradeId !== null}
                  aria-label="Close return grade modal"
                ><X size={18} /></button>
              </header>

              <div className="program-head-return-grade-summary">
                <div><span>Student</span><strong>{returnGrade.student.full_name}</strong><small>{returnGrade.student.student_number}</small></div>
                <div><span>Subject</span><strong>{returnGrade.class.subject.subject_code}</strong><small>{returnGrade.class.subject.subject_name}</small></div>
                <div><span>Faculty</span><strong>{returnGrade.faculty.faculty_name}</strong><small>{returnGrade.faculty.employee_number}</small></div>
                <div><span>Final Rating</span><strong>{formatGrade(returnGrade.grades.final_rating)}</strong><small>{returnGrade.grades.remarks || "No remarks"}</small></div>
              </div>

              <div className="program-head-return-field">
                <div className="program-head-return-label">
                  <label htmlFor="program-head-return-reason">Return Reason</label>
                  <span>{returnReason.length}/500</span>
                </div>
                <textarea
                  id="program-head-return-reason"
                  value={returnReason}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value.length <= 500) {
                      setReturnReason(value);
                      setReturnError("");
                    }
                  }}
                  disabled={actionGradeId !== null}
                  maxLength={500}
                  rows={6}
                  placeholder="Example: Please verify the final rating before resubmitting."
                  autoFocus
                />
                <small>A clear reason is required so the Faculty knows what needs correction.</small>
              </div>

              {returnError && (
                <div className="program-head-return-error" role="alert"><AlertCircle size={14} />{returnError}</div>
              )}

              <footer className="program-head-return-modal-actions">
                <button type="button" className="program-head-return-cancel" onClick={closeReturnModal} disabled={actionGradeId !== null}>Cancel</button>
                <button
                  type="button"
                  className="program-head-return-confirm"
                  onClick={() => void submitReturn()}
                  disabled={actionGradeId !== null || !returnReason.trim()}
                >
                  <Undo2 size={14} />
                  {actionGradeId === returnGrade.grade_id ? "Returning..." : "Return to Faculty"}
                </button>
              </footer>
            </section>
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
