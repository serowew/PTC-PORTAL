import { useEffect, useMemo, useState } from "react";

import { authService } from "../../../services/auth.service";

import type { OfferingTableSubject } from "./components/OfferingTable";
import ConflictAlert, {
  type OfferingConflict,
} from "./components/ConflictAlert";

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

type OfferingStatus = "Open" | "Closed" | "Cancelled";

// =====================================================
// RESPONSE
// =====================================================

interface UpdateOfferingResponse {
  success: boolean;

  message?: string;

  error?: string;

  conflict?: boolean;

  conflicts?: OfferingConflict[];

  summary?: {
    total_conflicts?: number;

    faculty_conflicts?: number;

    section_conflicts?: number;

    room_conflicts?: number;

    [key: string]: unknown;
  };

  proposed_schedule?: {
    faculty_id?: number | null;

    room_id?: number | null;

    schedule_days?: string | null;

    schedule_time?: string | null;
  };

  conflict_count?: number;

  conflict_types?: string[];

  missing_configuration?: string[];

  max_students?: number;

  enrolled_count?: number;

  offering?: unknown;
}

// =====================================================
// PROPS
// =====================================================

interface EditOfferingModalProps {
  open: boolean;

  subject: OfferingTableSubject | null;

  faculty: FacultyOption[];

  rooms: RoomOption[];

  onClose: () => void;

  onSuccess: () => void;

  onUnauthorized: () => void;
}

// =====================================================
// SAFE JSON RESPONSE
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
// FACULTY DISPLAY NAME
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

