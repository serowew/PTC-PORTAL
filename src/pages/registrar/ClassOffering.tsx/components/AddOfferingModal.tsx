import { useEffect, useMemo, useState } from "react";

import { authService } from "../../../../services/auth.service";

import type { OfferingTableSubject } from "../components/OfferingTable";
import ConflictAlert, {
  type OfferingConflict,
} from "../components/ConflictAlert";

// =====================================================
// API
// =====================================================

const API_BASE_URL = "http://localhost:3000/api/registrar/offerings";

// =====================================================
// TYPES
// =====================================================

interface FacultyOption {
  faculty_id: number;

  employee_number?: string;

  faculty_name?: string;

  first_name?: string;

  middle_name?: string | null;

  last_name?: string;
}

interface RoomOption {
  room_id: number;

  room_name: string;

  room_code?: string;

  capacity?: number | null;
}

// =====================================================
// API RESPONSE
// =====================================================

interface CreateOfferingResponse {
  success: boolean;

  message?: string;

  error?: string;

  conflict?: boolean;

  conflict_count?: number;

  conflict_types?: string[];

  conflicts?: OfferingConflict[];

  configuration_complete?: boolean;

  ready_for_enrollment?: boolean;

  offering?: {
    offering_id?: number;

    status?: "Open" | "Closed" | "Cancelled";

    configuration_complete?: boolean;

    ready_for_enrollment?: boolean;

    [key: string]: unknown;
  } | null;
}

// =====================================================
// PROPS
// =====================================================

interface AddOfferingModalProps {
  open: boolean;

  subject: OfferingTableSubject | null;

  faculty: FacultyOption[];

