import OfferingTableRow from "./OfferingTableRow";

// =====================================================
// TYPES
// =====================================================

interface OfferingFaculty {
  faculty_id: number;
  faculty_name: string;
}

interface OfferingRoom {
  room_id: number;
  room_name: string;
  room_code?: string | null;
}

interface OfferingSchedule {
  days: string | null;
  time: string | null;
}

interface OfferingCapacity {
  max_students: number;
  enrolled_count: number;
  available_slots: number;
  is_full: boolean;
}

interface Offering {
  offering_id: number;

  status: "Open" | "Closed" | "Cancelled";

  faculty: OfferingFaculty | null;

  room: OfferingRoom | null;

  schedule: OfferingSchedule;

  capacity: OfferingCapacity;
}

interface SectionSubject {
  section_subject_id: number;

  status: "Open" | "Closed" | "Cancelled";

  max_students: number | null;
}

interface SubjectInfo {
  subject_id: number;

  subject_code: string;

  subject_name: string;

  units: number;

  lecture_hours?: number;

  laboratory_hours?: number;

  is_required?: boolean;

  display_order?: number | null;
}

export interface OfferingTableSubject {
  /**
   * Normal curriculum subject:
   * number
   *
   * Special / Retake subject:
   * null
   */
  curriculum_subject_id: number | null;

  subject: SubjectInfo;

  section_subject: SectionSubject | null;

  offering: Offering | null;

  has_section_subject: boolean;

  has_offering: boolean;

  configuration_complete: boolean;

  ready_for_enrollment: boolean;

  missing_configuration: string[];
}

// =====================================================
// PROPS
// =====================================================

interface OfferingTableProps {
  subjects: OfferingTableSubject[];

  onCreateOffering: (subject: OfferingTableSubject) => void;

  onEditOffering: (subject: OfferingTableSubject) => void;

  onOfferingStatus: (subject: OfferingTableSubject) => void;

  onSectionSubjectStatus: (subject: OfferingTableSubject) => void;
}

// =====================================================
// VALID ROW
// =====================================================

function isValidSubjectRow(
  item: OfferingTableSubject | null | undefined,
): item is OfferingTableSubject {
  if (!item) {
    return false;
  }

  if (!item.subject) {
    return false;
  }

  const subjectId = Number(item.subject.subject_id);

  return Number.isInteger(subjectId) && subjectId > 0;
}

// =====================================================
// ROW KEY
// =====================================================

function getRowKey(item: OfferingTableSubject, index: number) {
  const curriculumSubjectId = Number(item.curriculum_subject_id ?? 0);

  if (Number.isInteger(curriculumSubjectId) && curriculumSubjectId > 0) {
    return `curriculum-${curriculumSubjectId}`;
  }

  const sectionSubjectId = Number(
    item.section_subject?.section_subject_id ?? 0,
  );

  if (Number.isInteger(sectionSubjectId) && sectionSubjectId > 0) {
    return `section-subject-${sectionSubjectId}`;
  }

  const offeringId = Number(item.offering?.offering_id ?? 0);

  if (Number.isInteger(offeringId) && offeringId > 0) {
    return `offering-${offeringId}`;
  }

  const subjectId = Number(item.subject?.subject_id ?? 0);

  if (Number.isInteger(subjectId) && subjectId > 0) {
    return `subject-${subjectId}`;
  }

  return `offering-row-${index}`;
}

// =====================================================
// COMPONENT
// =====================================================

export default function OfferingTable({
  subjects,
  onCreateOffering,
  onEditOffering,
  onOfferingStatus,
  onSectionSubjectStatus,
}: OfferingTableProps) {
  // =====================================================
  // SAFE SUBJECT ARRAY
  // =====================================================

  const safeSubjects = Array.isArray(subjects)
    ? subjects.filter(isValidSubjectRow)
    : [];

  // =====================================================
  // SPECIAL / RETAKE TABLE
  // =====================================================

  const isSpecialTable =
    safeSubjects.length > 0 &&
    safeSubjects.every((item) => item.curriculum_subject_id === null);

  // =====================================================
  // TABLE
  // =====================================================

  const tableContent = (
    <div className="class-offering-table-wrapper">
      <table className="class-offering-table">
        <thead>
          <tr>
            <th>Subject</th>

            <th>Faculty</th>

            <th>Schedule &amp; Room</th>

            <th>Capacity</th>

            <th>Status</th>

            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {safeSubjects.length === 0 ? (
            <tr>
              <td colSpan={6}>
                <div className="class-offering-table-empty">
                  No class offering subjects found for this academic setup.
                </div>
              </td>
            </tr>
          ) : (
            safeSubjects.map((item, index) => (
              <OfferingTableRow
                key={getRowKey(item, index)}
                item={item}
                onCreateOffering={onCreateOffering}
                onEditOffering={onEditOffering}
                onOfferingStatus={onOfferingStatus}
                onSectionSubjectStatus={onSectionSubjectStatus}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  // =====================================================
  // SPECIAL TABLE
  //
  // Parent page already supplies the Special / Retake
  // section heading, so return only the table here.
  // =====================================================

  if (isSpecialTable) {
    return tableContent;
  }

  // =====================================================
  // CURRICULUM TABLE
  // =====================================================

  return (
    <section className="class-offering-section">
      <div className="class-offering-section-header">
        <div>
          <div className="class-offering-section-kicker">Curriculum Plan</div>

          <h2>Curriculum Class Offerings</h2>

          <p>
            Every expected curriculum subject is shown, including subjects that
            still need a section-subject record or a class offering.
          </p>
        </div>

        <span className="class-offering-section-count">
          {safeSubjects.length} subject
          {safeSubjects.length === 1 ? "" : "s"}
        </span>
      </div>

      {tableContent}
    </section>
  );
}
