import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { api } from "../../../services/api";
import { authService } from "../../../services/auth.service";

import "../../../styles/ClassPROG.css";

const API_BASE_URL = api.url("/api/program-head/classes");

type GradeRemark = "Passed" | "Failed" | "Incomplete" | "Unofficial Drop";
type GradeOutcome = "NUMERIC" | "INCOMPLETE" | "UNOFFICIAL_DROP";

interface GradeComputation {
  complete: boolean;
  overallPercentage: number | null;
  finalRating: number | null;
  finalRatingText: string;
  remarks: GradeRemark | null;
}

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

  grading_ready: boolean;
  grading_block_reason: string | null;

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

interface GradeInfo {
  grade_id: number;
  faculty_id: number | null;

  midterm_grade: number | null;
  final_grade: number | null;
  overall_percentage?: number | null;
  final_rating: number | null;
  grading_outcome?: GradeOutcome;

  remarks: string | null;
  grade_status: string;

  submitted_at: string | null;

  review: {
    reviewed_by: number | null;
    reviewed_by_username: string | null;
    reviewed_at: string | null;
    review_remarks: string | null;
  };

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

  grade: GradeInfo | null;
}

interface GradebookResponse {
  success: boolean;

  summary?: {
    total_students: number;
    without_grade: number;
    draft: number;
    submitted: number;
    returned: number;
    approved: number;
  };

  students?: GradebookStudent[];

  message?: string;
  error?: string;
}

interface DirectGradeResponse {
  success: boolean;

  message?: string;
  error?: string;

  grade?: {
    grade_id: number;
    enrollment_subject_id: number;
    faculty_id: number;

    midterm_grade: number | null;
    final_grade: number | null;
    overall_percentage?: number | null;
    final_rating: number | null;
    grading_outcome?: GradeOutcome;

    remarks: string;
    grade_status: string;

    submitted_at: string | null;

    reviewed_by: number | null;
    reviewed_by_username?: string | null;
    reviewed_at: string | null;
    review_remarks: string | null;

    subject_status?: string;
  };
}

interface DirectGradeForm {
  grading_outcome: GradeOutcome;
  outcome_reason: string;
  midterm_grade: string;
  final_grade: string;
}

const EMPTY_DIRECT_FORM: DirectGradeForm = {
  grading_outcome: "NUMERIC",
  outcome_reason: "",
  midterm_grade: "",
  final_grade: "",
};

interface Notice {
  type: "success" | "error";
  message: string;
}

// Match the official TWO_TERM_50_50 grading policy used by Faculty.
const GRADE_BANDS = [
  [97, 1],
  [94, 1.25],
  [91, 1.5],
  [88, 1.75],
  [85, 2],
  [82, 2.25],
  [79, 2.5],
  [76, 2.75],
  [75, 3],
  [0, 5],
] as const;

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

function formatGrade(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }

  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric.toFixed(2) : "—";
}

function getRoomLabel(room: RoomInfo | null): string {
  if (!room) {
    return "No room assigned";
  }

  return room.room_code || room.room_name || `Room ${room.room_id}`;
}

function getGradeStatusClass(status: string | null | undefined): string {
  if (!status) {
    return "none";
  }

  return status.toLowerCase().replace(/\s+/g, "-");
}

function getSubjectStatusClass(status: string): string {
  return status.toLowerCase().replace(/\s+/g, "-");
}

function percentageInHundredths(value: string): number | null {
  const text = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || number > 100) return null;
  return Math.round(number * 100);
}

function validatePercentage(value: string, label: string): string | null {
  if (!value.trim()) return `${label} percentage is required.`;
  if (percentageInHundredths(value) === null) {
    return `${label} must be between 0 and 100 with at most two decimal places.`;
  }
  return null;
}

