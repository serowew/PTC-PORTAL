import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  BookOpenCheck,
  CircleDashed,
  FilePenLine,
  GraduationCap,
  Search,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { api } from "../../../services/api";

import "../../../styles/ProgramHeadGradeEncoding.css";

const API_BASE_URL = `${api.baseUrl}/api/program-head/classes`;

interface ProgramHeadInfo {
  faculty_id: number | null;
  employee_number: string;
  program_head_name: string;
  department?: {
    department_code: string;
    department_name: string;
  };
}

interface FacultyClass {
  offering_id: number;
  offering_status: string;
  faculty: { faculty_id: number; faculty_name: string } | null;

  subject: {
    subject_code: string;
    subject_name: string;
    units: number;
  };

  section: {
    section_name: string;
    year_level: number;
    course: {
      course_code: string;
      course_name: string;
    };
  };

  academic_period: {
    academic_year: string;
    semester_name: string;
  };

  schedule: {
    days: string | null;
    time: string | null;
  };
}

interface ProgramHeadClassesResponse {
  success: boolean;
  program_head?: ProgramHeadInfo;
  classes?: FacultyClass[];
  message?: string;
  error?: string;
}

interface GradebookStudent {
  enrollment_subject_id: number;
  student_number: string;
  full_name: string;
  email: string | null;
  subject_status: string;
  grade: {
    grade_id: number;
    grade_status: "Draft" | "Submitted" | "Returned" | "Approved";
  } | null;
}

interface GradebookResponse {
  success: boolean;
  class?: FacultyClass;
  students?: GradebookStudent[];
  message?: string;
  error?: string;
}

type AssessmentProgress = "NO_SCORES_YET" | "IN_PROGRESS" | "UNVERIFIED";

interface ModernRosterStudent {
  enrollment_subject_id: number;
  is_current_enrolled: boolean;
  scores_by_assessment_id: Record<
    string,
    {
      saved: boolean;
      score_status: "PENDING" | "SCORED" | "NOT_APPLICABLE";
    }
  >;
}

interface ModernRosterResponse {
  success: boolean;
  offering_id: number;
  students?: ModernRosterStudent[];
}

interface PendingRow {
  offering: FacultyClass;
  student: GradebookStudent;
  progress: AssessmentProgress;
}

function classifyAssessmentProgress(
  student: GradebookStudent,
  roster: ModernRosterResponse | null,
): AssessmentProgress {
  const match = roster?.students?.find(
    (entry) =>
      Number(entry.enrollment_subject_id) ===
        Number(student.enrollment_subject_id) && entry.is_current_enrolled,
  );

  if (!match) return "UNVERIFIED";

  const hasSavedScore = Object.values(match.scores_by_assessment_id ?? {}).some(
    (score) =>
      score.saved &&
      (score.score_status === "SCORED" ||
        score.score_status === "NOT_APPLICABLE"),
  );

  return hasSavedScore ? "IN_PROGRESS" : "NO_SCORES_YET";
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();

    throw new Error(
      `Server returned a non-JSON response (${response.status}): ${text.slice(
        0,
        200,
      )}`,
    );
  }

  return response.json() as Promise<T>;
}

function formatDays(value: string | null): string {
  if (!value) {
    return "Not scheduled";
  }

  return value
    .split(",")
    .map((item) => {
      const day = item.trim();
      return day
        ? day.charAt(0).toUpperCase() + day.slice(1).toLowerCase()
        : "";
    })
    .filter(Boolean)
    .join(", ");
}

