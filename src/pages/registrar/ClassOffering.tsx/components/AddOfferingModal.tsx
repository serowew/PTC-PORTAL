import { useEffect, useState } from "react";

import { authService } from "../../../../services/auth.service";
import { apiUrl } from "../../../../services/api";

import type { OfferingTableSubject } from "../components/OfferingTable";

// =====================================================
// API
// =====================================================

const API_BASE_URL = apiUrl("/api/registrar/offerings");

// =====================================================
// TYPES
// =====================================================

interface FacultyOption {
  faculty_id: number;

  user_id?: number;

  employee_number?: string;

  faculty_name?: string;

  first_name?: string;

  middle_name?: string | null;

  last_name?: string;

  department_id?: number | null;

  department_name?: string;

  employment_status?: string;

  username?: string;

  role_id?: number;

  role_name?: "Faculty" | "Program Head" | string;

  is_active?: boolean;

  is_verified?: boolean;
}

// =====================================================
// API RESPONSE
// =====================================================

interface CreateOfferingResponse {
  success: boolean;

  message?: string;

  error?: string;

  offering?: {
    offering_id?: number;

    section_subject_id?: number;

    status?: "Open" | "Closed" | "Cancelled";

    configuration_complete?: boolean;

    ready_for_enrollment?: boolean;

    schedule_status?: string;

    faculty?: {
      faculty_id?: number;

      faculty_name?: string;

      role_name?: string;
    } | null;
  } | null;
}

// =====================================================
// PROPS
// =====================================================

interface AddOfferingModalProps {
  open: boolean;

  subject: OfferingTableSubject | null;

  faculty: FacultyOption[];

  onClose: () => void;

  onSuccess: () => void;

