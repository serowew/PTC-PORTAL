import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/EnrollmementDetailsR.css";

const API_BASE_URL = "http://localhost:3000/api/registrar/enrollments";

// =====================================================
// TYPES
// =====================================================

type EnrollmentStatus =
  | "Draft"
  | "Pending"
  | "Approved"
  | "Rejected"
  | "Cancelled"
  | string;

// =====================================================
// OFFICIAL PERSISTED ENROLLMENT TYPE
//
// IMPORTANT:
//
// This comes from:
//
// enrollment_subjects.enrollment_type
//
// The frontend must NOT determine the official type
// again from grades or validation.
// =====================================================

type EnrollmentType = "Regular" | "Retake" | "Carry Over";

// =====================================================
// IRREGULAR REASON
// =====================================================

type IrregularReason =
  | "RETAKE"
  | "CARRY_OVER"
  | "CROSS_SECTION_PLACEMENT"
  | string
  | null;

// =====================================================
// PLACEMENT FLAGS
//
// These describe the actual class placement.
//
// They do NOT change:
//
// students.course_id
// students.year_level
// students.section_id
// =====================================================

interface PlacementFlags {
  cross_section: boolean;
  cross_course: boolean;
  cross_year?: boolean;
}

// =====================================================
// ENROLLMENT DETAILS
// =====================================================

interface EnrollmentDetails {
  enrollment_id: number;

  student: {
    student_id: number;
    user_id: number | null;

    student_number: string;

    first_name: string;
    middle_name: string | null;
    last_name: string;

    student_name: string;

    username: string | null;
    email: string | null;

    gender: string | null;
    birth_date: string | null;
    contact_number: string | null;

    year_level: number | null;
  };

  course: {
    course_id: number | null;
    course_code: string | null;
    course_name: string | null;
  };

  // ===================================================
  // HOME / PROFILE SECTION
  //
  // Informational only.
  //
  // An irregular placement does NOT modify this.
  // ===================================================

  student_section: {
    section_id: number | null;
    section_name: string | null;
    year_level: number | null;
  };

  academic_period: {
    academic_year_id: number;
    academic_year: string;

    semester_id: number;
    semester_name: string;
  };

  enrollment_status: EnrollmentStatus;

  remarks: string | null;

  approval: {
    approved_by: number | null;
    approved_by_username: string | null;
    approved_at: string | null;
  };

  created_at: string;
}

// =====================================================
// ENROLLMENT SUBJECT
// =====================================================

interface EnrollmentSubject {
  enrollment_subject_id: number;
  enrollment_id: number;

  subject_id: number;
  subject_code: string;
  subject_name: string;

  units: number;

  lecture_hours: number | null;
  laboratory_hours: number | null;

  status: string;

  // ===================================================
  // OFFICIAL TYPE
  //
  // Backend persisted value.
  // ===================================================

  enrollment_type: EnrollmentType;

  // ===================================================
  // DERIVED IRREGULAR INFORMATION
  // ===================================================

  is_irregular: boolean;

  irregular_reason: IrregularReason;

  // ===================================================
  // ACTUAL ASSIGNED SECTION
  //
  // This may differ from student_section.
  // ===================================================

  section: {
    section_id: number | null;
    section_name: string | null;

    year_level: number | null;

    // Optional because older backend responses may not
    // yet expose assigned-section course metadata.
    course_id?: number | null;
    course_code?: string | null;
    course_name?: string | null;
  };

  section_subject: {
    section_subject_id: number | null;
    status: string | null;
  };

  offering: {
    offering_id: number | null;

    status: string | null;

    schedule_days: string | null;
    schedule_time: string | null;

    max_students: number | null;
    enrolled_count: number;
    available_slots: number | null;
  };

  faculty: {
    faculty_id: number | null;

    // Existing details endpoint currently uses username.
    username: string | null;

    // Keep optional support if backend later returns
    // the complete Faculty display name.
    faculty_name?: string | null;
  };

  room: {
    room_id: number | null;
    room_name: string | null;
  };

  // Optional richer placement metadata.
  placement_flags?: PlacementFlags;

  assignment_complete: boolean;
}

// =====================================================
// ENROLLMENT SUMMARY
// =====================================================

interface EnrollmentSummary {
  total_subjects: number;
  total_units: number;

  assigned_subjects: number;
  unassigned_subjects: number;

  all_subjects_assigned: boolean;

  // ===================================================
  // TYPE COMPOSITION
  // ===================================================

  regular_subjects: number;
  retake_subjects: number;
  carry_over_subjects: number;

  // ===================================================
  // IRREGULAR COMPOSITION
  // ===================================================

  irregular_subjects: number;

  is_irregular_enrollment: boolean;
}

// =====================================================
// ENROLLMENT DETAILS RESPONSE
// =====================================================

interface EnrollmentDetailsResponse {
  success: boolean;

  message?: string;
  error?: string;

  enrollment?: EnrollmentDetails;

  subjects?: EnrollmentSubject[];

  summary?: EnrollmentSummary;
}

// =====================================================
// VALIDATION ISSUE
// =====================================================

interface ValidationIssue {
  code?: string;
  message?: string;
  category?: string;

  enrollment_subject_id?: number;
  subject_id?: number;
  subject_code?: string;

  [key: string]: unknown;
}

// =====================================================
// APPROVED GRADE V2 SUMMARY
//
// IMPORTANT:
//
// Official academic result uses:
//
// final_rating
//
// NOT final_grade.
// =====================================================

interface ApprovedGradeSummary {
  grade_id?: number;

  enrollment_subject_id?: number;

  enrollment_id?: number | null;

  final_rating?: number | null;

  remarks?: string | null;

  grade_status?: string | null;

  approved_by?: number | null;
  approved_at?: string | null;

  academic_year_id?: number | null;
  semester_id?: number | null;

  // ===================================================
  // LEGACY RESPONSE COMPATIBILITY ONLY
  //
  // We do not use final_grade as academic truth.
  // ===================================================

  final_grade?: number | null;

  classification?: string | null;
  result_code?: string | null;
}

// =====================================================
// PREREQUISITE EVALUATION
// =====================================================

interface PrerequisiteEvaluation {
  prerequisite_id?: number;

  subject_id?: number;
  subject_code?: string;
  subject_name?: string;

  required_for_attempt?: boolean;

  satisfied?: boolean;

  passed_grade?: number | null;

  bypassed_for_retake?: boolean;

  error?: string | null;

  [key: string]: unknown;
}

// =====================================================
// GRADE V2 ACADEMIC ELIGIBILITY
//
// Current backend authority:
//
// eligible
// eligibility_type
// reason
// latest_approved_grade
// prerequisites
//
// Legacy fields stay optional only so older responses
// do not crash the page while we finish migration.
// =====================================================

interface AcademicEligibility {
  eligible: boolean;

  eligibility_type?: string | null;

  reason?: string | null;

  latest_approved_grade?: ApprovedGradeSummary | null;

  prerequisites?: PrerequisiteEvaluation[];

  errors?: ValidationIssue[];

  // ===================================================
  // LEGACY FRONTEND/API COMPATIBILITY
  // ===================================================

  attempt_type?: string | null;

  is_retake?: boolean;

  previous_grade?: ApprovedGradeSummary | null;

  prerequisite_policy?: string | null;
}

// =====================================================
// VALIDATION SUBJECT
// =====================================================
interface ValidationSubject {
  enrollment_subject_id: number;

  subject_id: number;

  subject_code: string;

  subject_name: string;

  units: number;

  status: string;

  valid: boolean;

  enrollment_type: "Regular" | "Retake" | string | null;

  placement: {
    offering_id: number | null;

    section_id: number | null;

    section_subject_id: number | null;

    section_name: string | null;
  };

  errors: ValidationIssue[];

  warnings: ValidationIssue[];
}
interface ValidationResponse {
  success: boolean;

  message?: string;

  error?: string;

  valid: boolean;

  can_approve: boolean;

  already_approved?: boolean;

  validation_state?:
    | "READY_FOR_APPROVAL"
    | "ALREADY_APPROVED"
    | "NOT_READY"
    | "NOT_APPROVABLE"
    | string;

  enrollment?: {
    enrollment_id: number;

    student_id: number;

    student_number: string;

    student_name: string;

    course_id: number;

    course_code: string;

    course_name: string;

    year_level: number;

    academic_year_id: number;

    academic_year: string;

    semester_id: number;

    semester_name: string;

    enrollment_status: string;
  };

  curriculum?: {
    curriculum_id: number;

    curriculum_name: string;
  } | null;

  summary?: {
    total_records: number;

    active_subjects: number;

    total_units: number;

    valid_subjects: number;

    invalid_subjects: number;

    validation_errors: number;

    validation_warnings: number;
  };

  subjects?: ValidationSubject[];

  errors?: ValidationIssue[];

  warnings?: ValidationIssue[];
}
// =====================================================
// RAW VALIDATION PLACEMENT
// =====================================================

interface RawValidationPlacement {
  offering_id?: number | null;

  section_id?: number | null;

  section_subject_id?: number | null;

  section_name?: string | null;
}

// =====================================================
// RAW VALIDATION CAPACITY
// =====================================================

interface RawValidationCapacity {
  max_students?: number | null;

  enrolled_count?: number | null;

  available_slots?: number | null;
}

// =====================================================
// RAW VALIDATION SUBJECT
//
// The backend validation endpoint may provide some
// fields directly and others inside placement.
// =====================================================

interface RawValidationSubject {
  enrollment_subject_id?: number;

  subject_id?: number;
  subject_code?: string;
  subject_name?: string;

  units?: number;

  status?: string;

  enrollment_type?: EnrollmentType | string | null;

  is_irregular?: boolean;

  irregular_reason?: IrregularReason;

  offering_id?: number | null;

  section_id?: number | null;
  section_name?: string | null;

  section_subject_id?: number | null;

  offering_status?: string | null;

  section_subject_status?: string | null;

  placement?: RawValidationPlacement;

  capacity?: RawValidationCapacity;

  academic_eligibility?: AcademicEligibility;

  valid?: boolean;

  errors?: ValidationIssue[];

  warnings?: ValidationIssue[];
}

// =====================================================
// RAW VALIDATION SUMMARY
// =====================================================

interface RawValidationSummary {
  total_records?: number;

  total_enrolled_subjects?: number;

  active_subjects?: number;

  total_units?: number;

  valid_subjects?: number;
  invalid_subjects?: number;

  error_count?: number;
  warning_count?: number;

  validation_errors?: number;
  validation_warnings?: number;
}

// =====================================================
// RAW VALIDATION RESPONSE
// =====================================================

interface RawValidationResponse {
  success: boolean;

  message?: string;
  error?: string;

  valid?: boolean;

  can_approve?: boolean;

  already_approved?: boolean;

  validation_state?:
    | "READY_FOR_APPROVAL"
    | "ALREADY_APPROVED"
    | "NOT_READY"
    | "NOT_APPROVABLE"
    | string;

  // Legacy compatibility while older backend code is still present.
  ready_for_approval?: boolean;

  summary?: RawValidationSummary;

  subjects?: RawValidationSubject[];

  errors?: ValidationIssue[];

  warnings?: ValidationIssue[];
}

// =====================================================
// AVAILABLE OFFERING
//
// Used by:
// - Assign Offering
// - Change Offering
//
// The backend already determines whether cross-course
// or cross-section placement is valid.
// =====================================================

interface AvailableOffering {
  offering_id: number;

  // ===================================================
  // CURRENT ENROLLMENT SUBJECT CONTEXT
  // ===================================================

  enrollment_subject_id?: number;

  enrollment_type?: EnrollmentType;

  is_irregular_placement?: boolean;

  placement_flags?: PlacementFlags;

  subject: {
    subject_id: number;
    subject_code: string;
    subject_name: string;

    units: number;

    lecture_hours: number | null;
    laboratory_hours: number | null;
  };

  section: {
    section_id: number;
    section_name: string;

    year_level: number | null;

    course_id: number | null;
    course_code: string | null;
    course_name: string | null;
  };

  section_subject: {
    section_subject_id: number;
    status: string;
  };

  faculty: {
    faculty_id: number | null;
    faculty_name: string | null;
  };

  room: {
    room_id: number | null;
    room_name: string | null;
  };

  schedule: {
    days: string | null;
    time: string | null;
  };

  capacity: {
    max_students: number;
    enrolled_count: number;
    available_slots: number;

    is_full: boolean;
  };

  offering_status: string;

  academic_year_id: number;
  semester_id: number;
}

// =====================================================
// AVAILABLE OFFERINGS RESPONSE
// =====================================================

interface AvailableOfferingsResponse {
  success: boolean;

  message?: string;
  error?: string;

  code?: string;

  subject_filter?: number | null;

  count?: number;

  offerings?: AvailableOffering[];

  enrollment?: {
    enrollment_id: number;

    student_id: number;

    student_number: string;

    student_name: string;

    course_id: number;

    course_code: string | null;
    course_name: string | null;

    academic_year_id: number;
    academic_year: string;

    semester_id: number;
    semester_name: string;

    enrollment_status: string;
  };

  actor?: {
    user_id: number;
    username: string | null;
  };
}

// =====================================================
// AVAILABLE SUBJECT OFFERING
//
// Used by:
//
// Add Subject
// Replace Subject
// =====================================================

interface AvailableSubjectOffering {
  offering_id: number;

  offering_status: string;

  section: {
    section_id: number;
    section_name: string;

    year_level: number | null;

    course_id: number | null;
    course_code: string | null;
    course_name: string | null;
  };

  section_subject: {
    section_subject_id: number;
    status: string;
  };

  faculty: {
    faculty_id: number | null;
    faculty_name: string | null;
  };

  room: {
    room_id: number | null;
    room_name: string | null;
  };

  schedule: {
    days: string | null;
    time: string | null;
  };

  capacity: {
    max_students: number;
    enrolled_count: number;
    available_slots: number;

    is_full: boolean;
  };

  placement_flags?: PlacementFlags;

  is_irregular_placement?: boolean;

  academic_year_id: number;

  semester_id: number;
}

// =====================================================
// AVAILABLE SUBJECT
//
// Used by:
// - Add Subject
// - Replace Subject
// =====================================================

interface AvailableSubject {
  subject_id: number;

  subject_code: string;
  subject_name: string;

  units: number;

  lecture_hours: number | null;
  laboratory_hours: number | null;

  offering_count: number;

  available_offerings: AvailableSubjectOffering[];

  academic_eligibility?: AcademicEligibility;

  // ===================================================
  // OPTIONAL EXPLICIT TYPE
  //
  // If the discovery endpoint exposes the resolved type
  // we use it directly.
  //
  // If not, the Add/Replace mutation backend remains
  // authoritative and resolves it on save.
  // ===================================================

  enrollment_type?: EnrollmentType;

  is_irregular?: boolean;
}

// =====================================================
// AVAILABLE SUBJECTS RESPONSE
// =====================================================

interface AvailableSubjectsResponse {
  success: boolean;

  message?: string;
  error?: string;

  code?: string;

  total_subjects?: number;

  total_offerings?: number;

  subjects?: AvailableSubject[];
}

// =====================================================
// SCHEDULE CONFLICT DETAILS
//
// Used to display backend schedule conflicts without
// duplicating the backend overlap algorithm.
// =====================================================

interface ScheduleConflictItem {
  enrollment_subject_id?: number;

  subject_id?: number;

  subject_code?: string;

  subject_name?: string;

  enrollment_type?: EnrollmentType | string;

  offering_id?: number | null;

  section_id?: number | null;

  section_name?: string | null;

  schedule?: {
    days?: string | null;
    time?: string | null;
  };

  common_days?: string[];
}

// =====================================================
// GENERIC MUTATION RESPONSE
// =====================================================

interface MutationResponse {
  success: boolean;

  message?: string;
  error?: string;

  code?: string;

  ready_for_approval?: boolean;

  validation_errors?: ValidationIssue[];

  errors?: ValidationIssue[];

  academic_eligibility?: AcademicEligibility;

  enrollment_type?: EnrollmentType;

  conflict_count?: number;

  conflicts?: ScheduleConflictItem[];

  selected_offering?: {
    offering_id?: number;

    section_id?: number;

    section_name?: string | null;

    schedule?: {
      days?: string | null;
      time?: string | null;
    };
  };

  replacement_subject?: {
    subject_id?: number;

    subject_code?: string | null;

    enrollment_type?: EnrollmentType;
  };

  enrollment_subject?: {
    enrollment_subject_id?: number;

    subject_id?: number;

    enrollment_type?: EnrollmentType;

    is_irregular?: boolean;
  };

  new_subject?: {
    enrollment_subject_id?: number;

    subject_id?: number;

    subject_code?: string;

    subject_name?: string;

    enrollment_type?: EnrollmentType;

    is_irregular?: boolean;
  };
}

// =====================================================
// BULK SECTION OPTION
// =====================================================

interface BulkSectionOption {
  section_id: number;

  section_name: string;

  year_level: number | null;

  course_id: number | null;
  course_code: string | null;
  course_name: string | null;

  ready_subject_count: number;

  ready_offering_count: number;
}

// =====================================================
// BULK SECTION ASSIGNMENT RESPONSE
// =====================================================

interface BulkSectionAssignmentResponse {
  success: boolean;

  message?: string;
  error?: string;

  code?: string;

  section?: {
    section_id: number;

    section_name: string;
  };

  summary?: {
    total_active_subjects?: number;

    regular_subjects?: number;

    retake_subjects?: number;

    carry_over_subjects?: number;

    assigned?: number;

    already_correct?: number;

    manual_subjects?: number;

    errors?: number;
  };