export default function ProgramHeadPendingGrades() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();
  const authenticated = Boolean(session && token);
  const userRole = session?.role;

  const [programHead, setProgramHead] = useState<ProgramHeadInfo | null>(null);
  const [checkedClassCount, setCheckedClassCount] = useState(0);
  const [classes, setClasses] = useState<FacultyClass[]>([]);
  const [pendingRows, setPendingRows] = useState<PendingRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("All");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Program Head" && session) {
      navigate(authService.getDashboardRoute(session.role), {
        replace: true,
      });
    }
  }, [authenticated, userRole, session, navigate]);

  const loadPendingGrades = useCallback(
    async (signal?: AbortSignal) => {
      if (!authenticated || userRole !== "Program Head") {
        return;
      }

      try {
        setLoading(true);
        setError("");

        const classesResponse = await authService.authFetch(API_BASE_URL, {
          method: "GET",
          signal,
        });

        const classesData =
          await readJsonResponse<ProgramHeadClassesResponse>(classesResponse);

        if (signal?.aborted) return;

        if (classesResponse.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (!classesResponse.ok || !classesData.success) {
          throw new Error(
            classesData.message ||
              classesData.error ||
              "Unable to load assigned classes.",
          );
        }

        // Department classes are readable; only the linked instructor's classes belong here.
        const instructorId = Number(classesData.program_head?.faculty_id);
        if (!Number.isSafeInteger(instructorId) || instructorId <= 0) {
          throw new Error(
            "Your Program Head account has no linked instructor record.",
          );
        }

        if (!Array.isArray(classesData.classes)) {
          throw new Error("Assigned class data is missing from the response.");
        }

        const loadedClasses = classesData.classes.filter(
          (item) =>
            item.offering_status !== "Cancelled" &&
            Number(item.faculty?.faculty_id) === instructorId,
        );

        setProgramHead(classesData.program_head ?? null);
        setClasses(loadedClasses);

        const gradebooks = await Promise.allSettled(
          loadedClasses.map(async (item) => {
            const response = await authService.authFetch(
              `${API_BASE_URL}/${item.offering_id}/gradebook`,
              {
                method: "GET",
                signal,
              },
            );

            const data = await readJsonResponse<GradebookResponse>(response);

            if (response.status === 401) {
              throw new Error("SESSION_EXPIRED");
            }

            if (!response.ok || !data.success) {
              throw new Error(
                data.message ||
                  data.error ||
                  `Unable to load ${item.subject.subject_code}.`,
              );
            }

            if (!Array.isArray(data.students)) {
              throw new Error(
                `Gradebook roster is missing for ${item.subject.subject_code}.`,
              );
            }

            return {
              offering: item,
              students: data.students,
            };
          }),
        );

        const sessionExpired = gradebooks.some(
          (result) =>
            result.status === "rejected" &&
            result.reason instanceof Error &&
            result.reason.message === "SESSION_EXPIRED",
        );

        if (signal?.aborted) return;

        if (sessionExpired) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        // Check modern assessment progress only for classes with missing grades.
        const classesToCheck = gradebooks.flatMap((result) =>
          result.status === "fulfilled" &&
          result.value.students.some(
            (student) =>
              student.subject_status === "Enrolled" && student.grade === null,
          )
            ? [result.value.offering]
            : [],
        );

        const modernRosters = new Map<number, ModernRosterResponse>();
        let modernCheckIndex = 0;
        let modernUnavailable = 0;
        let modernSessionExpired = false;

        await Promise.all(
          Array.from(
            { length: Math.min(4, classesToCheck.length) },
            async () => {
              while (
                modernCheckIndex < classesToCheck.length &&
                !signal?.aborted &&
                !modernSessionExpired
              ) {
                const item = classesToCheck[modernCheckIndex++];

                try {
                  const response = await authService.authFetch(
                    `${api.baseUrl}/api/gradebook/${item.offering_id}/roster`,
                    { method: "GET", signal },
                  );

                  if (response.status === 401) {
                    modernSessionExpired = true;
                    return;
                  }

                  const data =
                    await readJsonResponse<ModernRosterResponse>(response);

                  if (
                    !response.ok ||
                    !data.success ||
                    Number(data.offering_id) !== Number(item.offering_id) ||
                    !Array.isArray(data.students)
                  ) {
                    modernUnavailable += 1;
                    continue;
                  }

                  modernRosters.set(item.offering_id, data);
                } catch (requestError) {
                  if (signal?.aborted) return;

                  modernUnavailable += 1;
                  console.warn(
                    `Assessment progress unavailable for offering ${item.offering_id}:`,
                    requestError,
                  );
                }
              }
            },
          ),
        );

        if (signal?.aborted) return;

        if (modernSessionExpired) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        const nextRows: PendingRow[] = [];

        gradebooks.forEach((result) => {
          if (result.status !== "fulfilled") return;

          result.value.students.forEach((student) => {
            if (
              student.subject_status === "Enrolled" &&
              student.grade === null
            ) {
              nextRows.push({
                offering: result.value.offering,
                student,
                progress: classifyAssessmentProgress(
                  student,
                  modernRosters.get(result.value.offering.offering_id) ?? null,
                ),
              });
            }
          });
        });

        nextRows.sort((a, b) => {
          const subject = a.offering.subject.subject_code.localeCompare(
            b.offering.subject.subject_code,
          );

          if (subject !== 0) {
            return subject;
          }

          return a.student.full_name.localeCompare(b.student.full_name);
        });

        setPendingRows(nextRows);
        setCheckedClassCount(
          gradebooks.filter((result) => result.status === "fulfilled").length,
        );

        const failed = gradebooks.filter(
          (result) => result.status === "rejected",
        ).length;

        const warnings: string[] = [];

        if (failed > 0) {
          warnings.push(
            `${failed} class${failed === 1 ? "" : "es"} could not be checked. The list shows classes that loaded successfully.`,
          );
        }

        if (modernUnavailable > 0) {
          warnings.push(
            `Assessment progress could not be verified for ${modernUnavailable} class${modernUnavailable === 1 ? "" : "es"}. Those students remain listed for review.`,
          );
        }

        setError(warnings.join(" "));
      } catch (requestError) {
        if (signal?.aborted) return;

        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD PROGRAM HEAD PENDING GRADES ERROR:", requestError);

        setProgramHead(null);
        setClasses([]);
        setPendingRows([]);
        setCheckedClassCount(0);

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load pending grades.",
        );
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [authenticated, userRole, navigate],
  );

  useEffect(() => {
    const controller = new AbortController();

    void loadPendingGrades(controller.signal);

    return () => controller.abort();
  }, [loadPendingGrades]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    return pendingRows.filter(({ offering, student }) => {
      const matchesClass =
        classFilter === "All" || String(offering.offering_id) === classFilter;

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
      ]
        .join(" ")
        .toLowerCase();

      return matchesClass && (!query || searchable.includes(query));
    });
  }, [pendingRows, search, classFilter]);

  const classesWithPending = useMemo(
    () => new Set(pendingRows.map((row) => row.offering.offering_id)).size,
    [pendingRows],
  );

  const classesWithoutPending = Math.max(
    checkedClassCount - classesWithPending,
    0,
  );

  if (!authenticated || userRole !== "Program Head") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="programhead-pending-grades-page">
        <section className="programhead-pending-grades-hero">
          <div className="programhead-pending-grades-hero__copy">
            <span className="programhead-pending-grades-eyebrow">
              <span>
                <GraduationCap size={16} strokeWidth={2.2} aria-hidden="true" />
              </span>
              Program Head · Grade Monitoring
            </span>
            <h1>Pending Grades</h1>
            <p>
              Students enrolled in classes you personally teach who do not yet
              have a semester grade record. Draft, Submitted, Returned, and
              Approved grades are not included.
            </p>
          </div>
        </section>
        <section className="programhead-pending-grades-faculty">
          <span className="programhead-pending-grades-faculty__icon">
            <GraduationCap size={20} aria-hidden="true" />
          </span>
          <div>
            <small>Program Head · Instructor</small>
            <strong>{programHead?.program_head_name || "Program Head"}</strong>
            <span>
              {programHead?.employee_number || "Employee number unavailable"}
            </span>
          </div>
        </section>
        <section
          className="programhead-pending-grades-summary"
          aria-label="Pending grade summary"
        >
          <article>
            <span className="programhead-pending-grades-summary__icon">
              <CircleDashed size={18} aria-hidden="true" />
            </span>
            <div>
              <small>No Semester Record</small>
              <strong>{pendingRows.length}</strong>
              <span>Students without a semester grade record</span>
            </div>
          </article>
          <article>
            <span className="programhead-pending-grades-summary__icon">
              <BookOpenCheck size={18} aria-hidden="true" />
            </span>
            <div>
              <small>Classes with Pending</small>
              <strong>{classesWithPending}</strong>
              <span>Classes that still need grade encoding</span>
            </div>
          </article>
          <article>
            <span className="programhead-pending-grades-summary__icon">
              <UsersRound size={18} aria-hidden="true" />
            </span>
            <div>
              <small>Assigned Classes</small>
              <strong>{classes.length}</strong>
              <span>Your teaching assignments</span>
            </div>
          </article>
          <article>
            <span className="programhead-pending-grades-summary__icon">
              <FilePenLine size={18} aria-hidden="true" />
            </span>
            <div>
              <small>No Pending</small>
              <strong>{classesWithoutPending}</strong>
              <span>Checked classes with no missing grade records</span>
            </div>
          </article>
        </section>
        <section className="programhead-pending-grades-filters">
          <div className="programhead-pending-grades-filters__heading">
            <div>
              <span>Filter Pending Records</span>
              <strong>Find students that still need grades</strong>
              <p>
                Search pending records or narrow the list to one assigned class.
              </p>
            </div>
            {(search || classFilter !== "All") && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setClassFilter("All");
                }}
              >
                Clear Filters
              </button>
            )}
          </div>
          <div className="programhead-pending-grades-filters__grid">
            <label>
              <span>Search</span>
              <div className="programhead-pending-grades-search">
                <Search size={15} aria-hidden="true" />
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Student, subject, section..."
                />
              </div>
            </label>
            <label>
              <span>Assigned Class</span>
              <select
                value={classFilter}
                onChange={(event) => setClassFilter(event.target.value)}
              >
                <option value="All">All Assigned Classes</option>
                {classes.map((item) => (
                  <option
                    key={item.offering_id}
                    value={String(item.offering_id)}
                  >
                    {item.subject.subject_code} — {item.section.section_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
        {error && (
          <section className="programhead-pending-grades-error" role="alert">
            <span className="programhead-pending-grades-error__icon">
              <AlertCircle size={18} aria-hidden="true" />
            </span>
            <div>
              <strong>Some grade monitoring data could not be loaded</strong>
              <p>{error}</p>
            </div>
          </section>
        )}
        <section className="programhead-pending-grades-list">
          <header>
            <div>
              <span>Grade Encoding Queue</span>
              <h2>Students Without Semester Grade Records</h2>
              <p>
                These are enrolled students in your own teaching classes who do
                not yet have a semester grade record.
              </p>
            </div>
            <strong>
              {filteredRows.length}{" "}
              {filteredRows.length === 1 ? "record" : "records"}
            </strong>
          </header>
          {loading ? (
            <div className="programhead-pending-grades-loading">
              <div className="programhead-pending-grades-spinner" />
              <div>
                <strong>Checking assigned classes</strong>
                <span>
                  Checking your teaching classes for missing grade records...
                </span>
              </div>
            </div>
          ) : pendingRows.length === 0 ? (
            <div className="programhead-pending-grades-empty">
              <span>
                <BookOpenCheck size={23} aria-hidden="true" />
              </span>
              <strong>No pending grades</strong>
              <p>
                No missing semester grade records were found in the classes
                checked successfully.
              </p>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="programhead-pending-grades-empty">
              <span>
                <Search size={23} aria-hidden="true" />
              </span>
              <strong>No matching pending records</strong>
              <p>Try changing the search or assigned-class filter.</p>
            </div>
          ) : (
            <div className="programhead-pending-grades-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Subject</th>
                    <th>Section</th>
                    <th>Academic Period</th>
                    <th>Schedule</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(({ offering, student, progress }) => (
                    <tr
                      key={`${offering.offering_id}-${student.enrollment_subject_id}`}
                    >
                      <td>
                        <div className="programhead-pending-grades-student">
                          <strong>{student.full_name}</strong>
                          <span>{student.student_number}</span>
                          <small>{student.email || "No email"}</small>
                        </div>
                      </td>
                      <td>
                        <strong>{offering.subject.subject_code}</strong>
                        <small>{offering.subject.subject_name}</small>
                      </td>
                      <td>
                        <strong>{offering.section.section_name}</strong>
                        <small>
                          {offering.section.course.course_code} · Year{" "}
                          {offering.section.year_level}
                        </small>
                      </td>
                      <td>
                        <strong>
                          {offering.academic_period.academic_year}
                        </strong>
                        <small>{offering.academic_period.semester_name}</small>
                      </td>
                      <td>
                        <strong>{formatDays(offering.schedule.days)}</strong>
                        <small>
                          {offering.schedule.time || "Not scheduled"}
                        </small>
                      </td>
                      <td>
                        <span
                          className="programhead-pending-grades-status"
                          data-progress={progress}
                        >
                          {progress === "IN_PROGRESS"
                            ? "In Progress"
                            : progress === "NO_SCORES_YET"
                              ? "No Scores Yet"
                              : "Progress Unavailable"}
                        </span>
                      </td>
                      <td>
                        <Link
                          to={`/programhead/grades/enter?offering_id=${offering.offering_id}&enrollment_subject_id=${student.enrollment_subject_id}`}
                          className="programhead-pending-grades-action"
                          aria-label={`Open gradebook for ${student.full_name} in ${offering.subject.subject_code}`}
                        >
                          <FilePenLine size={14} aria-hidden="true" />
                          {progress === "IN_PROGRESS"
                            ? "Continue Grades"
                            : "Open Gradebook"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </DashboardLayout>
  );
}
