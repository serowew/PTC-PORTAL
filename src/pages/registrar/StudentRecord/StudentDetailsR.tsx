import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  FileBadge,
  GraduationCap,
  Hash,
  IdCard,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  School,
  UserRound,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/RegistrarStudentDetails.css";

// =====================================================
// API
// =====================================================

const API_BASE_URL = "http://localhost:3000/api/registrar/students";

// =====================================================
// TYPES
// =====================================================

interface Student {
  student_id: number;
  student_number: string;

  first_name: string;
  middle_name: string | null;
  last_name: string;

  gender: string | null;
  birth_date: string | null;
  contact_number: string | null;
  email: string | null;

  course_id: number | null;
  course_code: string | null;

  year_level: number | null;

  section_id: number | null;
  section_name: string | null;

  semester_id: number | null;
  semester_name: string | null;

  status: string | null;

  house_no: string | null;
  street: string | null;
  barangay: string | null;
  city: string | null;
  province: string | null;
  zip_code: string | null;
}

interface StudentResponse {
  success: boolean;
  message?: string;
  error?: string;
  student?: Student;
}

type StatusVariant =
  | "active"
  | "graduated"
  | "warning"
  | "danger"
  | "neutral";

// =====================================================
// HELPERS
// =====================================================

const getDisplayValue = (
  value: string | number | null | undefined,
  fallback = "Not provided",
) => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  return String(value);
};

const formatBirthDate = (dateValue: string | null) => {
  if (!dateValue) return "Not provided";

  const dateOnly = dateValue.split("T")[0];
  const [year, month, day] = dateOnly.split("-").map(Number);

  if (!year || !month || !day) return dateValue;

  const date = new Date(year, month - 1, day);

  if (Number.isNaN(date.getTime())) return dateValue;

  return new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
};

const getStatusVariant = (status: string | null): StatusVariant => {
  const normalized = (status || "").trim().toLowerCase();

  if (
    normalized.includes("active") ||
    normalized.includes("enrolled") ||
    normalized.includes("regular")
  ) {
    return "active";
  }

  if (normalized.includes("graduat")) return "graduated";

  if (
    normalized.includes("drop") ||
    normalized.includes("inactive") ||
    normalized.includes("dismiss")
  ) {
    return "danger";
  }

  if (
    normalized.includes("leave") ||
    normalized.includes("pending") ||
    normalized.includes("hold")
  ) {
    return "warning";
  }

  return "neutral";
};

// =====================================================
// COMPONENT
// =====================================================