  rooms: RoomOption[];

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
// FACULTY NAME
// =====================================================

function getFacultyName(item: FacultyOption) {
  if (item.faculty_name) {
    return item.faculty_name;
  }

  const fullName = [item.first_name, item.middle_name, item.last_name]
    .filter(Boolean)
    .join(" ");

  if (fullName) {
    return fullName;
  }

  return `Faculty #${item.faculty_id}`;
}

// =====================================================
// COMPONENT
// =====================================================

export default function AddOfferingModal({
  open,

  subject,

  faculty,

  rooms,

  onClose,

  onSuccess,

  onUnauthorized,
}: AddOfferingModalProps) {
  // =====================================================
  // FORM STATE
  // =====================================================

  const [facultyId, setFacultyId] = useState("");

  const [roomId, setRoomId] = useState("");

  const [scheduleDays, setScheduleDays] = useState("");

  const [scheduleTime, setScheduleTime] = useState("");

  const [maxStudents, setMaxStudents] = useState("");

  // =====================================================
  // UI STATE
  // =====================================================

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [conflicts, setConflicts] = useState<OfferingConflict[]>([]);

  // =====================================================
  // RESET FORM
  // =====================================================

  useEffect(() => {
    if (!open || !subject) {
      return;
    }

    setFacultyId("");

    setRoomId("");

    setScheduleDays("");

    setScheduleTime("");

    setMaxStudents(String(subject.section_subject?.max_students ?? 50));

    setLoading(false);

    setError("");

    setConflicts([]);
  }, [open, subject]);

  // =====================================================
  // SUBJECT INFORMATION
  // =====================================================

  const sectionSubject = subject?.section_subject || null;

  const sectionSubjectId = sectionSubject?.section_subject_id;

  const sectionSubjectStatus = sectionSubject?.status || null;

  const sectionSubjectOpen = sectionSubjectStatus === "Open";

  const sectionSubjectCancelled = sectionSubjectStatus === "Cancelled";

  const subjectCode = subject?.subject.subject_code || "";

  const subjectName = subject?.subject.subject_name || "";

  const units = subject?.subject.units || 0;

  // =====================================================
  // SELECTED ROOM
  // =====================================================

  const selectedRoom = useMemo(() => {
    if (!roomId) {
      return null;
    }

    return rooms.find((room) => String(room.room_id) === roomId) || null;
  }, [rooms, roomId]);

  // =====================================================
  // NUMERIC CAPACITY
  // =====================================================

  const numericCapacity = Number(maxStudents);

  const validCapacity =
    Number.isInteger(numericCapacity) && numericCapacity > 0;

  // =====================================================
  // BACKEND AUTO-OPEN PREVIEW
  //
  // POST /subject-offerings does NOT accept a client-
  // controlled status.
  //
  // The backend automatically creates:
  //
  // OPEN when:
  // ✓ section_subject is Open
  // ✓ faculty is assigned
  // ✓ schedule days are assigned
  // ✓ schedule time is assigned
  // ✓ capacity > 0
  //
  // CLOSED otherwise.
  //
  // Room remains optional.
  // =====================================================

  const willOpenAutomatically =
    sectionSubjectOpen &&
    Boolean(facultyId) &&
    Boolean(scheduleDays.trim()) &&
    Boolean(scheduleTime.trim()) &&
    validCapacity;

  // =====================================================
  // ROOM CAPACITY STATE
  // =====================================================

  const roomCapacityExceeded = Boolean(
    selectedRoom?.capacity &&
    Number(selectedRoom.capacity) > 0 &&
    validCapacity &&
    numericCapacity > Number(selectedRoom.capacity),
  );

  // =====================================================
  // VALIDATE CAPACITY
  // =====================================================

  const validateCapacity = () => {
    if (!validCapacity) {
      throw new Error("Capacity must be a whole number greater than 0.");
    }

    if (
      selectedRoom?.capacity &&
      Number(selectedRoom.capacity) > 0 &&
      numericCapacity > Number(selectedRoom.capacity)
    ) {
      throw new Error(
        `Capacity cannot exceed the selected room capacity of ${selectedRoom.capacity}.`,
      );
    }
  };

  // =====================================================
  // CLEAR SERVER FEEDBACK
  // =====================================================

  const clearFeedback = () => {
    setError("");

    setConflicts([]);
  };

  // =====================================================
  // CLOSE
  // =====================================================

  const handleClose = () => {
    if (loading) {
      return;
    }

    clearFeedback();

    onClose();
  };

  // =====================================================
  // CREATE OFFERING
  // =====================================================

  const createOffering = async () => {
    if (!subject || !sectionSubjectId) {
      setConflicts([]);

      setError("This subject does not have a valid section subject.");

      return;
    }

    if (sectionSubjectCancelled) {
      setConflicts([]);

      setError(
        "A class offering cannot be created for a cancelled section subject.",
      );

      return;
    }

    if (subject.has_offering || subject.offering) {
      setConflicts([]);

      setError("This section subject already has a class offering.");

      return;
    }

    try {
      setLoading(true);

      clearFeedback();

      // =================================================
      // CAPACITY VALIDATION
      // =================================================

      validateCapacity();

      // =================================================
      // REQUEST BODY
      //
      // IMPORTANT:
      //
      // Do NOT send status.
      //
      // Backend determines Open / Closed automatically.
      // =================================================

      const payload: {
        section_subject_id: number;

        faculty_id?: number;

        room_id?: number;

        schedule_days?: string;

        schedule_time?: string;

        max_students: number;
      } = {
        section_subject_id: sectionSubjectId,

        max_students: numericCapacity,
      };

      // =================================================
      // OPTIONAL FACULTY
      // =================================================

      if (facultyId) {
        payload.faculty_id = Number(facultyId);
      }

      // =================================================
      // OPTIONAL ROOM
      // =================================================

      if (roomId) {
        payload.room_id = Number(roomId);
      }

      // =================================================
      // OPTIONAL SCHEDULE DAYS
      // =================================================

      if (scheduleDays.trim()) {
        payload.schedule_days = scheduleDays.trim();
      }

      // =================================================
      // OPTIONAL SCHEDULE TIME
      // =================================================

      if (scheduleTime.trim()) {
        payload.schedule_time = scheduleTime.trim();
      }

      // =================================================
      // REQUEST
      // =================================================

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

      // =================================================
      // UNAUTHORIZED
      // =================================================

      if (response.status === 401) {
        onUnauthorized();

        return;
      }

      // =================================================
      // FORBIDDEN
      // =================================================

      if (response.status === 403) {
        throw new Error(
          data.message ||
            data.error ||
            "You are not authorized to create class offerings.",
        );
      }

      // =================================================
      // NOT FOUND
      // =================================================

      if (response.status === 404) {
        throw new Error(
          data.message ||
            data.error ||
            "The section subject, faculty, or room could not be found.",
        );
      }

      // =================================================
      // CONFLICT
      //
      // Backend remains authoritative for:
      // - duplicate offering
      // - cancelled section subject
      // - room capacity
      // - schedule conflicts
      //
      // Structured schedule conflicts are rendered using
      // the same ConflictAlert used by EditOfferingModal.
      // Other 409 business-rule errors remain plain errors.
      // =================================================

      if (response.status === 409) {
        const backendConflicts = Array.isArray(data.conflicts)
          ? data.conflicts
          : [];

        setConflicts(backendConflicts);

        throw new Error(
          data.message ||
            data.error ||
            "The class offering could not be created because of a conflict.",
        );
      }

      // =================================================
      // VALIDATION / API ERROR
      // =================================================

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Failed to create the class offering.",
        );
      }

      // =================================================
      // SUCCESS
      // =================================================

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
        {/* ================================================= */}
        {/* HEADER */}
        {/* ================================================= */}

        <div className="class-offering-modal-header">
          <div>
            <h2 id="add-offering-title">Create Class Offering</h2>

            <p>Configure the class implementation for this section subject.</p>
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

        {/* ================================================= */}
        {/* SUBJECT */}
        {/* ================================================= */}

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

        {/* ================================================= */}
        {/* ERROR */}
        {/* ================================================= */}

        {error && conflicts.length === 0 && (
          <div className="class-offering-error">{error}</div>
        )}

        {/* ================================================= */}
        {/* SCHEDULE CONFLICT DISPLAY */}
        {/* ================================================= */}

        <ConflictAlert conflicts={conflicts} message={error} />

        {/* ================================================= */}
        {/* FORM */}
        {/* ================================================= */}

        <div className="class-offering-modal-body">
          {/* =============================================== */}
          {/* SECTION SUBJECT STATUS */}
          {/* =============================================== */}

          <div className="class-offering-open-requirements">
            <h3>Section Subject</h3>

            <ul>
              <li>Status: {sectionSubjectStatus || "Unavailable"}</li>
            </ul>

            {sectionSubjectStatus === "Closed" && (
              <small>
                The offering can still be created, but it will remain Closed
                until the section subject is opened.
              </small>
            )}

            {sectionSubjectCancelled && (
              <small>
                Cancelled section subjects cannot receive a new offering.
              </small>
            )}
          </div>

          <div className="class-offering-form-grid">
            {/* ============================================= */}
            {/* FACULTY */}
            {/* ============================================= */}

            <div className="class-offering-field">
              <label htmlFor="add-offering-faculty">Faculty</label>

              <select
                id="add-offering-faculty"
                value={facultyId}
                disabled={loading || sectionSubjectCancelled}
                onChange={(event) => {
                  setFacultyId(event.target.value);

                  clearFeedback();
                }}
              >
                <option value="">Not Assigned</option>

                {faculty.map((item) => (
                  <option key={item.faculty_id} value={String(item.faculty_id)}>
                    {getFacultyName(item)}
                  </option>
                ))}
              </select>

              <small>Required for the offering to open automatically.</small>
            </div>

            {/* ============================================= */}
            {/* ROOM */}
            {/* ============================================= */}

            <div className="class-offering-field">
              <label htmlFor="add-offering-room">Room</label>

              <select
                id="add-offering-room"
                value={roomId}
                disabled={loading || sectionSubjectCancelled}
                onChange={(event) => {
                  setRoomId(event.target.value);

                  clearFeedback();
                }}
              >
                <option value="">No Room Assigned</option>

                {rooms.map((room) => (
                  <option key={room.room_id} value={String(room.room_id)}>
                    {room.room_code ? `${room.room_code} — ` : ""}
                    {room.room_name}
                    {room.capacity ? ` (${room.capacity})` : ""}
                  </option>
                ))}
              </select>

              <small>
                Optional. Room capacity is validated when a room is assigned.
              </small>
            </div>

            {/* ============================================= */}
            {/* SCHEDULE DAYS */}
            {/* ============================================= */}

            <div className="class-offering-field">
              <label htmlFor="add-offering-days">Schedule Days</label>

              <input
                id="add-offering-days"
                type="text"
                value={scheduleDays}
                disabled={loading || sectionSubjectCancelled}
                placeholder="Example: Monday, Wednesday"
                onChange={(event) => {
                  setScheduleDays(event.target.value);

                  clearFeedback();
                }}
              />

              <small>Required for the offering to open automatically.</small>
            </div>

            {/* ============================================= */}
            {/* SCHEDULE TIME */}
            {/* ============================================= */}

            <div className="class-offering-field">
              <label htmlFor="add-offering-time">Schedule Time</label>

              <input
                id="add-offering-time"
                type="text"
                value={scheduleTime}
                disabled={loading || sectionSubjectCancelled}
                placeholder="Example: 8:00 AM - 10:00 AM"
                onChange={(event) => {
                  setScheduleTime(event.target.value);

                  clearFeedback();
                }}
              />

              <small>Required for the offering to open automatically.</small>
            </div>

            {/* ============================================= */}
            {/* CAPACITY */}
            {/* ============================================= */}

            <div className="class-offering-field">
              <label htmlFor="add-offering-capacity">Maximum Students</label>

              <input
                id="add-offering-capacity"
                type="number"
                min={1}
                value={maxStudents}
                disabled={loading || sectionSubjectCancelled}
                onChange={(event) => {
                  setMaxStudents(event.target.value);

                  clearFeedback();
                }}
              />

              {roomCapacityExceeded ? (
                <small>
                  Capacity exceeds the selected room limit of{" "}
                  {selectedRoom?.capacity}.
                </small>
              ) : selectedRoom?.capacity ? (
                <small>Selected room capacity: {selectedRoom.capacity}</small>
              ) : (
                <small>
                  Maximum number of students allowed in this offering.
                </small>
              )}
            </div>
          </div>

          {/* ================================================= */}
          {/* AUTOMATIC RESULT */}
          {/* ================================================= */}

          <div className="class-offering-open-requirements">
            <h3>Automatic Offering Result</h3>

            <ul>
              <li>
                Section Subject: {sectionSubjectOpen ? "Ready" : "Not Open"}
              </li>

              <li>Faculty: {facultyId ? "Ready" : "Missing"}</li>

              <li>
                Schedule Days: {scheduleDays.trim() ? "Ready" : "Missing"}
              </li>

              <li>
                Schedule Time: {scheduleTime.trim() ? "Ready" : "Missing"}
              </li>

              <li>Capacity: {validCapacity ? "Ready" : "Invalid"}</li>

              <li>Room: Optional</li>
            </ul>

            <p>
              <strong>
                {willOpenAutomatically
                  ? "Result: OPEN / READY"
                  : "Result: CLOSED / NOT READY"}
              </strong>
            </p>

            <small>
              The backend chooses the initial offering status automatically. A
              fully configured offering under an Open section subject becomes
              Open; otherwise it is created Closed so the Registrar can finish
              it later.
            </small>
          </div>
        </div>

        {/* ================================================= */}
        {/* FOOTER */}
        {/* ================================================= */}

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
              !validCapacity ||
              roomCapacityExceeded ||
              subject.has_offering
            }
            onClick={createOffering}
          >
            {loading
              ? "Creating..."
              : willOpenAutomatically
                ? "Create Offering — Opens Automatically"
                : "Create Offering — Starts Closed"}
          </button>
        </div>
      </div>
    </div>
  );
}
