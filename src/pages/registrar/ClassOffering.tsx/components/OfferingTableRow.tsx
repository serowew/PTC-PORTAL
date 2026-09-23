import {
  BookOpen,
  Clock3,
  Edit3,
  Power,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import type { OfferingTableSubject } from "./OfferingTable";

// =====================================================
// PROPS
// =====================================================

interface OfferingTableRowProps {
  item: OfferingTableSubject;

  onCreateOffering: (subject: OfferingTableSubject) => void;

  onEditOffering: (subject: OfferingTableSubject) => void;

  onOfferingStatus: (subject: OfferingTableSubject) => void;

  onSectionSubjectStatus: (subject: OfferingTableSubject) => void;
}

// =====================================================
// STATUS
// =====================================================

function getStatusLabel(item: OfferingTableSubject) {
  const sectionSubject = item.section_subject;
  const offering = item.offering;

  if (!item.has_section_subject || !sectionSubject) {
    return "NO SECTION SUBJECT";
  }

  if (sectionSubject.status === "Cancelled") {
    return "SECTION CANCELLED";
  }

  if (!item.has_offering || !offering) {
    return "NO OFFERING";
  }

  if (offering.status === "Cancelled") {
    return "CANCELLED";
  }

  if (sectionSubject.status !== "Open") {
    return "SECTION CLOSED";
  }

  if (item.ready_for_enrollment) {
    return "READY";
  }

  if (!item.configuration_complete) {
    return "INCOMPLETE";
  }

  if (offering.status === "Closed") {
    return "CONFIGURED";
  }

  return "NOT READY";
}

// =====================================================
// STATUS CLASS
// =====================================================

function getStatusClassName(status: string) {
  switch (status) {
    case "READY":
      return "ready";

    case "CONFIGURED":
      return "closed";

    case "NO OFFERING":
      return "no-offering";

    case "NO SECTION SUBJECT":
      return "no-section-subject";

    case "INCOMPLETE":
      return "incomplete";

    case "CANCELLED":
      return "cancelled";

    case "SECTION CLOSED":
      return "section-closed";

    case "SECTION CANCELLED":
      return "section-cancelled";

    default:
      return "not-ready";
  }
}

// =====================================================
// COMPONENT
// =====================================================

export default function OfferingTableRow({
  item,
  onCreateOffering,
  onEditOffering,
  onOfferingStatus,
  onSectionSubjectStatus,
}: OfferingTableRowProps) {
  const subject = item.subject;

  const sectionSubject = item.section_subject;

  const offering = item.offering;

  const capacity = offering?.capacity;

  // =====================================================
  // STATUS
  // =====================================================

  const statusLabel = getStatusLabel(item);

  const statusClassName = getStatusClassName(statusLabel);

  // =====================================================
  // TERMINAL STATES
  // =====================================================

  const sectionSubjectCancelled = sectionSubject?.status === "Cancelled";

  const offeringCancelled = offering?.status === "Cancelled";

  // =====================================================
  // DISPLAY VALUES
  // =====================================================

  const facultyName = offering?.faculty?.faculty_name || "Not assigned";

  const facultyRole = offering?.faculty?.role_name || null;

  const scheduleDays = offering?.schedule?.days?.trim() || null;

  const scheduleTime = offering?.schedule?.time?.trim() || null;

  const hasSchedule = Boolean(scheduleDays) && Boolean(scheduleTime);

  // =====================================================
  // CAPACITY
  // =====================================================

  const maxStudents = Number(
    capacity?.max_students ?? sectionSubject?.max_students ?? 0,
  );

  const enrolledCount = Number(capacity?.enrolled_count ?? 0);

  const availableSlots = Number(
    capacity?.available_slots ?? Math.max(maxStudents - enrolledCount, 0),
  );

  const isFull =
    capacity?.is_full ?? (maxStudents > 0 && enrolledCount >= maxStudents);

  const capacityPercent =
    maxStudents > 0
      ? Math.min(
          100,
          Math.max(0, Math.round((enrolledCount / maxStudents) * 100)),
        )
      : 0;

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <tr>
      {/* SUBJECT */}

      <td>
        <div className="class-offering-subject-cell">
          <span className="class-offering-subject-code">
            {subject?.subject_code || "—"}
          </span>

          <div className="class-offering-subject-copy">
            <strong>{subject?.subject_name || "Unknown Subject"}</strong>

            <span>
              {Number(subject?.units || 0)} unit
              {Number(subject?.units || 0) === 1 ? "" : "s"}
              {typeof subject?.is_required === "boolean"
                ? ` • ${subject.is_required ? "Required" : "Elective"}`
                : ""}
            </span>
          </div>
        </div>
      </td>

      {/* INSTRUCTOR */}

      <td>
        <div className="class-offering-meta-line">
          <UserRound size={15} aria-hidden="true" />

          <span>
            <strong>{facultyName}</strong>

            {facultyRole && <small>{facultyRole}</small>}
          </span>
        </div>
      </td>

      {/* SCHEDULE */}

      <td>
        <div className="class-offering-schedule-cell">
          <div className="class-offering-meta-line">
            <Clock3 size={15} aria-hidden="true" />

            {hasSchedule ? (
              <span>
                <strong>{scheduleDays}</strong>

                <small>{scheduleTime}</small>
              </span>
            ) : offering?.faculty ? (
              <span>
                <strong>Pending Instructor Schedule</strong>

                <small>
                  Assigned instructor must set the class day and time.
                </small>
              </span>
            ) : (
              <span>
                <strong>No Schedule</strong>

                <small>Assign an instructor first.</small>
              </span>
            )}
          </div>
        </div>
      </td>

      {/* CAPACITY */}

      <td>
        {capacity ? (
          <div className="class-offering-capacity-cell">
            <div className="class-offering-capacity-value">
              <strong>{enrolledCount}</strong>

              <span>/ {maxStudents}</span>

              {isFull && <em>Full</em>}
            </div>

            <div className="class-offering-capacity-track" aria-hidden="true">
              <span
                style={{
                  width: `${capacityPercent}%`,
                }}
              />
            </div>

            <small>
              {availableSlots} slot
              {availableSlots === 1 ? "" : "s"} available
            </small>
          </div>
        ) : (
          <div className="class-offering-capacity-cell">
            <strong>{sectionSubject?.max_students ?? "—"}</strong>

            <small>Section capacity</small>
          </div>
        )}
      </td>

      {/* STATUS */}

      <td>
        <div className="class-offering-status-stack">
          <span className={`class-offering-status-badge ${statusClassName}`}>
            {statusLabel}
          </span>

          {sectionSubject && <small>Section: {sectionSubject.status}</small>}
        </div>
      </td>

      {/* ACTIONS */}

      <td>
        {!item.has_section_subject || !sectionSubject ? (
          <span className="class-offering-action-note">
            Section subject missing
          </span>
        ) : sectionSubjectCancelled ? (
          <span className="class-offering-action-note">
            No actions available
          </span>
        ) : !item.has_offering || !offering ? (
          <div className="class-offering-actions">
            <button
              type="button"
              className="class-offering-action-button class-offering-action-button--primary"
              onClick={() => onCreateOffering(item)}
            >
              <BookOpen size={14} aria-hidden="true" />
              Create
            </button>

            <button
              type="button"
              className="class-offering-action-button"
              onClick={() => onSectionSubjectStatus(item)}
            >
              <ShieldCheck size={14} aria-hidden="true" />
              Section Status
            </button>
          </div>
        ) : offeringCancelled ? (
          <div className="class-offering-actions">
            <button
              type="button"
              className="class-offering-action-button"
              onClick={() => onOfferingStatus(item)}
            >
              <Power size={14} aria-hidden="true" />
              Offering Status
            </button>

            <button
              type="button"
              className="class-offering-action-button"
              onClick={() => onSectionSubjectStatus(item)}
            >
              <ShieldCheck size={14} aria-hidden="true" />
              Section Status
            </button>
          </div>
        ) : (
          <div className="class-offering-actions">
            <button
              type="button"
              className="class-offering-action-button class-offering-action-button--primary"
              onClick={() => onEditOffering(item)}
            >
              <Edit3 size={14} aria-hidden="true" />
              Reassign
            </button>

            <button
              type="button"
              className="class-offering-action-button"
              onClick={() => onOfferingStatus(item)}
            >
              <Power size={14} aria-hidden="true" />
              Status
            </button>

            <button
              type="button"
              className="class-offering-action-button"
              onClick={() => onSectionSubjectStatus(item)}
            >
              <ShieldCheck size={14} aria-hidden="true" />
              Section
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