function calculateGrade(form: DirectGradeForm): GradeComputation {
  if (form.grading_outcome === "INCOMPLETE") {
    return {
      complete:
        form.outcome_reason.trim().length > 0 &&
        form.outcome_reason.trim().length <= 500,
      overallPercentage: null,
      finalRating: 4,
      finalRatingText: "4.00",
      remarks: "Incomplete",
    };
  }

  if (form.grading_outcome === "UNOFFICIAL_DROP") {
    return {
      complete:
        form.outcome_reason.trim().length > 0 &&
        form.outcome_reason.trim().length <= 500,
      overallPercentage: null,
      finalRating: 6,
      finalRatingText: "6.00",
      remarks: "Unofficial Drop",
    };
  }

  const midterm = percentageInHundredths(form.midterm_grade);
  const finalTerm = percentageInHundredths(form.final_grade);
  if (midterm === null || finalTerm === null) {
    return {
      complete: false,
      overallPercentage: null,
      finalRating: null,
      finalRatingText: "",
      remarks: null,
    };
  }

  // Use hundredths; never round the 50/50 average before choosing the band.
  const total = midterm + finalTerm;
  const overallPercentage = total / 200;
  const finalRating =
    GRADE_BANDS.find(([threshold]) => total >= threshold * 200)?.[1] ?? 5;
  return {
    complete: true,
    overallPercentage,
    finalRating,
    finalRatingText: finalRating.toFixed(2),
    remarks: finalRating <= 3 ? "Passed" : "Failed",
  };
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

  const [selectedClass, setSelectedClass] = useState<ClassItem | null>(null);

  const [gradebook, setGradebook] = useState<GradebookResponse | null>(null);

  const [gradebookLoading, setGradebookLoading] = useState(false);
  const [gradebookError, setGradebookError] = useState("");

  const [gradebookNotice, setGradebookNotice] = useState<Notice | null>(null);

  const [directStudent, setDirectStudent] = useState<GradebookStudent | null>(
    null,
  );

  const [directForm, setDirectForm] = useState<DirectGradeForm>({
    ...EMPTY_DIRECT_FORM,
  });

  const [directError, setDirectError] = useState("");

  const [directSubmitting, setDirectSubmitting] = useState(false);

  const [confirmDirectGrade, setConfirmDirectGrade] = useState(false);

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
                  [1, 2].includes(Number(item.academic_period.semester_id)) &&
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

  const directGradeResult = useMemo(
    () => calculateGrade(directForm),
    [directForm],
  );

  const refreshClasses = () => {
    setRefreshKey((current) => current + 1);
  };

  const loadGradebook = async (item: ClassItem) => {
    try {
      setGradebookLoading(true);
      setGradebookError("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${item.offering_id}/gradebook`,
        {
          method: "GET",
        },
      );

      const data = await readJsonResponse<GradebookResponse>(response);

      if (response.status === 401) {
        authService.logout();

        navigate("/login", {
          replace: true,
        });

        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Unable to load class gradebook.",
        );
      }

      setGradebook(data);
    } catch (requestError) {
      console.error("LOAD PROGRAM HEAD CLASS GRADEBOOK ERROR:", requestError);
      setGradebook(null);

      setGradebookError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load class gradebook.",
      );
    } finally {
      setGradebookLoading(false);
    }
  };

  const openClass = async (item: ClassItem) => {
    setSelectedClass(item);

    setGradebook(null);
    setGradebookError("");
    setGradebookNotice(null);

    await loadGradebook(item);
  };

  const closeClass = () => {
    if (gradebookLoading || directSubmitting) {
      return;
    }

    setConfirmDirectGrade(false);

    setSelectedClass(null);

    setGradebook(null);
    setGradebookError("");
    setGradebookNotice(null);

    setDirectStudent(null);

    setDirectForm({ ...EMPTY_DIRECT_FORM });

    setDirectError("");
  };

  const openDirectGrade = (student: GradebookStudent) => {
    if (!selectedClass) {
      return;
    }

    if (!selectedClass.grading_ready || !selectedClass.faculty) {
      setGradebookNotice({
        type: "error",

        message:
          selectedClass.grading_block_reason ||
          "Direct grade encoding is unavailable for this class.",
      });

      return;
    }

    if (student.grade) {
      setGradebookNotice({
        type: "error",

        message:
          "A grade already exists for this student. Existing grade work cannot be overwritten.",
      });

      return;
    }

    if (student.subject_status !== "Enrolled") {
      setGradebookNotice({
        type: "error",

        message:
          "Direct grade encoding is only available for actively enrolled subjects without an existing grade.",
      });

      return;
    }

    setConfirmDirectGrade(false);

    setDirectStudent(student);

    setDirectForm({ ...EMPTY_DIRECT_FORM });

    setDirectError("");
  };

  const closeDirectGrade = () => {
    if (directSubmitting) {
      return;
    }

    setConfirmDirectGrade(false);

    setDirectStudent(null);

    setDirectForm({ ...EMPTY_DIRECT_FORM });

    setDirectError("");
  };

  const submitDirectGrade = () => {
    if (!selectedClass || !directStudent) {
      return;
    }

    setDirectError("");

    if (!selectedClass.grading_ready || !selectedClass.faculty) {
      setDirectError(
        selectedClass.grading_block_reason ||
          "Direct grade encoding is unavailable for this offering.",
      );

      return;
    }

    if (directStudent.grade) {
      setDirectError(
        "A grade already exists for this student and cannot be overwritten.",
      );

      return;
    }

    if (directStudent.subject_status !== "Enrolled") {
      setDirectError(
        "This student subject is no longer actively enrolled and cannot receive a new direct grade.",
      );

      return;
    }

    if (directForm.grading_outcome === "NUMERIC") {
      const error =
        validatePercentage(directForm.midterm_grade, "Midterm") ||
        validatePercentage(directForm.final_grade, "Final Term");
      if (error) {
        setDirectError(error);
        return;
      }
    } else {
      const reason = directForm.outcome_reason.trim();
      if (!reason || reason.length > 500) {
        setDirectError(
          "Enter a reason of 1–500 characters for this special outcome.",
        );
        return;
      }
    }

    if (!directGradeResult.complete || directGradeResult.finalRating === null) {
      setDirectError("The Final Rating could not be calculated.");
      return;
    }

    setConfirmDirectGrade(true);
  };

  const confirmAndApproveDirectGrade = async () => {
    if (!selectedClass || !directStudent) {
      return;
    }

    const gradeResult = calculateGrade(directForm);

    if (
      !gradeResult.complete ||
      gradeResult.finalRating === null ||
      !gradeResult.remarks
    ) {
      setConfirmDirectGrade(false);

      setDirectError("The Final Rating could not be calculated.");

      return;
    }

    try {
      setDirectSubmitting(true);

      setDirectError("");
      setGradebookNotice(null);

      const response = await authService.authFetch(
        `${API_BASE_URL}/${selectedClass.offering_id}/grades/${directStudent.enrollment_subject_id}/direct-approve`,
        {
          method: "PUT",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            midterm_grade:
              directForm.grading_outcome === "NUMERIC"
                ? Number(directForm.midterm_grade)
                : null,
            final_grade:
              directForm.grading_outcome === "NUMERIC"
                ? Number(directForm.final_grade)
                : null,
            grading_outcome: directForm.grading_outcome,
            outcome_reason:
              directForm.grading_outcome === "NUMERIC"
                ? null
                : directForm.outcome_reason.trim(),
          }),
        },
      );

      const data = await readJsonResponse<DirectGradeResponse>(response);

      if (response.status === 401) {
        authService.logout();

        navigate("/login", {
          replace: true,
        });

        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
            data.error ||
            "Unable to directly encode and approve grade.",
        );
      }

      setConfirmDirectGrade(false);

      setGradebookNotice({
        type: "success",

        message:
          data.message ||
          "Grade encoded and approved successfully by Program Head.",
      });

      setDirectStudent(null);

      setDirectForm({ ...EMPTY_DIRECT_FORM });

      await loadGradebook(selectedClass);

      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      console.error("PROGRAM HEAD DIRECT GRADE ERROR:", requestError);

      setConfirmDirectGrade(false);

      setDirectError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to directly encode and approve grade.",
      );
    } finally {
      setDirectSubmitting(false);
    }
  };

  useEffect(() => {
    if (!selectedClass) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (confirmDirectGrade) {
        if (!directSubmitting) {
          setConfirmDirectGrade(false);
        }

        return;
      }

      if (directStudent) {
        if (!directSubmitting) {
          setDirectStudent(null);

          setDirectForm({ ...EMPTY_DIRECT_FORM });

          setDirectError("");
        }

        return;
      }

      if (!gradebookLoading) {
        setSelectedClass(null);

        setGradebook(null);
        setGradebookError("");
        setGradebookNotice(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    const originalOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);

      document.body.style.overflow = originalOverflow;
    };
  }, [
    selectedClass,
    directStudent,
    directSubmitting,
    gradebookLoading,
    confirmDirectGrade,
  ]);

  if (!authenticated || userRole !== "Program Head") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="programhead-class-management">
        <section className="programhead-class-header">
          <div>
            <span className="programhead-class-eyebrow">Program Head</span>
            <h1>My Classes</h1>
            <p>
              View classes assigned to your faculty account. Open a class to
              review students and manage grades.
            </p>
            {programHead && (
              <small className="programhead-classes-owner">
                {programHead.program_head_name} ·{" "}
                {programHead.department.department_name}
              </small>
            )}
          </div>
          <button
            type="button"
            className="programhead-class-refresh"
            onClick={refreshClasses}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
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
                  : `${classes.length} class${classes.length === 1 ? "" : "es"}`}
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
                          <small>{item.subject.units} units</small>
                        </td>
                        <td>
                          <strong>{item.section.section_name}</strong>
                          <span>
                            {item.section.course.course_code} · Year{" "}
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
                            {item.capacity.official_students} /{" "}
                            {item.capacity.max_students || "—"}
                          </strong>
                          <span>
                            {item.grades.approved} approved ·{" "}
                            {item.grades.submitted} submitted
                          </span>
                          <small>
                            {item.grades.without_grade} without grades
                          </small>
                        </td>
                        <td>
                          <span
                            className={`programhead-class-status ${item.offering_status.toLowerCase()}`}
                          >
                            {item.offering_status}
                          </span>
                          <small className="programhead-classes-list__grading">
                            {item.grading_ready
                              ? "Grade review ready"
                              : "Grade review blocked"}
                          </small>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="programhead-class-manage"
                            onClick={() => void openClass(item)}
                          >
                            Manage grades
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

        {selectedClass && (
          <div
            className="programhead-gradebook-backdrop"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target && !directStudent) {
                closeClass();
              }
            }}
          >
            <section className="programhead-gradebook-modal">
              <header className="programhead-gradebook-header">
                <div>
                  <span>Class Management</span>

                  <h2>
                    {selectedClass.subject.subject_code} ·{" "}
                    {selectedClass.section.section_name}
                  </h2>

                  <p>{selectedClass.subject.subject_name}</p>
                </div>

                <button
                  type="button"
                  className="programhead-gradebook-close"
                  onClick={closeClass}
                  disabled={gradebookLoading || directSubmitting}
                >
                  ×
                </button>
              </header>

              <div className="programhead-gradebook-meta">
                <div>
                  <span>Faculty</span>

                  <strong>
                    {selectedClass.faculty?.faculty_name ||
                      "No Faculty assigned"}
                  </strong>
                </div>

                <div>
                  <span>Academic Period</span>

                  <strong>{selectedClass.academic_period.academic_year}</strong>

                  <small>{selectedClass.academic_period.semester_name}</small>
                </div>

                <div>
                  <span>Schedule</span>

                  <strong>{formatDays(selectedClass.schedule.days)}</strong>

                  <small>
                    {selectedClass.schedule.time || "No time assigned"}
                  </small>
                </div>

                <div>
                  <span>Room</span>

                  <strong>{getRoomLabel(selectedClass.room)}</strong>
                </div>
              </div>

              {gradebookNotice && (
                <div
                  className={`programhead-gradebook-notice ${gradebookNotice.type}`}
                >
                  <strong>
                    {gradebookNotice.type === "success"
                      ? "Class record updated"
                      : "Action could not be completed"}
                  </strong>

                  <p>{gradebookNotice.message}</p>
                </div>
              )}

              {gradebookLoading && (
                <div className="programhead-gradebook-loading">
                  <div className="programhead-class-spinner" />

                  <strong>Loading class gradebook</strong>

                  <p>Retrieving officially enrolled students and grades.</p>
                </div>
              )}

              {gradebookError && !gradebookLoading && (
                <div className="programhead-gradebook-error">
                  <strong>Class gradebook could not be loaded</strong>

                  <p>{gradebookError}</p>
                  <button
                    type="button"
                    onClick={() => void loadGradebook(selectedClass)}
                  >
                    Try Again
                  </button>
                </div>
              )}

              {!gradebookLoading && !gradebookError && gradebook?.summary && (
                <>
                  <div className="programhead-gradebook-summary">
                    <div>
                      <span>Students</span>

                      <strong>{gradebook.summary.total_students}</strong>
                    </div>

                    <div>
                      <span>No Grade</span>

                      <strong>{gradebook.summary.without_grade}</strong>
                    </div>

                    <div>
                      <span>Draft</span>

                      <strong>{gradebook.summary.draft}</strong>
                    </div>

                    <div>
                      <span>Submitted</span>

                      <strong>{gradebook.summary.submitted}</strong>
                    </div>

                    <div>
                      <span>Returned</span>

                      <strong>{gradebook.summary.returned}</strong>
                    </div>

                    <div>
                      <span>Approved</span>

                      <strong>{gradebook.summary.approved}</strong>
                    </div>
                  </div>

                  {!selectedClass.grading_ready && (
                    <div className="programhead-direct-blocked-notice">
                      <strong>Direct grade encoding unavailable</strong>

                      <p>
                        {selectedClass.grading_block_reason ||
                          "A Faculty assignment is required before this class can receive grades."}
                      </p>
                    </div>
                  )}

                  <div className="programhead-gradebook-body">
                    {!gradebook.students || gradebook.students.length === 0 ? (
                      <div className="programhead-gradebook-empty">
                        <strong>No official students</strong>

                        <p>
                          No approved-enrollment students are currently attached
                          to this offering.
                        </p>
                      </div>
                    ) : (
                      <div className="programhead-gradebook-table-scroll">
                        <table className="programhead-gradebook-table">
                          <thead>
                            <tr>
                              <th>Student</th>
                              <th>Subject Status</th>
                              <th>Midterm %</th>
                              <th>Final Term %</th>
                              <th>Overall %</th>
                              <th>Rating</th>
                              <th>Remarks</th>
                              <th>Grade Status</th>
                              <th>Action</th>
                            </tr>
                          </thead>

                          <tbody>
                            {gradebook.students.map((student) => {
                              const canDirectEncode =
                                selectedClass.grading_ready &&
                                selectedClass.faculty !== null &&
                                student.grade === null &&
                                student.subject_status === "Enrolled";

                              return (
                                <tr key={student.enrollment_subject_id}>
                                  <td>
                                    <div className="programhead-gradebook-student">
                                      <strong>{student.full_name}</strong>

                                      <span>{student.student_number}</span>
                                    </div>
                                  </td>

                                  <td>
                                    <span
                                      className={`programhead-subject-status ${getSubjectStatusClass(
                                        student.subject_status,
                                      )}`}
                                    >
                                      {student.subject_status}
                                    </span>
                                  </td>

                                  <td>
                                    {formatGrade(student.grade?.midterm_grade)}
                                  </td>

                                  <td>
                                    {formatGrade(student.grade?.final_grade)}
                                  </td>

                                  <td>
                                    {formatGrade(
                                      student.grade?.overall_percentage,
                                    )}
                                  </td>

                                  <td>
                                    <strong>
                                      {formatGrade(student.grade?.final_rating)}
                                    </strong>
                                  </td>

                                  <td>
                                    {student.grade?.remarks ? (
                                      <span
                                        className={`programhead-grade-remark ${student.grade.remarks.toLowerCase()}`}
                                      >
                                        {student.grade.remarks}
                                      </span>
                                    ) : (
                                      <span className="programhead-grade-muted">
                                        —
                                      </span>
                                    )}
                                  </td>

                                  <td>
                                    {student.grade ? (
                                      <span
                                        className={`programhead-grade-status ${getGradeStatusClass(
                                          student.grade.grade_status,
                                        )}`}
                                      >
                                        {student.grade.grade_status}
                                      </span>
                                    ) : (
                                      <span className="programhead-grade-status none">
                                        No Grade
                                      </span>
                                    )}
                                  </td>

                                  <td>
                                    {canDirectEncode ? (
                                      <button
                                        type="button"
                                        className="programhead-direct-grade-button"
                                        onClick={() => openDirectGrade(student)}
                                      >
                                        Encode Grade
                                      </button>
                                    ) : student.grade ? (
                                      <span className="programhead-grade-action-label locked">
                                        Existing Grade
                                      </span>
                                    ) : (
                                      <span className="programhead-grade-action-label blocked">
                                        Unavailable
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        )}

        {selectedClass && directStudent && (
          <div
            className="programhead-direct-grade-backdrop"
            onMouseDown={(event) => {
              if (event.currentTarget !== event.target || directSubmitting) {
                return;
              }

              if (confirmDirectGrade) {
                setConfirmDirectGrade(false);

                return;
              }

              closeDirectGrade();
            }}
          >
            {!confirmDirectGrade ? (
              <section className="programhead-direct-grade-modal">
                <header className="programhead-direct-grade-header">
                  <div>
                    <span>Program Head Direct Encoding</span>

                    <h2>Encode Student Grade</h2>

                    <p>
                      Enter Midterm and Final Term percentages using the same
                      grading policy as Faculty. The server calculates the
                      official rating.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={closeDirectGrade}
                    disabled={directSubmitting}
                    aria-label="Close grade encoding"
                  >
                    ×
                  </button>
                </header>

                <div className="programhead-direct-grade-student">
                  <div>
                    <span>Student</span>

                    <strong>{directStudent.full_name}</strong>

                    <small>{directStudent.student_number}</small>
                  </div>

                  <div>
                    <span>Subject</span>

                    <strong>{selectedClass.subject.subject_code}</strong>

                    <small>{selectedClass.subject.subject_name}</small>
                  </div>

                  <div>
                    <span>Section</span>

                    <strong>{selectedClass.section.section_name}</strong>

                    <small>
                      {selectedClass.section.course.course_code} · Year{" "}
                      {selectedClass.section.year_level}
                    </small>
                  </div>

                  <div>
                    <span>Assigned Faculty</span>

                    <strong>
                      {selectedClass.faculty?.faculty_name || "—"}
                    </strong>

                    <small>
                      {selectedClass.faculty?.employee_number || "—"}
                    </small>
                  </div>
                </div>

                <div className="programhead-direct-grade-warning">
                  <div>!</div>

                  <p>
                    <strong>Final Rating is calculated automatically.</strong>{" "}
                    Numeric grading uses Midterm 50% and Final Term 50%. The
                    backend independently calculates the official rating.
                  </p>
                </div>

                <div className="programhead-direct-grade-form">
                  <div>
                    <label htmlFor="ph-grade-outcome">Grading Outcome</label>
                    <select
                      id="ph-grade-outcome"
                      value={directForm.grading_outcome}
                      onChange={(event) =>
                        setDirectForm({
                          ...EMPTY_DIRECT_FORM,
                          grading_outcome: event.target.value as GradeOutcome,
                        })
                      }
                      disabled={directSubmitting}
                    >
                      <option value="NUMERIC">Numeric Grade</option>
                      <option value="INCOMPLETE">Incomplete (4.00)</option>
                      <option value="UNOFFICIAL_DROP">
                        Unofficial Drop (6.00)
                      </option>
                    </select>
                  </div>

                  {directForm.grading_outcome === "NUMERIC" ? (
                    <>
                      <div>
                        <label htmlFor="ph-midterm-grade">Midterm (%)</label>
                        <input
                          id="ph-midterm-grade"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max="100"
                          step="0.01"
                          placeholder="0–100"
                          value={directForm.midterm_grade}
                          onChange={(event) =>
                            setDirectForm((current) => ({
                              ...current,
                              midterm_grade: event.target.value,
                            }))
                          }
                          disabled={directSubmitting}
                        />
                      </div>
                      <div>
                        <label htmlFor="ph-final-term-grade">
                          Final Term (%)
                        </label>
                        <input
                          id="ph-final-term-grade"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max="100"
                          step="0.01"
                          placeholder="0–100"
                          value={directForm.final_grade}
                          onChange={(event) =>
                            setDirectForm((current) => ({
                              ...current,
                              final_grade: event.target.value,
                            }))
                          }
                          disabled={directSubmitting}
                        />
                      </div>
                    </>
                  ) : (
                    <div>
                      <label htmlFor="ph-outcome-reason">
                        Reason (required)
                      </label>
                      <textarea
                        id="ph-outcome-reason"
                        rows={3}
                        maxLength={500}
                        placeholder="Explain the special academic outcome"
                        value={directForm.outcome_reason}
                        onChange={(event) =>
                          setDirectForm((current) => ({
                            ...current,
                            outcome_reason: event.target.value,
                          }))
                        }
                        disabled={directSubmitting}
                      />
                    </div>
                  )}

                  <div>
                    <label>Final Rating (automatic)</label>
                    <input
                      value={directGradeResult.finalRatingText}
                      placeholder="Auto-calculated"
                      readOnly
                      aria-label="Calculated final rating"
                    />
                  </div>
                </div>

                <div className="programhead-direct-grade-result">
                  <span>Calculated Academic Result</span>
                  {!directGradeResult.complete ? (
                    <strong className="none">
                      {directForm.grading_outcome === "NUMERIC"
                        ? "Enter valid Midterm and Final Term percentages"
                        : "Enter a reason to continue"}
                    </strong>
                  ) : directGradeResult.remarks ? (
                    <strong
                      className={directGradeResult.remarks
                        .toLowerCase()
                        .replace(/\s+/g, "-")}
                    >
                      {directGradeResult.remarks}
                    </strong>
                  ) : (
                    <strong className="none">Unable to Calculate</strong>
                  )}
                  <small>
                    {directForm.grading_outcome === "NUMERIC" &&
                    directGradeResult.overallPercentage !== null
                      ? `Overall: ${directGradeResult.overallPercentage.toFixed(2)}% · Rating: ${directGradeResult.finalRatingText}`
                      : directForm.grading_outcome === "NUMERIC"
                        ? "Overall = Midterm 50% + Final Term 50%"
                        : `Official rating: ${directGradeResult.finalRatingText}`}
                  </small>
                </div>

                {directError && (
                  <div className="programhead-direct-grade-error">
                    <strong>Grade could not be reviewed</strong>

                    <p>{directError}</p>
                  </div>
                )}

                <footer className="programhead-direct-grade-actions">
                  <button
                    type="button"
                    className="programhead-direct-cancel"
                    onClick={closeDirectGrade}
                    disabled={directSubmitting}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    className="programhead-direct-submit"
                    onClick={submitDirectGrade}
                    disabled={directSubmitting || !directGradeResult.complete}
                  >
                    Review & Submit
                  </button>
                </footer>
              </section>
            ) : (
              <section className="programhead-direct-grade-modal programhead-confirm-grade-modal">
                <header className="programhead-direct-grade-header">
                  <div>
                    <span>Final Grade Review</span>

                    <h2>Submit & Approve Grade?</h2>

                    <p>
                      Verify the calculated grade before making it an official
                      academic result.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setConfirmDirectGrade(false)}
                    disabled={directSubmitting}
                    aria-label="Close confirmation"
                  >
                    ×
                  </button>
                </header>

                <div className="programhead-confirm-grade-student">
                  <div>
                    <span>Student</span>

                    <strong>{directStudent.full_name}</strong>

                    <small>{directStudent.student_number}</small>
                  </div>

                  <div>
                    <span>Subject</span>

                    <strong>{selectedClass.subject.subject_code}</strong>

                    <small>{selectedClass.subject.subject_name}</small>
                  </div>

                  <div>
                    <span>Section</span>

                    <strong>{selectedClass.section.section_name}</strong>

                    <small>
                      {selectedClass.section.course.course_code} · Year{" "}
                      {selectedClass.section.year_level}
                    </small>
                  </div>
                </div>

                <div className="programhead-confirm-grade-review">
                  <div>
                    <span>Grading Outcome</span>
                    <strong>
                      {directForm.grading_outcome.replace(/_/g, " ")}
                    </strong>
                  </div>
                  <div>
                    <span>Midterm (%)</span>
                    <strong>
                      {directForm.grading_outcome === "NUMERIC"
                        ? directForm.midterm_grade || "—"
                        : "N/A"}
                    </strong>
                  </div>
                  <div>
                    <span>Final Term (%)</span>
                    <strong>
                      {directForm.grading_outcome === "NUMERIC"
                        ? directForm.final_grade || "—"
                        : "N/A"}
                    </strong>
                  </div>
                  <div className="final-rating">
                    <span>Final Rating</span>
                    <strong>{directGradeResult.finalRatingText || "—"}</strong>
                  </div>
                </div>
                {directForm.grading_outcome !== "NUMERIC" && (
                  <div className="programhead-confirm-grade-record">
                    <div>
                      <span>Outcome Reason</span>
                      <strong>{directForm.outcome_reason}</strong>
                    </div>
                  </div>
                )}

                <div className="programhead-confirm-grade-result">
                  <span>Academic Result</span>

                  {directGradeResult.remarks ? (
                    <strong
                      className={directGradeResult.remarks
                        .toLowerCase()
                        .replace(/\s+/g, "-")}
                    >
                      {directGradeResult.remarks}
                    </strong>
                  ) : (
                    <strong>Invalid</strong>
                  )}
                </div>

                <div className="programhead-confirm-grade-warning">
                  <div>!</div>

                  <div>
                    <strong>This will become an official grade.</strong>

                    <p>
                      {directForm.grading_outcome === "NUMERIC"
                        ? `Midterm and Final Term percentages produce an overall result of ${directGradeResult.overallPercentage?.toFixed(2) ?? "—"}% and an official rating of ${directGradeResult.finalRatingText}.`
                        : `This special outcome will be recorded as ${directGradeResult.remarks} (${directGradeResult.finalRatingText}).`}{" "}
                      Confirming processes the grade through Draft → Submitted →
                      Approved.
                    </p>
                  </div>
                </div>

                <div className="programhead-confirm-grade-record">
                  <div>
                    <span>Assigned Faculty</span>

                    <strong>
                      {selectedClass.faculty?.faculty_name || "—"}
                    </strong>
                  </div>

                  <div>
                    <span>Approved By</span>

                    <strong>
                      {programHead?.program_head_name || "Program Head"}
                    </strong>
                  </div>
                </div>

                {directError && (
                  <div className="programhead-direct-grade-error">
                    <strong>Grade could not be approved</strong>

                    <p>{directError}</p>
                  </div>
                )}

                <footer className="programhead-direct-grade-actions">
                  <button
                    type="button"
                    className="programhead-direct-cancel"
                    onClick={() => setConfirmDirectGrade(false)}
                    disabled={directSubmitting}
                  >
                    Back to Edit
                  </button>

                  <button
                    type="button"
                    className="programhead-direct-submit"
                    onClick={() => void confirmAndApproveDirectGrade()}
                    disabled={directSubmitting || !directGradeResult.complete}
                  >
                    {directSubmitting
                      ? "Approving Grade..."
                      : "Confirm & Approve"}
                  </button>
                </footer>
              </section>
            )}
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