export default function EditOfferingModal({
  open,

  subject,

  faculty,

  rooms,

  onClose,

  onSuccess,

  onUnauthorized,
}: EditOfferingModalProps) {
  // =====================================================
  // FORM
  // =====================================================

  const [facultyId, setFacultyId] = useState("");

  const [roomId, setRoomId] = useState("");

  const [scheduleDays, setScheduleDays] = useState("");

  const [scheduleTime, setScheduleTime] = useState("");

  const [maxStudents, setMaxStudents] = useState("");

  // =====================================================
  // UI
  // =====================================================

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [conflicts, setConflicts] = useState<OfferingConflict[]>([]);

  // =====================================================
  // EXISTING OFFERING
  // =====================================================

  const offering = subject?.offering || null;

  const offeringId = offering?.offering_id;

  const currentStatus: OfferingStatus =
    offering?.status === "Open" ||
    offering?.status === "Closed" ||
    offering?.status === "Cancelled"
      ? offering.status
      : "Closed";

  const isOpen = currentStatus === "Open";

  const isClosed = currentStatus === "Closed";

  const isCancelled = currentStatus === "Cancelled";

  // =====================================================
  // SECTION SUBJECT
  // =====================================================

  const sectionSubject = subject?.section_subject || null;

  const sectionSubjectStatus = sectionSubject?.status || null;

  const sectionSubjectOpen = sectionSubjectStatus === "Open";

  // =====================================================
  // RESET / LOAD CURRENT VALUES
  // =====================================================

  useEffect(() => {
    if (!open || !subject || !offering) {
      return;
    }

    setFacultyId(offering.faculty ? String(offering.faculty.faculty_id) : "");

    setRoomId(offering.room ? String(offering.room.room_id) : "");

    setScheduleDays(offering.schedule?.days || "");

    setScheduleTime(offering.schedule?.time || "");

    setMaxStudents(
      String(
        offering.capacity?.max_students ??
          subject.section_subject?.max_students ??
          50,
      ),
    );

    setLoading(false);

    setError("");

    setConflicts([]);
  }, [open, subject, offering]);

  // =====================================================
  // SELECTED ROOM
  // =====================================================

  const selectedRoom = useMemo(() => {
    if (!roomId) {
      return null;
    }

    return rooms.find((item) => String(item.room_id) === roomId) || null;
  }, [roomId, rooms]);

  // =====================================================
  // CAPACITY
  // =====================================================

  const numericCapacity = Number(maxStudents);

  const validCapacity =
    Number.isInteger(numericCapacity) && numericCapacity > 0;

  // =====================================================
  // CURRENT ASSIGNED STUDENTS
  //
  // Backend counts active Pending + Approved assignments.
  // The readiness row exposes that as enrolled_count.
  // =====================================================

  const enrolledCount = Number(offering?.capacity?.enrolled_count || 0);

  const belowAssignedStudents =
    validCapacity && numericCapacity < enrolledCount;

  // =====================================================
  // ROOM CAPACITY
  // =====================================================

  const roomCapacityExceeded = Boolean(
    selectedRoom?.capacity &&
    Number(selectedRoom.capacity) > 0 &&
    validCapacity &&
    numericCapacity > Number(selectedRoom.capacity),
  );

  // =====================================================
  // SCHEDULE STATE
  // =====================================================

  const hasDays = Boolean(scheduleDays.trim());

  const hasTime = Boolean(scheduleTime.trim());

  const schedulePairValid = hasDays === hasTime;

  const hasCompleteSchedule = hasDays && hasTime;

  // =====================================================
  // CONFIGURATION PREVIEW
  //
  // This preview does NOT change status.
  //
  // PUT /subject-offerings/:id preserves current status.
  // A Closed offering stays Closed after Edit.
  // Registrar opens it separately through status management.
  // =====================================================

  const configurationComplete =
    sectionSubjectOpen &&
    Boolean(facultyId) &&
    hasCompleteSchedule &&
    validCapacity;

  // =====================================================
  // OPEN OFFERING VALIDITY
  //
  // An existing Open offering must remain completely
  // configured after the edit.
  // =====================================================

  const openOfferingWouldRemainValid = !isOpen || configurationComplete;

  // =====================================================
  // FRONTEND SAVE ELIGIBILITY
  // =====================================================

  const canSave =
    Boolean(subject) &&
    Boolean(offering) &&
    Boolean(offeringId) &&
    !loading &&
    !isCancelled &&
    validCapacity &&
    !belowAssignedStudents &&
    !roomCapacityExceeded &&
    schedulePairValid &&
    openOfferingWouldRemainValid;

  // =====================================================
  // CLEAR SERVER FEEDBACK
  // =====================================================

  const clearFeedback = () => {
    setError("");

    setConflicts([]);
  };

  // =====================================================
  // VALIDATE
  // =====================================================

  const validateForm = () => {
    // ===============================================
    // CANCELLED
    // ===============================================

    if (isCancelled) {
      throw new Error("A cancelled subject offering cannot be edited.");
    }

    // ===============================================
    // CAPACITY
    // ===============================================

    if (!validCapacity) {
      throw new Error(
        "Maximum students must be a whole number greater than 0.",
      );
    }

    // ===============================================
    // CANNOT DROP BELOW ACTIVE STUDENTS
    // ===============================================

    if (numericCapacity < enrolledCount) {
      throw new Error(
        `Maximum students cannot be lower than the current assigned student count of ${enrolledCount}.`,
      );
    }

    // ===============================================
    // ROOM CAPACITY
    // ===============================================

    if (
      selectedRoom?.capacity &&
      Number(selectedRoom.capacity) > 0 &&
      numericCapacity > Number(selectedRoom.capacity)
    ) {
      throw new Error(
        `Maximum students cannot exceed the selected room capacity of ${selectedRoom.capacity}.`,
      );
    }

    // ===============================================
    // SCHEDULE PAIR
    // ===============================================

    if (!schedulePairValid) {
      throw new Error(
        "Schedule days and schedule time must either both be provided or both be empty.",
      );
    }

    // ===============================================
    // OPEN OFFERING
    //
    // An Open offering must remain fully configured.
    //
    // This includes the section_subject itself remaining
    // Open.
    // ===============================================

    if (isOpen) {
      if (!sectionSubjectOpen) {
        throw new Error(
          "An Open offering requires its section subject to remain Open.",
        );
      }

      if (!facultyId) {
        throw new Error(
          "An Open offering must have an assigned faculty member.",
        );
      }

      if (!hasDays) {
        throw new Error("An Open offering must have schedule days.");
      }

      if (!hasTime) {
        throw new Error("An Open offering must have a schedule time.");
      }
    }
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
  // SAVE
  // =====================================================

  const handleSave = async () => {
    if (!subject || !offering || !offeringId) {
      setError("A valid subject offering is required.");

      return;
    }

    try {
      setLoading(true);

      clearFeedback();

      // ===============================================
      // VALIDATE FRONTEND
      // ===============================================

      validateForm();

      // ===============================================
      // PAYLOAD
      //
      // Missing backend field = preserve current value.
      // Explicit null = clear optional value.
      //
      // Send every editable configuration field so the
      // Registrar can intentionally clear optional values.
      //
      // STATUS IS NEVER EDITED HERE.
      // ===============================================

      const payload = {
        faculty_id: facultyId ? Number(facultyId) : null,

        room_id: roomId ? Number(roomId) : null,

        schedule_days: scheduleDays.trim() ? scheduleDays.trim() : null,

        schedule_time: scheduleTime.trim() ? scheduleTime.trim() : null,

        max_students: numericCapacity,
      };

      // ===============================================
      // REQUEST
      // ===============================================

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

      // ===============================================
      // AUTHENTICATION
      // ===============================================

      if (response.status === 401) {
        onUnauthorized();

        return;
      }

      // ===============================================
      // AUTHORIZATION
      // ===============================================

      if (response.status === 403) {
        throw new Error(
          data.message ||
            data.error ||
            "You are not authorized to edit class offerings.",
        );
      }

      // ===============================================
      // NOT FOUND
      // ===============================================

      if (response.status === 404) {
        throw new Error(
          data.message ||
            data.error ||
            "The class offering, faculty, or room could not be found.",
        );
      }

      // ===============================================
      // CONFLICT / BUSINESS RULE
      //
      // One 409 branch only.
      //
      // Structured schedule conflicts are preserved for
      // ConflictAlert.
      //
      // Other 409 cases such as:
      // - Cancelled offering
      // - Capacity below assignments
      // - Room capacity
      // - Open offering becoming incomplete
      //
      // still display the backend message.
      // ===============================================

      if (response.status === 409) {
        setConflicts(Array.isArray(data.conflicts) ? data.conflicts : []);

        throw new Error(
          data.message ||
            data.error ||
            "The offering could not be updated because of a conflict or business rule.",
        );
      }

      // ===============================================
      // BAD REQUEST / VALIDATION
      // ===============================================

      if (response.status === 400) {
        throw new Error(
          data.message ||
            data.error ||
            "The class offering configuration is invalid.",
        );
      }

      // ===============================================
      // GENERAL ERROR
      // ===============================================

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Failed to update class offering.",
        );
      }

      // ===============================================
      // SUCCESS
      // ===============================================

      onSuccess();

      onClose();
    } catch (error) {
      console.error("UPDATE OFFERING ERROR:", error);

      setError(
        error instanceof Error
          ? error.message
          : "Unable to update class offering.",
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
        {/* ================================================= */}
        {/* HEADER */}
        {/* ================================================= */}

        <div className="class-offering-modal-header">
          <div>
            <h2 id="edit-offering-title">Edit Class Offering</h2>

            <p>
              Update faculty, schedule, room, or capacity for this class
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

        {/* ================================================= */}
        {/* SUBJECT INFORMATION */}
        {/* ================================================= */}

        <div className="class-offering-modal-subject">
          <div>
            <strong>{subject.subject.subject_code}</strong>

            <span>
              {" — "}
              {subject.subject.subject_name}
            </span>
          </div>

          <small>
            {subject.subject.units} unit
            {subject.subject.units !== 1 ? "s" : ""}
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
        {/* BODY */}
        {/* ================================================= */}

        <div className="class-offering-modal-body">
          {/* =============================================== */}
          {/* CURRENT STATUS */}
          {/* =============================================== */}

          <div className="class-offering-prepare-notice">
            <strong>Current offering status: {currentStatus}</strong>

            <p>
              Section subject status:{" "}
              <strong>{sectionSubjectStatus || "Unavailable"}</strong>
            </p>

            {isOpen && (
              <p>
                This offering is Open. After editing, faculty, schedule,
                capacity, and the section subject must all remain valid or the
                backend will reject the update.
              </p>
            )}

            {isClosed && (
              <p>
                This offering is Closed. Editing can complete its configuration,
                but saving here does not open it. Use Offering Status separately
                when you are ready to open enrollment.
              </p>
            )}

            {isCancelled && (
              <p>
                This offering is Cancelled. Cancellation is terminal, so the
                configuration can no longer be edited.
              </p>
            )}
          </div>

          {/* =============================================== */}
          {/* FORM */}
          {/* =============================================== */}

          <div className="class-offering-form-grid">
            {/* ============================================= */}
            {/* FACULTY */}
            {/* ============================================= */}

            <div className="class-offering-field">
              <label htmlFor="edit-offering-faculty">Faculty</label>

              <select
                id="edit-offering-faculty"
                value={facultyId}
                disabled={loading || isCancelled}
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

              <small>Required while the offering is Open.</small>
            </div>

            {/* ============================================= */}
            {/* ROOM */}
            {/* ============================================= */}

            <div className="class-offering-field">
              <label htmlFor="edit-offering-room">Room</label>

              <select
                id="edit-offering-room"
                value={roomId}
                disabled={loading || isCancelled}
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
                Optional. When assigned, room capacity and overlapping room
                schedules are validated.
              </small>
            </div>

            {/* ============================================= */}
            {/* SCHEDULE DAYS */}
            {/* ============================================= */}

            <div className="class-offering-field">
              <label htmlFor="edit-offering-days">Schedule Days</label>

              <input
                id="edit-offering-days"
                type="text"
                value={scheduleDays}
                disabled={loading || isCancelled}
                placeholder="Example: Monday, Wednesday"
                onChange={(event) => {
                  setScheduleDays(event.target.value);

                  clearFeedback();
                }}
              />

              <small>Examples: Monday or Monday, Wednesday.</small>
            </div>

            {/* ============================================= */}
            {/* SCHEDULE TIME */}
            {/* ============================================= */}

            <div className="class-offering-field">
              <label htmlFor="edit-offering-time">Schedule Time</label>

              <input
                id="edit-offering-time"
                type="text"
                value={scheduleTime}
                disabled={loading || isCancelled}
                placeholder="Example: 8:00 AM - 10:00 AM"
                onChange={(event) => {
                  setScheduleTime(event.target.value);

                  clearFeedback();
                }}
              />

              <small>
                Section, faculty, and assigned-room overlaps are rejected by the
                backend.
              </small>
            </div>

            {/* ============================================= */}
            {/* MAXIMUM STUDENTS */}
            {/* ============================================= */}

            <div className="class-offering-field">
              <label htmlFor="edit-offering-capacity">Maximum Students</label>

              <input
                id="edit-offering-capacity"
                type="number"
                min={Math.max(1, enrolledCount)}
                step={1}
                value={maxStudents}
                disabled={loading || isCancelled}
                onChange={(event) => {
                  setMaxStudents(event.target.value);

                  clearFeedback();
                }}
              />

              {belowAssignedStudents ? (
                <small>
                  Capacity cannot be lower than the {enrolledCount} currently
                  assigned student
                  {enrolledCount !== 1 ? "s" : ""}.
                </small>
              ) : roomCapacityExceeded ? (
                <small>
                  Capacity exceeds the selected room capacity of{" "}
                  {selectedRoom?.capacity}.
                </small>
              ) : enrolledCount > 0 ? (
                <small>
                  Current assigned students: {enrolledCount}
                  {selectedRoom?.capacity
                    ? ` • Room capacity: ${selectedRoom.capacity}`
                    : ""}
                </small>
              ) : selectedRoom?.capacity ? (
                <small>Selected room capacity: {selectedRoom.capacity}</small>
              ) : (
                <small>Capacity must be a positive whole number.</small>
              )}
            </div>

            {/* ============================================= */}
            {/* STATUS */}
            {/* ============================================= */}

            <div className="class-offering-field">
              <label>Offering Status</label>

              <input type="text" value={currentStatus} disabled />

              <small>
                Status is managed separately from editing class configuration.
              </small>
            </div>
          </div>

          {/* =============================================== */}
          {/* CONFIGURATION PREVIEW */}
          {/* =============================================== */}

          <div className="class-offering-open-requirements">
            <h3>Configuration Check</h3>

            <ul>
              <li>
                Section Subject:{" "}
                {sectionSubjectOpen
                  ? "Open"
                  : sectionSubjectStatus || "Unavailable"}
              </li>

              <li>Faculty: {facultyId ? "Ready" : "Missing"}</li>

              <li>Schedule Days: {hasDays ? "Ready" : "Missing"}</li>

              <li>Schedule Time: {hasTime ? "Ready" : "Missing"}</li>

              <li>
                Schedule Pair:{" "}
                {schedulePairValid ? "Valid" : "Days and time must be paired"}
              </li>

              <li>
                Capacity:{" "}
                {!validCapacity
                  ? "Invalid"
                  : belowAssignedStudents
                    ? "Below assigned students"
                    : roomCapacityExceeded
                      ? "Above room capacity"
                      : "Ready"}
              </li>

              <li>
                Room: {roomId ? "Assigned — conflict checked" : "Optional"}
              </li>
            </ul>

            <p>
              <strong>
                {configurationComplete
                  ? "Configuration Complete"
                  : "Configuration Incomplete"}
              </strong>
            </p>

            {isClosed && configurationComplete && (
              <small>
                Saving these changes keeps the offering Closed. Open it
                separately through Offering Status after this edit is saved.
              </small>
            )}

            {isOpen && !configurationComplete && (
              <small>
                This Open offering cannot be saved in an incomplete state.
              </small>
            )}
          </div>

          {/* =============================================== */}
          {/* SCHEDULE VALIDATION */}
          {/* =============================================== */}

          <div className="class-offering-open-requirements">
            <h3>Schedule Validation</h3>

            <ul>
              <li>Same section + overlapping schedule = conflict</li>

              <li>Same faculty + overlapping schedule = conflict</li>

              <li>Same assigned room + overlapping schedule = conflict</li>

              <li>Adjacent non-overlapping schedules are allowed</li>
            </ul>
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
            className="class-offering-primary-button"
            disabled={!canSave}
            onClick={handleSave}
          >
            {loading ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
