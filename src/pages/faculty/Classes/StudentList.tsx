import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";

import "../../../styles/FacultyStudentList.css";

// =====================================================
// API
// =====================================================

const API_BASE_URL = apiUrl("/api/faculty/classes");

// =====================================================
// TYPES
// =====================================================

interface FacultyInfo {
  faculty_id: number;
  employee_number: string;
  faculty_name: string;
}

interface FacultyClassInfo {
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

  room: {
    room_id: number;
    room_code?: string | null;
    room_name?: string | null;
  } | null;

  capacity: {
    max_students: number;
    official_students: number;
  };
}

interface FacultyClassStudent {
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
}

interface FacultyStudentListResponse {
  success: boolean;

  faculty?: FacultyInfo;

  class?: FacultyClassInfo;

  summary?: {
    official_students: number;
  };

  students?: FacultyClassStudent[];

  message?: string;
  error?: string;
}

// =====================================================
// SAFE JSON
// =====================================================

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

// =====================================================
// HELPERS
// =====================================================

function formatDays(value: string | null) {
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

function getRoomLabel(room: FacultyClassInfo["room"]) {
  if (!room) {
    return "—";
  }

  if (room.room_code && room.room_name) {
    return `${room.room_code} • ${room.room_name}`;
  }

  return room.room_code || room.room_name || "—";
}
// =====================================================
// COMPONENT
// =====================================================

export default function FacultyStudentList() {
  const navigate = useNavigate();

  const [searchParams] = useSearchParams();

  // ===================================================
  // AUTH
  // ===================================================

  const session = authService.getSession();

  const token = authService.getToken();

  const userRole = session?.role;

  const authenticated = Boolean(session && token);

  // ===================================================
  // OFFERING ID
  // ===================================================

  const rawOfferingId = searchParams.get("offering_id");

  const offeringId = rawOfferingId ? Number(rawOfferingId) : null;

  const validOfferingId =
    Number.isInteger(offeringId) && Number(offeringId) > 0;

  // ===================================================
  // STATE
  // ===================================================

  const [faculty, setFaculty] = useState<FacultyInfo | null>(null);

  const [classInfo, setClassInfo] = useState<FacultyClassInfo | null>(null);

  const [students, setStudents] = useState<FacultyClassStudent[]>([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  const [search, setSearch] = useState("");

  const [refreshKey, setRefreshKey] = useState(0);

  // ===================================================
  // AUTHORIZATION
  // ===================================================

  useEffect(() => {
    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (userRole !== "Faculty") {
      if (session) {
        navigate(authService.getDashboardRoute(session.role), {
          replace: true,
        });
      }
    }
  }, [authenticated, userRole, session, navigate]);

  // ===================================================
  // LOAD OFFICIAL ROSTER
  // ===================================================

  useEffect(() => {
    if (!authenticated || userRole !== "Faculty") {
      return;
    }

    if (!validOfferingId) {
      setFaculty(null);
      setClassInfo(null);
      setStudents([]);

      setError("No valid class offering was selected.");

      setLoading(false);

      return;
    }

    const controller = new AbortController();

    const loadRoster = async () => {
      try {
        setLoading(true);
        setError("");

        const response = await authService.authFetch(
          `${API_BASE_URL}/${offeringId}/students`,
          {
            method: "GET",
            signal: controller.signal,
          },
        );

        const data =
          await readJsonResponse<FacultyStudentListResponse>(response);

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        if (response.status === 403) {
          throw new Error(
            data.message || "You are not allowed to access this class.",
          );
        }

        if (response.status === 404) {
          throw new Error(
            data.message || "The selected Faculty class could not be found.",
          );
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message ||
              data.error ||
              "Unable to load the official class roster.",
          );
        }

        setFaculty(data.faculty || null);

        setClassInfo(data.class || null);

        setStudents(Array.isArray(data.students) ? data.students : []);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD FACULTY CLASS ROSTER ERROR:", requestError);

        setFaculty(null);
        setClassInfo(null);
        setStudents([]);

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load the official class roster.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadRoster();

    return () => {
      controller.abort();
    };
  }, [
    authenticated,
    userRole,
    offeringId,
    validOfferingId,
    navigate,
    refreshKey,
  ]);
  // ===================================================
  // FILTER STUDENTS
  // ===================================================

  const filteredStudents = useMemo(() => {
    const normalized = search.trim().toLowerCase();

    if (!normalized) {
      return students;
    }

    return students.filter((student) => {
      return (
        student.student_number.toLowerCase().includes(normalized) ||
        student.full_name.toLowerCase().includes(normalized) ||
        (student.email || "").toLowerCase().includes(normalized)
      );
    });
  }, [students, search]);

  // ===================================================
  // ACTIONS
  // ===================================================

  const goBack = () => {
    navigate("/faculty/classes");
  };

  const refreshRoster = () => {
    setRefreshKey((current) => current + 1);
  };

  // ===================================================
  // AUTH RENDER GUARD
  // ===================================================

  if (!authenticated || userRole !== "Faculty") {
    return null;
  }

  // ===================================================
  // UI
  // ===================================================

  return (
    <DashboardLayout>
      <main className="faculty-student-list-page">
        {/* =============================================
            PAGE HEADER
        ============================================= */}

        <section className="faculty-student-list-header">
          <div className="faculty-student-list-heading">
            <button
              type="button"
              className="faculty-roster-back"
              onClick={goBack}
            >
              ← Back to My Classes
            </button>

            <span className="faculty-roster-eyebrow">Faculty Class Roster</span>

            <h1>Student List</h1>

            <p>Official students enrolled in the selected Faculty class.</p>
          </div>

          <button
            type="button"
            className="faculty-roster-refresh"
            onClick={refreshRoster}
            disabled={loading || !validOfferingId}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </section>

        {/* =============================================
            ERROR
        ============================================= */}

        {error && (
          <section className="faculty-roster-error">
            <div>
              <strong>Class roster could not be loaded</strong>

              <p>{error}</p>
            </div>

            <div className="faculty-roster-error-actions">
              <button type="button" onClick={goBack}>
                My Classes
              </button>

              {validOfferingId && (
                <button type="button" onClick={refreshRoster}>
                  Try Again
                </button>
              )}
            </div>
          </section>
        )}

        {/* =============================================
            LOADING
        ============================================= */}

        {loading && (
          <section className="faculty-roster-loading">
            <div className="faculty-roster-spinner" />

            <div>
              <strong>Loading official roster</strong>

              <span>Retrieving Approved enrollment memberships...</span>
            </div>
          </section>
        )}

        {/* =============================================
            CLASS INFORMATION
        ============================================= */}

        {!loading && !error && classInfo && (
          <>
            <section className="faculty-roster-class-card">
              <div className="faculty-roster-subject">
                <span>Subject</span>

                <strong>{classInfo.subject.subject_code}</strong>

                <p>{classInfo.subject.subject_name}</p>
              </div>

              <div className="faculty-roster-class-grid">
                <div>
                  <span>Section</span>

                  <strong>{classInfo.section.section_name}</strong>

                  <small>
                    {classInfo.section.course.course_code} • Year{" "}
                    {classInfo.section.year_level}
                  </small>
                </div>

                <div>
                  <span>Academic Year</span>

                  <strong>{classInfo.academic_period.academic_year}</strong>

                  <small>{classInfo.academic_period.semester_name}</small>
                </div>

                <div>
                  <span>Schedule</span>

                  <strong>{formatDays(classInfo.schedule.days)}</strong>

                  <small>{classInfo.schedule.time || "Not scheduled"}</small>
                </div>

                <div>
                  <span>Room</span>

                  <strong>{getRoomLabel(classInfo.room)}</strong>

                  <small>Optional room assignment</small>
                </div>

                <div>
                  <span>Units</span>

                  <strong>{classInfo.subject.units}</strong>

                  <small>Academic units</small>
                </div>

                <div>
                  <span>Class Status</span>

                  <strong
                    className={`faculty-roster-status ${classInfo.offering_status.toLowerCase()}`}
                  >
                    {classInfo.offering_status}
                  </strong>

                  <small>Offering #{classInfo.offering_id}</small>
                </div>
              </div>
            </section>

            {/* =======================================
                  FACULTY / COUNTS
              ======================================= */}

            <section className="faculty-roster-summary">
              <div>
                <span>Faculty</span>

                <strong>{faculty?.faculty_name || "—"}</strong>
              </div>

              <div>
                <span>Employee Number</span>

                <strong>{faculty?.employee_number || "—"}</strong>
              </div>

              <div>
                <span>Official Students</span>

                <strong>{students.length}</strong>
              </div>

              <div>
                <span>Class Capacity</span>

                <strong>
                  {classInfo.capacity.official_students}
                  {" / "}
                  {classInfo.capacity.max_students}
                </strong>
              </div>
            </section>
          </>
        )}
        {/* =============================================
            STUDENT TABLE
        ============================================= */}

        {!loading && !error && classInfo && (
          <section className="faculty-roster-content">
            <div className="faculty-roster-content-header">
              <div>
                <h2>Official Students</h2>

                <p>
                  Only students from Approved enrollments assigned to this
                  offering appear here.
                </p>
              </div>

              <div className="faculty-roster-search">
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search student..."
                />
              </div>
            </div>

            {students.length === 0 ? (
              <div className="faculty-roster-empty">
                <strong>No official students</strong>

                <p>
                  There are no Approved enrollment memberships for this class
                  yet.
                </p>
              </div>
            ) : filteredStudents.length === 0 ? (
              <div className="faculty-roster-empty">
                <strong>No matching student</strong>

                <p>No student matches your current search.</p>

                <button type="button" onClick={() => setSearch("")}>
                  Clear Search
                </button>
              </div>
            ) : (
              <div className="faculty-roster-table-wrapper">
                <table className="faculty-roster-table">
                  <thead>
                    <tr>
                      <th>#</th>

                      <th>Student Number</th>

                      <th>Student Name</th>

                      <th>Email</th>

                      <th>Enrollment</th>

                      <th>Subject Status</th>

                      <th>Enrollment Subject ID</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredStudents.map((student, index) => (
                      <tr key={student.enrollment_subject_id}>
                        <td>{index + 1}</td>

                        <td>
                          <strong>{student.student_number}</strong>
                        </td>

                        <td>
                          <div className="faculty-roster-student-name">
                            <strong>{student.full_name}</strong>

                            <small>Student ID {student.student_id}</small>
                          </div>
                        </td>

                        <td>{student.email || "—"}</td>

                        <td>
                          <span
                            className={`faculty-roster-badge ${
                              student.enrollment_status === "Approved"
                                ? "approved"
                                : ""
                            }`}
                          >
                            {student.enrollment_status}
                          </span>
                        </td>

                        <td>
                          <span
                            className={`faculty-roster-badge ${
                              student.subject_status === "Enrolled"
                                ? "enrolled"
                                : ""
                            }`}
                          >
                            {student.subject_status}
                          </span>
                        </td>

                        <td>
                          <span className="faculty-roster-id">
                            #{student.enrollment_subject_id}
                          </span>
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