  onUnauthorized: () => void;
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
// INSTRUCTOR NAME
// =====================================================

function getInstructorName(item: FacultyOption) {
  if (item.faculty_name) {
    return item.faculty_name;
  }

  const fullName = [item.first_name, item.middle_name, item.last_name]
    .filter(Boolean)
    .join(" ");

  if (fullName) {
    return fullName;
  }

  return `Instructor #${item.faculty_id}`;
}

// =====================================================
// INSTRUCTOR LABEL
// =====================================================

function getInstructorLabel(item: FacultyOption) {
  const name = getInstructorName(item);

  const role = item.role_name || "Faculty";

  const employeeNumber = item.employee_number
    ? ` (${item.employee_number})`
    : "";

  return `${name} — ${role}${employeeNumber}`;
}

// =====================================================
// COMPONENT
// =====================================================

export default function AddOfferingModal({
  open,

  subject,

  faculty,

  onClose,

  onSuccess,

  onUnauthorized,
}: AddOfferingModalProps) {
  // =====================================================
  // FORM
  // =====================================================

  const [facultyId, setFacultyId] = useState("");

  // =====================================================
  // UI
  // =====================================================

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [successMessage, setSuccessMessage] = useState("");

  // =====================================================
  // RESET
  // =====================================================

  useEffect(() => {
    if (!open || !subject) {
      return;
    }

    setFacultyId("");

    setLoading(false);

    setError("");

    setSuccessMessage("");
  }, [open, subject]);

  // =====================================================
  // SUBJECT INFORMATION
  // =====================================================

  const sectionSubject = subject?.section_subject || null;

  const sectionSubjectId = sectionSubject?.section_subject_id;

  const sectionSubjectStatus = sectionSubject?.status || null;

  const sectionSubjectCancelled = sectionSubjectStatus === "Cancelled";

  const subjectCode = subject?.subject.subject_code || "";

  const subjectName = subject?.subject.subject_name || "";

  const units = subject?.subject.units || 0;

  // =====================================================
  // SELECTED INSTRUCTOR
  // =====================================================

  const selectedInstructor =
    faculty.find((item) => String(item.faculty_id) === facultyId) || null;

  // =====================================================
  // CLOSE
  // =====================================================

  const handleClose = () => {
    if (loading) {
      return;
    }

    setError("");

    setSuccessMessage("");

    onClose();
  };

  // =====================================================
  // CREATE OFFERING
  // =====================================================

  const createOffering = async () => {
    // ===============================================
    // SECTION SUBJECT
    // ===============================================

    if (!subject || !sectionSubjectId) {
      setError("This subject does not have a valid section subject.");

      return;
    }

    // ===============================================
    // CANCELLED
    // ===============================================

    if (sectionSubjectCancelled) {
      setError(
        "A class offering cannot be created for a cancelled section subject.",
      );

      return;
    }

    // ===============================================
    // ALREADY HAS OFFERING
    // ===============================================

    if (subject.has_offering || subject.offering) {
      setError("This section subject already has a class offering.");

      return;
    }

    // ===============================================
    // INSTRUCTOR REQUIRED
    // ===============================================

    if (!facultyId) {
      setError(
        "Please select a Faculty or Program Head to teach this subject.",
      );

      return;
    }

    try {
      setLoading(true);

      setError("");

      setSuccessMessage("");

      // =============================================
      // REQUEST BODY
      //
      // Registrar sends ONLY:
      //
      // section_subject_id
      // faculty_id
      //
      // No room.
      // No schedule.
      // No capacity.
      // No status.
      // =============================================

      const payload = {
        section_subject_id: sectionSubjectId,

        faculty_id: Number(facultyId),
      };

      // =============================================
      // REQUEST
      // =============================================

      const response = await authService.authFetch(
        `${API_BASE_URL}/subject-offerings`,
        {
          method: "POST",

          headers: {
            Accept: "application/json",

            "Content-Type": "application/json",
          },

          body: JSON.stringify(payload),
        },
      );

      const data = await readJsonResponse<CreateOfferingResponse>(response);

      // =============================================
      // UNAUTHORIZED
      // =============================================

      if (response.status === 401) {
        onUnauthorized();

        return;
      }

      // =============================================
      // FORBIDDEN
      // =============================================

      if (response.status === 403) {
        throw new Error(
          data.message ||
            data.error ||
            "You are not authorized to create class offerings.",
        );
      }

      // =============================================
      // NOT FOUND
      // =============================================

      if (response.status === 404) {
        throw new Error(
          data.message ||
            data.error ||
            "The section subject or instructor could not be found.",
        );
      }

      // =============================================
      // BUSINESS RULE CONFLICT
      // =============================================

      if (response.status === 409) {
        throw new Error(
          data.message ||
            data.error ||
            "The class offering could not be created.",
        );
      }

      // =============================================
      // GENERAL ERROR
      // =============================================

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Failed to create the class offering.",
        );
      }

      // =============================================
      // SUCCESS
      // =============================================

      setSuccessMessage(data.message || "Instructor assigned successfully.");

      onSuccess();

      onClose();
    } catch (error) {
      console.error("CREATE OFFERING ERROR:", error);

      setError(
        error instanceof Error
          ? error.message
          : "Unable to create class offering.",
      );
    } finally {
      setLoading(false);
    }
  };

  // =====================================================
  // DO NOT RENDER
  // =====================================================

  if (!open || !subject) {
    return null;
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <div
      className="class-offering-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) {
          handleClose();
        }
      }}
    >
      <div
        className="class-offering-modal class-offering-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-offering-title"
      >
        {/* ============================================= */}
        {/* HEADER */}
        {/* ============================================= */}

        <div className="class-offering-modal-header">
          <div>
            <h2 id="add-offering-title">Assign Instructor</h2>

            <p>
              Assign a Faculty member or Program Head to teach this subject.
            </p>
          </div>

          <button
            type="button"
            aria-label="Close"
            disabled={loading}
            onClick={handleClose}
          >
            ×
          </button>
        </div>

        {/* ============================================= */}
        {/* SUBJECT */}
        {/* ============================================= */}

        <div className="class-offering-modal-subject">
          <div>
            <strong>{subjectCode}</strong>

            <span>
              {" — "}
              {subjectName}
            </span>
          </div>

          <small>
            {units} unit
            {units !== 1 ? "s" : ""}
          </small>
        </div>

        {/* ============================================= */}
        {/* ERROR */}
        {/* ============================================= */}

        {error && <div className="class-offering-error">{error}</div>}

        {/* ============================================= */}
        {/* SUCCESS */}
        {/* ============================================= */}

        {successMessage && (
          <div className="class-offering-success">{successMessage}</div>
        )}

        {/* ============================================= */}
        {/* BODY */}
        {/* ============================================= */}

        <div className="class-offering-modal-body">
          {/* =========================================== */}
          {/* SECTION SUBJECT */}
          {/* =========================================== */}

          <div className="class-offering-open-requirements">
            <h3>Subject Offering</h3>

            <ul>
              <li>
                Section Subject Status: {sectionSubjectStatus || "Unavailable"}
              </li>

              <li>Initial Offering Status: Closed</li>

              <li>Schedule: Pending Instructor Schedule</li>
            </ul>

            {sectionSubjectStatus === "Closed" && (
              <small>
                The instructor can be assigned, but the offering remains Closed
                until the section subject is Open and the assigned instructor
                sets the schedule.
              </small>
            )}

            {sectionSubjectCancelled && (
              <small>
                Cancelled section subjects cannot receive a new offering.
              </small>
            )}
          </div>

          {/* =========================================== */}
          {/* INSTRUCTOR */}
          {/* =========================================== */}

          <div className="class-offering-form-grid">
            <div className="class-offering-field">
              <label htmlFor="add-offering-faculty">Assigned Instructor</label>

              <select
                id="add-offering-faculty"
                value={facultyId}
                disabled={loading || sectionSubjectCancelled}
                onChange={(event) => {
                  setFacultyId(event.target.value);

                  setError("");

                  setSuccessMessage("");
                }}
              >
                <option value="">Select Faculty or Program Head</option>

                {faculty.map((item) => (
                  <option key={item.faculty_id} value={String(item.faculty_id)}>
                    {getInstructorLabel(item)}
                  </option>
                ))}
              </select>

              <small>
                Required. Both Faculty and Program Head accounts may be assigned
                to teach.
              </small>
            </div>
          </div>

          {/* =========================================== */}
          {/* SELECTED INSTRUCTOR */}
          {/* =========================================== */}

          {selectedInstructor && (
            <div className="class-offering-open-requirements">
              <h3>Instructor Assignment</h3>

              <ul>
                <li>Name: {getInstructorName(selectedInstructor)}</li>

                <li>Role: {selectedInstructor.role_name || "Faculty"}</li>

                {selectedInstructor.employee_number && (
                  <li>Employee No.: {selectedInstructor.employee_number}</li>
                )}

                {selectedInstructor.department_name && (
                  <li>Department: {selectedInstructor.department_name}</li>
                )}
              </ul>
            </div>
          )}

          {/* =========================================== */}
          {/* WORKFLOW INFORMATION */}
          {/* =========================================== */}

          <div className="class-offering-open-requirements">
            <h3>What Happens Next?</h3>

            <ul>
              <li>Registrar assigns the teaching user.</li>

              <li>The offering is created as Closed.</li>

              <li>Room and schedule are not assigned by the Registrar.</li>

              <li>
                The assigned Faculty or Program Head enters their own class
                schedule.
              </li>

              <li>
                After schedule validation, the offering becomes Open and ready
                for enrollment.
              </li>
            </ul>
          </div>
        </div>

        {/* ============================================= */}
        {/* FOOTER */}
        {/* ============================================= */}

        <div className="class-offering-modal-footer">
          <button type="button" disabled={loading} onClick={handleClose}>
            Cancel
          </button>

          <button
            type="button"
            disabled={
              loading ||
              sectionSubjectCancelled ||
              !sectionSubjectId ||
              !facultyId ||
              subject.has_offering
            }
            onClick={createOffering}
          >
            {loading ? "Assigning..." : "Assign Instructor"}
          </button>
        </div>
      </div>
    </div>
  );
}
