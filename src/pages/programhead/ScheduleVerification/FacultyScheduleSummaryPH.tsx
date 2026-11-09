import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, CalendarDays } from "lucide-react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { api } from "../../../services/api";
import { authService } from "../../../services/auth.service";
import "../../../styles/FacultyScheduleSummaryPH.css";

const API_URL = api.url("/api/program-head/classes");

interface FacultyScheduleClass {
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
  faculty: {
    faculty_id: number;
    employee_number: string;
    faculty_name: string;
  } | null;
  academic_period: {
    academic_year_id: number;
    academic_year: string;
    semester_id: number;
    semester_name: string;
  };
  schedule: {
    days: string | null;
    time: string | null;
  };
}

interface ApiResponse {
  success: boolean;
  message?: string;
  error?: string;
  classes?: FacultyScheduleClass[];
}

function hasSchedule(item: FacultyScheduleClass): boolean {
  return Boolean(item.schedule.days?.trim() && item.schedule.time?.trim());
}

function readError(data: ApiResponse, fallback: string): string {
  return data.message || data.error || fallback;
}

async function readJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(
      `Server returned a non-JSON response (${response.status}): ${text.slice(0, 180)}`,
    );
  }
  return response.json() as Promise<T>;
}

export default function FacultyScheduleSummaryPH() {
  const session = authService.getSession();
  const navigate = useNavigate();
  const [classes, setClasses] = useState<FacultyScheduleClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (session?.role !== "Program Head") return;
    const controller = new AbortController();
    let active = true;

    const loadSchedules = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await authService.authFetch(API_URL, {
          method: "GET",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        const data = await readJson<ApiResponse>(response);

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }
        if (!response.ok || !data.success) {
          throw new Error(
            readError(data, "Could not load the faculty schedule summary."),
          );
        }
        if (active) setClasses(Array.isArray(data.classes) ? data.classes : []);
      } catch (loadError) {
        if (
          loadError instanceof DOMException &&
          loadError.name === "AbortError"
        ) {
          return;
        }
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load the faculty schedule summary.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadSchedules();
    return () => {
      active = false;
      controller.abort();
    };
  }, [navigate, session?.role]);

  const sortedClasses = useMemo(
    () =>
      [...classes].sort((a, b) => {
        const aFaculty = a.faculty?.faculty_name || "Unassigned faculty";
        const bFaculty = b.faculty?.faculty_name || "Unassigned faculty";
        const facultyOrder = aFaculty.localeCompare(bFaculty);
        if (facultyOrder !== 0) return facultyOrder;
        const courseOrder = a.section.course.course_code.localeCompare(
          b.section.course.course_code,
        );
        if (courseOrder !== 0) return courseOrder;
        return a.section.section_name.localeCompare(b.section.section_name);
      }),
    [classes],
  );

  const facultyCount = new Set(
    classes
      .map((item) => item.faculty?.faculty_id)
      .filter((id): id is number => typeof id === "number"),
  ).size;
  const scheduledCount = classes.filter(hasSchedule).length;

  if (session?.role !== "Program Head") return null;

  return (
    <DashboardLayout>
      <main className="faculty-summary-page">
        <header className="faculty-summary-page__header">
          <div>
            <div className="faculty-summary-page__eyebrow">
              <span className="faculty-summary-page__eyebrow-icon" aria-hidden="true">
                <CalendarDays size={16} strokeWidth={2} />
              </span>
              <span>PROGRAM HEAD · CLASS MANAGEMENT</span>
            </div>
            <h1>Faculty Schedule Summary</h1>
            <p>View teaching assignments across the department.</p>
          </div>
        </header>

        {error && (
          <div className="faculty-summary-page__alert" role="alert">
            <AlertCircle size={17} /> {error}
          </div>
        )}

        <section
          className="faculty-summary-table-card"
          aria-label="Faculty schedules"
        >
          <header className="faculty-summary-table-card__heading">
            <h2>Department schedules</h2>
            {!loading && !error && (
              <span>
                {classes.length} classes · {facultyCount} faculty ·{" "}
                {scheduledCount} scheduled
              </span>
            )}
          </header>

          {loading ? (
            <div className="faculty-summary-page__empty">
              Loading faculty schedules…
            </div>
          ) : error ? null : classes.length === 0 ? (
            <div className="faculty-summary-page__empty">
              No department class offerings are available.
            </div>
          ) : (
            <div className="faculty-summary-table-scroll">
              <table className="faculty-summary-table">
                <thead>
                  <tr>
                    <th>Faculty</th>
                    <th>Course and section</th>
                    <th>Subject</th>
                    <th>Academic period</th>
                    <th>Days and time</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedClasses.map((item) => (
                    <tr key={item.offering_id}>
                      <td>
                        <strong>
                          {item.faculty?.faculty_name || "Unassigned faculty"}
                        </strong>
                        {item.faculty?.employee_number && (
                          <small>{item.faculty.employee_number}</small>
                        )}
                      </td>
                      <td>
                        <strong>
                          {item.section.course.course_code} ·{" "}
                          {item.section.section_name}
                        </strong>
                        <small>Year {item.section.year_level}</small>
                      </td>
                      <td>
                        <strong>{item.subject.subject_code}</strong>
                        <small>{item.subject.subject_name}</small>
                      </td>
                      <td>
                        <strong>{item.academic_period.academic_year}</strong>
                        <small>{item.academic_period.semester_name}</small>
                      </td>
                      <td>
                        {hasSchedule(item) ? (
                          <>
                            <strong>{item.schedule.days}</strong>
                            <small>{item.schedule.time}</small>
                          </>
                        ) : (
                          <span className="faculty-summary-table__muted">
                            Not scheduled
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`faculty-summary-page__status ${hasSchedule(item) ? "is-scheduled" : "is-unscheduled"}`}
                        >
                          {hasSchedule(item) ? "Scheduled" : "Needs schedule"}
                        </span>
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