export default function StudentDetailsR() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  // =====================================================
  // AUTHENTICATION
  // =====================================================

  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  // =====================================================
  // STATE
  // =====================================================

  const [student, setStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // =====================================================
  // AUTHORIZATION
  // =====================================================

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Registrar") {
      if (user) {
        navigate(authService.getDashboardRoute(user.role), { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [authenticated, userRole, user, navigate]);

  // =====================================================
  // FETCH STUDENT
  // =====================================================

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") return;

    if (!id) {
      setStudent(null);
      setError("Invalid student ID.");
      setLoading(false);
      return;
    }

    const studentId = Number(id);

    if (!Number.isInteger(studentId) || studentId <= 0) {
      setStudent(null);
      setError("Invalid student ID.");
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    const fetchStudent = async () => {
      try {
        setLoading(true);
        setError("");

        const requestUrl = `${API_BASE_URL}/${studentId}`;

        const response = await authService.authFetch(requestUrl, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

        const contentType = response.headers.get("content-type") || "";
        let data: StudentResponse | null = null;

        if (contentType.includes("application/json")) {
          data = (await response.json()) as StudentResponse;
        } else {
          const text = await response.text();

          throw new Error(
            `Server returned a non-JSON response (${response.status}): ${text.slice(
              0,
              200,
            )}`,
          );
        }

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          throw new Error(
            data?.message || "You are not authorized to view this student.",
          );
        }

        if (!response.ok) {
          throw new Error(
            data?.message ||
              data?.error ||
              `Unable to load student (${response.status}).`,
          );
        }

        if (!data?.success || !data.student) {
          throw new Error(data?.message || "Failed to load student.");
        }

        setStudent(data.student);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;

        console.error("GET STUDENT DETAILS ERROR:", err);
        setStudent(null);

        if (err instanceof TypeError) {
          setError(
            "Unable to connect to the student records server. Make sure the backend is running on port 3000.",
          );
          return;
        }

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load student information.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void fetchStudent();

    return () => {
      controller.abort();
    };
  }, [id, authenticated, userRole, navigate, refreshKey]);

  // =====================================================
  // DERIVED DISPLAY VALUES
  // =====================================================

  const fullName = useMemo(() => {
    if (!student) return "";

    return [student.first_name, student.middle_name, student.last_name]
      .filter(Boolean)
      .join(" ");
  }, [student]);

  const initials = useMemo(() => {
    if (!student) return "ST";

    const first = student.first_name?.trim().charAt(0) || "";
    const last = student.last_name?.trim().charAt(0) || "";

    return `${first}${last}`.toUpperCase() || "ST";
  }, [student]);

  const fullAddress = useMemo(() => {
    if (!student) return "";

    return [
      student.house_no,
      student.street,
      student.barangay,
      student.city,
      student.province,
      student.zip_code,
    ]
      .filter((part): part is string => Boolean(part?.trim()))
      .join(", ");
  }, [student]);

  // =====================================================
  // AUTH RENDER GUARD
  // =====================================================

  if (!authenticated || !user || userRole !== "Registrar") {
    return null;
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <DashboardLayout>
      <main className="registrar-student-details">
        {/* =================================================
            PAGE HERO
        ================================================= */}
        <section className="registrar-student-details__hero">
          <div className="registrar-student-details__hero-copy">
            <span className="registrar-student-details__eyebrow">
              <span className="registrar-student-details__eyebrow-icon">
                <IdCard size={15} strokeWidth={2.2} />
              </span>
              Student Records
            </span>

            <h1>Student Details</h1>
            <p>
              Review the student&apos;s profile, academic placement, contact
              information, and available Registrar record actions.
            </p>
          </div>

          <div className="registrar-student-details__hero-actions">
            <button
              type="button"
              className="registrar-student-details__button registrar-student-details__button--secondary"
              onClick={() => navigate("/registrar/student/listR")}
            >
              <ArrowLeft size={16} />
              Back to Student List
            </button>

            <button
              type="button"
              className="registrar-student-details__button registrar-student-details__button--primary"
              onClick={() => setRefreshKey((current) => current + 1)}
              disabled={loading}
            >
              <RefreshCw
                size={16}
                className={loading ? "registrar-student-details__spin" : ""}
              />
              {loading ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </section>

        {/* =================================================
            LOADING
        ================================================= */}
        {loading && (
          <section
            className="registrar-student-details__loading"
            aria-live="polite"
          >
            <div className="registrar-student-details__profile-skeleton">
              <div className="registrar-student-details__skeleton registrar-student-details__skeleton--avatar" />

              <div className="registrar-student-details__skeleton-copy">
                <div className="registrar-student-details__skeleton registrar-student-details__skeleton--title" />
                <div className="registrar-student-details__skeleton registrar-student-details__skeleton--text" />
                <div className="registrar-student-details__skeleton registrar-student-details__skeleton--badge" />
              </div>
            </div>

            <div className="registrar-student-details__loading-grid">
              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className="registrar-student-details__loading-item"
                >
                  <div className="registrar-student-details__skeleton registrar-student-details__skeleton--label" />
                  <div className="registrar-student-details__skeleton registrar-student-details__skeleton--value" />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* =================================================
            ERROR
        ================================================= */}
        {!loading && error && (
          <section className="registrar-student-details__error" role="alert">
            <div className="registrar-student-details__error-icon">
              <ClipboardCheck size={23} />
            </div>

            <div className="registrar-student-details__error-copy">
              <strong>Student information could not be loaded</strong>
              <p>{error}</p>
            </div>

            <button
              type="button"
              onClick={() => setRefreshKey((current) => current + 1)}
            >
              <RefreshCw size={15} />
              Try Again
            </button>
          </section>
        )}

        {/* =================================================
            STUDENT CONTENT
        ================================================= */}
        {!loading && !error && student && (
          <>
            {/* =============================================
                PROFILE SUMMARY
            ============================================= */}
            <section className="registrar-student-details__profile-card">
              <div className="registrar-student-details__identity">
                <div
                  className="registrar-student-details__avatar"
                  aria-hidden="true"
                >
                  {initials}
                </div>

                <div className="registrar-student-details__identity-copy">
                  <div className="registrar-student-details__identity-heading">
                    <h2>{fullName || "Student"}</h2>

                    <span
                      className={`registrar-student-details__status registrar-student-details__status--${getStatusVariant(
                        student.status,
                      )}`}
                    >
                      <span />
                      {getDisplayValue(student.status, "Unknown status")}
                    </span>
                  </div>

                  <p className="registrar-student-details__student-number">
                    <Hash size={14} />
                    {getDisplayValue(student.student_number, "No student number")}
                  </p>

                  <div className="registrar-student-details__identity-tags">
                    <span>
                      <GraduationCap size={14} />
                      {getDisplayValue(student.course_code, "No course")}
                    </span>
                    <span>
                      <School size={14} />
                      {student.year_level
                        ? `Year ${student.year_level}`
                        : "Year not set"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="registrar-student-details__summary-grid">
                <div className="registrar-student-details__summary-item">
                  <span className="registrar-student-details__summary-icon">
                    <GraduationCap size={17} />
                  </span>
                  <div>
                    <span>Course</span>
                    <strong>
                      {getDisplayValue(student.course_code, "Not assigned")}
                    </strong>
                  </div>
                </div>

                <div className="registrar-student-details__summary-item">
                  <span className="registrar-student-details__summary-icon">
                    <School size={17} />
                  </span>
                  <div>
                    <span>Year Level</span>
                    <strong>
                      {student.year_level
                        ? `Year ${student.year_level}`
                        : "Not assigned"}
                    </strong>
                  </div>
                </div>

                <div className="registrar-student-details__summary-item">
                  <span className="registrar-student-details__summary-icon">
                    <UsersRound size={17} />
                  </span>
                  <div>
                    <span>Section</span>
                    <strong>
                      {getDisplayValue(student.section_name, "Not assigned")}
                    </strong>
                  </div>
                </div>

                <div className="registrar-student-details__summary-item">
                  <span className="registrar-student-details__summary-icon">
                    <CalendarDays size={17} />
                  </span>
                  <div>
                    <span>Semester</span>
                    <strong>
                      {getDisplayValue(student.semester_name, "Not assigned")}
                    </strong>
                  </div>
                </div>
              </div>
            </section>

            {/* =============================================
                QUICK RECORD ACTIONS
            ============================================= */}
            <section className="registrar-student-details__record-actions">
              <div className="registrar-student-details__section-heading registrar-student-details__section-heading--compact">
                <div>
                  <span className="registrar-student-details__section-kicker">
                    Registrar Tools
                  </span>
                  <h2>Student Record Actions</h2>
                </div>
                <p>Open the related record without returning to the student list.</p>
              </div>

              <div className="registrar-student-details__action-grid">
                <button
                  type="button"
                  className="registrar-student-details__action-card"
                  onClick={() =>
                    navigate(
                      `/registrar/student/${student.student_id}/AcadRecR`,
                    )
                  }
                >
                  <span className="registrar-student-details__action-icon">
                    <BookOpen size={20} />
                  </span>
                  <span className="registrar-student-details__action-copy">
                    <strong>Academic Records</strong>
                    <small>Review grades and official academic history</small>
                  </span>
                  <span className="registrar-student-details__action-arrow">→</span>
                </button>

                <button
                  type="button"
                  className="registrar-student-details__action-card"
                  onClick={() =>
                    navigate(
                      `/registrar/student/${student.student_id}/DocumentsR`,
                    )
                  }
                >
                  <span className="registrar-student-details__action-icon">
                    <FileBadge size={20} />
                  </span>
                  <span className="registrar-student-details__action-copy">
                    <strong>Student COG</strong>
                    <small>Open the student&apos;s certificate of grades</small>
                  </span>
                  <span className="registrar-student-details__action-arrow">→</span>
                </button>

                <button
                  type="button"
                  className="registrar-student-details__action-card"
                  onClick={() =>
                    navigate(
                      `/registrar/student/${student.student_id}/TransferEvaluationR`,
                    )
                  }
                >
                  <span className="registrar-student-details__action-icon">
                    <ClipboardCheck size={20} />
                  </span>
                  <span className="registrar-student-details__action-copy">
                    <strong>Transfer Evaluation</strong>
                    <small>Review transferred subjects and credited records</small>
                  </span>
                  <span className="registrar-student-details__action-arrow">→</span>
                </button>
              </div>
            </section>

            {/* =============================================
                INFORMATION SECTIONS
            ============================================= */}
            <div className="registrar-student-details__content-grid">
              <section className="registrar-student-details__info-card">
                <div className="registrar-student-details__section-heading">
                  <div className="registrar-student-details__section-title-row">
                    <span className="registrar-student-details__section-icon">
                      <UserRound size={18} />
                    </span>
                    <div>
                      <span className="registrar-student-details__section-kicker">
                        Profile
                      </span>
                      <h2>Personal Information</h2>
                    </div>
                  </div>
                  <p>Basic identity and contact details on the student record.</p>
                </div>

                <div className="registrar-student-details__details-grid">
                  <div className="registrar-student-details__field">
                    <span>First Name</span>
                    <strong>{getDisplayValue(student.first_name)}</strong>
                  </div>

                  <div className="registrar-student-details__field">
                    <span>Middle Name</span>
                    <strong>{getDisplayValue(student.middle_name)}</strong>
                  </div>

                  <div className="registrar-student-details__field">
                    <span>Last Name</span>
                    <strong>{getDisplayValue(student.last_name)}</strong>
                  </div>

                  <div className="registrar-student-details__field">
                    <span>Gender</span>
                    <strong>{getDisplayValue(student.gender)}</strong>
                  </div>

                  <div className="registrar-student-details__field registrar-student-details__field--with-icon">
                    <span>Birth Date</span>
                    <strong>
                      <CalendarDays size={15} />
                      {formatBirthDate(student.birth_date)}
                    </strong>
                  </div>

                  <div className="registrar-student-details__field registrar-student-details__field--with-icon">
                    <span>Contact Number</span>
                    <strong>
                      <Phone size={15} />
                      {getDisplayValue(student.contact_number)}
                    </strong>
                  </div>

                  <div className="registrar-student-details__field registrar-student-details__field--full registrar-student-details__field--with-icon">
                    <span>Email Address</span>
                    <strong>
                      <Mail size={15} />
                      {student.email ? (
                        <a href={`mailto:${student.email}`}>{student.email}</a>
                      ) : (
                        "Not provided"
                      )}
                    </strong>
                  </div>
                </div>
              </section>

              <section className="registrar-student-details__info-card">
                <div className="registrar-student-details__section-heading">
                  <div className="registrar-student-details__section-title-row">
                    <span className="registrar-student-details__section-icon">
                      <GraduationCap size={18} />
                    </span>
                    <div>
                      <span className="registrar-student-details__section-kicker">
                        Enrollment
                      </span>
                      <h2>Academic Information</h2>
                    </div>
                  </div>
                  <p>Current academic placement stored for this student.</p>
                </div>

                <div className="registrar-student-details__details-grid">
                  <div className="registrar-student-details__field registrar-student-details__field--with-icon">
                    <span>Student Number</span>
                    <strong>
                      <Hash size={15} />
                      {getDisplayValue(student.student_number)}
                    </strong>
                  </div>

                  <div className="registrar-student-details__field registrar-student-details__field--with-icon">
                    <span>Course</span>
                    <strong>
                      <GraduationCap size={15} />
                      {getDisplayValue(student.course_code, "Not assigned")}
                    </strong>
                  </div>

                  <div className="registrar-student-details__field registrar-student-details__field--with-icon">
                    <span>Year Level</span>
                    <strong>
                      <School size={15} />
                      {student.year_level
                        ? `Year ${student.year_level}`
                        : "Not assigned"}
                    </strong>
                  </div>

                  <div className="registrar-student-details__field registrar-student-details__field--with-icon">
                    <span>Section</span>
                    <strong>
                      <UsersRound size={15} />
                      {getDisplayValue(student.section_name, "Not assigned")}
                    </strong>
                  </div>

                  <div className="registrar-student-details__field registrar-student-details__field--with-icon">
                    <span>Semester</span>
                    <strong>
                      <CalendarDays size={15} />
                      {getDisplayValue(student.semester_name, "Not assigned")}
                    </strong>
                  </div>

                  <div className="registrar-student-details__field">
                    <span>Status</span>
                    <strong>
                      <span
                        className={`registrar-student-details__inline-status registrar-student-details__inline-status--${getStatusVariant(
                          student.status,
                        )}`}
                      >
                        {getDisplayValue(student.status, "Unknown")}
                      </span>
                    </strong>
                  </div>
                </div>
              </section>

              <section className="registrar-student-details__info-card registrar-student-details__info-card--wide">
                <div className="registrar-student-details__section-heading">
                  <div className="registrar-student-details__section-title-row">
                    <span className="registrar-student-details__section-icon">
                      <MapPin size={18} />
                    </span>
                    <div>
                      <span className="registrar-student-details__section-kicker">
                        Residence
                      </span>
                      <h2>Address Information</h2>
                    </div>
                  </div>
                  <p>Residential address currently saved on the student profile.</p>
                </div>

                <div className="registrar-student-details__details-grid registrar-student-details__details-grid--address">
                  <div className="registrar-student-details__field">
                    <span>House No.</span>
                    <strong>{getDisplayValue(student.house_no)}</strong>
                  </div>

                  <div className="registrar-student-details__field">
                    <span>Street</span>
                    <strong>{getDisplayValue(student.street)}</strong>
                  </div>

                  <div className="registrar-student-details__field">
                    <span>Barangay</span>
                    <strong>{getDisplayValue(student.barangay)}</strong>
                  </div>

                  <div className="registrar-student-details__field">
                    <span>City</span>
                    <strong>{getDisplayValue(student.city)}</strong>
                  </div>

                  <div className="registrar-student-details__field">
                    <span>Province</span>
                    <strong>{getDisplayValue(student.province)}</strong>
                  </div>

                  <div className="registrar-student-details__field">
                    <span>ZIP Code</span>
                    <strong>{getDisplayValue(student.zip_code)}</strong>
                  </div>

                  <div className="registrar-student-details__address-summary">
                    <span className="registrar-student-details__address-icon">
                      <MapPin size={18} />
                    </span>
                    <div>
                      <span>Complete Address</span>
                      <strong>{fullAddress || "No complete address on file"}</strong>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </>
        )}
      </main>
    </DashboardLayout>
  );
}