  errors?: Array<{
    enrollment_subject_id?: number;

    subject_id?: number;

    subject_code?: string;

    enrollment_type?: EnrollmentType | string;

    message?: string;

    code?: string;
  }>;
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
// OFFICIAL ENROLLMENT TYPE NORMALIZER
//
// This is NOT an academic evaluator.
//
// It only safely normalizes the already persisted
// backend value for display.
// =====================================================

function normalizeEnrollmentType(value: unknown): EnrollmentType {
  if (value === "Retake") {
    return "Retake";
  }

  if (value === "Carry Over") {
    return "Carry Over";
  }

  return "Regular";
}

// =====================================================
// COMPONENT
// =====================================================

export default function EnrollmentDetailsR() {
  const navigate = useNavigate();

  const { id } = useParams<{ id: string }>();

  // ===================================================
  // AUTH SESSION
  //
  // Keep these stable for this page mount.
  // ===================================================

  const [user] = useState(() => authService.getSession());

  const [token] = useState(() => authService.getToken());

  const userRole = user?.role;

  const authenticated = Boolean(user && token);

  // ===================================================
  // ENROLLMENT ID
  // ===================================================

  const enrollmentId = useMemo(() => {
    const value = Number(id);

    return Number.isInteger(value) && value > 0 ? value : null;
  }, [id]);

  // =====================================================
  // CORE DATA
  // =====================================================

  const [enrollment, setEnrollment] = useState<EnrollmentDetails | null>(null);

  const [subjects, setSubjects] = useState<EnrollmentSubject[]>([]);

  const [summary, setSummary] = useState<EnrollmentSummary | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  // =====================================================
  // VALIDATION
  // =====================================================

  const [validation, setValidation] = useState<ValidationResponse | null>(null);

  const [validationLoading, setValidationLoading] = useState(false);

  const [validationError, setValidationError] = useState("");

  // =====================================================
  // INDIVIDUAL ASSIGNMENT / CHANGE OFFERING
  //
  // This is used for:
  //
  // Regular
  // Retake
  // Carry Over
  //
  // The backend decides which offerings are valid.
  // =====================================================

  const [selectedSubject, setSelectedSubject] =
    useState<EnrollmentSubject | null>(null);

  const [availableOfferings, setAvailableOfferings] = useState<
    AvailableOffering[]
  >([]);

  const [offeringsLoading, setOfferingsLoading] = useState(false);

  const [selectedOfferingId, setSelectedOfferingId] = useState("");

  const [assignmentReason, setAssignmentReason] = useState(
    "Assigned by Registrar.",
  );

  const [assignmentLoading, setAssignmentLoading] = useState(false);

  // =====================================================
  // BULK SECTION PLACEMENT
  //
  // IMPORTANT:
  //
  // Bulk placement is REGULAR-only.
  //
  // Retake and Carry Over remain individually placed.
  // =====================================================

  const [bulkSectionOpen, setBulkSectionOpen] = useState(false);

  const [bulkSectionOptions, setBulkSectionOptions] = useState<
    BulkSectionOption[]
  >([]);

  const [bulkSectionOptionsLoading, setBulkSectionOptionsLoading] =
    useState(false);

  const [selectedBulkSectionId, setSelectedBulkSectionId] = useState("");

  const [bulkSectionReason, setBulkSectionReason] = useState(
    "Registrar assigned Regular subjects to the selected section.",
  );

  const [bulkSectionLoading, setBulkSectionLoading] = useState(false);

  const [bulkSectionError, setBulkSectionError] = useState("");

  // =====================================================
  // ADD SUBJECT PANEL
  // =====================================================

  const [addSubjectOpen, setAddSubjectOpen] = useState(false);

  const [availableSubjects, setAvailableSubjects] = useState<
    AvailableSubject[]
  >([]);

  const [availableSubjectsLoading, setAvailableSubjectsLoading] =
    useState(false);

  const [selectedAddSubjectId, setSelectedAddSubjectId] = useState("");

  const [selectedAddOfferingId, setSelectedAddOfferingId] = useState("");

  const [addSubjectReason, setAddSubjectReason] = useState(
    "Registrar added subject.",
  );

  const [addSubjectLoading, setAddSubjectLoading] = useState(false);

  // =====================================================
  // REPLACE SUBJECT
  //
  // IMPORTANT:
  //
  // Change Offering:
  //   same enrollment_subject
  //   same subject
  //   placement only changes
  //
  // Replace Subject:
  //   old enrollment_subject -> Dropped
  //   new enrollment_subject -> Enrolled
  //   new subject may resolve as:
  //   Regular / Retake / Carry Over
  // =====================================================

  const [replaceSubjectOpen, setReplaceSubjectOpen] = useState(false);

  const [replaceSourceSubject, setReplaceSourceSubject] =
    useState<EnrollmentSubject | null>(null);

  const [replacementSubjects, setReplacementSubjects] = useState<
    AvailableSubject[]
  >([]);

  const [replacementSubjectsLoading, setReplacementSubjectsLoading] =
    useState(false);

  const [selectedReplacementSubjectId, setSelectedReplacementSubjectId] =
    useState("");

  const [selectedReplacementOfferingId, setSelectedReplacementOfferingId] =
    useState("");

  const [replacementReason, setReplacementReason] = useState(
    "Registrar replaced an incorrectly assigned enrollment subject.",
  );

  const [replacementLoading, setReplacementLoading] = useState(false);

  const [replacementError, setReplacementError] = useState("");

  // =====================================================
  // APPROVAL
  // =====================================================

  const [approvalRemarks, setApprovalRemarks] = useState(
    "Registrar verified enrollment subjects, offerings, academic eligibility, enrollment types, irregular placement, schedule, and capacity.",
  );

  const [approvalLoading, setApprovalLoading] = useState(false);

  // =====================================================
  // REJECTION
  // =====================================================

  const [rejectionRemarks, setRejectionRemarks] = useState("");

  const [rejectionLoading, setRejectionLoading] = useState(false);

  // =====================================================
  // FEEDBACK / REFRESH
  // =====================================================

  const [actionError, setActionError] = useState("");

  // Keep structured backend error details so schedule
  // conflicts can be rendered properly instead of
  // collapsing everything into one text message.
  const [actionErrorDetails, setActionErrorDetails] =
    useState<MutationResponse | null>(null);

  const [successMessage, setSuccessMessage] = useState("");

  const [refreshKey, setRefreshKey] = useState(0);

  // =====================================================
  // AUTH
  // =====================================================

  useEffect(() => {
    if (!authenticated || !user) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (userRole !== "Registrar") {
      navigate(authService.getDashboardRoute(user.role), {
        replace: true,
      });
    }
  }, [authenticated, user, userRole, navigate]);

  // =====================================================
  // UNAUTHORIZED
  // =====================================================

  const handleUnauthorized = useCallback(() => {
    authService.logout();

    navigate("/login", {
      replace: true,
    });
  }, [navigate]);

  // =====================================================
  // REFRESH PAGE DATA
  // =====================================================

  const refresh = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);

  // =====================================================
  // CLEAR GENERAL ACTION ERROR
  // =====================================================

  const clearActionError = useCallback(() => {
    setActionError("");

    setActionErrorDetails(null);
  }, []);

  // =====================================================
  // BUILD HUMAN-READABLE MUTATION ERROR
  //
  // IMPORTANT:
  //
  // The backend remains authoritative.
  //
  // We do NOT recreate:
  // - schedule overlap validation
  // - academic eligibility
  // - capacity validation
  // - enrollment type validation
  //
  // We only display what the backend returns.
  // =====================================================

  const getMutationErrorMessage = useCallback(
    (
      data: MutationResponse | BulkSectionAssignmentResponse,
      fallback: string,
    ) => {
      const messages: string[] = [];

      if (typeof data.message === "string" && data.message.trim()) {
        messages.push(data.message.trim());
      }

      if (typeof data.error === "string" && data.error.trim()) {
        messages.push(data.error.trim());
      }

      if (Array.isArray(data.errors)) {
        for (const issue of data.errors) {
          const message =
            typeof issue?.message === "string" ? issue.message.trim() : "";

          const code = typeof issue?.code === "string" ? issue.code.trim() : "";

          const subjectCode =
            "subject_code" in issue && typeof issue.subject_code === "string"
              ? issue.subject_code.trim()
              : "";

          const text = message || code || subjectCode;

          if (text && !messages.includes(text)) {
            messages.push(text);
          }
        }
      }

      if (
        "validation_errors" in data &&
        Array.isArray(data.validation_errors)
      ) {
        for (const issue of data.validation_errors) {
          const text = issue?.message || issue?.code;

          if (
            typeof text === "string" &&
            text.trim() &&
            !messages.includes(text.trim())
          ) {
            messages.push(text.trim());
          }
        }
      }

      return messages.join(" ") || fallback;
    },
    [],
  );

  // =====================================================
  // LOAD ENROLLMENT DETAILS
  //
  // IMPORTANT:
  //
  // enrollment_type comes from the persisted backend
  // value.
  //
  // We normalize it only for defensive rendering.
  //
  // We DO NOT determine Retake / Carry Over again here.
  // =====================================================

