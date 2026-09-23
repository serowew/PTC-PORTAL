import { useEffect, useState } from "react";

import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";

import type { OfferingTableSubject } from "./components/OfferingTable";

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

  email?: string;

  department_id?: number | null;

  department_name?: string;

  employment_status?: string;

  username?: string;

  role_id?: number;

  role_name?: string;

  is_active?: boolean;

  is_verified?: boolean;
}

interface UpdateOfferingResponse {
  success: boolean;

  message?: string;

  error?: string;

  changed?: boolean;

  changed_fields?: string[];

  grade_count?: number;

  offering?: {
    offering_id?: number;

    faculty?: {
      faculty_id?: number;

      user_id?: number;

      faculty_name?: string;

      role_name?: string;
    };

    room?: null;

    schedule_days?: string | null;

    schedule_time?: string | null;

    schedule_start_time?: string | null;

    schedule_end_time?: string | null;

    status?: string;

    configuration_complete?: boolean;

    ready_for_enrollment?: boolean;

    schedule_status?: string;
  };
}

// =====================================================
// PROPS
// =====================================================

interface EditOfferingModalProps {
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

export default function EditOfferingModal({
  open,

  subject,

  faculty,

  onClose,

  onSuccess,

  onUnauthorized,
}: EditOfferingModalProps) {
  // =====================================================
  // OFFERING
  // =====================================================

  const offering = subject?.offering || null;

  const offeringId = offering?.offering_id;

  const currentFacultyId = offering?.faculty?.faculty_id || null;

  const currentFacultyName =
    offering?.faculty?.faculty_name || "No instructor assigned";

  const currentStatus = offering?.status || "Closed";

  const isCancelled = currentStatus === "Cancelled";

  // =====================================================
  // FORM
  // =====================================================

  const [facultyId, setFacultyId] = useState("");

  // =====================================================
  // UI
  // =====================================================

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  // =====================================================
  // RESET
  // =====================================================

  useEffect(() => {
    if (!open || !offering) {
      return;
    }

    setFacultyId(currentFacultyId ? String(currentFacultyId) : "");

    setLoading(false);

    setError("");
  }, [open, offering, currentFacultyId]);

  // =====================================================
  // SELECTED INSTRUCTOR
  // =====================================================

  const selectedInstructor =
    faculty.find((item) => String(item.faculty_id) === facultyId) || null;

  const selectedFacultyId = facultyId ? Number(facultyId) : null;

  const instructorChanged =
    selectedFacultyId !== null && selectedFacultyId !== currentFacultyId;

  // =====================================================
  // SUBJECT
  // =====================================================

  const subjectCode = subject?.subject.subject_code || "";

  const subjectName = subject?.subject.subject_name || "";

  const units = subject?.subject.units || 0;

  // =====================================================
  // CURRENT SCHEDULE
  // =====================================================

  const currentScheduleDays = offering?.schedule?.days || null;

  const currentScheduleTime = offering?.schedule?.time || null;

  const currentRoom = offering?.room
    ? offering.room.room_code || offering.room.room_name
    : null;

  // =====================================================
  // CLOSE
  // =====================================================

  const handleClose = () => {
    if (loading) {
      return;
    }

    setError("");

    onClose();
  };

  // =====================================================
  // REASSIGN
  // =====================================================

  const handleReassign = async () => {
    // ===============================================
    // OFFERING
    // ===============================================

    if (!offering || !offeringId) {
      setError("Subject offering not found.");

      return;
    }

    // ===============================================
    // CANCELLED
    // ===============================================

    if (isCancelled) {
      setError("A cancelled subject offering cannot be reassigned.");

      return;
    }

    // ===============================================
    // INSTRUCTOR REQUIRED
    // ===============================================

    if (!facultyId) {
      setError("Please select a Faculty or Program Head.");

      return;
    }

    // ===============================================
    // SAME INSTRUCTOR
    // ===============================================

    if (Number(facultyId) === currentFacultyId) {
      setError("Please select a different instructor.");

      return;
    }

    try {
      setLoading(true);

      setError("");

      // =============================================
      // REQUEST BODY
      //
      // Registrar sends ONLY faculty_id.
      // =============================================

      const payload = {
        faculty_id: Number(facultyId),
      };

      const response = await authService.authFetch(
        `${API_BASE_URL}/subject-offerings/${offeringId}`,
        {
          method: "PUT",

          headers: {
            Accept: "application/json",

            "Content-Type": "application/json",
          },

          body: JSON.stringify(payload),
        },
      );

      const data = await readJsonResponse<UpdateOfferingResponse>(response);

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
            "You are not authorized to reassign this offering.",
        );
      }

      // =============================================
      // NOT FOUND
      // =============================================

      if (response.status === 404) {
        throw new Error(
          data.message ||
            data.error ||
            "The offering or instructor could not be found.",
        );
      }

      // =============================================
      // BUSINESS RULE
      //
      // Examples:
      //
      // - grade records already exist
      // - cancelled offering
      // - wrong department
      // - inactive account
      // =============================================

      if (response.status === 409) {
        throw new Error(
          data.message ||
            data.error ||
            "The instructor could not be reassigned.",
        );
      }

      // =============================================
      // GENERAL ERROR
      // =============================================

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Failed to reassign instructor.",
        );
      }

      // =============================================
      // SUCCESS
      // =============================================

      onSuccess();

      onClose();
    } catch (error) {
      console.error("REASSIGN OFFERING ERROR:", error);

      setError(
        error instanceof Error
          ? error.message
          : "Unable to reassign instructor.",
      );
    } finally {
      setLoading(false);
    }
  };

  // =====================================================
  // DO NOT RENDER
  // =====================================================

  if (!open || !subject || !offering) {
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
        aria-labelledby="edit-offering-title"
      >
        {/* ============================================= */}
        {/* HEADER */}
        {/* ============================================= */}

        <div className="class-offering-modal-header">
          <div>
            <h2 id="edit-offering-title">Reassign Instructor</h2>

            <p>
              Change the Faculty or Program Head assigned to teach this
              offering.
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
        {/* BODY */}
        {/* ============================================= */}

        <div className="class-offering-modal-body">
          {/* =========================================== */}
          {/* CURRENT ASSIGNMENT */}
          {/* =========================================== */}

          <div className="class-offering-open-requirements">
            <h3>Current Assignment</h3>

            <ul>
              <li>Instructor: {currentFacultyName}</li>

              <li>Offering Status: {currentStatus}</li>

              <li>Schedule Days: {currentScheduleDays || "Pending"}</li>

              <li>Schedule Time: {currentScheduleTime || "Pending"}</li>

              <li>Room: {currentRoom || "Not assigned"}</li>
            </ul>
          </div>

          {/* =========================================== */}
          {/* NEW INSTRUCTOR */}
          {/* =========================================== */}

          <div className="class-offering-form-grid">
            <div className="class-offering-field">
              <label htmlFor="edit-offering-faculty">Assigned Instructor</label>

              <select
                id="edit-offering-faculty"
                value={facultyId}
                disabled={loading || isCancelled}
                onChange={(event) => {
                  setFacultyId(event.target.value);

                  setError("");
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
                Registrar may assign either a Faculty member or Program Head
                from the same department.
              </small>
            </div>
          </div>

          {/* =========================================== */}
          {/* SELECTED INSTRUCTOR */}
          {/* =========================================== */}

          {selectedInstructor && (
            <div className="class-offering-open-requirements">
              <h3>Selected Instructor</h3>

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
          {/* IMPORTANT WARNING */}
          {/* =========================================== */}

          {instructorChanged && (
            <div className="class-offering-open-requirements">
              <h3>Reassignment Effect</h3>

              <ul>
                <li>The current instructor will be removed.</li>

                <li>The existing schedule will be cleared.</li>

                <li>Any existing room assignment will be cleared.</li>

                <li>The offering will become Closed.</li>

                <li>The new instructor must enter their own schedule.</li>

                <li>
                  The offering will reopen only after the new schedule passes
                  conflict validation.
                </li>
              </ul>
            </div>
          )}

          {/* =========================================== */}
          {/* GRADE SAFETY */}
          {/* =========================================== */}

          <div className="class-offering-open-requirements">
            <h3>Reassignment Protection</h3>

            <p>
              An offering with existing grade records cannot be reassigned. The
              backend will block the change to preserve grade ownership.
            </p>
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
            className="class-offering-primary-button"
            disabled={
              loading || isCancelled || !facultyId || !instructorChanged
            }
            onClick={handleReassign}
          >
            {loading ? "Reassigning..." : "Reassign Instructor"}
          </button>
        </div>
      </div>
    </div>
  );
}
