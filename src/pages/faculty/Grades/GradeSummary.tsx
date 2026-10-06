import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  BookOpenCheck,
  CircleDashed,
  FilePenLine,
  GraduationCap,
  RefreshCw,
  Search,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { api } from "../../../services/api";

import "../../../styles/FacultyPendingGrades.css";

const API_BASE_URL = `${api.baseUrl}/api/faculty/classes`;

interface FacultyInfo {
  faculty_id: number;
  employee_number: string;
  faculty_name: string;
}

interface FacultyClass {
  offering_id: number;
  offering_status: string;

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

interface FacultyClassesResponse {
  success: boolean;
  faculty?: FacultyInfo;
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

interface PendingRow {
  offering: FacultyClass;
  student: GradebookStudent;
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

export default function GradeSummary() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();
  const authenticated = Boolean(session && token);
  const userRole = session?.role;

  const [faculty, setFaculty] = useState<FacultyInfo | null>(null);
  const [classes, setClasses] = useState<FacultyClass[]>([]);
  const [pendingRows, setPendingRows] = useState<PendingRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("All");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Faculty" && session) {
      navigate(authService.getDashboardRoute(session.role), {
        replace: true,
      });
    }
  }, [authenticated, userRole, session, navigate]);

  const loadPendingGrades = useCallback(
    async (signal?: AbortSignal) => {
      if (!authenticated || userRole !== "Faculty") {
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
              "Unable to load assigned classes.",
          );
        }

        const loadedClasses = Array.isArray(classesData.classes)
          ? classesData.classes.filter(
              (item) => item.offering_status !== "Cancelled",
            )
          : [];

        setFaculty(classesData.faculty || null);
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

            return {
              offering: data.class || item,
              students: Array.isArray(data.students) ? data.students : [],
            };
          }),
        );

        const sessionExpired = gradebooks.some(
          (result) =>
            result.status === "rejected" &&
            result.reason instanceof Error &&
            result.reason.message === "SESSION_EXPIRED",
        );

        if (sessionExpired) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        const nextRows: PendingRow[] = [];

        gradebooks.forEach((result) => {
          if (result.status !== "fulfilled") {
            return;
          }

          result.value.students.forEach((student) => {
            if (student.subject_status === "Enrolled" && student.grade === null) {
              nextRows.push({
                offering: result.value.offering,
                student,
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

        const failed = gradebooks.filter(
          (result) => result.status === "rejected",
        ).length;

        if (failed > 0) {
          setError(
            `${failed} class${failed === 1 ? "" : "es"} could not be checked. The list shows the classes that loaded successfully.`,
          );
        }
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD FACULTY PENDING GRADES ERROR:", requestError);

        setClasses([]);
        setPendingRows([]);

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
  }, [loadPendingGrades, refreshKey]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    return pendingRows.filter(({ offering, student }) => {
      const matchesClass =
        classFilter === "All" ||
        String(offering.offering_id) === classFilter;

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
    classes.length - classesWithPending,
    0,
  );

  const openEnterGrades = (offeringId: number) => {
    navigate(`/faculty/grades/enter?offering_id=${offeringId}`);
  };

  if (!authenticated || userRole !== "Faculty") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="faculty-pending-grades-page">
        <section className="faculty-pending-grades-hero">
          <div className="faculty-pending-grades-hero__copy">
            <span className="faculty-pending-grades-eyebrow">
              <span>
                <GraduationCap size={16} strokeWidth={2.2} aria-hidden="true" />
              </span>
              Faculty · Grade Monitoring
            </span>
            <h1>Pending Grades</h1>
            <p>
              Students shown here are still enrolled in your assigned class but
              do not have a grade record yet. Draft, Submitted, Returned, and
              Approved grades are not included.
            </p>
          </div>
          <button
            type="button"
            className="faculty-pending-grades-refresh"
            onClick={() => setRefreshKey((current) => current + 1)}
            disabled={loading}
          >
            <RefreshCw
              size={16}
              className={loading ? "is-spinning" : undefined}
              aria-hidden="true"
            />
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </section>
        <section className="faculty-pending-grades-faculty">
          <span className="faculty-pending-grades-faculty__icon">
            <GraduationCap size={20} aria-hidden="true" />
          </span>
          <div>
            <small>Faculty</small>
            <strong>{faculty?.faculty_name || "Faculty"}</strong>
            <span>
              {faculty?.employee_number || "Employee number unavailable"}
            </span>
          </div>
        </section>
        <section
          className="faculty-pending-grades-summary"
          aria-label="Pending grade summary"
        >
          <article>
            <span className="faculty-pending-grades-summary__icon">
              <CircleDashed size={18} aria-hidden="true" />
            </span>
            <div>
              <small>Not Encoded</small>
              <strong>{pendingRows.length}</strong>
              <span>Students without a grade record</span>
            </div>
          </article>
          <article>
            <span className="faculty-pending-grades-summary__icon">
              <BookOpenCheck size={18} aria-hidden="true" />
            </span>
            <div>
              <small>Classes with Pending</small>
              <strong>{classesWithPending}</strong>
              <span>Classes that still need grade encoding</span>
            </div>
          </article>
          <article>
            <span className="faculty-pending-grades-summary__icon">
              <UsersRound size={18} aria-hidden="true" />
            </span>
            <div>
              <small>Assigned Classes</small>
              <strong>{classes.length}</strong>
              <span>Active teaching assignments</span>
            </div>
          </article>
          <article>
            <span className="faculty-pending-grades-summary__icon">
              <FilePenLine size={18} aria-hidden="true" />
            </span>
            <div>
              <small>No Pending</small>
              <strong>{classesWithoutPending}</strong>
              <span>Classes with nothing left to encode</span>
            </div>
          </article>
        </section>
        <section className="faculty-pending-grades-filters">
          <div className="faculty-pending-grades-filters__heading">
            <div>
              <span>Filter Pending Records</span>
              <strong>Find students that still need grades</strong>
              <p>Search pending records or narrow the list to one assigned class.</p>
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
          <div className="faculty-pending-grades-filters__grid">
            <label>
              <span>Search</span>
              <div className="faculty-pending-grades-search">
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
          <section className="faculty-pending-grades-error" role="alert">
            <span className="faculty-pending-grades-error__icon">
              <AlertCircle size={18} aria-hidden="true" />
            </span>
            <div>
              <strong>Some pending grade data could not be loaded</strong>
              <p>{error}</p>
            </div>
          </section>
        )}
        <section className="faculty-pending-grades-list">
          <header>
            <div>
              <span>Grade Encoding Queue</span>
              <h2>Students Without Encoded Grades</h2>
              <p>
                These are the students who still need a grade record created by
                the faculty.
              </p>
            </div>
            <strong>
              {filteredRows.length}{" "}
              {filteredRows.length === 1 ? "record" : "records"}
            </strong>
          </header>
          {loading ? (
            <div className="faculty-pending-grades-loading">
              <div className="faculty-pending-grades-spinner" />
              <div>
                <strong>Checking assigned classes</strong>
                <span>Looking for students without encoded grades...</span>
              </div>
            </div>
          ) : pendingRows.length === 0 ? (
            <div className="faculty-pending-grades-empty">
              <span>
                <BookOpenCheck size={23} aria-hidden="true" />
              </span>
              <strong>No pending grades</strong>
              <p>
                Every currently enrolled student already has a grade record.
              </p>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="faculty-pending-grades-empty">
              <span>
                <Search size={23} aria-hidden="true" />
              </span>
              <strong>No matching pending records</strong>
              <p>Try changing the search or assigned-class filter.</p>
            </div>
          ) : (
            <div className="faculty-pending-grades-table-wrap">
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
                  {filteredRows.map(({ offering, student }) => (
                    <tr key={student.enrollment_subject_id}>
                      <td>
                        <div className="faculty-pending-grades-student">
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
                        <strong>{offering.academic_period.academic_year}</strong>
                        <small>
                          {offering.academic_period.semester_name}
                        </small>
                      </td>
                      <td>
                        <strong>{formatDays(offering.schedule.days)}</strong>
                        <small>
                          {offering.schedule.time || "Not scheduled"}
                        </small>
                      </td>
                      <td>
                        <span className="faculty-pending-grades-status">
                          Not Encoded
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="faculty-pending-grades-action"
                          onClick={() =>
                            openEnterGrades(offering.offering_id)
                          }
                        >
                          <FilePenLine size={14} aria-hidden="true" />
                          Encode Grade
                        </button>
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