  useEffect(() => {
    if (!authenticated || !user || userRole !== "Registrar") {
      return;
    }

    if (!enrollmentId) {
      setEnrollment(null);

      setSubjects([]);

      setSummary(null);

      setError("Invalid enrollment ID.");

      setLoading(false);

      return;
    }

    const controller = new AbortController();

    const loadEnrollment = async () => {
      try {
        setLoading(true);

        setError("");

        const response = await authService.authFetch(
          `${API_BASE_URL}/${enrollmentId}`,
          {
            method: "GET",

            signal: controller.signal,

            headers: {
              Accept: "application/json",
            },
          },
        );

        if (response.status === 401) {
          handleUnauthorized();

          return;
        }

        const data =
          await readJsonResponse<EnrollmentDetailsResponse>(response);

        if (response.status === 403) {
          throw new Error(data.message || "Registrar access is required.");
        }

        if (!response.ok || !data.success || !data.enrollment) {
          throw new Error(
            data.message || data.error || "Failed to fetch enrollment details.",
          );
        }

        // =============================================
        // NORMAL ENROLLMENT WORKFLOW:
        //
        // First Semester
        // Second Semester
        //
        // Summer is excluded.
        // =============================================

        const semesterId = Number(data.enrollment.academic_period.semester_id);

        if (![1, 2].includes(semesterId)) {
          throw new Error(
            "This enrollment uses an unsupported semester. The PTC Portal enrollment workflow supports only First Semester and Second Semester.",
          );
        }

        // =============================================
        // NORMALIZE SUBJECTS
        // =============================================

        const rawSubjects = Array.isArray(data.subjects) ? data.subjects : [];

        const normalizedSubjects: EnrollmentSubject[] = rawSubjects.map(
          (subject) => {
            const enrollmentType = normalizeEnrollmentType(
              subject.enrollment_type,
            );

            const irregularByType =
              enrollmentType === "Retake" || enrollmentType === "Carry Over";

            const isIrregular =
              subject.is_irregular === true || irregularByType;

            let irregularReason = subject.irregular_reason ?? null;

            if (!irregularReason && enrollmentType === "Retake") {
              irregularReason = "RETAKE";
            }

            if (!irregularReason && enrollmentType === "Carry Over") {
              irregularReason = "CARRY_OVER";
            }

            return {
              ...subject,

              enrollment_type: enrollmentType,

              is_irregular: isIrregular,

              irregular_reason: irregularReason,
            };
          },
        );

        // =============================================
        // DERIVED SUMMARY FALLBACK
        //
        // Normally backend summary is authoritative.
        //
        // These fallbacks keep the UI stable if an
        // older dev response omits a newly-added field.
        // =============================================

        const derivedRegular = normalizedSubjects.filter(
          (subject) => subject.enrollment_type === "Regular",
        ).length;

        const derivedRetake = normalizedSubjects.filter(
          (subject) => subject.enrollment_type === "Retake",
        ).length;

        const derivedCarryOver = normalizedSubjects.filter(
          (subject) => subject.enrollment_type === "Carry Over",
        ).length;

        const derivedIrregular = normalizedSubjects.filter(
          (subject) => subject.is_irregular,
        ).length;

        const derivedAssigned = normalizedSubjects.filter(
          (subject) => subject.assignment_complete,
        ).length;

        const derivedUnassigned = Math.max(
          normalizedSubjects.length - derivedAssigned,
          0,
        );

        const derivedUnits = normalizedSubjects.reduce(
          (total, subject) => total + Number(subject.units || 0),
          0,
        );

        const serverSummary = data.summary;

        const normalizedSummary: EnrollmentSummary = {
          total_subjects: Number(
            serverSummary?.total_subjects ?? normalizedSubjects.length,
          ),

          total_units: Number(serverSummary?.total_units ?? derivedUnits),

          assigned_subjects: Number(
            serverSummary?.assigned_subjects ?? derivedAssigned,
          ),

          unassigned_subjects: Number(
            serverSummary?.unassigned_subjects ?? derivedUnassigned,
          ),

          all_subjects_assigned:
            typeof serverSummary?.all_subjects_assigned === "boolean"
              ? serverSummary.all_subjects_assigned
              : normalizedSubjects.length > 0 && derivedUnassigned === 0,

          regular_subjects: Number(
            serverSummary?.regular_subjects ?? derivedRegular,
          ),

          retake_subjects: Number(
            serverSummary?.retake_subjects ?? derivedRetake,
          ),

          carry_over_subjects: Number(
            serverSummary?.carry_over_subjects ?? derivedCarryOver,
          ),

          irregular_subjects: Number(
            serverSummary?.irregular_subjects ?? derivedIrregular,
          ),

          is_irregular_enrollment:
            typeof serverSummary?.is_irregular_enrollment === "boolean"
              ? serverSummary.is_irregular_enrollment
              : derivedIrregular > 0,
        };

        setEnrollment(data.enrollment);

        setSubjects(normalizedSubjects);

        setSummary(normalizedSummary);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("GET ENROLLMENT DETAILS ERROR:", requestError);

        setEnrollment(null);

        setSubjects([]);

        setSummary(null);

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load enrollment details.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadEnrollment();

    return () => controller.abort();
  }, [
    authenticated,
    enrollmentId,
    user,
    userRole,
    refreshKey,
    handleUnauthorized,
  ]);

  // =====================================================
  // LOAD VALIDATION
  //
  // Backend:
  //
  // - verifies persisted enrollment_type
  // - verifies academic truth
  // - verifies placement
  // - verifies capacity
  // - verifies schedule conflicts
  //
  // Frontend:
  //
  // - normalizes the response
  // - displays it
  // =====================================================

  const loadValidation = useCallback(async () => {
    if (!authenticated || !enrollmentId || !user || userRole !== "Registrar") {
      return;
    }

    try {
      setValidationLoading(true);

      setValidationError("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${enrollmentId}/validate`,
        {
          method: "GET",

          headers: {
            Accept: "application/json",
          },
        },
      );

      if (response.status === 401) {
        handleUnauthorized();

        return;
      }

      const data = await readJsonResponse<RawValidationResponse>(response);

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Failed to validate enrollment.",
        );
      }

      const rawSubjects = Array.isArray(data.subjects) ? data.subjects : [];

      const rawErrors = Array.isArray(data.errors) ? data.errors : [];

      const rawWarnings = Array.isArray(data.warnings) ? data.warnings : [];

      // ===============================================
      // NORMALIZE VALIDATION SUBJECTS
      // ===============================================

      const normalizedSubjects: ValidationSubject[] = rawSubjects.map(
        (item: RawValidationSubject) => {
          const placement = item?.placement || {};

          // =========================================
          // DETAILS ENDPOINT FALLBACK
          //
          // If validation omits a display field, use
          // the persisted enrollment-subject details.
          // =========================================

          const persistedSubject = subjects.find(
            (subject) =>
              Number(subject.enrollment_subject_id) ===
              Number(item?.enrollment_subject_id || 0),
          );

          const enrollmentType = normalizeEnrollmentType(
            item?.enrollment_type ?? persistedSubject?.enrollment_type,
          );

          const offeringId =
            item?.offering_id !== undefined && item?.offering_id !== null
              ? Number(item.offering_id)
              : placement?.offering_id !== undefined &&
                  placement?.offering_id !== null
                ? Number(placement.offering_id)
                : (persistedSubject?.offering.offering_id ?? null);

          const sectionId =
            item?.section_id !== undefined && item?.section_id !== null
              ? Number(item.section_id)
              : placement?.section_id !== undefined &&
                  placement?.section_id !== null
                ? Number(placement.section_id)
                : (persistedSubject?.section.section_id ?? null);

          const sectionSubjectId =
            item?.section_subject_id !== undefined &&
            item?.section_subject_id !== null
              ? Number(item.section_subject_id)
              : placement?.section_subject_id !== undefined &&
                  placement?.section_subject_id !== null
                ? Number(placement.section_subject_id)
                : (persistedSubject?.section_subject.section_subject_id ??
                  null);

          return {
            enrollment_subject_id: Number(item?.enrollment_subject_id || 0),

            subject_id: Number(item?.subject_id || 0),

            subject_code: String(
              item?.subject_code ?? persistedSubject?.subject_code ?? "",
            ),

            subject_name: String(
              item?.subject_name ?? persistedSubject?.subject_name ?? "",
            ),

            units: Number(item?.units ?? persistedSubject?.units ?? 0),

            status: String(
              item?.status ?? persistedSubject?.status ?? "Enrolled",
            ),

            valid: item?.valid === true,

            enrollment_type: enrollmentType,

            placement: {
              offering_id: offeringId,

              section_id: sectionId,

              section_subject_id: sectionSubjectId,

              section_name:
                item?.section_name ??
                placement?.section_name ??
                persistedSubject?.section.section_name ??
                null,
            },

            errors: Array.isArray(item?.errors) ? item.errors : [],

            warnings: Array.isArray(item?.warnings) ? item.warnings : [],
          };
        },
      );

      const validSubjects = normalizedSubjects.filter(
        (subject) => subject.valid,
      ).length;

      const invalidSubjects = normalizedSubjects.length - validSubjects;

      // ===============================================
      // APPROVED ENROLLMENT COMPATIBILITY
      //
      // Older /validate code may return a status-only
      // ENROLLMENT_NOT_PENDING / INVALID_ENROLLMENT_STATUS
      // error after an enrollment is already Approved.
      // That must not make an otherwise valid official
      // enrollment look structurally invalid.
      //
      // We ignore ONLY those approval-state errors for
      // Approved enrollment. Real subject, academic,
      // placement, capacity and schedule errors remain.
      // ===============================================

      const enrollmentIsApproved =
        String(enrollment?.enrollment_status || "") === "Approved";

      const approvalStateOnlyCodes = new Set([
        "ENROLLMENT_NOT_PENDING",
        "INVALID_ENROLLMENT_STATUS",
      ]);

      const effectiveErrors = enrollmentIsApproved
        ? rawErrors.filter(
            (issue) => !approvalStateOnlyCodes.has(String(issue?.code || "")),
          )
        : rawErrors;

      const alreadyApproved =
        typeof data.already_approved === "boolean"
          ? data.already_approved
          : enrollmentIsApproved;

      const effectiveValid = alreadyApproved
        ? effectiveErrors.length === 0 && invalidSubjects === 0
        : typeof data.valid === "boolean"
          ? data.valid
          : effectiveErrors.length === 0 && invalidSubjects === 0;

      const canApprove =
        !alreadyApproved &&
        String(enrollment?.enrollment_status || "") === "Pending" &&
        (typeof data.can_approve === "boolean"
          ? data.can_approve
          : typeof data.ready_for_approval === "boolean"
            ? data.ready_for_approval
            : effectiveValid);

      const validationState =
        data.validation_state ||
        (alreadyApproved
          ? "ALREADY_APPROVED"
          : canApprove
            ? "READY_FOR_APPROVAL"
            : String(enrollment?.enrollment_status || "") === "Pending"
              ? "NOT_READY"
              : "NOT_APPROVABLE");

      const normalizedValidation: ValidationResponse = {
        success: true,

        message: alreadyApproved
          ? "Enrollment is already approved. No additional approval action is required."
          : data.message,

        valid: effectiveValid,

        can_approve: canApprove,

        already_approved: alreadyApproved,

        validation_state: validationState,

        summary: {
          total_records: Number(
            data.summary?.total_records ??
              data.summary?.total_enrolled_subjects ??
              normalizedSubjects.length,
          ),

          active_subjects: Number(
            data.summary?.active_subjects ??
              data.summary?.total_enrolled_subjects ??
              normalizedSubjects.length,
          ),

          total_units: Number(data.summary?.total_units ?? 0),

          valid_subjects: Number(data.summary?.valid_subjects ?? validSubjects),

          invalid_subjects: Number(
            data.summary?.invalid_subjects ?? invalidSubjects,
          ),

          validation_errors: Number(
            alreadyApproved
              ? effectiveErrors.length
              : (data.summary?.validation_errors ??
                  data.summary?.error_count ??
                  effectiveErrors.length),
          ),

          validation_warnings: Number(
            data.summary?.validation_warnings ??
              data.summary?.warning_count ??
              rawWarnings.length,
          ),
        },

        subjects: normalizedSubjects,

        errors: effectiveErrors,

        warnings: rawWarnings,
      };

      setValidation(normalizedValidation);
    } catch (requestError) {
      console.error("VALIDATE ENROLLMENT ERROR:", requestError);

      setValidation(null);

      setValidationError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to validate enrollment.",
      );
    } finally {
      setValidationLoading(false);
    }
  }, [
    authenticated,
    enrollmentId,
    user,
    userRole,
    subjects,
    handleUnauthorized,
  ]);

  // =====================================================
  // AUTOMATIC VALIDATION
  // =====================================================

  useEffect(() => {
    if (!enrollment || !enrollmentId) {
      return;
    }

    if (
      !["Pending", "Approved"].includes(String(enrollment.enrollment_status))
    ) {
      setValidation(null);

      setValidationError("");

      return;
    }

    void loadValidation();
  }, [enrollment, enrollmentId, refreshKey, loadValidation]);

  // =====================================================
  // VALIDATION LOOKUP
  // =====================================================

  const validationByEnrollmentSubjectId = useMemo(() => {
    const map = new Map<number, ValidationSubject>();

    for (const item of validation?.subjects || []) {
      map.set(Number(item.enrollment_subject_id), item);
    }

    return map;
  }, [validation?.subjects]);

  // =====================================================
  // SELECTED INDIVIDUAL OFFERING
  // =====================================================

  const selectedAssignmentOffering = useMemo(() => {
    const offeringId = Number(selectedOfferingId);

    if (!Number.isInteger(offeringId) || offeringId <= 0) {
      return null;
    }

    return (
      availableOfferings.find(
        (offering) => Number(offering.offering_id) === offeringId,
      ) || null
    );
  }, [availableOfferings, selectedOfferingId]);

  // =====================================================
  // SELECTED BULK SECTION
  // =====================================================

  const selectedBulkSection = useMemo(() => {
    const sectionId = Number(selectedBulkSectionId);

    if (!Number.isInteger(sectionId) || sectionId <= 0) {
      return null;
    }

    return (
      bulkSectionOptions.find(
        (section) => Number(section.section_id) === sectionId,
      ) || null
    );
  }, [bulkSectionOptions, selectedBulkSectionId]);

  // =====================================================
  // OPEN INDIVIDUAL ASSIGNMENT / CHANGE OFFERING
  //
  // IMPORTANT:
  //
  // Do NOT restrict this to the student's course.
  //
  // Backend rules:
  //
  // Regular:
  //   same course/year
  //
  // Retake / Carry Over:
  //   valid cross-section/course/year allowed
  //
  // Exact subject + AY + semester remain authoritative.
  // =====================================================

  const openAssignment = async (subject: EnrollmentSubject) => {
    if (!enrollmentId || !enrollment) {
      return;
    }

    try {
      // ===============================================
      // CLOSE OTHER PANELS
      // ===============================================

      setBulkSectionOpen(false);

      setAddSubjectOpen(false);

      setReplaceSubjectOpen(false);

      setSelectedSubject(subject);

      setAvailableOfferings([]);

      setSelectedOfferingId(
        subject.assignment_complete && subject.offering.offering_id
          ? String(subject.offering.offering_id)
          : "",
      );

      setAssignmentReason(
        subject.assignment_complete
          ? `Registrar changed the ${subject.enrollment_type} subject offering.`
          : `Registrar assigned the ${subject.enrollment_type} subject offering.`,
      );

      clearActionError();

      setSuccessMessage("");

      setOfferingsLoading(true);

      const params = new URLSearchParams();

      params.set("subject_id", String(subject.subject_id));

      const response = await authService.authFetch(
        `${API_BASE_URL}/${enrollmentId}/available-offerings?${params.toString()}`,
        {
          method: "GET",

          headers: {
            Accept: "application/json",
          },
        },
      );

      if (response.status === 401) {
        handleUnauthorized();

        return;
      }

      const data = await readJsonResponse<AvailableOfferingsResponse>(response);

      if (response.status === 403) {
        throw new Error(data.message || "Registrar access is required.");
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
            data.error ||
            "Failed to load available subject offerings.",
        );
      }

      // ===============================================
      // DEFENSIVE FILTER
      //
      // NO course/year filter here.
      //
      // Backend has already applied enrollment-type
      // placement policy.
      // ===============================================

      const returnedOfferings = Array.isArray(data.offerings)
        ? data.offerings.filter(
            (offering) =>
              Number(offering.subject.subject_id) ===
                Number(subject.subject_id) &&
              Number(offering.academic_year_id) ===
                Number(enrollment.academic_period.academic_year_id) &&
              Number(offering.semester_id) ===
                Number(enrollment.academic_period.semester_id) &&
              offering.offering_status === "Open" &&
              offering.section_subject.status === "Open" &&
              offering.capacity.available_slots > 0 &&
              !offering.capacity.is_full,
          )
        : [];

      setAvailableOfferings(returnedOfferings);

      const currentOfferingId = subject.offering.offering_id
        ? Number(subject.offering.offering_id)
        : null;

      const currentOfferingStillAvailable =
        currentOfferingId !== null &&
        returnedOfferings.some(
          (offering) => Number(offering.offering_id) === currentOfferingId,
        );

      if (currentOfferingStillAvailable && currentOfferingId !== null) {
        setSelectedOfferingId(String(currentOfferingId));
      } else if (
        !subject.assignment_complete &&
        returnedOfferings.length === 1
      ) {
        setSelectedOfferingId(String(returnedOfferings[0].offering_id));
      } else {
        setSelectedOfferingId("");
      }
    } catch (requestError) {
      console.error("LOAD AVAILABLE OFFERINGS ERROR:", requestError);

      setAvailableOfferings([]);

      setSelectedOfferingId("");

      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load available offerings.",
      );
    } finally {
      setOfferingsLoading(false);
    }
  };

  // =====================================================
  // CLOSE INDIVIDUAL ASSIGNMENT
  // =====================================================

  const closeAssignment = (force = false) => {
    if (assignmentLoading && !force) {
      return;
    }

    setSelectedSubject(null);

    setAvailableOfferings([]);

    setSelectedOfferingId("");

    setAssignmentReason("Assigned by Registrar.");

    if (force) {
      clearActionError();
    }
  };

  // =====================================================
  // ASSIGNMENT MODAL BEHAVIOR
  // =====================================================

  useEffect(() => {
    if (!selectedSubject) {
      return;
    }

    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || assignmentLoading) {
        return;
      }

      setSelectedSubject(null);

      setAvailableOfferings([]);

      setSelectedOfferingId("");

      setAssignmentReason("Assigned by Registrar.");

      clearActionError();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);

      document.body.style.overflow = previousOverflow;
    };
  }, [selectedSubject, assignmentLoading, clearActionError]);

  // =====================================================
  // SAVE INDIVIDUAL ASSIGNMENT / CHANGE OFFERING
  //
  // BODY:
  //
  // {
  //   offering_id,
  //   reason
  // }
  //
  // Frontend never sends:
  //
  // student_id
  // subject_id
  // section_id
  // enrollment_type
  // =====================================================

  const saveAssignment = async () => {
    if (!enrollmentId || !selectedSubject) {
      return;
    }

    const offeringId = Number(selectedOfferingId);

    if (!Number.isInteger(offeringId) || offeringId <= 0) {
      setActionError("Select a valid available offering.");

      setActionErrorDetails(null);

      return;
    }

    if (!selectedAssignmentOffering) {
      setActionError(
        "The selected offering is no longer in the current READY / Open offering list. Reload the assignment choices and select again.",
      );

      setActionErrorDetails(null);

      return;
    }

    if (
      selectedAssignmentOffering.capacity.is_full ||
      selectedAssignmentOffering.capacity.available_slots <= 0
    ) {
      setActionError("The selected offering no longer has available capacity.");

      setActionErrorDetails(null);

      return;
    }

    const cleanReason =
      assignmentReason.trim() ||
      `Registrar assigned the ${selectedSubject.enrollment_type} subject offering.`;

    if (cleanReason.length > 500) {
      setActionError("Assignment reason must not exceed 500 characters.");

      setActionErrorDetails(null);

      return;
    }

    try {
      setAssignmentLoading(true);

      clearActionError();

      setSuccessMessage("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${enrollmentId}/subjects/${selectedSubject.enrollment_subject_id}`,
        {
          method: "PUT",

          headers: {
            Accept: "application/json",

            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            offering_id: offeringId,

            reason: cleanReason,
          }),
        },
      );

      if (response.status === 401) {
        handleUnauthorized();

        return;
      }

      const data = await readJsonResponse<MutationResponse>(response);

      if (!response.ok || !data.success) {
        setActionErrorDetails(data);

        setActionError(
          getMutationErrorMessage(data, "Failed to assign subject offering."),
        );

        return;
      }

      setSuccessMessage(
        data.message ||
          (selectedSubject.assignment_complete
            ? "Subject offering changed successfully."
            : "Subject offering assigned successfully."),
      );

      setActionErrorDetails(null);

      closeAssignment(true);

      refresh();
    } catch (requestError) {
      console.error("ASSIGN SUBJECT OFFERING ERROR:", requestError);

      setActionErrorDetails(null);

      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to assign the selected offering.",
      );
    } finally {
      setAssignmentLoading(false);
    }
  };

  // =====================================================
  // BULK SECTION PLACEMENT
  //
  // IMPORTANT:
  //
  // ONLY persisted Regular subjects participate.
  //
  // Retake:
  //   manual individual placement
  //
  // Carry Over:
  //   manual individual placement
  // =====================================================

  const resetBulkSectionModal = () => {
    setBulkSectionOpen(false);

    setBulkSectionOptions([]);

    setSelectedBulkSectionId("");

    setBulkSectionReason(
      "Registrar assigned Regular subjects to the selected section.",
    );

    setBulkSectionError("");
  };

  // =====================================================
  // CLOSE BULK SECTION MODAL
  // =====================================================

  const closeBulkSectionModal = (force = false) => {
    if (!force && (bulkSectionLoading || bulkSectionOptionsLoading)) {
      return;
    }

    resetBulkSectionModal();
  };

  // =====================================================
  // OPEN BULK SECTION MODAL
  // =====================================================

  const openBulkSectionModal = async () => {
    if (!enrollmentId || !enrollment) {
      return;
    }

    if (enrollment.enrollment_status !== "Pending") {
      setActionError(
        "Bulk section placement is only available for Pending enrollments.",
      );

      setActionErrorDetails(null);

      return;
    }

    // ===============================================
    // PERSISTED REGULAR SUBJECT IDS
    //
    // Do not infer Regular from previous grade state.
    // ===============================================

    const regularSubjectIds = new Set(
      subjects
        .filter(
          (subject) =>
            subject.enrollment_type === "Regular" &&
            subject.status === "Enrolled",
        )
        .map((subject) => Number(subject.subject_id)),
    );

    if (regularSubjectIds.size === 0) {
      setActionError(
        "This enrollment has no active Regular subjects available for bulk section placement. Retake and Carry Over subjects require individual placement.",
      );

      setActionErrorDetails(null);

      return;
    }

    try {
      // ===============================================
      // CLOSE OTHER PANELS
      // ===============================================

      closeAssignment(true);

      setAddSubjectOpen(false);

      setReplaceSubjectOpen(false);

      setBulkSectionOpen(true);

      setBulkSectionOptions([]);

      setSelectedBulkSectionId("");

      setBulkSectionError("");

      clearActionError();

      setSuccessMessage("");

      setBulkSectionOptionsLoading(true);

      const response = await authService.authFetch(
        `${API_BASE_URL}/${enrollmentId}/available-offerings`,
        {
          method: "GET",

          headers: {
            Accept: "application/json",
          },
        },
      );

      if (response.status === 401) {
        handleUnauthorized();

        return;
      }

      const data = await readJsonResponse<AvailableOfferingsResponse>(response);

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
            data.error ||
            "Failed to load sections available for bulk placement.",
        );
      }

      // ===============================================
      // BULK UI DEFENSIVE FILTER
      //
      // Bulk section:
      //
      // Regular only
      // same course
      // same year
      // same AY
      // same semester
      //
      // Backend /assign-section is still authoritative.
      // ===============================================

      const returnedOfferings = Array.isArray(data.offerings)
        ? data.offerings.filter((offering) => {
            const offeringSubjectId = Number(offering.subject.subject_id);

            return (
              regularSubjectIds.has(offeringSubjectId) &&
              (offering.enrollment_type === undefined ||
                normalizeEnrollmentType(offering.enrollment_type) ===
                  "Regular") &&
              Number(offering.academic_year_id) ===
                Number(enrollment.academic_period.academic_year_id) &&
              Number(offering.semester_id) ===
                Number(enrollment.academic_period.semester_id) &&
              Number(offering.section.course_id) ===
                Number(enrollment.course.course_id) &&
              Number(offering.section.year_level) ===
                Number(enrollment.student.year_level) &&
              offering.offering_status === "Open" &&
              offering.section_subject.status === "Open" &&
              offering.capacity.available_slots > 0 &&
              !offering.capacity.is_full
            );
          })
        : [];

      // ===============================================
      // GROUP READY OFFERINGS BY SECTION
      // ===============================================

      const sectionMap = new Map<
        number,
        {
          option: BulkSectionOption;

          subjectIds: Set<number>;
        }
      >();

      for (const offering of returnedOfferings) {
        const sectionId = Number(offering.section.section_id);

        if (!Number.isInteger(sectionId) || sectionId <= 0) {
          continue;
        }

        const existing = sectionMap.get(sectionId);

        if (existing) {
          existing.option.ready_offering_count += 1;

          existing.subjectIds.add(Number(offering.subject.subject_id));

          existing.option.ready_subject_count = existing.subjectIds.size;

          continue;
        }

        const subjectIds = new Set<number>();

        subjectIds.add(Number(offering.subject.subject_id));

        sectionMap.set(sectionId, {
          option: {
            section_id: sectionId,

            section_name: offering.section.section_name,

            year_level: offering.section.year_level,

            course_id: offering.section.course_id,

            course_code: offering.section.course_code,

            course_name: offering.section.course_name,

            ready_subject_count: subjectIds.size,

            ready_offering_count: 1,
          },

          subjectIds,
        });
      }

      const options = Array.from(sectionMap.values())
        .map((entry) => entry.option)
        .sort((a, b) => a.section_name.localeCompare(b.section_name));

      setBulkSectionOptions(options);

      // ===============================================
      // PREFER HOME SECTION WHEN AVAILABLE
      //
      // This does NOT change students.section_id.
      // It only preselects the likely Regular section.
      // ===============================================

      const homeSectionId = enrollment.student_section.section_id
        ? Number(enrollment.student_section.section_id)
        : null;

      const homeSectionIsAvailable =
        homeSectionId !== null &&
        options.some((section) => Number(section.section_id) === homeSectionId);

      if (homeSectionIsAvailable && homeSectionId !== null) {
        setSelectedBulkSectionId(String(homeSectionId));
      } else if (options.length === 1) {
        setSelectedBulkSectionId(String(options[0].section_id));
      }
    } catch (requestError) {
      console.error("LOAD BULK SECTION OPTIONS ERROR:", requestError);

      setBulkSectionOptions([]);

      setSelectedBulkSectionId("");

      setBulkSectionError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load sections available for bulk placement.",
      );
    } finally {
      setBulkSectionOptionsLoading(false);
    }
  };

  // =====================================================
  // SAVE BULK SECTION ASSIGNMENT
  // =====================================================

  const saveBulkSectionAssignment = async () => {
    if (!enrollmentId || !selectedBulkSection) {
      setBulkSectionError("Select a valid section.");

      return;
    }

    const cleanReason =
      bulkSectionReason.trim() ||
      "Registrar assigned Regular subjects to the selected section.";

    if (cleanReason.length > 255) {
      setBulkSectionError("Assignment reason must not exceed 255 characters.");

      return;
    }

    try {
      setBulkSectionLoading(true);

      setBulkSectionError("");

      clearActionError();

      setSuccessMessage("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${enrollmentId}/assign-section`,
        {
          method: "POST",

          headers: {
            Accept: "application/json",

            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            section_id: selectedBulkSection.section_id,

            reason: cleanReason,
          }),
        },
      );

      if (response.status === 401) {
        handleUnauthorized();

        return;
      }

      const data =
        await readJsonResponse<BulkSectionAssignmentResponse>(response);

      if (!response.ok || !data.success) {
        setBulkSectionError(
          getMutationErrorMessage(data, "Bulk section placement failed."),
        );

        return;
      }

      const assignedCount = Number(data.summary?.assigned ?? 0);

      const alreadyCorrectCount = Number(data.summary?.already_correct ?? 0);

      const manualCount = Number(data.summary?.manual_subjects ?? 0);

      const successParts = [
        `${assignedCount} Regular subject${
          assignedCount !== 1 ? "s" : ""
        } assigned.`,

        alreadyCorrectCount > 0
          ? `${alreadyCorrectCount} already correctly placed.`
          : "",

        manualCount > 0
          ? `${manualCount} Retake/Carry Over/manual subject${
              manualCount !== 1 ? "s" : ""
            } left for individual placement.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");

      setSuccessMessage(data.message || successParts);

      closeBulkSectionModal(true);

      refresh();
    } catch (requestError) {
      console.error("BULK SECTION ASSIGNMENT ERROR:", requestError);

      setBulkSectionError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to assign the selected section.",
      );
    } finally {
      setBulkSectionLoading(false);
    }
  };

  // =====================================================
  // BULK SECTION MODAL BEHAVIOR
  // =====================================================

  useEffect(() => {
    if (!bulkSectionOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        bulkSectionLoading ||
        bulkSectionOptionsLoading
      ) {
        return;
      }

      resetBulkSectionModal();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);

      document.body.style.overflow = previousOverflow;
    };
  }, [bulkSectionOpen, bulkSectionLoading, bulkSectionOptionsLoading]);

  // =====================================================
  // ADD SUBJECT
  // =====================================================

  const selectedAddSubject = useMemo(() => {
    const subjectId = Number(selectedAddSubjectId);

    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      return null;
    }

    return (
      availableSubjects.find(
        (subject) => Number(subject.subject_id) === subjectId,
      ) || null
    );
  }, [availableSubjects, selectedAddSubjectId]);

  // =====================================================
  // SELECTED ADD SUBJECT OFFERING
  // =====================================================

  const selectedAddOffering = useMemo(() => {
    const offeringId = Number(selectedAddOfferingId);

    if (
      !selectedAddSubject ||
      !Number.isInteger(offeringId) ||
      offeringId <= 0
    ) {
      return null;
    }

    return (
      selectedAddSubject.available_offerings.find(
        (offering) => Number(offering.offering_id) === offeringId,
      ) || null
    );
  }, [selectedAddSubject, selectedAddOfferingId]);

  // =====================================================
  // OPTIONAL ENROLLMENT TYPE NORMALIZER
  //
  // IMPORTANT:
  //
  // normalizeEnrollmentType() defaults unknown values to
  // Regular because it is used for persisted rows.
  //
  // Discovery candidates are different.
  //
  // If the backend did NOT explicitly return a candidate
  // type, we must NOT invent Regular.
  // =====================================================

  const normalizeOptionalEnrollmentType = (
    value: unknown,
  ): EnrollmentType | null => {
    if (value === "Regular") {
      return "Regular";
    }

    if (value === "Retake") {
      return "Retake";
    }

    if (value === "Carry Over") {
      return "Carry Over";
    }

    const normalized = String(value ?? "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");

    if (normalized === "REGULAR") {
      return "Regular";
    }

    if (normalized === "RETAKE") {
      return "Retake";
    }

    if (normalized === "CARRY_OVER") {
      return "Carry Over";
    }

    return null;
  };

  // =====================================================
  // DISCOVERY SUBJECT TYPE
  //
  // Official persisted type is determined by the
  // mutation backend.
  //
  // For discovery display:
  //
  // 1. Explicit enrollment_type wins.
  // 2. Explicit Retake / Carry Over eligibility may be
  //    shown.
  // 3. Generic eligibility "Regular" is NOT automatically
  //    considered official because an earlier subject can
  //    still resolve as Carry Over during authoritative
  //    mutation validation.
  // =====================================================

  const getCandidateEnrollmentType = (
    subject: AvailableSubject,
  ): EnrollmentType | null => {
    const explicitType = normalizeOptionalEnrollmentType(
      subject.enrollment_type,
    );

    if (explicitType) {
      return explicitType;
    }

    const eligibility = subject.academic_eligibility;

    const eligibilityType = normalizeOptionalEnrollmentType(
      eligibility?.eligibility_type,
    );

    if (eligibilityType === "Retake" || eligibilityType === "Carry Over") {
      return eligibilityType;
    }

    const legacyAttempt = normalizeOptionalEnrollmentType(
      eligibility?.attempt_type,
    );

    if (legacyAttempt === "Retake") {
      return "Retake";
    }

    // ===============================================
    // Do not invent Regular here.
    //
    // Add/Replace mutation will resolve the official
    // enrollment type.
    // ===============================================

    return null;
  };

  // =====================================================
  // ACADEMIC ELIGIBILITY MESSAGE
  // =====================================================

  const getAcademicEligibilityMessage = (
    eligibility: AcademicEligibility | undefined,
  ) => {
    if (!eligibility) {
      return "";
    }

    if (typeof eligibility.reason === "string" && eligibility.reason.trim()) {
      return eligibility.reason.trim();
    }

    const errors = Array.isArray(eligibility.errors) ? eligibility.errors : [];

    return errors
      .map((issue) => issue.message || issue.code)
      .filter(Boolean)
      .join(" ");
  };

  // =====================================================
  // LATEST APPROVED FINAL RATING
  //
  // Official Grade V2 academic result:
  //
  // final_rating
  //
  // We intentionally do NOT use final_grade as the
  // official academic result.
  // =====================================================

  const getLatestApprovedFinalRating = (
    eligibility: AcademicEligibility | undefined,
  ): number | null => {
    if (!eligibility) {
      return null;
    }

    const currentGrade = eligibility.latest_approved_grade;

    if (
      currentGrade?.final_rating !== undefined &&
      currentGrade?.final_rating !== null
    ) {
      const rating = Number(currentGrade.final_rating);

      return Number.isFinite(rating) ? rating : null;
    }

    // ===============================================
    // Legacy container compatibility only.
    //
    // Still only read final_rating.
    // ===============================================

    const previousGrade = eligibility.previous_grade;

    if (
      previousGrade?.final_rating !== undefined &&
      previousGrade?.final_rating !== null
    ) {
      const rating = Number(previousGrade.final_rating);

      return Number.isFinite(rating) ? rating : null;
    }

    return null;
  };

  // =====================================================
  // FILTER DISCOVERED OFFERINGS
  //
  // We keep:
  //
  // same AY
  // same semester
  // Open offering
  // Open section subject
  // capacity available
  //
  // We DO NOT apply a frontend same-course restriction
  // because valid Retake / Carry Over placement may use
  // another course.
  // =====================================================

  const getUsableDiscoveryOfferings = (
    offerings: AvailableSubjectOffering[],
  ) => {
    if (!enrollment) {
      return [];
    }

    return offerings.filter(
      (offering) =>
        Number(offering.academic_year_id) ===
          Number(enrollment.academic_period.academic_year_id) &&
        Number(offering.semester_id) ===
          Number(enrollment.academic_period.semester_id) &&
        offering.offering_status === "Open" &&
        offering.section_subject.status === "Open" &&
        offering.capacity.available_slots > 0 &&
        !offering.capacity.is_full,
    );
  };

  // =====================================================
  // NORMALIZE SUBJECT DISCOVERY RESPONSE
  // =====================================================

  const normalizeAvailableSubjects = (
    source: AvailableSubject[],
  ): AvailableSubject[] => {
    return source.map((subject) => {
      const explicitType = normalizeOptionalEnrollmentType(
        subject.enrollment_type,
      );

      return {
        ...subject,

        enrollment_type: explicitType ?? undefined,

        available_offerings: getUsableDiscoveryOfferings(
          Array.isArray(subject.available_offerings)
            ? subject.available_offerings
            : [],
        ),

        offering_count: getUsableDiscoveryOfferings(
          Array.isArray(subject.available_offerings)
            ? subject.available_offerings
            : [],
        ).length,
      };
    });
  };

  // =====================================================
  // RESET ADD SUBJECT PANEL
  // =====================================================

  const resetAddSubjectPanel = () => {
    setAddSubjectOpen(false);

    setAvailableSubjects([]);

    setSelectedAddSubjectId("");

    setSelectedAddOfferingId("");

    setAddSubjectReason("Registrar added subject.");
  };

  // =====================================================
  // CLOSE ADD SUBJECT
  // =====================================================

  const closeAddSubject = (force = false) => {
    if (!force && (addSubjectLoading || availableSubjectsLoading)) {
      return;
    }

    resetAddSubjectPanel();
  };

  // =====================================================
  // OPEN ADD SUBJECT
  // =====================================================

  const openAddSubject = async () => {
    if (!enrollmentId || !enrollment) {
      return;
    }

    if (
      !["Pending", "Approved"].includes(String(enrollment.enrollment_status))
    ) {
      setActionError(
        `Subjects cannot be added while enrollment status is '${enrollment.enrollment_status}'.`,
      );

      setActionErrorDetails(null);

      return;
    }

    try {
      // ===============================================
      // CLOSE OTHER WORKFLOWS
      // ===============================================

      closeAssignment(true);

      closeBulkSectionModal(true);

      setReplaceSubjectOpen(false);

      setAddSubjectOpen(true);

      setAvailableSubjects([]);

      setSelectedAddSubjectId("");

      setSelectedAddOfferingId("");

      setAddSubjectReason("Registrar added subject.");

      clearActionError();

      setSuccessMessage("");

      setAvailableSubjectsLoading(true);

      const response = await authService.authFetch(
        `${API_BASE_URL}/${enrollmentId}/available-subjects`,
        {
          method: "GET",

          headers: {
            Accept: "application/json",
          },
        },
      );

      if (response.status === 401) {
        handleUnauthorized();

        return;
      }

      const data = await readJsonResponse<AvailableSubjectsResponse>(response);

      if (response.status === 403) {
        throw new Error(data.message || "Registrar access is required.");
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
            data.error ||
            "Failed to load subjects available for addition.",
        );
      }

      const normalized = normalizeAvailableSubjects(
        Array.isArray(data.subjects) ? data.subjects : [],
      );

      setAvailableSubjects(normalized);
    } catch (requestError) {
      console.error("LOAD AVAILABLE SUBJECTS ERROR:", requestError);

      setAvailableSubjects([]);

      setActionErrorDetails(null);

      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load subjects available for addition.",
      );
    } finally {
      setAvailableSubjectsLoading(false);
    }
  };

  // =====================================================
  // ADD SELECTED SUBJECT
  //
  // BODY:
  //
  // {
  //   offering_id,
  //   reason
  // }
  //
  // Backend derives:
  //
  // subject_id
  // enrollment_type
  // section_id
  // section_subject_id
  // irregular placement
  // =====================================================

  const addSelectedSubject = async () => {
    if (!enrollmentId || !selectedAddSubject || !selectedAddOffering) {
      setActionError("Select a subject and one of its available offerings.");

      setActionErrorDetails(null);

      return;
    }

    if (selectedAddSubject.academic_eligibility?.eligible === false) {
      setActionError(
        getAcademicEligibilityMessage(
          selectedAddSubject.academic_eligibility,
        ) || "The selected subject is not academically eligible.",
      );

      setActionErrorDetails(null);

      return;
    }

    const cleanReason = addSubjectReason.trim() || "Registrar added subject.";

    if (cleanReason.length > 500) {
      setActionError("Add Subject reason must not exceed 500 characters.");

      setActionErrorDetails(null);

      return;
    }

    try {
      setAddSubjectLoading(true);

      clearActionError();

      setSuccessMessage("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${enrollmentId}/subjects`,
        {
          method: "POST",

          headers: {
            Accept: "application/json",

            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            offering_id: selectedAddOffering.offering_id,

            reason: cleanReason,
          }),
        },
      );

      if (response.status === 401) {
        handleUnauthorized();

        return;
      }

      const data = await readJsonResponse<MutationResponse>(response);

      if (!response.ok || !data.success) {
        setActionErrorDetails(data);

        setActionError(
          getMutationErrorMessage(data, "Failed to add subject to enrollment."),
        );

        return;
      }

      const addedType =
        data.enrollment_subject?.enrollment_type ??
        data.enrollment_type ??
        null;

      setSuccessMessage(
        data.message ||
          (addedType
            ? `${addedType} subject added to enrollment successfully.`
            : "Subject added to enrollment successfully."),
      );

      setActionErrorDetails(null);

      resetAddSubjectPanel();

      refresh();
    } catch (requestError) {
      console.error("ADD SUBJECT ERROR:", requestError);

      setActionErrorDetails(null);

      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to add the selected subject.",
      );
    } finally {
      setAddSubjectLoading(false);
    }
  };

  // =====================================================
  // REPLACE SUBJECT
  //
  // Backend:
  //
  // PUT
  // /:id/subjects/:enrollmentSubjectId/replace
  //
  // BODY:
  //
  // {
  //   offering_id,
  //   reason
  // }
  //
  // IMPORTANT:
  //
  // This is NOT Change Offering.
  //
  // Change Offering:
  //   same enrollment_subject
  //   same subject_id
  //
  // Replace Subject:
  //   old row becomes Dropped
  //   new enrollment_subject row is created
  // =====================================================

  const selectedReplacementSubject = useMemo(() => {
    const subjectId = Number(selectedReplacementSubjectId);

    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      return null;
    }

    return (
      replacementSubjects.find(
        (subject) => Number(subject.subject_id) === subjectId,
      ) || null
    );
  }, [replacementSubjects, selectedReplacementSubjectId]);

  // =====================================================
  // SELECTED REPLACEMENT OFFERING
  // =====================================================

  const selectedReplacementOffering = useMemo(() => {
    const offeringId = Number(selectedReplacementOfferingId);

    if (
      !selectedReplacementSubject ||
      !Number.isInteger(offeringId) ||
      offeringId <= 0
    ) {
      return null;
    }

    return (
      selectedReplacementSubject.available_offerings.find(
        (offering) => Number(offering.offering_id) === offeringId,
      ) || null
    );
  }, [selectedReplacementSubject, selectedReplacementOfferingId]);

  // =====================================================
  // RESET REPLACE SUBJECT
  // =====================================================

  const resetReplaceSubjectPanel = () => {
    setReplaceSubjectOpen(false);

    setReplaceSourceSubject(null);

    setReplacementSubjects([]);

    setSelectedReplacementSubjectId("");

    setSelectedReplacementOfferingId("");

    setReplacementReason(
      "Registrar replaced an incorrectly assigned enrollment subject.",
    );

    setReplacementError("");
  };

  // =====================================================
  // CLOSE REPLACE SUBJECT
  // =====================================================

  const closeReplaceSubject = (force = false) => {
    if (!force && (replacementLoading || replacementSubjectsLoading)) {
      return;
    }

    resetReplaceSubjectPanel();

    if (force) {
      setActionErrorDetails(null);
    }
  };

  // =====================================================
  // OPEN REPLACE SUBJECT
  // =====================================================

  const openReplaceSubject = async (source: EnrollmentSubject) => {
    if (!enrollmentId || !enrollment) {
      return;
    }

    if (source.status !== "Enrolled") {
      setActionError(
        `Only an active Enrolled subject can be replaced. Current subject status is '${source.status}'.`,
      );

      setActionErrorDetails(null);

      return;
    }

    if (
      !["Pending", "Approved"].includes(String(enrollment.enrollment_status))
    ) {
      setActionError(
        `Subjects cannot be replaced while enrollment status is '${enrollment.enrollment_status}'.`,
      );

      setActionErrorDetails(null);

      return;
    }

    try {
      // ===============================================
      // CLOSE OTHER WORKFLOWS
      // ===============================================

      closeAssignment(true);

      closeBulkSectionModal(true);

      closeAddSubject(true);

      setReplaceSubjectOpen(true);

      setReplaceSourceSubject(source);

      setReplacementSubjects([]);

      setSelectedReplacementSubjectId("");

      setSelectedReplacementOfferingId("");

      setReplacementReason(
        `Registrar replaced ${source.subject_code} because the enrolled subject assignment required correction.`,
      );

      setReplacementError("");

      clearActionError();

      setSuccessMessage("");

      setReplacementSubjectsLoading(true);

      // ===============================================
      // Use subject discovery endpoint.
      //
      // The actual Replace mutation remains
      // authoritative.
      // ===============================================

      const response = await authService.authFetch(
        `${API_BASE_URL}/${enrollmentId}/available-subjects`,
        {
          method: "GET",

          headers: {
            Accept: "application/json",
          },
        },
      );

      if (response.status === 401) {
        handleUnauthorized();

        return;
      }

      const data = await readJsonResponse<AvailableSubjectsResponse>(response);

      if (response.status === 403) {
        throw new Error(data.message || "Registrar access is required.");
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Failed to load replacement subjects.",
        );
      }

      const normalized = normalizeAvailableSubjects(
        Array.isArray(data.subjects) ? data.subjects : [],
      )
        // =============================================
        // Same subject must use Change Offering,
        // not Replace Subject.
        // =============================================
        .filter(
          (subject) => Number(subject.subject_id) !== Number(source.subject_id),
        );

      setReplacementSubjects(normalized);
    } catch (requestError) {
      console.error("LOAD REPLACEMENT SUBJECTS ERROR:", requestError);

      setReplacementSubjects([]);

      setReplacementError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load replacement subjects.",
      );
    } finally {
      setReplacementSubjectsLoading(false);
    }
  };

  // =====================================================
  // REPLACE SUBJECT MODAL BEHAVIOR
  // =====================================================

  useEffect(() => {
    if (!replaceSubjectOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        replacementLoading ||
        replacementSubjectsLoading
      ) {
        return;
      }

      resetReplaceSubjectPanel();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);

      document.body.style.overflow = previousOverflow;
    };
  }, [replaceSubjectOpen, replacementLoading, replacementSubjectsLoading]);

  // =====================================================
  // SAVE REPLACEMENT
  // =====================================================

  const saveReplacementSubject = async () => {
    if (!enrollmentId || !replaceSourceSubject) {
      return;
    }

    if (!selectedReplacementSubject || !selectedReplacementOffering) {
      setReplacementError(
        "Select a replacement subject and one of its available offerings.",
      );

      return;
    }

    if (
      Number(selectedReplacementSubject.subject_id) ===
      Number(replaceSourceSubject.subject_id)
    ) {
      setReplacementError(
        "The replacement must be a different subject. Use Change Offering when only the class placement needs to change.",
      );

      return;
    }

    if (selectedReplacementSubject.academic_eligibility?.eligible === false) {
      setReplacementError(
        getAcademicEligibilityMessage(
          selectedReplacementSubject.academic_eligibility,
        ) || "The replacement subject is not academically eligible.",
      );

      return;
    }

    const cleanReason = replacementReason.trim();

    if (!cleanReason) {
      setReplacementError("Replacement reason is required.");

      return;
    }

    if (cleanReason.length > 500) {
      setReplacementError("Replacement reason must not exceed 500 characters.");

      return;
    }

    const confirmed = window.confirm(
      `Replace ${replaceSourceSubject.subject_code} with ${selectedReplacementSubject.subject_code}? The old enrollment subject will be preserved as Dropped and a new enrollment subject row will be created.`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setReplacementLoading(true);

      setReplacementError("");

      clearActionError();

      setSuccessMessage("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${enrollmentId}/subjects/${replaceSourceSubject.enrollment_subject_id}/replace`,
        {
          method: "PUT",

          headers: {
            Accept: "application/json",

            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            offering_id: selectedReplacementOffering.offering_id,

            reason: cleanReason,
          }),
        },
      );

      if (response.status === 401) {
        handleUnauthorized();

        return;
      }

      const data = await readJsonResponse<MutationResponse>(response);

      if (!response.ok || !data.success) {
        setActionErrorDetails(data);

        setReplacementError(
          getMutationErrorMessage(
            data,
            "Failed to replace enrollment subject.",
          ),
        );

        return;
      }

      const replacementType =
        data.new_subject?.enrollment_type ??
        data.replacement_subject?.enrollment_type ??
        null;

      setSuccessMessage(
        data.message ||
          (replacementType
            ? `Subject replaced successfully. New subject type: ${replacementType}.`
            : "Enrollment subject replaced successfully."),
      );

      setActionErrorDetails(null);

      closeReplaceSubject(true);

      refresh();
    } catch (requestError) {
      console.error("REPLACE SUBJECT ERROR:", requestError);

      setActionErrorDetails(null);

      setReplacementError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to replace the enrollment subject.",
      );
    } finally {
      setReplacementLoading(false);
    }
  };

  // =====================================================
  // APPROVE ENROLLMENT
  // =====================================================

  const approveEnrollment = async () => {
    if (!enrollmentId || !enrollment) {
      return;
    }

    if (enrollment.enrollment_status === "Approved") {
      setActionError("Enrollment is already approved.");

      setActionErrorDetails(null);

      return;
    }

    if (enrollment.enrollment_status !== "Pending") {
      setActionError("Only Pending enrollments can be approved.");

      setActionErrorDetails(null);

      return;
    }

    if (!validation?.can_approve) {
      setActionError(
        "Enrollment is not ready for approval. Resolve all validation errors first.",
      );

      setActionErrorDetails(null);

      return;
    }

    if (rejectionLoading) {
      return;
    }

    try {
      setApprovalLoading(true);

      clearActionError();

      setSuccessMessage("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${enrollmentId}/approve`,
        {
          method: "POST",

          headers: {
            Accept: "application/json",

            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            remarks: approvalRemarks.trim() || undefined,
          }),
        },
      );

      if (response.status === 401) {
        handleUnauthorized();

        return;
      }

      const data = await readJsonResponse<MutationResponse>(response);

      if (!response.ok || !data.success) {
        setActionErrorDetails(data);

        setActionError(
          getMutationErrorMessage(data, "Failed to approve enrollment."),
        );

        return;
      }

      setActionErrorDetails(null);

      setSuccessMessage(data.message || "Enrollment approved successfully.");

      refresh();
    } catch (requestError) {
      console.error("APPROVE ENROLLMENT ERROR:", requestError);

      setActionErrorDetails(null);

      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to approve enrollment.",
      );
    } finally {
      setApprovalLoading(false);
    }
  };

  // =====================================================
  // REJECT ENROLLMENT
  //
  // Only Pending enrollment.
  //
  // Registrar identity comes from JWT.
  // =====================================================

  const rejectEnrollment = async () => {
    if (!enrollmentId || !enrollment) {
      return;
    }

    if (enrollment.enrollment_status !== "Pending") {
      setActionError("Only Pending enrollments can be rejected.");

      setActionErrorDetails(null);

      return;
    }

    const remarks = rejectionRemarks.trim();

    if (!remarks) {
      setActionError("Rejection reason is required.");

      setActionErrorDetails(null);

      return;
    }

    if (remarks.length > 255) {
      setActionError("Rejection reason must not exceed 255 characters.");

      setActionErrorDetails(null);

      return;
    }

    const confirmed = window.confirm(
      "Reject this enrollment? The enrollment record will remain in the system and its subjects will not be deleted.",
    );

    if (!confirmed) {
      return;
    }

    try {
      setRejectionLoading(true);

      clearActionError();

      setSuccessMessage("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${enrollmentId}/reject`,
        {
          method: "POST",

          headers: {
            Accept: "application/json",

            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            remarks,
          }),
        },
      );

      if (response.status === 401) {
        handleUnauthorized();

        return;
      }

      const data = await readJsonResponse<MutationResponse>(response);

      if (response.status === 403) {
        setActionError(
          data.message || data.error || "Registrar access is required.",
        );

        setActionErrorDetails(data);

        return;
      }

      if (!response.ok || !data.success) {
        setActionErrorDetails(data);

        setActionError(
          getMutationErrorMessage(data, "Failed to reject enrollment."),
        );

        return;
      }

      setSuccessMessage(data.message || "Enrollment rejected successfully.");

      setActionErrorDetails(null);

      setRejectionRemarks("");

      refresh();
    } catch (requestError) {
      console.error("REJECT ENROLLMENT ERROR:", requestError);

      setActionErrorDetails(null);

      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to reject enrollment.",
      );
    } finally {
      setRejectionLoading(false);
    }
  };

  // =====================================================
  // DISPLAY HELPERS
  // =====================================================

  const getStatusClass = (value: string) =>
    `status ${String(value).toLowerCase().replace(/\s+/g, "-")}`;

  // =====================================================
  // ENROLLMENT TYPE CLASS
  //
  // Dedicated class.
  //
  // Do not confuse this with enrollment status.
  // =====================================================

  const getEnrollmentTypeClass = (value: EnrollmentType) => {
    const suffix = value.toLowerCase().replace(/\s+/g, "-");

    return `enrollment-type-badge ${suffix}`;
  };

  // =====================================================
  // IRREGULAR REASON LABEL
  // =====================================================

  const getIrregularReasonLabel = (reason: IrregularReason) => {
    if (!reason) {
      return "";
    }

    if (reason === "RETAKE") {
      return "Retake";
    }

    if (reason === "CARRY_OVER") {
      return "Carry Over";
    }

    if (reason === "CROSS_SECTION_PLACEMENT") {
      return "Cross-section placement";
    }

    return String(reason)
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  };

  // =====================================================
  // FORMAT DATE
  // =====================================================

  const formatDate = (value: string | null) => {
    if (!value) {
      return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // =====================================================
  // FORMAT SCHEDULE
  // =====================================================

  const formatSchedule = (days: string | null, time: string | null) => {
    if (!days && !time) {
      return "Not assigned";
    }

    if (!days) {
      return time || "Not assigned";
    }

    if (!time) {
      return days;
    }

    return `${days} • ${time}`;
  };

  // =====================================================
  // FORMAT FINAL RATING
  // =====================================================

  const formatFinalRating = (value: number | null) => {
    if (value === null || !Number.isFinite(value)) {
      return "—";
    }

    return value.toFixed(2);
  };

  // =====================================================
  // OFFICIAL ENROLLMENT TYPE
  //
  // Persisted enrollment_subject value only.
  // =====================================================

  const getEnrollmentType = (subject: EnrollmentSubject): EnrollmentType => {
    return normalizeEnrollmentType(subject.enrollment_type);
  };

  // =====================================================
  // FACULTY DISPLAY NAME
  // =====================================================

  const getSubjectFacultyName = (subject: EnrollmentSubject) => {
    return (
      subject.faculty.faculty_name || subject.faculty.username || "Not Assigned"
    );
  };

  // =====================================================
  // ASSIGNED CLASS SECONDARY LABEL
  // =====================================================

  const getAssignedClassSecondaryLabel = (subject: EnrollmentSubject) => {
    const values: string[] = [];

    if (subject.section.course_code) {
      values.push(subject.section.course_code);
    }

    if (subject.section.year_level) {
      values.push(`Year ${subject.section.year_level}`);
    }

    return values.join(" • ");
  };

  // =====================================================
  // SUBJECT PLACEMENT FLAGS
  //
  // Backend metadata wins when available.
  //
  // Otherwise derive display-only flags from:
  //
  // Home Section
  // Student Course
  // Student Year
  //
  // This does NOT authorize placement.
  // =====================================================

  const getSubjectPlacementFlags = (
    subject: EnrollmentSubject,
  ): PlacementFlags => {
    const backend = subject.placement_flags;

    const homeSectionId = enrollment?.student_section.section_id;

    const assignedSectionId = subject.section.section_id;

    const studentCourseId = enrollment?.course.course_id;

    const assignedCourseId = subject.section.course_id;

    const studentYearLevel = enrollment?.student.year_level;

    const assignedYearLevel = subject.section.year_level;

    return {
      cross_section:
        typeof backend?.cross_section === "boolean"
          ? backend.cross_section
          : homeSectionId !== null &&
            homeSectionId !== undefined &&
            assignedSectionId !== null &&
            Number(assignedSectionId) !== Number(homeSectionId),

      cross_course:
        typeof backend?.cross_course === "boolean"
          ? backend.cross_course
          : studentCourseId !== null &&
            studentCourseId !== undefined &&
            assignedCourseId !== null &&
            assignedCourseId !== undefined &&
            Number(assignedCourseId) !== Number(studentCourseId),

      cross_year:
        typeof backend?.cross_year === "boolean"
          ? backend.cross_year
          : studentYearLevel !== null &&
            studentYearLevel !== undefined &&
            assignedYearLevel !== null &&
            assignedYearLevel !== undefined &&
            Number(assignedYearLevel) !== Number(studentYearLevel),
    };
  };

  // =====================================================
  // OFFERING PLACEMENT FLAGS
  //
  // Used by:
  //
  // Change Offering
  // Add Subject
  // Replace Subject
  // =====================================================

  const getOfferingPlacementFlags = (
    offering: AvailableOffering | AvailableSubjectOffering,
  ): PlacementFlags => {
    const backend = offering.placement_flags;

    const homeSectionId = enrollment?.student_section.section_id;

    const studentCourseId = enrollment?.course.course_id;

    const studentYearLevel = enrollment?.student.year_level;

    return {
      cross_section:
        typeof backend?.cross_section === "boolean"
          ? backend.cross_section
          : homeSectionId !== null &&
            homeSectionId !== undefined &&
            Number(offering.section.section_id) !== Number(homeSectionId),

      cross_course:
        typeof backend?.cross_course === "boolean"
          ? backend.cross_course
          : studentCourseId !== null &&
            studentCourseId !== undefined &&
            offering.section.course_id !== null &&
            Number(offering.section.course_id) !== Number(studentCourseId),

      cross_year:
        typeof backend?.cross_year === "boolean"
          ? backend.cross_year
          : studentYearLevel !== null &&
            studentYearLevel !== undefined &&
            offering.section.year_level !== null &&
            Number(offering.section.year_level) !== Number(studentYearLevel),
    };
  };

  // =====================================================
  // PLACEMENT FLAG LABELS
  // =====================================================

  const getPlacementFlagLabels = (flags: PlacementFlags) => {
    const labels: string[] = [];

    if (flags.cross_section) {
      labels.push("CROSS SECTION");
    }

    if (flags.cross_course) {
      labels.push("CROSS COURSE");
    }

    if (flags.cross_year) {
      labels.push("CROSS YEAR");
    }

    return labels;
  };

  // =====================================================
  // CANDIDATE TYPE DISPLAY
  // =====================================================

  const getCandidateTypeLabel = (subject: AvailableSubject) => {
    const type = getCandidateEnrollmentType(subject);

    if (type) {
      return type;
    }

    if (subject.academic_eligibility?.eligible === false) {
      return "Blocked";
    }

    return "Eligible";
  };

  // =====================================================
  // HOME SECTION LABEL
  // =====================================================

  const homeSectionLabel = enrollment?.student_section.section_name
    ? `${enrollment.student_section.section_name}${
        enrollment.student_section.section_id !== null
          ? ` (#${enrollment.student_section.section_id})`
          : ""
      }`
    : "Not Assigned";

  // =====================================================
  // OFFICIAL ASSIGNED SECTION PLACEMENTS
  //
  // These come from enrollment_subjects.
  //
  // They do NOT modify the Home Section.
  // =====================================================

  const officialSectionPlacements = useMemo(() => {
    const activeStatuses = new Set([
      "Enrolled",
      "Completed",
      "Failed",
      "Incomplete",
    ]);

    const map = new Map<
      number,
      {
        sectionId: number;

        sectionName: string;

        courseCode: string | null;

        yearLevel: number | null;
      }
    >();

    subjects.forEach((subject) => {
      if (!activeStatuses.has(String(subject.status))) {
        return;
      }

      if (
        subject.section.section_id === null ||
        !subject.section.section_name
      ) {
        return;
      }

      const sectionId = Number(subject.section.section_id);

      map.set(sectionId, {
        sectionId,

        sectionName: subject.section.section_name,

        courseCode: subject.section.course_code ?? null,

        yearLevel: subject.section.year_level ?? null,
      });
    });

    return Array.from(map.values()).sort((a, b) =>
      a.sectionName.localeCompare(b.sectionName),
    );
  }, [subjects]);

  // =====================================================
  // ASSIGNED SECTION LABEL
  // =====================================================

  const officialSectionLabel =
    officialSectionPlacements.length === 0
      ? "Not Assigned"
      : officialSectionPlacements.length === 1
        ? `${officialSectionPlacements[0].sectionName} (#${officialSectionPlacements[0].sectionId})`
        : officialSectionPlacements
            .map((section) => `${section.sectionName} (#${section.sectionId})`)
            .join(", ");

  // =====================================================
  // ENROLLMENT COMPOSITION
  // =====================================================

  const regularSubjectCount =
    summary?.regular_subjects ??
    subjects.filter((subject) => subject.enrollment_type === "Regular").length;

  const retakeSubjectCount =
    summary?.retake_subjects ??
    subjects.filter((subject) => subject.enrollment_type === "Retake").length;

  const carryOverSubjectCount =
    summary?.carry_over_subjects ??
    subjects.filter((subject) => subject.enrollment_type === "Carry Over")
      .length;

  const irregularSubjectCount =
    summary?.irregular_subjects ??
    subjects.filter((subject) => subject.is_irregular).length;

  const isIrregularEnrollment =
    summary?.is_irregular_enrollment ?? irregularSubjectCount > 0;

  // =====================================================
  // REGULAR / MANUAL SUBJECT COUNTS
  //
  // Used by Bulk Section UI.
  // =====================================================

  const activeRegularSubjects = subjects.filter(
    (subject) =>
      subject.status === "Enrolled" && subject.enrollment_type === "Regular",
  );

  const activeManualSubjects = subjects.filter(
    (subject) =>
      subject.status === "Enrolled" && subject.enrollment_type !== "Regular",
  );

  // =====================================================
  // SCHEDULE CONFLICT DATA
  //
  // Part 4 will render this as a structured error.
  // =====================================================

  const actionScheduleConflicts = Array.isArray(actionErrorDetails?.conflicts)
    ? actionErrorDetails.conflicts
    : [];

  // =====================================================
  // GUARD
  // =====================================================

  if (!authenticated || !user || userRole !== "Registrar") {
    return null;
  }

  // =====================================================
  // LOADING
  // =====================================================

  if (loading) {
    return (
      <DashboardLayout>
        <div className="registrar-enrollment-details">
          <div className="enrollment-details-loading">
            Loading enrollment details...
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // =====================================================
  // ERROR
  // =====================================================

  if (error || !enrollment) {
    return (
      <DashboardLayout>
        <div className="registrar-enrollment-details">
          <div className="enrollment-details-back-row">
            <button
              type="button"
              className="back-btn"
              onClick={() => navigate("/registrar/enrollment/management")}
            >
              ← Back to Enrollment Management
            </button>
          </div>

          <div className="enrollment-details-error">
            <h2>Unable to Load Enrollment</h2>

            <p>{error || "Enrollment record not found."}</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <DashboardLayout>
      <div className="registrar-enrollment-details">
        {/* =================================================
            PAGE HEADER
        ================================================= */}

        <div className="enrollment-details-back-row">
          <button
            type="button"
            className="back-btn"
            onClick={() => navigate("/registrar/enrollment/management")}
          >
            ← Back to Enrollment Management
          </button>
        </div>

        <section className="enrollment-details-header">
          <div className="enrollment-details-identity">
            <div
              className="enrollment-details-avatar"
              aria-hidden="true"
            >
              {enrollment.student.first_name
                ?.charAt(0)
                .toUpperCase() || "S"}
            </div>

            <div className="enrollment-details-identity-copy">
              <span className="enrollment-details-eyebrow">
                Enrollment Review
              </span>

              <div className="enrollment-details-name-row">
                <h1>{enrollment.student.student_name}</h1>

                <div className="enrollment-header-badges">
                  <span
                    className={getStatusClass(
                      enrollment.enrollment_status,
                    )}
                  >
                    {enrollment.enrollment_status}
                  </span>

                  {isIrregularEnrollment && (
                    <span className="irregular-badge">IRREGULAR</span>
                  )}
                </div>
              </div>

              <p>{enrollment.student.student_number}</p>
            </div>
          </div>

          <div className="enrollment-details-header-summary">
            <div>
              <span>Course</span>
              <strong>{enrollment.course.course_code || "—"}</strong>
            </div>

            <div>
              <span>Year Level</span>
              <strong>
                {enrollment.student.year_level
                  ? `Year ${enrollment.student.year_level}`
                  : "—"}
              </strong>
            </div>

            <div>
              <span>Academic Year</span>
              <strong>
                {enrollment.academic_period.academic_year}
              </strong>
            </div>

            <div>
              <span>Semester</span>
              <strong>
                {enrollment.academic_period.semester_name}
              </strong>
            </div>
          </div>
        </section>

        {/* =================================================
            SUCCESS
        ================================================= */}

        {successMessage && (
          <div className="remarks-box enrollment-success-message">
            <strong>{successMessage}</strong>
          </div>
        )}

        {/* =================================================
            GLOBAL ACTION ERROR
        ================================================= */}

        {actionError && (
          <div className="enrollment-details-error">
            <strong>Action could not be completed</strong>

            <p>{actionError}</p>

            {actionErrorDetails?.code && (
              <small>Code: {actionErrorDetails.code}</small>
            )}

            {actionScheduleConflicts.length > 0 && (
              <div className="schedule-conflict-list">
                <strong>Schedule Conflicts</strong>

                {actionScheduleConflicts.map((conflict, index) => (
                  <div
                    key={`global-conflict-${
                      conflict.enrollment_subject_id ?? index
                    }`}
                    className="schedule-conflict-item"
                  >
                    <div>
                      <strong>
                        {conflict.subject_code ||
                          `Subject #${conflict.subject_id ?? "—"}`}
                      </strong>

                      {conflict.subject_name && (
                        <span>{conflict.subject_name}</span>
                      )}
                    </div>

                    <div>
                      <span>Section</span>

                      <strong>{conflict.section_name || "—"}</strong>
                    </div>

                    <div>
                      <span>Schedule</span>

                      <strong>
                        {formatSchedule(
                          conflict.schedule?.days ?? null,
                          conflict.schedule?.time ?? null,
                        )}
                      </strong>
                    </div>

                    {Array.isArray(conflict.common_days) &&
                      conflict.common_days.length > 0 && (
                        <div>
                          <span>Conflicting Day</span>

                          <strong>{conflict.common_days.join(", ")}</strong>
                        </div>
                      )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* =================================================
            STUDENT INFORMATION
        ================================================= */}

        <div className="enrollment-details-card">
          <div className="details-card-header">
            <h2>Student Information</h2>
          </div>

          <div className="details-grid">
            <div className="detail-item">
              <span>Student Number</span>

              <strong>{enrollment.student.student_number}</strong>
            </div>

            <div className="detail-item">
              <span>Student Name</span>

              <strong>{enrollment.student.student_name}</strong>
            </div>

            <div className="detail-item">
              <span>Year Level</span>

              <strong>
                {enrollment.student.year_level
                  ? `Year ${enrollment.student.year_level}`
                  : "—"}
              </strong>
            </div>

            <div className="detail-item">
              <span>Gender</span>

              <strong>{enrollment.student.gender || "—"}</strong>
            </div>

            <div className="detail-item">
              <span>Contact Number</span>

              <strong>{enrollment.student.contact_number || "—"}</strong>
            </div>

            <div className="detail-item">
              <span>Email</span>

              <strong>{enrollment.student.email || "—"}</strong>
            </div>
          </div>
        </div>

        {/* =================================================
            ENROLLMENT INFORMATION
        ================================================= */}

        <div className="enrollment-details-card">
          <div className="details-card-header">
            <div>
              <h2>Enrollment Information</h2>

              <span>
                Home academic information and actual subject placement are shown
                separately.
              </span>
            </div>

            {isIrregularEnrollment && (
              <span className="irregular-badge">IRREGULAR ENROLLMENT</span>
            )}
          </div>

          <div className="details-grid">
            <div className="detail-item">
              <span>Course</span>

              <strong>
                {enrollment.course.course_code || "—"}

                {enrollment.course.course_name
                  ? ` — ${enrollment.course.course_name}`
                  : ""}
              </strong>
            </div>

            <div className="detail-item">
              <span>Home Section</span>

              <strong>{homeSectionLabel}</strong>

              <small>
                Student profile reference. Individual irregular placement does
                not change this.
              </small>
            </div>

            <div className="detail-item">
              <span>Assigned Section(s)</span>

              <strong>{officialSectionLabel}</strong>
            </div>

            <div className="detail-item">
              <span>Enrollment Classification</span>

              <strong>{isIrregularEnrollment ? "Irregular" : "Regular"}</strong>
            </div>

            <div className="detail-item">
              <span>Academic Year</span>

              <strong>{enrollment.academic_period.academic_year}</strong>
            </div>

            <div className="detail-item">
              <span>Semester</span>

              <strong>{enrollment.academic_period.semester_name}</strong>
            </div>

            <div className="detail-item">
              <span>Total Subjects</span>

              <strong>{summary?.total_subjects ?? subjects.length}</strong>
            </div>

            <div className="detail-item">
              <span>Total Units</span>

              <strong>{summary?.total_units ?? 0}</strong>
            </div>

            <div className="detail-item">
              <span>Regular</span>

              <strong>{regularSubjectCount}</strong>
            </div>

            <div className="detail-item">
              <span>Retake</span>

              <strong>{retakeSubjectCount}</strong>
            </div>

            <div className="detail-item">
              <span>Carry Over</span>

              <strong>{carryOverSubjectCount}</strong>
            </div>

            <div className="detail-item">
              <span>Irregular Subjects</span>

              <strong>{irregularSubjectCount}</strong>
            </div>

            <div className="detail-item">
              <span>Assigned</span>

              <strong>{summary?.assigned_subjects ?? 0}</strong>
            </div>

            <div className="detail-item">
              <span>Unassigned</span>

              <strong>{summary?.unassigned_subjects ?? 0}</strong>
            </div>

            <div className="detail-item">
              <span>Created</span>

              <strong>{formatDate(enrollment.created_at)}</strong>
            </div>

            <div className="detail-item">
              <span>Approved By</span>

              <strong>{enrollment.approval.approved_by_username || "—"}</strong>
            </div>

            <div className="detail-item">
              <span>Approved At</span>

              <strong>{formatDate(enrollment.approval.approved_at)}</strong>
            </div>
          </div>

          {enrollment.remarks && (
            <div className="remarks-box">
              <span>Remarks</span>

              <p>{enrollment.remarks}</p>
            </div>
          )}
        </div>

        {/* =================================================
            ENROLLMENT VALIDATION
        ================================================= */}

        <div className="enrollment-details-card">
          <div className="details-card-header">
            <div>
              <h2>Enrollment Validation</h2>

              <span>
                Academic eligibility, persisted enrollment type, placement,
                capacity, and schedule conflicts are validated by the backend.
              </span>
            </div>

            <button
              type="button"
              className="subject-action-btn"
              disabled={
                validationLoading ||
                !["Pending", "Approved"].includes(
                  String(enrollment.enrollment_status),
                )
              }
              onClick={() => void loadValidation()}
            >
              {validationLoading ? "Validating..." : "Validate"}
            </button>
          </div>

          {validationError && (
            <div className="enrollment-details-error">
              <p>{validationError}</p>
            </div>
          )}

          {validation && (
            <>
              {validation.already_approved ? (
                <div className="remarks-box">
                  <span>Enrollment Status</span>

                  <p>
                    <strong>✓ Enrollment Already Approved</strong>
                  </p>

                  <p>
                    This enrollment has already completed Registrar approval. No
                    additional approval action is required.
                  </p>
                </div>
              ) : validation.can_approve ? (
                <div className="remarks-box">
                  <span>Approval Validation</span>

                  <p>
                    <strong>✓ READY FOR APPROVAL</strong>
                  </p>

                  <p>All required enrollment validation checks passed.</p>
                </div>
              ) : (
                <div className="remarks-box">
                  <span>Approval Validation</span>

                  <p>
                    <strong>NOT READY FOR APPROVAL</strong>
                  </p>

                  <p>
                    Resolve the validation errors below before approving this
                    enrollment.
                  </p>
                </div>
              )}

              <div className="details-grid">
                <div className="detail-item">
                  <span>Validation Status</span>

                  <strong>{validation.valid ? "VALID" : "INVALID"}</strong>
                </div>

                <div className="detail-item">
                  <span>Approval State</span>

                  <strong>
                    {validation.already_approved
                      ? "ALREADY APPROVED"
                      : validation.can_approve
                        ? "READY"
                        : "NOT READY"}
                  </strong>
                </div>

                <div className="detail-item">
                  <span>Active Subjects</span>

                  <strong>{validation.summary?.active_subjects ?? 0}</strong>
                </div>

                <div className="detail-item">
                  <span>Valid Subjects</span>

                  <strong>{validation.summary?.valid_subjects ?? 0}</strong>
                </div>

                <div className="detail-item">
                  <span>Invalid Subjects</span>

                  <strong>{validation.summary?.invalid_subjects ?? 0}</strong>
                </div>

                <div className="detail-item">
                  <span>Total Units</span>

                  <strong>{validation.summary?.total_units ?? 0}</strong>
                </div>

                <div className="detail-item">
                  <span>Errors</span>

                  <strong>{validation.summary?.validation_errors ?? 0}</strong>
                </div>

                <div className="detail-item">
                  <span>Warnings</span>

                  <strong>
                    {validation.summary?.validation_warnings ?? 0}
                  </strong>
                </div>
              </div>
            </>
          )}

          {validation && (validation.errors?.length || 0) > 0 && (
            <div className="remarks-box">
              <span>Validation Errors</span>

              <ul>
                {(validation.errors || []).map((issue, index) => (
                  <li key={`${issue.code || "error"}-${index}`}>
                    {issue.message || issue.code || "Validation error"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {validation && (validation.warnings?.length || 0) > 0 && (
            <div className="remarks-box">
              <span>Validation Warnings</span>

              <ul>
                {(validation.warnings || []).map((issue, index) => (
                  <li key={`${issue.code || "warning"}-${index}`}>
                    {issue.message || issue.code || "Validation warning"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* =================================================
            ENROLLED SUBJECTS
        ================================================= */}

        <div className="enrollment-details-card">
          <div className="details-card-header">
            <div>
              <h2>Enrolled Subjects</h2>

              <span>
                {summary?.total_subjects ?? subjects.length} active subject
                {(summary?.total_subjects ?? subjects.length) !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="subjects-header-actions">
              <button
                type="button"
                className="subject-action-btn bulk-section-btn"
                disabled={
                  bulkSectionLoading ||
                  bulkSectionOptionsLoading ||
                  enrollment.enrollment_status !== "Pending" ||
                  activeRegularSubjects.length === 0
                }
                onClick={() => void openBulkSectionModal()}
              >
                {bulkSectionOptionsLoading
                  ? "Loading Sections..."
                  : "Assign Regular Section"}
              </button>

              <button
                type="button"
                className="subject-action-btn"
                disabled={
                  addSubjectLoading ||
                  availableSubjectsLoading ||
                  !["Pending", "Approved"].includes(
                    String(enrollment.enrollment_status),
                  )
                }
                onClick={() => void openAddSubject()}
              >
                {availableSubjectsLoading ? "Loading..." : "+ Add Subject"}
              </button>
            </div>
          </div>

          <div className="subjects-table-wrapper">
            <table className="subjects-table">
              <thead>
                <tr>
                  <th>Code</th>

                  <th>Subject</th>

                  <th>Type</th>

                  <th>Units</th>

                  <th>Assigned Class</th>

                  <th>Schedule</th>

                  <th>Faculty</th>

                  <th>Room</th>

                  <th>Capacity</th>

                  <th>Validation</th>

                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {subjects.length === 0 && (
                  <tr>
                    <td colSpan={11} className="subjects-empty">
                      No enrolled subjects found.
                    </td>
                  </tr>
                )}

                {subjects.map((subject) => {
                  const validationSubject = validationByEnrollmentSubjectId.get(
                    subject.enrollment_subject_id,
                  );

                  const enrollmentType = getEnrollmentType(subject);

                  const placementFlags = getSubjectPlacementFlags(subject);

                  const placementFlagLabels =
                    getPlacementFlagLabels(placementFlags);

                  const assignedSecondary =
                    getAssignedClassSecondaryLabel(subject);

                  const editable =
                    subject.status === "Enrolled" &&
                    ["Pending", "Approved"].includes(
                      String(enrollment.enrollment_status),
                    );

                  return (
                    <tr
                      key={subject.enrollment_subject_id}
                      className={
                        subject.is_irregular ? "subject-row-irregular" : ""
                      }
                    >
                      <td>
                        <strong>{subject.subject_code}</strong>
                      </td>

                      <td>
                        <div className="subject-name-cell">
                          <strong>{subject.subject_name}</strong>

                          <small>{subject.status}</small>

                          {subject.is_irregular && subject.irregular_reason && (
                            <small className="subject-irregular-reason">
                              {getIrregularReasonLabel(
                                subject.irregular_reason,
                              )}
                            </small>
                          )}
                        </div>
                      </td>

                      <td>
                        <div className="subject-type-cell">
                          <span
                            className={getEnrollmentTypeClass(enrollmentType)}
                          >
                            {enrollmentType}
                          </span>

                          {subject.is_irregular && (
                            <span className="irregular-badge compact">
                              IRREGULAR
                            </span>
                          )}
                        </div>
                      </td>

                      <td>{subject.units}</td>

                      <td>
                        <div className="assigned-class-cell">
                          <strong>
                            {subject.section.section_name || "Not Assigned"}
                          </strong>

                          {assignedSecondary && (
                            <small>{assignedSecondary}</small>
                          )}

                          {placementFlagLabels.length > 0 && (
                            <div className="placement-flags">
                              {placementFlagLabels.map((flag) => (
                                <span
                                  key={`${subject.enrollment_subject_id}-${flag}`}
                                  className={`placement-flag ${flag
                                    .toLowerCase()
                                    .replace(/\s+/g, "-")}`}
                                >
                                  {flag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>

                      <td>
                        {formatSchedule(
                          subject.offering.schedule_days,
                          subject.offering.schedule_time,
                        )}
                      </td>

                      <td>{getSubjectFacultyName(subject)}</td>

                      <td>{subject.room.room_name || "—"}</td>

                      <td>
                        {subject.offering.max_students !== null
                          ? `${subject.offering.enrolled_count}/${subject.offering.max_students}`
                          : "—"}
                      </td>

                      <td>
                        <div className="subject-validation-cell">
                          {validationLoading ? (
                            <span>Checking...</span>
                          ) : validationSubject ? (
                            <>
                              <span
                                className={getStatusClass(
                                  validationSubject.valid ? "Valid" : "Invalid",
                                )}
                              >
                                {validationSubject.valid ? "VALID" : "INVALID"}
                              </span>

                              {validationSubject.errors.length > 0 && (
                                <small>
                                  {validationSubject.errors
                                    .map((item) => item.message || item.code)
                                    .filter(Boolean)
                                    .join(" • ")}
                                </small>
                              )}
                            </>
                          ) : (
                            "—"
                          )}
                        </div>
                      </td>

                      <td>
                        {editable ? (
                          <div className="subject-action-group">
                            <button
                              type="button"
                              className="subject-action-btn"
                              disabled={assignmentLoading || replacementLoading}
                              onClick={() => void openAssignment(subject)}
                            >
                              {subject.assignment_complete
                                ? "Change Offering"
                                : "Assign Offering"}
                            </button>

                            <button
                              type="button"
                              className="subject-action-btn subject-replace-btn"
                              disabled={assignmentLoading || replacementLoading}
                              onClick={() => void openReplaceSubject(subject)}
                            >
                              Replace Subject
                            </button>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* =================================================
            ADD SUBJECT PANEL
        ================================================= */}

        {addSubjectOpen && (
          <div className="enrollment-details-card">
            <div className="details-card-header">
              <div>
                <h2>Add Subject</h2>

                <span>
                  Select an academically eligible subject and one valid Open
                  offering. The backend determines the official Regular, Retake,
                  or Carry Over enrollment type.
                </span>
              </div>

              <button
                type="button"
                className="subject-action-btn"
                disabled={addSubjectLoading || availableSubjectsLoading}
                onClick={() => closeAddSubject()}
              >
                Close
              </button>
            </div>

            {availableSubjectsLoading ? (
              <div className="enrollment-details-loading">
                Loading subjects available for addition...
              </div>
            ) : (
              <>
                <div className="details-grid">
                  <div className="detail-item">
                    <span>Subject</span>

                    <select
                      value={selectedAddSubjectId}
                      disabled={addSubjectLoading}
                      onChange={(event) => {
                        setSelectedAddSubjectId(event.target.value);

                        setSelectedAddOfferingId("");

                        clearActionError();
                      }}
                    >
                      <option value="">Select subject</option>

                      {availableSubjects.map((subject) => {
                        const eligibility = subject.academic_eligibility;

                        const candidateLabel = getCandidateTypeLabel(subject);

                        return (
                          <option
                            key={subject.subject_id}
                            value={subject.subject_id}
                            disabled={eligibility?.eligible === false}
                          >
                            {subject.subject_code} — {subject.subject_name} ·{" "}
                            {subject.units} unit
                            {subject.units !== 1 ? "s" : ""} · {candidateLabel}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="detail-item">
                    <span>Offering</span>

                    <select
                      value={selectedAddOfferingId}
                      disabled={addSubjectLoading || !selectedAddSubject}
                      onChange={(event) => {
                        setSelectedAddOfferingId(event.target.value);

                        clearActionError();
                      }}
                    >
                      <option value="">Select offering</option>

                      {(selectedAddSubject?.available_offerings || []).map(
                        (offering) => (
                          <option
                            key={offering.offering_id}
                            value={offering.offering_id}
                          >
                            #{offering.offering_id} ·{" "}
                            {offering.section.section_name}
                            {offering.section.course_code
                              ? ` · ${offering.section.course_code}`
                              : ""}
                            {offering.section.year_level
                              ? ` · Year ${offering.section.year_level}`
                              : ""}
                            {" · "}
                            {offering.faculty.faculty_name ||
                              "Faculty not assigned"}
                            {" · "}
                            {formatSchedule(
                              offering.schedule.days,
                              offering.schedule.time,
                            )}
                            {" · "}
                            {offering.capacity.available_slots} slot
                            {offering.capacity.available_slots !== 1 ? "s" : ""}
                          </option>
                        ),
                      )}
                    </select>
                  </div>

                  <div className="detail-item">
                    <span>Reason</span>

                    <textarea
                      value={addSubjectReason}
                      disabled={addSubjectLoading}
                      maxLength={500}
                      onChange={(event) =>
                        setAddSubjectReason(event.target.value)
                      }
                    />

                    <small>
                      {addSubjectReason.length}
                      /500 characters
                    </small>
                  </div>
                </div>

                {selectedAddSubject && (
                  <div className="remarks-box">
                    <span>Subject Eligibility</span>

                    <p>
                      <strong>
                        {selectedAddSubject.academic_eligibility?.eligible ===
                        false
                          ? "BLOCKED"
                          : "ELIGIBLE"}
                      </strong>
                      {" · "}
                      Candidate:{" "}
                      <strong>
                        {getCandidateTypeLabel(selectedAddSubject)}
                      </strong>
                    </p>

                    {getAcademicEligibilityMessage(
                      selectedAddSubject.academic_eligibility,
                    ) && (
                      <p>
                        {getAcademicEligibilityMessage(
                          selectedAddSubject.academic_eligibility,
                        )}
                      </p>
                    )}

                    {getLatestApprovedFinalRating(
                      selectedAddSubject.academic_eligibility,
                    ) !== null && (
                      <p>
                        Previous Approved Final Rating:{" "}
                        <strong>
                          {formatFinalRating(
                            getLatestApprovedFinalRating(
                              selectedAddSubject.academic_eligibility,
                            ),
                          )}
                        </strong>
                      </p>
                    )}
                  </div>
                )}

                {selectedAddOffering && (
                  <div className="assignment-selected-summary">
                    <div>
                      <span>Assigned Class</span>

                      <strong>
                        {selectedAddOffering.section.section_name}
                      </strong>
                    </div>

                    <div>
                      <span>Course</span>

                      <strong>
                        {selectedAddOffering.section.course_code || "—"}
                      </strong>
                    </div>

                    <div>
                      <span>Year Level</span>

                      <strong>
                        {selectedAddOffering.section.year_level
                          ? `Year ${selectedAddOffering.section.year_level}`
                          : "—"}
                      </strong>
                    </div>

                    <div>
                      <span>Schedule</span>

                      <strong>
                        {formatSchedule(
                          selectedAddOffering.schedule.days,
                          selectedAddOffering.schedule.time,
                        )}
                      </strong>
                    </div>

                    {getPlacementFlagLabels(
                      getOfferingPlacementFlags(selectedAddOffering),
                    ).length > 0 && (
                      <div className="placement-flags">
                        {getPlacementFlagLabels(
                          getOfferingPlacementFlags(selectedAddOffering),
                        ).map((flag) => (
                          <span
                            key={`add-${flag}`}
                            className={`placement-flag ${flag
                              .toLowerCase()
                              .replace(/\s+/g, "-")}`}
                          >
                            {flag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {availableSubjects.length === 0 && (
                  <div className="remarks-box">
                    <p>
                      No academically eligible subject with a valid Open
                      offering can be added right now.
                    </p>
                  </div>
                )}

                {selectedAddSubject &&
                  selectedAddSubject.available_offerings.length === 0 && (
                    <div className="remarks-box">
                      <p>
                        The selected subject does not currently have an
                        available Open offering with capacity.
                      </p>
                    </div>
                  )}

                <div className="enrollment-details-actions">
                  <button
                    type="button"
                    className="reject-enrollment-btn"
                    disabled={addSubjectLoading}
                    onClick={() => closeAddSubject()}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    className="approve-enrollment-btn"
                    disabled={
                      addSubjectLoading ||
                      !selectedAddSubject ||
                      !selectedAddOffering ||
                      selectedAddSubject.academic_eligibility?.eligible ===
                        false
                    }
                    onClick={() => void addSelectedSubject()}
                  >
                    {addSubjectLoading ? "Adding..." : "Add Subject"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* =================================================
            BULK REGULAR SECTION PLACEMENT MODAL
        ================================================= */}

        {bulkSectionOpen && (
          <div
            className="assignment-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (
                event.target === event.currentTarget &&
                !bulkSectionLoading &&
                !bulkSectionOptionsLoading
              ) {
                closeBulkSectionModal();
              }
            }}
          >
            <section
              className="assignment-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="bulk-section-modal-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="assignment-modal-header">
                <div>
                  <span className="assignment-modal-eyebrow">
                    Registrar Bulk Placement
                  </span>

                  <h2 id="bulk-section-modal-title">Assign Regular Section</h2>

                  <p>
                    Assign persisted Regular subjects to one valid section.
                    Retake and Carry Over subjects remain for individual
                    placement.
                  </p>
                </div>

                <button
                  type="button"
                  className="assignment-modal-close"
                  aria-label="Close assign section modal"
                  title="Close"
                  disabled={bulkSectionLoading || bulkSectionOptionsLoading}
                  onClick={() => closeBulkSectionModal()}
                >
                  ×
                </button>
              </div>

              <div className="assignment-modal-body">
                {bulkSectionError && (
                  <div className="assignment-modal-alert" role="alert">
                    {bulkSectionError}
                  </div>
                )}

                <div className="assignment-selected-summary">
                  <div>
                    <span>Active Regular</span>

                    <strong>{activeRegularSubjects.length}</strong>
                  </div>

                  <div>
                    <span>Manual Irregular</span>

                    <strong>{activeManualSubjects.length}</strong>
                  </div>

                  <div>
                    <span>Home Section</span>

                    <strong>{homeSectionLabel}</strong>
                  </div>
                </div>

                {bulkSectionOptionsLoading ? (
                  <div className="assignment-modal-loading">
                    <div
                      className="assignment-modal-spinner"
                      aria-hidden="true"
                    />

                    <div>
                      <strong>Loading READY sections...</strong>

                      <span>
                        Checking Regular offerings for the student's course,
                        year level, and academic period.
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="assignment-modal-section-heading">
                      <div>
                        <h3>Available Sections</h3>

                        <p>
                          Choose the section used for the student's active
                          Regular subjects.
                        </p>
                      </div>

                      <span className="assignment-modal-count">
                        {bulkSectionOptions.length} section
                        {bulkSectionOptions.length !== 1 ? "s" : ""}
                      </span>
                    </div>

                    {bulkSectionOptions.length === 0 ? (
                      <div className="assignment-modal-empty">
                        <strong>No READY section available</strong>

                        <p>
                          No valid Regular section currently has the required
                          Open offerings and capacity.
                        </p>
                      </div>
                    ) : (
                      <div
                        className="assignment-offering-list"
                        role="radiogroup"
                        aria-label="Available sections"
                      >
                        {bulkSectionOptions.map((section) => {
                          const selected =
                            Number(selectedBulkSectionId) ===
                            Number(section.section_id);

                          const isHomeSection =
                            enrollment.student_section.section_id !== null &&
                            Number(enrollment.student_section.section_id) ===
                              Number(section.section_id);

                          return (
                            <button
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              key={section.section_id}
                              className={`assignment-offering-option${
                                selected ? " selected" : ""
                              }`}
                              disabled={bulkSectionLoading}
                              onClick={() => {
                                setSelectedBulkSectionId(
                                  String(section.section_id),
                                );

                                setBulkSectionError("");
                              }}
                            >
                              <div className="assignment-offering-option-top">
                                <div>
                                  <strong>{section.section_name}</strong>

                                  <span>
                                    Section #{section.section_id}
                                    {isHomeSection ? " · Home Section" : ""}
                                  </span>
                                </div>

                                <div className="assignment-offering-option-status">
                                  <span>READY</span>

                                  <span>
                                    {section.ready_subject_count} subject
                                    {section.ready_subject_count !== 1
                                      ? "s"
                                      : ""}
                                  </span>
                                </div>
                              </div>

                              <div className="assignment-offering-meta">
                                <div>
                                  <span>Course</span>

                                  <strong>
                                    {section.course_code ||
                                      enrollment.course.course_code ||
                                      "—"}
                                  </strong>
                                </div>

                                <div>
                                  <span>Year Level</span>

                                  <strong>
                                    {section.year_level
                                      ? `Year ${section.year_level}`
                                      : "—"}
                                  </strong>
                                </div>

                                <div>
                                  <span>READY Subjects</span>

                                  <strong>{section.ready_subject_count}</strong>
                                </div>

                                <div>
                                  <span>READY Offerings</span>

                                  <strong>
                                    {section.ready_offering_count}
                                  </strong>
                                </div>
                              </div>

                              <div className="assignment-offering-select-row">
                                <span
                                  className={`assignment-offering-radio${
                                    selected ? " selected" : ""
                                  }`}
                                  aria-hidden="true"
                                />

                                <strong>
                                  {selected
                                    ? "Selected"
                                    : "Select this section"}
                                </strong>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {selectedBulkSection && (
                      <div className="assignment-selected-summary">
                        <div>
                          <span>Selected Section</span>

                          <strong>{selectedBulkSection.section_name}</strong>
                        </div>

                        <div>
                          <span>Course</span>

                          <strong>
                            {selectedBulkSection.course_code || "—"}
                          </strong>
                        </div>

                        <div>
                          <span>Year Level</span>

                          <strong>
                            {selectedBulkSection.year_level
                              ? `Year ${selectedBulkSection.year_level}`
                              : "—"}
                          </strong>
                        </div>

                        <div>
                          <span>READY Subjects</span>

                          <strong>
                            {selectedBulkSection.ready_subject_count}
                          </strong>
                        </div>
                      </div>
                    )}

                    <label className="assignment-reason-field">
                      <span>Assignment Reason</span>

                      <textarea
                        value={bulkSectionReason}
                        disabled={bulkSectionLoading}
                        rows={3}
                        maxLength={255}
                        placeholder="Reason for Regular subject placement"
                        onChange={(event) =>
                          setBulkSectionReason(event.target.value)
                        }
                      />

                      <small>
                        {bulkSectionReason.length}
                        /255 characters
                      </small>
                    </label>
                  </>
                )}
              </div>

              <div className="assignment-modal-footer">
                <div className="assignment-modal-footer-note">
                  {selectedBulkSection
                    ? `${selectedBulkSection.section_name} will be used for eligible Regular subjects only.`
                    : "Select one READY section to continue."}
                </div>

                <div className="assignment-modal-actions">
                  <button
                    type="button"
                    className="assignment-modal-cancel"
                    disabled={bulkSectionLoading || bulkSectionOptionsLoading}
                    onClick={() => closeBulkSectionModal()}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    className="assignment-modal-save"
                    disabled={
                      bulkSectionLoading ||
                      bulkSectionOptionsLoading ||
                      !selectedBulkSection
                    }
                    onClick={() => void saveBulkSectionAssignment()}
                  >
                    {bulkSectionLoading
                      ? "Assigning Section..."
                      : "Assign Regular Section"}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* =================================================
            INDIVIDUAL ASSIGN / CHANGE OFFERING
        ================================================= */}

        {selectedSubject && (
          <div
            className="assignment-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !assignmentLoading) {
                closeAssignment();
              }
            }}
          >
            <section
              className="assignment-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="assignment-modal-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="assignment-modal-header">
                <div>
                  <span className="assignment-modal-eyebrow">
                    Registrar Placement
                  </span>

                  <h2 id="assignment-modal-title">
                    {selectedSubject.assignment_complete
                      ? "Change Offering"
                      : "Assign Offering"}
                  </h2>

                  <p>
                    <strong>{selectedSubject.subject_code}</strong> —{" "}
                    {selectedSubject.subject_name} · {selectedSubject.units}{" "}
                    unit
                    {selectedSubject.units !== 1 ? "s" : ""}
                  </p>

                  <div className="assignment-subject-badges">
                    <span
                      className={getEnrollmentTypeClass(
                        selectedSubject.enrollment_type,
                      )}
                    >
                      {selectedSubject.enrollment_type}
                    </span>

                    {selectedSubject.is_irregular && (
                      <span className="irregular-badge compact">IRREGULAR</span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  className="assignment-modal-close"
                  aria-label="Close assignment modal"
                  title="Close"
                  disabled={assignmentLoading}
                  onClick={() => closeAssignment()}
                >
                  ×
                </button>
              </div>

              <div className="assignment-modal-body">
                {actionError && (
                  <div className="assignment-modal-alert" role="alert">
                    <strong>{actionError}</strong>

                    {actionScheduleConflicts.length > 0 && (
                      <div className="schedule-conflict-list">
                        {actionScheduleConflicts.map((conflict, index) => (
                          <div
                            key={`assignment-conflict-${
                              conflict.enrollment_subject_id ?? index
                            }`}
                            className="schedule-conflict-item"
                          >
                            <strong>
                              {conflict.subject_code || "Conflicting Subject"}
                            </strong>

                            <span>{conflict.section_name || "—"}</span>

                            <span>
                              {formatSchedule(
                                conflict.schedule?.days ?? null,
                                conflict.schedule?.time ?? null,
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {offeringsLoading ? (
                  <div className="assignment-modal-loading">
                    <div
                      className="assignment-modal-spinner"
                      aria-hidden="true"
                    />

                    <div>
                      <strong>Loading valid offerings...</strong>

                      <span>
                        Checking exact subject, academic period, schedule, and
                        available capacity.
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="assignment-modal-section-heading">
                      <div>
                        <h3>Available Offerings</h3>

                        <p>
                          {selectedSubject.enrollment_type === "Regular"
                            ? "Regular placement remains within the student's valid course/year placement."
                            : "Irregular placement may use another valid section, year, or course when the offering uses the exact same subject."}
                        </p>
                      </div>

                      <span className="assignment-modal-count">
                        {availableOfferings.length} READY
                      </span>
                    </div>

                    {availableOfferings.length === 0 ? (
                      <div className="assignment-modal-empty">
                        <strong>No valid offering available</strong>

                        <p>
                          {selectedSubject.enrollment_type === "Regular"
                            ? "No valid Open offering was found for this Regular subject in the student's course, year level, and academic period."
                            : "No valid exact-subject Open offering was found in this academic period."}
                        </p>
                      </div>
                    ) : (
                      <div
                        className="assignment-offering-list"
                        role="radiogroup"
                        aria-label="Available offerings"
                      >
                        {availableOfferings.map((offering) => {
                          const selected =
                            Number(selectedOfferingId) ===
                            Number(offering.offering_id);

                          const flags = getOfferingPlacementFlags(offering);

                          const flagLabels = getPlacementFlagLabels(flags);

                          return (
                            <button
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              key={offering.offering_id}
                              className={`assignment-offering-option${
                                selected ? " selected" : ""
                              }`}
                              disabled={assignmentLoading}
                              onClick={() => {
                                setSelectedOfferingId(
                                  String(offering.offering_id),
                                );

                                clearActionError();
                              }}
                            >
                              <div className="assignment-offering-option-top">
                                <div>
                                  <strong>
                                    {offering.section.section_name}
                                  </strong>

                                  <span>Offering #{offering.offering_id}</span>

                                  <small>
                                    {offering.section.course_code || "Course —"}

                                    {offering.section.year_level
                                      ? ` • Year ${offering.section.year_level}`
                                      : ""}
                                  </small>
                                </div>

                                <div className="assignment-offering-option-status">
                                  <span>READY</span>

                                  <span>{offering.offering_status}</span>
                                </div>
                              </div>

                              {flagLabels.length > 0 && (
                                <div className="placement-flags">
                                  {flagLabels.map((flag) => (
                                    <span
                                      key={`${offering.offering_id}-${flag}`}
                                      className={`placement-flag ${flag
                                        .toLowerCase()
                                        .replace(/\s+/g, "-")}`}
                                    >
                                      {flag}
                                    </span>
                                  ))}
                                </div>
                              )}

                              <div className="assignment-offering-meta">
                                <div>
                                  <span>Course</span>

                                  <strong>
                                    {offering.section.course_code || "—"}
                                  </strong>
                                </div>

                                <div>
                                  <span>Year</span>

                                  <strong>
                                    {offering.section.year_level
                                      ? `Year ${offering.section.year_level}`
                                      : "—"}
                                  </strong>
                                </div>

                                <div>
                                  <span>Faculty</span>

                                  <strong>
                                    {offering.faculty.faculty_name || "—"}
                                  </strong>
                                </div>

                                <div>
                                  <span>Schedule</span>

                                  <strong>
                                    {formatSchedule(
                                      offering.schedule.days,
                                      offering.schedule.time,
                                    )}
                                  </strong>
                                </div>

                                <div>
                                  <span>Room</span>

                                  <strong>
                                    {offering.room.room_name || "—"}
                                  </strong>
                                </div>

                                <div>
                                  <span>Capacity</span>

                                  <strong>
                                    {offering.capacity.enrolled_count}/
                                    {offering.capacity.max_students} ·{" "}
                                    {offering.capacity.available_slots} open
                                  </strong>
                                </div>
                              </div>

                              <div className="assignment-offering-select-row">
                                <span
                                  className={`assignment-offering-radio${
                                    selected ? " selected" : ""
                                  }`}
                                  aria-hidden="true"
                                />

                                <strong>
                                  {selected
                                    ? "Selected"
                                    : "Select this offering"}
                                </strong>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {selectedAssignmentOffering && (
                      <div className="assignment-selected-summary">
                        <div>
                          <span>Selected Placement</span>

                          <strong>
                            {selectedAssignmentOffering.section.section_name}
                          </strong>
                        </div>

                        <div>
                          <span>Course</span>

                          <strong>
                            {selectedAssignmentOffering.section.course_code ||
                              "—"}
                          </strong>
                        </div>

                        <div>
                          <span>Year</span>

                          <strong>
                            {selectedAssignmentOffering.section.year_level
                              ? `Year ${selectedAssignmentOffering.section.year_level}`
                              : "—"}
                          </strong>
                        </div>

                        <div>
                          <span>Schedule</span>

                          <strong>
                            {formatSchedule(
                              selectedAssignmentOffering.schedule.days,
                              selectedAssignmentOffering.schedule.time,
                            )}
                          </strong>
                        </div>

                        <div>
                          <span>Available Slots</span>

                          <strong>
                            {
                              selectedAssignmentOffering.capacity
                                .available_slots
                            }
                          </strong>
                        </div>
                      </div>
                    )}

                    <label className="assignment-reason-field">
                      <span>Assignment Reason</span>

                      <textarea
                        value={assignmentReason}
                        disabled={assignmentLoading}
                        rows={3}
                        maxLength={500}
                        placeholder="Reason for this placement"
                        onChange={(event) =>
                          setAssignmentReason(event.target.value)
                        }
                      />

                      <small>
                        {assignmentReason.length}
                        /500 characters
                      </small>
                    </label>
                  </>
                )}
              </div>

              <div className="assignment-modal-footer">
                <div className="assignment-modal-footer-note">
                  {selectedAssignmentOffering
                    ? `${selectedAssignmentOffering.section.section_name} is ready to assign.`
                    : "Select one valid offering to continue."}
                </div>

                <div className="assignment-modal-actions">
                  <button
                    type="button"
                    className="assignment-modal-cancel"
                    disabled={assignmentLoading}
                    onClick={() => closeAssignment()}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    className="assignment-modal-save"
                    disabled={
                      offeringsLoading ||
                      assignmentLoading ||
                      !selectedAssignmentOffering ||
                      selectedAssignmentOffering.capacity.is_full ||
                      selectedAssignmentOffering.capacity.available_slots <= 0
                    }
                    onClick={() => void saveAssignment()}
                  >
                    {assignmentLoading
                      ? "Saving Assignment..."
                      : selectedSubject.assignment_complete
                        ? "Save Offering Change"
                        : "Assign Offering"}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* =================================================
            REPLACE SUBJECT MODAL
        ================================================= */}

        {replaceSubjectOpen && replaceSourceSubject && (
          <div
            className="assignment-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (
                event.target === event.currentTarget &&
                !replacementLoading &&
                !replacementSubjectsLoading
              ) {
                closeReplaceSubject();
              }
            }}
          >
            <section
              className="assignment-modal replace-subject-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="replace-subject-modal-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="assignment-modal-header">
                <div>
                  <span className="assignment-modal-eyebrow">
                    Registrar Academic Correction
                  </span>

                  <h2 id="replace-subject-modal-title">Replace Subject</h2>

                  <p>
                    Replace <strong>{replaceSourceSubject.subject_code}</strong>{" "}
                    — {replaceSourceSubject.subject_name}.
                  </p>

                  <small>
                    The original enrollment subject will be preserved as
                    Dropped. A new enrollment subject row will be created.
                  </small>
                </div>

                <button
                  type="button"
                  className="assignment-modal-close"
                  aria-label="Close replace subject modal"
                  title="Close"
                  disabled={replacementLoading || replacementSubjectsLoading}
                  onClick={() => closeReplaceSubject()}
                >
                  ×
                </button>
              </div>

              <div className="assignment-modal-body">
                {replacementError && (
                  <div className="assignment-modal-alert" role="alert">
                    <strong>{replacementError}</strong>

                    {actionScheduleConflicts.length > 0 && (
                      <div className="schedule-conflict-list">
                        {actionScheduleConflicts.map((conflict, index) => (
                          <div
                            key={`replacement-conflict-${
                              conflict.enrollment_subject_id ?? index
                            }`}
                            className="schedule-conflict-item"
                          >
                            <strong>
                              {conflict.subject_code || "Conflicting Subject"}
                            </strong>

                            <span>{conflict.section_name || "—"}</span>

                            <span>
                              {formatSchedule(
                                conflict.schedule?.days ?? null,
                                conflict.schedule?.time ?? null,
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="assignment-selected-summary">
                  <div>
                    <span>Current Subject</span>

                    <strong>{replaceSourceSubject.subject_code}</strong>
                  </div>

                  <div>
                    <span>Current Type</span>

                    <strong>{replaceSourceSubject.enrollment_type}</strong>
                  </div>

                  <div>
                    <span>Current Section</span>

                    <strong>
                      {replaceSourceSubject.section.section_name ||
                        "Not Assigned"}
                    </strong>
                  </div>

                  <div>
                    <span>Current Schedule</span>

                    <strong>
                      {formatSchedule(
                        replaceSourceSubject.offering.schedule_days,
                        replaceSourceSubject.offering.schedule_time,
                      )}
                    </strong>
                  </div>
                </div>

                {replacementSubjectsLoading ? (
                  <div className="assignment-modal-loading">
                    <div
                      className="assignment-modal-spinner"
                      aria-hidden="true"
                    />

                    <div>
                      <strong>Loading replacement subjects...</strong>

                      <span>
                        Checking academically eligible subjects and valid
                        offerings.
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <label className="assignment-reason-field">
                      <span>Replacement Subject</span>

                      <select
                        value={selectedReplacementSubjectId}
                        disabled={replacementLoading}
                        onChange={(event) => {
                          setSelectedReplacementSubjectId(event.target.value);

                          setSelectedReplacementOfferingId("");

                          setReplacementError("");

                          clearActionError();
                        }}
                      >
                        <option value="">Select replacement subject</option>

                        {replacementSubjects.map((subject) => (
                          <option
                            key={subject.subject_id}
                            value={subject.subject_id}
                            disabled={
                              subject.academic_eligibility?.eligible === false
                            }
                          >
                            {subject.subject_code} — {subject.subject_name} ·{" "}
                            {subject.units} unit
                            {subject.units !== 1 ? "s" : ""} ·{" "}
                            {getCandidateTypeLabel(subject)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="assignment-reason-field">
                      <span>Replacement Offering</span>

                      <select
                        value={selectedReplacementOfferingId}
                        disabled={
                          replacementLoading || !selectedReplacementSubject
                        }
                        onChange={(event) => {
                          setSelectedReplacementOfferingId(event.target.value);

                          setReplacementError("");

                          clearActionError();
                        }}
                      >
                        <option value="">Select replacement offering</option>

                        {(
                          selectedReplacementSubject?.available_offerings || []
                        ).map((offering) => (
                          <option
                            key={offering.offering_id}
                            value={offering.offering_id}
                          >
                            #{offering.offering_id} ·{" "}
                            {offering.section.section_name}
                            {offering.section.course_code
                              ? ` · ${offering.section.course_code}`
                              : ""}
                            {offering.section.year_level
                              ? ` · Year ${offering.section.year_level}`
                              : ""}
                            {" · "}
                            {formatSchedule(
                              offering.schedule.days,
                              offering.schedule.time,
                            )}
                            {" · "}
                            {offering.capacity.available_slots} open
                          </option>
                        ))}
                      </select>
                    </label>

                    {selectedReplacementSubject && (
                      <div className="remarks-box">
                        <span>Replacement Eligibility</span>

                        <p>
                          <strong>
                            {selectedReplacementSubject.academic_eligibility
                              ?.eligible === false
                              ? "BLOCKED"
                              : "ELIGIBLE"}
                          </strong>
                          {" · "}
                          Candidate:{" "}
                          <strong>
                            {getCandidateTypeLabel(selectedReplacementSubject)}
                          </strong>
                        </p>

                        {getAcademicEligibilityMessage(
                          selectedReplacementSubject.academic_eligibility,
                        ) && (
                          <p>
                            {getAcademicEligibilityMessage(
                              selectedReplacementSubject.academic_eligibility,
                            )}
                          </p>
                        )}

                        {getLatestApprovedFinalRating(
                          selectedReplacementSubject.academic_eligibility,
                        ) !== null && (
                          <p>
                            Previous Approved Final Rating:{" "}
                            <strong>
                              {formatFinalRating(
                                getLatestApprovedFinalRating(
                                  selectedReplacementSubject.academic_eligibility,
                                ),
                              )}
                            </strong>
                          </p>
                        )}
                      </div>
                    )}

                    {selectedReplacementOffering && (
                      <div className="assignment-selected-summary">
                        <div>
                          <span>New Section</span>

                          <strong>
                            {selectedReplacementOffering.section.section_name}
                          </strong>
                        </div>

                        <div>
                          <span>Course</span>

                          <strong>
                            {selectedReplacementOffering.section.course_code ||
                              "—"}
                          </strong>
                        </div>

                        <div>
                          <span>Year</span>

                          <strong>
                            {selectedReplacementOffering.section.year_level
                              ? `Year ${selectedReplacementOffering.section.year_level}`
                              : "—"}
                          </strong>
                        </div>

                        <div>
                          <span>Schedule</span>

                          <strong>
                            {formatSchedule(
                              selectedReplacementOffering.schedule.days,
                              selectedReplacementOffering.schedule.time,
                            )}
                          </strong>
                        </div>

                        {getPlacementFlagLabels(
                          getOfferingPlacementFlags(
                            selectedReplacementOffering,
                          ),
                        ).length > 0 && (
                          <div className="placement-flags">
                            {getPlacementFlagLabels(
                              getOfferingPlacementFlags(
                                selectedReplacementOffering,
                              ),
                            ).map((flag) => (
                              <span
                                key={`replace-${flag}`}
                                className={`placement-flag ${flag
                                  .toLowerCase()
                                  .replace(/\s+/g, "-")}`}
                              >
                                {flag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {replacementSubjects.length === 0 && (
                      <div className="assignment-modal-empty">
                        <strong>No replacement subject available</strong>

                        <p>
                          No different academically eligible subject currently
                          has a valid Open offering.
                        </p>
                      </div>
                    )}

                    <label className="assignment-reason-field">
                      <span>Replacement Reason</span>

                      <textarea
                        value={replacementReason}
                        disabled={replacementLoading}
                        rows={3}
                        maxLength={500}
                        placeholder="Explain why this enrollment subject is being replaced."
                        onChange={(event) =>
                          setReplacementReason(event.target.value)
                        }
                      />

                      <small>
                        {replacementReason.length}
                        /500 characters
                      </small>
                    </label>
                  </>
                )}
              </div>

              <div className="assignment-modal-footer">
                <div className="assignment-modal-footer-note">
                  {selectedReplacementSubject && selectedReplacementOffering
                    ? `${replaceSourceSubject.subject_code} will become Dropped and ${selectedReplacementSubject.subject_code} will be added as a new enrollment subject.`
                    : "Select a different subject and one valid offering."}
                </div>

                <div className="assignment-modal-actions">
                  <button
                    type="button"
                    className="assignment-modal-cancel"
                    disabled={replacementLoading || replacementSubjectsLoading}
                    onClick={() => closeReplaceSubject()}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    className="assignment-modal-save"
                    disabled={
                      replacementLoading ||
                      replacementSubjectsLoading ||
                      !selectedReplacementSubject ||
                      !selectedReplacementOffering ||
                      !replacementReason.trim() ||
                      selectedReplacementSubject.academic_eligibility
                        ?.eligible === false
                    }
                    onClick={() => void saveReplacementSubject()}
                  >
                    {replacementLoading
                      ? "Replacing Subject..."
                      : "Replace Subject"}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* =================================================
            FINAL APPROVAL
        ================================================= */}

        <div className="enrollment-details-card">
          <div className="details-card-header">
            <div>
              <h2>Final Approval</h2>

              <span>
                Approval is available only after final validation confirms all
                Regular, Retake, and Carry Over subjects are validly assigned.
              </span>
            </div>
          </div>

          {enrollment.enrollment_status === "Pending" ? (
            <>
              <div className="remarks-box">
                <span>Approval Remarks</span>

                <textarea
                  value={approvalRemarks}
                  disabled={approvalLoading || rejectionLoading}
                  onChange={(event) => setApprovalRemarks(event.target.value)}
                />
              </div>

              <div className="remarks-box">
                <span>Rejection Reason</span>

                <textarea
                  value={rejectionRemarks}
                  maxLength={255}
                  disabled={approvalLoading || rejectionLoading}
                  placeholder="Required only when rejecting this enrollment."
                  onChange={(event) => setRejectionRemarks(event.target.value)}
                />

                <small>
                  {rejectionRemarks.length}
                  /255 characters
                </small>
              </div>

              <div className="enrollment-details-actions">
                <button
                  type="button"
                  className="subject-action-btn"
                  disabled={
                    validationLoading || approvalLoading || rejectionLoading
                  }
                  onClick={() => void loadValidation()}
                >
                  {validationLoading ? "Validating..." : "Validate Enrollment"}
                </button>

                <button
                  type="button"
                  className="reject-enrollment-btn"
                  disabled={
                    approvalLoading ||
                    rejectionLoading ||
                    !rejectionRemarks.trim()
                  }
                  onClick={() => void rejectEnrollment()}
                >
                  {rejectionLoading ? "Rejecting..." : "Reject Enrollment"}
                </button>

                <button
                  type="button"
                  className="approve-enrollment-btn"
                  disabled={
                    approvalLoading ||
                    rejectionLoading ||
                    validationLoading ||
                    !validation?.can_approve
                  }
                  onClick={() => void approveEnrollment()}
                >
                  {approvalLoading ? "Approving..." : "Approve Enrollment"}
                </button>
              </div>
            </>
          ) : enrollment.enrollment_status === "Approved" ? (
            <div className="remarks-box">
              <span>Approval Complete</span>

              <p>
                <strong>✓ Enrollment Already Approved</strong>
              </p>

              <p>
                This enrollment is already official and does not require another
                approval.
              </p>

              {enrollment.approval.approved_by_username && (
                <p>
                  Approved by:{" "}
                  <strong>{enrollment.approval.approved_by_username}</strong>
                </p>
              )}

              {enrollment.approval.approved_at && (
                <p>
                  Approved at:{" "}
                  <strong>{formatDate(enrollment.approval.approved_at)}</strong>
                </p>
              )}
            </div>
          ) : (
            <div className="remarks-box">
              <p>
                Enrollment status is{" "}
                <strong>{enrollment.enrollment_status}</strong>. This enrollment
                is not currently available for approval.
              </p>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
