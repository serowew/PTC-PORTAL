import {
  CalendarDays,
  MapPin,
  Pencil,
  Plus,
  Settings2,
  UserRound,
} from "lucide-react";

import OfferingStatusBadge, {
  type OfferingDisplayStatus,
} from "./OfferingStatusBadge";

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
// DISPLAY STATUS
// =====================================================

function getDisplayStatus(item: OfferingTableSubject): OfferingDisplayStatus {
  const sectionStatus = item.section_subject?.status;
  const offeringStatus = item.offering?.status;

  if (!item.section_subject) {
    return "NO SECTION SUBJECT";
  }

  if (sectionStatus === "Cancelled") {
    return "SECTION CANCELLED";
  }

  if (sectionStatus === "Closed") {
    return "SECTION CLOSED";
  }

  if (!item.offering) {
    return "NO OFFERING";
  }

  if (offeringStatus === "Cancelled") {
    return "CANCELLED";
  }

  if (item.ready_for_enrollment) {
    return "READY";
  }

  if (item.configuration_complete && offeringStatus === "Closed") {
    return "CONFIGURED";
  }

  if (item.missing_configuration.length > 0) {
    return "INCOMPLETE";
  }

  return "NOT READY";
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
  const { subject, section_subject: sectionSubject, offering } = item;

  const displayStatus = getDisplayStatus(item);

  const maxStudents = Number(
    offering?.capacity.max_students ?? sectionSubject?.max_students ?? 0,
  );

  const enrolledCount = Number(offering?.capacity.enrolled_count ?? 0);

  const availableSlots = Number(
    offering?.capacity.available_slots ?? Math.max(maxStudents - enrolledCount, 0),
  );

  const capacityPercent =
    maxStudents > 0
      ? Math.min(100, Math.max(0, (enrolledCount / maxStudents) * 100))
      : 0;

  const scheduleDays = offering?.schedule.days?.trim() || "Schedule not set";
  const scheduleTime = offering?.schedule.time?.trim() || "Time not set";

  const roomLabel = offering?.room
    ? [offering.room.room_code, offering.room.room_name]
        .filter(Boolean)
        .join(" — ")
    : "Room not assigned";

  const canCreateOffering = Boolean(sectionSubject) && !offering;

  return (
    <tr>
      {/* SUBJECT */}
      <td>
        <div className="class-offering-subject-cell">
          <span className="class-offering-subject-code">
            {subject.subject_code}
          </span>

          <div className="class-offering-subject-copy">
            <strong>{subject.subject_name}</strong>

            <span>
              {subject.units} unit{subject.units === 1 ? "" : "s"}
              {typeof subject.is_required === "boolean"
                ? ` • ${subject.is_required ? "Required" : "Elective"}`
                : ""}
            </span>
          </div>
        </div>
      </td>

      {/* FACULTY */}
      <td>
        <div className="class-offering-meta-line">
          <UserRound size={15} aria-hidden="true" />

          <span>
            <strong>{offering?.faculty?.faculty_name || "Not assigned"}</strong>
            <small>{offering ? "Faculty" : "No offering yet"}</small>
          </span>
        </div>
      </td>

      {/* SCHEDULE + ROOM */}
      <td>
        <div className="class-offering-schedule-cell">
          <div className="class-offering-meta-line">
            <CalendarDays size={15} aria-hidden="true" />

            <span>
              <strong>{scheduleDays}</strong>
              <small>{scheduleTime}</small>
            </span>
          </div>

          <div className="class-offering-meta-line class-offering-meta-line--muted">
            <MapPin size={15} aria-hidden="true" />

            <span>
              <strong>{roomLabel}</strong>
              <small>Room</small>
            </span>
          </div>
        </div>
      </td>

      {/* CAPACITY */}
      <td>
        <div className="class-offering-capacity-cell">
          {offering ? (
            <>
              <div className="class-offering-capacity-value">
                <strong>{enrolledCount}</strong>
                <span>/ {maxStudents}</span>
                {offering.capacity.is_full ? <em>Full</em> : null}
              </div>

              <div className="class-offering-capacity-track" aria-hidden="true">
                <span style={{ width: `${capacityPercent}%` }} />
              </div>

              <small>
                {availableSlots} slot{availableSlots === 1 ? "" : "s"} available
              </small>
            </>
          ) : (
            <>
              <strong>{maxStudents || "—"}</strong>
              <small>{sectionSubject ? "Section capacity" : "Not prepared"}</small>
            </>
          )}
        </div>
      </td>

      {/* STATUS */}
      <td>
        <div className="class-offering-status-stack">
          <OfferingStatusBadge status={displayStatus} />

          {sectionSubject ? (
            <small>Section: {sectionSubject.status}</small>
          ) : (
            <small>Prepare section subject first</small>
          )}

          {item.missing_configuration.length > 0 && offering ? (
            <small>{item.missing_configuration.join(", ")}</small>
          ) : null}
        </div>
      </td>

      {/* ACTIONS */}
      <td>
        <div className="class-offering-actions">
          {canCreateOffering ? (
            <button
              type="button"
              className="class-offering-action-button class-offering-action-button--primary"
              onClick={() => onCreateOffering(item)}
            >
              <Plus size={14} aria-hidden="true" />
              Create
            </button>
          ) : null}

          {offering ? (
            <>
              <button
                type="button"
                className="class-offering-action-button"
                onClick={() => onEditOffering(item)}
              >
                <Pencil size={14} aria-hidden="true" />
                Edit
              </button>

              <button
                type="button"
                className="class-offering-action-button"
                onClick={() => onOfferingStatus(item)}
              >
                <Settings2 size={14} aria-hidden="true" />
                Offering Status
              </button>
            </>
          ) : null}

          {sectionSubject ? (
            <button
              type="button"
              className="class-offering-action-button"
              onClick={() => onSectionSubjectStatus(item)}
            >
              <Settings2 size={14} aria-hidden="true" />
              Section Status
            </button>
          ) : null}

          {!sectionSubject ? (
            <span className="class-offering-action-note">
              Prepare the section subject before creating an offering.
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
