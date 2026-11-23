import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { api } from "../../../services/api";
import { authService } from "../../../services/auth.service";

import "../../../styles/ClassPROG.css";

const API_BASE_URL = api.url("/api/program-head/classes");

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

interface FacultyInfo {
  faculty_id: number;
  employee_number: string;
  first_name?: string;
  middle_name?: string | null;
  last_name?: string;
  faculty_name: string;
  email: string | null;
}

interface RoomInfo {
  room_id: number;
  room_code: string | null;
  room_name: string | null;
}

interface ClassItem {
  offering_id: number;
  section_subject_id: number;

  offering_status: string;
  section_subject_status: string;

  subject: {
    subject_id: number;
    subject_code: string;
    subject_name: string;
    units: number;
    lecture_hours: number;
    laboratory_hours: number;
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

  faculty: FacultyInfo | null;

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

  room: RoomInfo | null;

  capacity: {
    max_students: number;
    official_students: number;
  };

  grades: {
    draft: number;
    submitted: number;
    returned: number;
    approved: number;
    total_with_grade: number;
    without_grade: number;
  };

  created_at: string | null;
}

interface ClassesResponse {
  success: boolean;

  program_head?: ProgramHeadInfo;

  classes?: ClassItem[];

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

      if (!day) {
        return "";
      }

      return day.charAt(0).toUpperCase() + day.slice(1).toLowerCase();
    })
    .filter(Boolean)
    .join(", ");
}

function getRoomLabel(room: RoomInfo | null): string {
  if (!room) {
    return "No room assigned";
  }

  return room.room_code || room.room_name || `Room ${room.room_id}`;
}

export default function ClassPROG() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();

  const authenticated = Boolean(session && token);
  const userRole = session?.role;

  const [programHead, setProgramHead] = useState<ProgramHeadInfo | null>(null);

  const [classes, setClasses] = useState<ClassItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (userRole !== "Program Head" && session) {
      navigate(authService.getDashboardRoute(session.role), {
        replace: true,
      });
    }
  }, [authenticated, userRole, session, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Program Head") {
      return;
    }

    const controller = new AbortController();

    const loadClasses = async () => {
      try {
        setLoading(true);
        setError("");

        const response = await authService.authFetch(API_BASE_URL, {
          method: "GET",
          signal: controller.signal,
        });

        const data = await readJsonResponse<ClassesResponse>(response);

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        if (response.status === 403) {
          throw new Error(data.message || "Program Head access is required.");
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message ||
              data.error ||
              "Unable to load Program Head classes.",
          );
        }

        const loadedProgramHead = data.program_head || null;

        const ownFacultyId = Number(loadedProgramHead?.faculty_id || 0);

        const loadedClasses =
          Array.isArray(data.classes) && ownFacultyId > 0
            ? data.classes.filter(
                (item) =>
                  item.offering_status !== "Cancelled" &&
                  Number(item.faculty?.faculty_id || 0) === ownFacultyId,
              )
            : [];

        setProgramHead(loadedProgramHead);
        setClasses(loadedClasses);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD PROGRAM HEAD CLASSES ERROR:", requestError);

        setProgramHead(null);
        setClasses([]);

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load Program Head classes.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadClasses();

    return () => {
      controller.abort();
    };
  }, [authenticated, userRole, navigate, refreshKey]);

  const refreshClasses = () => {
    setRefreshKey((current) => current + 1);
  };

  if (!authenticated || userRole !== "Program Head") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="programhead-class-management">
        <section className="programhead-class-header">
          <div>
            <span className="programhead-class-eyebrow">
              <span
                className="programhead-class-eyebrow-icon"
                aria-hidden="true"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3.5" y="4" width="17" height="16.5" rx="2" />
                  <path d="M8 2.5v3M16 2.5v3M3.5 9h17M8 13h2M14 13h2M8 17h2" />
                </svg>
              </span>
              Program Head
            </span>

            <h1>My Classes</h1>

            <p>
              View your assigned teaching classes and open the assessment-based
              gradebook to record scores, attendance, and semester grades.
            </p>

            {programHead && (
              <small className="programhead-classes-owner">
                {programHead.program_head_name}
                {" · "}
                {programHead.department.department_name}
              </small>
            )}
          </div>
        </section>

        {error && (
          <section className="programhead-class-error" role="alert">
            <div>
              <strong>Classes could not be loaded</strong>
              <p>{error}</p>
            </div>

            <button type="button" onClick={refreshClasses}>
              Try Again
            </button>
          </section>
        )}

        {!error && (
          <section className="programhead-classes-list">
            <header className="programhead-classes-list__heading">
              <h2>Assigned classes</h2>

              <span>
                {loading
                  ? "Loading..."
                  : `${classes.length} class${
                      classes.length === 1 ? "" : "es"
                    }`}
              </span>
            </header>

            {loading ? (
              <div className="programhead-class-state">
                <div className="programhead-class-spinner" />

                <strong>Loading your classes</strong>
              </div>
            ) : classes.length === 0 ? (
              <div className="programhead-class-state">
                <strong>No classes assigned</strong>

                <p>
                  Classes assigned to your faculty account will appear here.
                </p>
              </div>
            ) : (
              <div className="programhead-classes-list__scroll">
                <table className="programhead-classes-list__table">
                  <thead>
                    <tr>
                      <th>Subject</th>
                      <th>Course and section</th>
                      <th>Academic period</th>
                      <th>Schedule</th>
                      <th>Students and grades</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {classes.map((item) => (
                      <tr key={item.offering_id}>
                        <td>
                          <strong>{item.subject.subject_code}</strong>

                          <span>{item.subject.subject_name}</span>

                          <small>
                            {item.subject.units}
                            {" units"}
                          </small>
                        </td>

                        <td>
                          <strong>{item.section.section_name}</strong>

                          <span>
                            {item.section.course.course_code}
                            {" · Year "}
                            {item.section.year_level}
                          </span>
                        </td>

                        <td>
                          <strong>{item.academic_period.academic_year}</strong>

                          <span>{item.academic_period.semester_name}</span>
                        </td>

                        <td>
                          <strong>{formatDays(item.schedule.days)}</strong>

                          <span>
                            {item.schedule.time || "No time assigned"}
                          </span>

                          <small>{getRoomLabel(item.room)}</small>
                        </td>

                        <td>
                          <strong>
                            {item.capacity.official_students}
                            {" / "}
                            {item.capacity.max_students || "—"}
                          </strong>

                          <span>
                            {item.grades.approved}
                            {" approved · "}
                            {item.grades.submitted}
                            {" submitted"}
                          </span>

                          <small>
                            {item.grades.without_grade}
                            {" without grades"}
                          </small>
                        </td>

                        <td>
                          <span
                            className={`programhead-class-status ${item.offering_status.toLowerCase()}`}
                          >
                            {item.offering_status}
                          </span>

                          <small className="programhead-classes-list__grading">
                            {item.offering_status === "Open"
                              ? "Assessment gradebook"
                              : "Gradebook read-only"}
                          </small>
                        </td>

                        <td>
                          <button
                            type="button"
                            className="programhead-class-manage"
                            onClick={() =>
                              navigate(
                                `/programhead/grades/enter?offering_id=${item.offering_id}`,
                              )
                            }
                          >
                            Open Gradebook
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </DashboardLayout>
  );
}
