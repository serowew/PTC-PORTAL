import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BookOpenCheck,
  CalendarRange,
  CheckCircle2,
  GraduationCap,
  Hash,
  LoaderCircle,
  X,
} from "lucide-react";

import { authService } from "../../../services/auth.service";
import "../../../styles/CurriculumManagementR.css";

const API_BASE_URL = "http://localhost:3000/api/registrar/curriculums";
const COURSES_API_URL = `${API_BASE_URL}/courses`;

interface AddCurriculumModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

interface Course {
  course_id: number;
  course_code: string;
  course_name: string;
}

interface CourseResponse {
  success: boolean;
  data?: Course[];
  courses?: Course[];
  message?: string;
  error?: string;
}

interface CreateCurriculumResponse {
  success: boolean;
  message?: string;
  error?: string;
  curriculum_id?: number;
}

export default function AddCurriculumModal({
  onClose,
  onSuccess,
}: AddCurriculumModalProps) {
  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [courseId, setCourseId] = useState("");
  const [curriculumName, setCurriculumName] = useState("");
  const [effectiveYear, setEffectiveYear] = useState(
    new Date().getFullYear().toString(),
  );
  const [totalUnits, setTotalUnits] = useState("");
  const [isActive, setIsActive] = useState("0");

  const [courses, setCourses] = useState<Course[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [courseError, setCourseError] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const selectedCourse = useMemo(
    () => courses.find((course) => String(course.course_id) === courseId),
    [courses, courseId],
  );

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") {
      setLoadingCourses(false);
      return;
    }

    const controller = new AbortController();

    const loadCourses = async () => {
      try {
        setLoadingCourses(true);
        setCourseError("");

        const response = await authService.authFetch(COURSES_API_URL, {
          method: "GET",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        const contentType = response.headers.get("content-type") || "";
        let data: CourseResponse | null = null;

        if (contentType.includes("application/json")) {
          data = await response.json();
        } else {
          const text = await response.text();
          throw new Error(
            `Server returned a non-JSON response (${response.status}): ${text.slice(0, 200)}`,
          );
        }

        if (response.status === 401) {
          authService.logout();
          setCourseError("Your session has expired. Please log in again.");
          return;
        }

        if (response.status === 403) {
          throw new Error(
            data?.message ||
              data?.error ||
              "You are not authorized to load courses.",
          );
        }

        if (!response.ok || !data?.success) {
          throw new Error(
            data?.message || data?.error || "Failed to load courses.",
          );
        }

        const loadedCourses = Array.isArray(data.data)
          ? data.data
          : Array.isArray(data.courses)
            ? data.courses
            : [];

        setCourses(loadedCourses);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;

        console.error("GET COURSES FOR CURRICULUM ERROR:", err);
        setCourses([]);
        setCourseError(
          err instanceof Error ? err.message : "Unable to load courses.",
        );
      } finally {
        if (!controller.signal.aborted) setLoadingCourses(false);
      }
    };

    void loadCourses();

    return () => controller.abort();
  }, [authenticated, userRole]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, submitting]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccessMessage("");

    if (!authenticated || userRole !== "Registrar") {
      setError(
        "Your session has expired or you are not authorized to create curricula.",
      );
      return;
    }

    const parsedCourseId = Number(courseId);
    if (!Number.isInteger(parsedCourseId) || parsedCourseId <= 0) {
      setError("Please select a valid course.");
      return;
    }

    const trimmedName = curriculumName.trim();
    if (!trimmedName) {
      setError("Curriculum name is required.");
      return;
    }

    const parsedEffectiveYear = Number(effectiveYear);
    if (
      !Number.isInteger(parsedEffectiveYear) ||
      parsedEffectiveYear < 1900 ||
      parsedEffectiveYear > 2100
    ) {
      setError("Effective year must be between 1900 and 2100.");
      return;
    }

    const parsedTotalUnits = Number(totalUnits);
    if (!Number.isFinite(parsedTotalUnits) || parsedTotalUnits < 0) {
      setError(
        "Total units must be a valid number greater than or equal to 0.",
      );
      return;
    }

    try {
      setSubmitting(true);

      const payload = {
        course_id: parsedCourseId,
        curriculum_name: trimmedName,
        effective_year: parsedEffectiveYear,
        total_units: parsedTotalUnits,
        is_active: Number(isActive) === 1 ? 1 : 0,
      };

      const response = await authService.authFetch(API_BASE_URL, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const contentType = response.headers.get("content-type") || "";
      let data: CreateCurriculumResponse | null = null;

      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        throw new Error(
          `Server returned a non-JSON response (${response.status}): ${text.slice(0, 200)}`,
        );
      }

      if (response.status === 401) {
        authService.logout();
        setError("Your session has expired. Please log in again.");
        return;
      }

      if (response.status === 403) {
        throw new Error(
          data?.message ||
            data?.error ||
            "You are not authorized to create curricula.",
        );
      }

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.message || data?.error || "Failed to create curriculum.",
        );
      }

      setSuccessMessage(data.message || "Curriculum created successfully.");

      window.setTimeout(() => {
        onSuccess();
      }, 500);
    } catch (err) {
      console.error("CREATE CURRICULUM ERROR:", err);
      setError(
        err instanceof Error ? err.message : "Failed to create curriculum.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="registrar-curriculum-modal__overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        className="registrar-curriculum-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-curriculum-title"
        aria-describedby="add-curriculum-description"
      >
        <header className="registrar-curriculum-modal__header">
          <div className="registrar-curriculum-modal__heading">
            <span className="registrar-curriculum-modal__heading-icon">
              <BookOpenCheck size={21} aria-hidden="true" />
            </span>
            <div>
              <span className="registrar-curriculum-modal__eyebrow">
                New Academic Structure
              </span>
              <h2 id="add-curriculum-title">Add Curriculum</h2>
              <p id="add-curriculum-description">
                Create the curriculum record first, then open it to map and
                organize subjects.
              </p>
            </div>
          </div>

          <button
            type="button"
            className="registrar-curriculum-modal__close"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close add curriculum dialog"
          >
            <X size={19} aria-hidden="true" />
          </button>
        </header>

        <form className="registrar-curriculum-modal__form" onSubmit={handleSubmit}>
          {error && (
            <div className="registrar-curriculum-modal__message registrar-curriculum-modal__message--error" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <div>
                <strong>Unable to create curriculum</strong>
                <span>{error}</span>
              </div>
            </div>
          )}

          {successMessage && (
            <div className="registrar-curriculum-modal__message registrar-curriculum-modal__message--success" role="status">
              <CheckCircle2 size={18} aria-hidden="true" />
              <div>
                <strong>Curriculum created</strong>
                <span>{successMessage}</span>
              </div>
            </div>
          )}

          <div className="registrar-curriculum-modal__section">
            <div className="registrar-curriculum-modal__section-heading">
              <h3>Curriculum Information</h3>
              <p>Define the program, curriculum title, and effective year.</p>
            </div>

            <div className="registrar-curriculum-modal__field">
              <label htmlFor="curriculum-course">Course</label>
              <div className="registrar-curriculum-modal__control">
                <GraduationCap size={16} aria-hidden="true" />
                {loadingCourses ? (
                  <div className="registrar-curriculum-modal__loading-field">
                    <LoaderCircle size={16} className="is-spinning" aria-hidden="true" />
                    Loading available courses...
                  </div>
                ) : courseError ? (
                  <div className="registrar-curriculum-modal__field-error">
                    <AlertCircle size={16} aria-hidden="true" />
                    {courseError}
                  </div>
                ) : (
                  <select
                    id="curriculum-course"
                    value={courseId}
                    onChange={(event) => setCourseId(event.target.value)}
                    disabled={submitting}
                    required
                  >
                    <option value="">Select a course</option>
                    {courses.map((course) => (
                      <option key={course.course_id} value={course.course_id}>
                        {course.course_code} — {course.course_name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {selectedCourse && (
                <span className="registrar-curriculum-modal__helper">
                  Creating for {selectedCourse.course_code} — {selectedCourse.course_name}
                </span>
              )}
            </div>

            <div className="registrar-curriculum-modal__field">
              <label htmlFor="curriculum-name">Curriculum Name</label>
              <div className="registrar-curriculum-modal__control">
                <BookOpenCheck size={16} aria-hidden="true" />
                <input
                  id="curriculum-name"
                  type="text"
                  value={curriculumName}
                  onChange={(event) => setCurriculumName(event.target.value)}
                  placeholder="e.g. BSIT Revised Curriculum 2026"
                  disabled={submitting}
                  maxLength={255}
                  required
                />
              </div>
            </div>

            <div className="registrar-curriculum-modal__grid registrar-curriculum-modal__grid--two">
              <div className="registrar-curriculum-modal__field">
                <label htmlFor="curriculum-effective-year">Effective Year</label>
                <div className="registrar-curriculum-modal__control">
                  <CalendarRange size={16} aria-hidden="true" />
                  <input
                    id="curriculum-effective-year"
                    type="number"
                    value={effectiveYear}
                    onChange={(event) => setEffectiveYear(event.target.value)}
                    min="1900"
                    max="2100"
                    disabled={submitting}
                    required
                  />
                </div>
              </div>

              <div className="registrar-curriculum-modal__field">
                <label htmlFor="curriculum-total-units">Planned Total Units</label>
                <div className="registrar-curriculum-modal__control">
                  <Hash size={16} aria-hidden="true" />
                  <input
                    id="curriculum-total-units"
                    type="number"
                    value={totalUnits}
                    onChange={(event) => setTotalUnits(event.target.value)}
                    min="0"
                    step="1"
                    placeholder="e.g. 185"
                    disabled={submitting}
                    required
                  />
                </div>
                <span className="registrar-curriculum-modal__helper">
                  This can later reflect the units of mapped curriculum subjects.
                </span>
              </div>
            </div>
          </div>

          <div className="registrar-curriculum-modal__section registrar-curriculum-modal__section--compact">
            <div className="registrar-curriculum-modal__section-heading">
              <h3>Initial Status</h3>
              <p>Choose whether this curriculum should start active or inactive.</p>
            </div>

            <div className="registrar-curriculum-modal__status-options">
              <label
                className={`registrar-curriculum-modal__status-option ${
                  isActive === "0" ? "is-selected" : ""
                }`}
              >
                <input
                  type="radio"
                  name="curriculum-status"
                  value="0"
                  checked={isActive === "0"}
                  onChange={(event) => setIsActive(event.target.value)}
                  disabled={submitting}
                />
                <span className="registrar-curriculum-modal__status-radio" />
                <div>
                  <strong>Inactive</strong>
                  <span>Build and review the curriculum before activating it.</span>
                </div>
              </label>

              <label
                className={`registrar-curriculum-modal__status-option ${
                  isActive === "1" ? "is-selected" : ""
                }`}
              >
                <input
                  type="radio"
                  name="curriculum-status"
                  value="1"
                  checked={isActive === "1"}
                  onChange={(event) => setIsActive(event.target.value)}
                  disabled={submitting}
                />
                <span className="registrar-curriculum-modal__status-radio" />
                <div>
                  <strong>Active</strong>
                  <span>Mark this curriculum as available for active use.</span>
                </div>
              </label>
            </div>
          </div>

          <footer className="registrar-curriculum-modal__actions">
            <button
              type="button"
              className="registrar-curriculum-modal__button registrar-curriculum-modal__button--secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="registrar-curriculum-modal__button registrar-curriculum-modal__button--primary"
              disabled={
                submitting ||
                loadingCourses ||
                courses.length === 0 ||
                !authenticated ||
                userRole !== "Registrar"
              }
            >
              {submitting ? (
                <>
                  <LoaderCircle size={16} className="is-spinning" aria-hidden="true" />
                  Creating...
                </>
              ) : (
                <>
                  <BookOpenCheck size={16} aria-hidden="true" />
                  Create Curriculum
                </>
              )}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
