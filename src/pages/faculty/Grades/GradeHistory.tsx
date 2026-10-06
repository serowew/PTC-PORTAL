import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  BadgeCheck,
  BookOpenCheck,
  CheckCircle2,
  History,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Undo2,
  UsersRound,
} from "lucide-react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { api } from "../../../services/api";
import "../../../styles/GradeHistory.css";

const API_BASE_URL = `${api.baseUrl}/api/faculty/classes`;

type GradeStatus = "Draft" | "Submitted" | "Returned" | "Approved";
type GradeRemark = "Passed" | "Failed" | "Incomplete" | "Unofficial Drop";

interface FacultyInfo {
  faculty_id: number;
  employee_number: string;
  faculty_name: string;
}
interface FacultyClass {
  offering_id: number;
  section_subject_id?: number;
  offering_status: string;
  section_subject_status?: string;
  subject: {
    subject_id?: number;
    subject_code: string;
    subject_name: string;
    units: number;
  };
  section: {
    section_id?: number;
    section_name: string;
    year_level: number;
    course: {
      course_id?: number;
      course_code: string;
      course_name: string;
    };
  };
  academic_period: {
    academic_year_id?: number;
    academic_year: string;
    semester_id?: number;
    semester_name: string;
  };
  schedule: {
    days: string | null;
    time: string | null;
  };
  room?: {
    room_id: number;
    room_code?: string | null;
    room_name?: string | null;
  } | null;
}
interface FacultyClassesResponse {
  success: boolean;
  faculty?: FacultyInfo;
  classes?: FacultyClass[];
  message?: string;
  error?: string;
}
interface GradeReview {
  reviewed_by: number | null;
  reviewed_by_username: string | null;
  reviewed_at: string | null;
  review_remarks: string | null;
}
interface FacultyGrade {
  grade_id: number;
  faculty_id: number | null;
  midterm_grade: number | null;
  final_grade: number | null;
  overall_percentage: number | null;
  final_rating: number | null;
  grading_policy?: string | null;
  grading_outcome?: string | null;
  outcome_reason?: string | null;
  remarks: GradeRemark | null;
  grade_status: GradeStatus;
  submitted_at: string | null;
  review: GradeReview;
  created_at: string | null;
  updated_at: string | null;
}
interface GradebookStudent {
  enrollment_subject_id: number;
  enrollment_id: number;
  student_id: number;
  student_number: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  full_name: string;
  email: string | null;
  enrollment_status: string;
  subject_status: string;
  grade: FacultyGrade | null;
}
interface GradebookResponse {
  success: boolean;
  faculty?: FacultyInfo;
  class?: FacultyClass;
  students?: GradebookStudent[];
  message?: string;
  error?: string;
}
interface HistoryRow {
  offering: FacultyClass;
  student: GradebookStudent;
  grade: FacultyGrade;
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

function hasGradeHistory(grade: FacultyGrade | null): grade is FacultyGrade {
  return Boolean(grade && grade.grade_status !== "Draft");
}

function formatGrade(value: number | null): string {
  if (value === null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(2);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getStatusClass(status: GradeStatus): string {
  return status.toLowerCase();
}

function getResultClass(remark: GradeRemark | null): string {
  if (!remark) return "neutral";
  if (remark === "Passed") return "passed";
  if (remark === "Failed") return "failed";
  if (remark === "Incomplete") return "incomplete";
  return "drop";
}

function getActivityTimestamp(grade: FacultyGrade): number {
  const value =
    grade.review.reviewed_at ||
    grade.submitted_at ||
    grade.updated_at ||
    grade.created_at;
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export default function GradeHistory() {
  const navigate = useNavigate();
  const session = authService.getSession();
  const token = authService.getToken();
  const userRole = session?.role;
  const authenticated = Boolean(session && token);
  const [faculty, setFaculty] = useState<FacultyInfo | null>(null);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [partialError, setPartialError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("All");
  const [academicYearFilter, setAcademicYearFilter] = useState("All");
  const [semesterFilter, setSemesterFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }
    if (userRole !== "Faculty" && session) {
      navigate(authService.getDashboardRoute(session.role), { replace: true });
    }
  }, [authenticated, userRole, session, navigate]);

  const loadHistory = useCallback(
    async (signal: AbortSignal, isRefresh: boolean) => {
      if (!authenticated || userRole !== "Faculty") return;
      try {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
        setError("");
        setPartialError("");
        const classesResponse = await authService.authFetch(API_BASE_URL, {
          method: "GET",
          signal,
          headers: { Accept: "application/json" },
        });
        const classesData =
          await readJsonResponse<FacultyClassesResponse>(classesResponse);
        if (classesResponse.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }
        if (!classesResponse.ok || !classesData.success) {
          throw new Error(
            classesData.message ||
              classesData.error ||
              "Unable to load assigned Faculty classes.",
          );
        }
        const loadedClasses = Array.isArray(classesData.classes)
          ? classesData.classes
          : [];
        setFaculty(classesData.faculty || null);
        const gradebooks = await Promise.allSettled(
          loadedClasses.map(async (offering) => {
            const response = await authService.authFetch(
              `${API_BASE_URL}/${offering.offering_id}/gradebook`,
              {
                method: "GET",
                signal,
                headers: { Accept: "application/json" },
              },
            );
            const data = await readJsonResponse<GradebookResponse>(response);
            if (response.status === 401) throw new Error("SESSION_EXPIRED");
            if (!response.ok || !data.success) {
              throw new Error(
                data.message ||
                  data.error ||
                  `Unable to load ${offering.subject.subject_code}.`,
              );
            }
            return {
              offering: data.class || offering,
              faculty: data.faculty,
              students: Array.isArray(data.students) ? data.students : [],
            };
          }),
        );
        if (signal.aborted) return;
        const nextRows: HistoryRow[] = [];
        const failedClasses: string[] = [];
        for (let index = 0; index < gradebooks.length; index += 1) {
          const result = gradebooks[index];
          const fallbackClass = loadedClasses[index];
          if (result.status === "fulfilled") {
            if (result.value.faculty) setFaculty(result.value.faculty);
            result.value.students.forEach((student) => {
              if (hasGradeHistory(student.grade)) {
                nextRows.push({
                  offering: result.value.offering,
                  student,
                  grade: student.grade,
                });
              }
            });
            continue;
          }
          if (
            result.reason instanceof Error &&
            result.reason.message === "SESSION_EXPIRED"
          ) {
            authService.logout();
            navigate("/login", { replace: true });
            return;
          }
          failedClasses.push(fallbackClass.subject.subject_code);
        }
        nextRows.sort(
          (a, b) =>
            getActivityTimestamp(b.grade) - getActivityTimestamp(a.grade),
        );
        setRows(nextRows);
        if (failedClasses.length > 0) {
          setPartialError(
            `Some class gradebooks could not be loaded: ${failedClasses.join(", ")}.`,
          );
        }
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }
        console.error("LOAD FACULTY GRADE HISTORY ERROR:", requestError);
        setFaculty(null);
        setRows([]);
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load Faculty grade history.",
        );
      } finally {
        if (!signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [authenticated, userRole, navigate],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadHistory(controller.signal, refreshKey > 0);
    return () => controller.abort();
  }, [loadHistory, refreshKey]);

  const classOptions = useMemo(() => {
    const values = new Map<number, FacultyClass>();
    rows.forEach(({ offering }) => values.set(offering.offering_id, offering));
    return Array.from(values.values());
  }, [rows]);

  const academicYears = useMemo(
    () =>
      Array.from(
        new Set(rows.map(({ offering }) => offering.academic_period.academic_year)),
      ),
    [rows],
  );

  const semesters = useMemo(
    () =>
      Array.from(
        new Set(rows.map(({ offering }) => offering.academic_period.semester_name)),
      ),
    [rows],
  );

  const overview = useMemo(() => {
    const submitted = rows.filter(
      ({ grade }) => grade.grade_status === "Submitted",
    ).length;
    const returned = rows.filter(
      ({ grade }) => grade.grade_status === "Returned",
    ).length;
    const approved = rows.filter(
      ({ grade }) => grade.grade_status === "Approved",
    ).length;
    return {
      records: rows.length,
      submitted,
      returned,
      approved,
      classesWithHistory: new Set(
        rows.map(({ offering }) => offering.offering_id),
      ).size,
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return rows.filter(({ offering, student, grade }) => {
      const searchable = [
        student.student_number,
        student.full_name,
        student.email || "",
        offering.subject.subject_code,
        offering.subject.subject_name,
        offering.section.section_name,
        offering.section.course.course_code,
        offering.academic_period.academic_year,
        offering.academic_period.semester_name,
        grade.remarks || "",
        grade.review.reviewed_by_username || "",
        grade.review.review_remarks || "",
      ]
        .join(" ")
        .toLowerCase();
      return (
        (!normalizedSearch || searchable.includes(normalizedSearch)) &&
        (classFilter === "All" ||
          offering.offering_id === Number(classFilter)) &&
        (academicYearFilter === "All" ||
          offering.academic_period.academic_year === academicYearFilter) &&
        (semesterFilter === "All" ||
          offering.academic_period.semester_name === semesterFilter) &&
        (statusFilter === "All" || grade.grade_status === statusFilter)
      );
    });
  }, [
    rows,
    search,
    classFilter,
    academicYearFilter,
    semesterFilter,
    statusFilter,
  ]);

  const clearFilters = () => {
    setSearch("");
    setClassFilter("All");
    setAcademicYearFilter("All");
    setSemesterFilter("All");
    setStatusFilter("All");
  };

  const hasActiveFilters =
    search.trim() !== "" ||
    classFilter !== "All" ||
    academicYearFilter !== "All" ||
    semesterFilter !== "All" ||
    statusFilter !== "All";

  if (!authenticated || userRole !== "Faculty") return null;

  return (
    <DashboardLayout>
      <main className="faculty-grade-history">
        <section className="faculty-grade-history__hero">
          <div className="faculty-grade-history__hero-copy">
            <div className="faculty-grade-history__eyebrow">
              <span>
                <History size={16} strokeWidth={2.2} aria-hidden="true" />
              </span>
              Faculty · Grade Records
            </div>
            <h1>Grade History</h1>
            <p>
              Review submitted, returned, and approved grade records from your
              assigned classes. Stored grade values are displayed exactly as
              returned by the existing gradebook API.
            </p>
            {faculty && (
              <div className="faculty-grade-history__identity">
                <UsersRound size={14} aria-hidden="true" />
                <strong>{faculty.faculty_name}</strong>
                <span>{faculty.employee_number}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            className="faculty-grade-history__refresh"
            onClick={() => setRefreshKey((current) => current + 1)}
            disabled={loading || refreshing}
          >
            <RefreshCw
              size={16}
              className={refreshing ? "is-spinning" : undefined}
              aria-hidden="true"
            />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </section>

        {error && (
          <section
            className="faculty-grade-history__notice faculty-grade-history__notice--error"
            role="alert"
          >
            <AlertCircle size={18} aria-hidden="true" />
            <div>
              <strong>Grade history could not be loaded</strong>
              <p>{error}</p>
            </div>
            <button
              type="button"
              onClick={() => setRefreshKey((current) => current + 1)}
            >
              Try Again
            </button>
          </section>
        )}

        {partialError && !error && (
          <section
            className="faculty-grade-history__notice faculty-grade-history__notice--warning"
            role="status"
          >
            <AlertCircle size={18} aria-hidden="true" />
            <div>
              <strong>Some gradebooks are unavailable</strong>
              <p>{partialError}</p>
            </div>
          </section>
        )}

        <section
          className="faculty-grade-history__overview"
          aria-label="Grade history overview"
        >
          <article>
            <span className="faculty-grade-history__overview-icon">
              <History size={19} aria-hidden="true" />
            </span>
            <div>
              <small>History Records</small>
              <strong>{loading ? "…" : overview.records}</strong>
              <span>{overview.classesWithHistory} class(es) with history</span>
            </div>
          </article>
          <article>
            <span className="faculty-grade-history__overview-icon">
              <Send size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Submitted</small>
              <strong>{loading ? "…" : overview.submitted}</strong>
              <span>Waiting for Program Head review</span>
            </div>
          </article>
          <article>
            <span className="faculty-grade-history__overview-icon">
              <Undo2 size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Returned</small>
              <strong>{loading ? "…" : overview.returned}</strong>
              <span>Returned for faculty correction</span>
            </div>
          </article>
          <article>
            <span className="faculty-grade-history__overview-icon">
              <BadgeCheck size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Approved</small>
              <strong>{loading ? "…" : overview.approved}</strong>
              <span>Reviewed and approved records</span>
            </div>
          </article>
        </section>

        <section className="faculty-grade-history__panel">
          <header className="faculty-grade-history__panel-header">
            <div>
              <span>Grade Record Archive</span>
              <h2>Historical Grade Records</h2>
              <p>
                Search by student, subject, section, reviewer, or review remarks,
                then narrow the results using the available class and status data.
              </p>
            </div>
            <div className="faculty-grade-history__panel-count">
              {filteredRows.length} {filteredRows.length === 1 ? "record" : "records"}
            </div>
          </header>

          <div className="faculty-grade-history__filters">
            <label className="faculty-grade-history__search">
              <span>Search</span>
              <div>
                <Search size={15} aria-hidden="true" />
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Student, subject, section, reviewer..."
                />
              </div>
            </label>
            <label>
              <span>Assigned Class</span>
              <select
                value={classFilter}
                onChange={(event) => setClassFilter(event.target.value)}
              >
                <option value="All">All Classes</option>
                {classOptions.map((item) => (
                  <option key={item.offering_id} value={item.offering_id}>
                    {item.subject.subject_code} — {item.section.section_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Academic Year</span>
              <select
                value={academicYearFilter}
                onChange={(event) => setAcademicYearFilter(event.target.value)}
              >
                <option value="All">All Academic Years</option>
                {academicYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Semester</span>
              <select
                value={semesterFilter}
                onChange={(event) => setSemesterFilter(event.target.value)}
              >
                <option value="All">All Semesters</option>
                {semesters.map((semester) => (
                  <option key={semester} value={semester}>
                    {semester}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="All">All History Statuses</option>
                <option value="Submitted">Submitted</option>
                <option value="Returned">Returned</option>
                <option value="Approved">Approved</option>
              </select>
            </label>
            <button
              type="button"
              className="faculty-grade-history__clear"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Clear
            </button>
          </div>

          {loading ? (
            <div className="faculty-grade-history__state">
              <div className="faculty-grade-history__spinner" />
              <strong>Loading grade history</strong>
              <span>Retrieving submitted and reviewed grade records...</span>
            </div>
          ) : !error && rows.length === 0 ? (
            <div className="faculty-grade-history__state faculty-grade-history__state--empty">
              <BookOpenCheck size={27} aria-hidden="true" />
              <strong>No grade history yet</strong>
              <span>
                Submitted, returned, and approved grade records will appear here.
              </span>
            </div>
          ) : !error && filteredRows.length === 0 ? (
            <div className="faculty-grade-history__state faculty-grade-history__state--empty">
              <Search size={27} aria-hidden="true" />
              <strong>No matching history records</strong>
              <span>No historical grade record matches the current filters.</span>
              <button type="button" onClick={clearFilters}>
                Clear Filters
              </button>
            </div>
          ) : !error ? (
            <>
              <div className="faculty-grade-history__table-meta">
                <span>
                  Showing <strong>{filteredRows.length}</strong> of{" "}
                  <strong>{rows.length}</strong> historical grade records
                </span>
                <small>No grade values are recalculated on this page.</small>
              </div>
              <div className="faculty-grade-history__table-wrap">
                <table className="faculty-grade-history__table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Subject</th>
                      <th>Section</th>
                      <th>Academic Period</th>
                      <th>Midterm</th>
                      <th>Final Term</th>
                      <th>Final Rating</th>
                      <th>Result</th>
                      <th>Status</th>
                      <th>History</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map(({ offering, student, grade }) => (
                      <tr
                        key={`${offering.offering_id}-${student.enrollment_subject_id}-${grade.grade_id}`}
                      >
                        <td>
                          <div className="faculty-grade-history__stack">
                            <strong>{student.full_name}</strong>
                            <span>{student.student_number}</span>
                            {student.email && <small>{student.email}</small>}
                          </div>
                        </td>
                        <td>
                          <div className="faculty-grade-history__stack">
                            <strong>{offering.subject.subject_code}</strong>
                            <span>{offering.subject.subject_name}</span>
                            <small>{offering.subject.units} unit(s)</small>
                          </div>
                        </td>
                        <td>
                          <div className="faculty-grade-history__stack">
                            <strong>{offering.section.section_name}</strong>
                            <span>{offering.section.course.course_code}</span>
                            <small>Year {offering.section.year_level}</small>
                          </div>
                        </td>
                        <td>
                          <div className="faculty-grade-history__stack">
                            <strong>
                              {offering.academic_period.academic_year}
                            </strong>
                            <span>
                              {offering.academic_period.semester_name}
                            </span>
                          </div>
                        </td>
                        <td className="faculty-grade-history__grade-cell">
                          {formatGrade(grade.midterm_grade)}
                        </td>
                        <td className="faculty-grade-history__grade-cell">
                          {formatGrade(grade.final_grade)}
                        </td>
                        <td>
                          <div className="faculty-grade-history__rating">
                            <strong>{formatGrade(grade.final_rating)}</strong>
                            {grade.overall_percentage !== null && (
                              <small>
                                {formatGrade(grade.overall_percentage)}%
                              </small>
                            )}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`faculty-grade-history__result faculty-grade-history__result--${getResultClass(
                              grade.remarks,
                            )}`}
                          >
                            {grade.remarks || "No Result"}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`faculty-grade-history__status faculty-grade-history__status--${getStatusClass(
                              grade.grade_status,
                            )}`}
                          >
                            {grade.grade_status}
                          </span>
                        </td>
                        <td>
                          <div className="faculty-grade-history__timeline">
                            <span>
                              <Send size={12} aria-hidden="true" />
                              <span>
                                <small>Submitted</small>
                                <strong>{formatDate(grade.submitted_at)}</strong>
                              </span>
                            </span>
                            {(grade.review.reviewed_at ||
                              grade.review.reviewed_by_username) && (
                              <span>
                                <CheckCircle2 size={12} aria-hidden="true" />
                                <span>
                                  <small>
                                    {grade.grade_status === "Returned"
                                      ? "Returned"
                                      : "Reviewed"}
                                  </small>
                                  <strong>
                                    {formatDate(grade.review.reviewed_at)}
                                  </strong>
                                  {grade.review.reviewed_by_username && (
                                    <em>
                                      by {grade.review.reviewed_by_username}
                                    </em>
                                  )}
                                </span>
                              </span>
                            )}
                            {grade.review.review_remarks && (
                              <p>{grade.review.review_remarks}</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>
      </main>
    </DashboardLayout>
  );
}
