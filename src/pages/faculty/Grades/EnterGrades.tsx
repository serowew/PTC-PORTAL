import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  Clock3,
  FilePenLine,
  Filter,
  GraduationCap,
  MapPin,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { api } from "../../../services/api";

import "../../../styles/EnterGrades.css";

const API_BASE_URL = `${api.baseUrl}/api/faculty/classes`;
const LEGACY_DIRECT_PERCENTAGE_ENTRY_ENABLED = false;
const MODERN_GRADEBOOK_API = `${api.baseUrl}/api/gradebook`;

type GradeStatus = "Draft" | "Submitted" | "Returned" | "Approved";

type GradeRemark = "Passed" | "Failed" | "Incomplete" | "Unofficial Drop";

type GradeOutcome = "NUMERIC" | "INCOMPLETE" | "UNOFFICIAL_DROP";
type AssessmentMode = "create" | "edit" | "remove";
type AssessmentTerm = "MIDTERM" | "FINAL_TERM";

interface FacultyInfo {
  faculty_id: number;
  employee_number: string;
  faculty_name: string;
}

interface FacultyClass {
  offering_id: number;
  section_subject_id: number;

  offering_status: string;
  section_subject_status: string;

  subject: {
    subject_id: number;
    subject_code: string;
    subject_name: string;
    units: number;
    lecture_hours: number;
    laboratory_hours: number;
  };

  section: {
    section_id: number;
    section_name: string;
    year_level: number;

    course: {
      course_id: number;
      course_code: string;
      course_name: string;
    };
  };

  academic_period: {
    academic_year_id: number;
    academic_year: string;
    is_current_academic_year: boolean;

    semester_id: number;
    semester_name: string;
  };

  schedule: {
    days: string | null;
    time: string | null;
  };

  room: {
    room_id: number;
    room_code?: string | null;
    room_name?: string | null;
  } | null;

  capacity?: {
    max_students: number;
    official_students: number;
  };

  created_at?: string;
}

interface FacultyClassesResponse {
  success: boolean;

  faculty?: FacultyInfo;

  summary?: {
    total_classes: number;
    open_classes: number;
    closed_classes: number;
    total_official_students: number;
  };

  classes?: FacultyClass[];

  message?: string;
  error?: string;
}

interface GradeReview {
  reviewed_by: number | null;
  reviewed_by_username: string | null;
  reviewed_at: string | null;
  review_remarks: string | null;
}

interface FacultyGrade {
  grade_id: number;
  faculty_id: number | null;

  midterm_grade: number | null;
  final_grade: number | null;
  overall_percentage: number | null;
  final_rating: number | null;

  grading_policy?: string;
  grading_outcome?: string;
  outcome_reason?: string | null;

  remarks: GradeRemark | null;

  grade_status: GradeStatus;

  submitted_at: string | null;

  review: GradeReview;

  created_at: string | null;
  updated_at: string | null;
}

type IncCompletionRequestStatus =
  | "Pending Program Head"
  | "For Registrar Processing";

interface IncCompletionRequestSummary {
  grade_change_request_id: number;
  status: IncCompletionRequestStatus;
  requested_at: string | null;
  reviewed_at: string | null;
  review_remarks: string | null;
}

interface GradebookStudent {
  enrollment_subject_id: number;
  enrollment_id: number;
  student_id: number;

  student_number: string;

  first_name: string;
  middle_name: string | null;
  last_name: string;

  full_name: string;
  email: string | null;

  enrollment_status: string;
  subject_status: string;

  grade: FacultyGrade | null;
  inc_completion_request: IncCompletionRequestSummary | null;
}

interface GradebookSummary {
  total_students: number;
  without_grade: number;
  draft: number;
  submitted: number;
  returned: number;
  approved: number;
}

interface GradebookResponse {
  success: boolean;

  faculty?: FacultyInfo;
  class?: FacultyClass;

  summary?: GradebookSummary;
  students?: GradebookStudent[];

  message?: string;
  error?: string;
}
type ModernGradebookScoreStatus = "PENDING" | "SCORED" | "NOT_APPLICABLE";

interface ModernGradebookAssessment {
  assessment_id: number;
  offering_category_id: number;
  header_name: string;
  maximum_score: string;
  display_order: number;
  record_version: number;
}

interface ModernGradebookCategory {
  category_code: string;
  category_name: string;
  category_percent: number | string;
  display_order: number;
  assessments: ModernGradebookAssessment[];
}

interface ModernGradebookScore {
  assessment_id: number;
  score_id: number | null;
  score_status: ModernGradebookScoreStatus;
  earned_score: string | null;
  not_applicable_reason: string | null;
  record_version: number | null;
  updated_at: string | null;
  saved: boolean;
}

interface ModernGradebookStudent {
  enrollment_subject_id: number;
  enrollment_id: number;
  student_id: number;
  student_number: string;
  student_name: string;
  enrollment_subject_status: string;
  is_current_enrolled: boolean;
  scores_by_assessment_id: Record<string, ModernGradebookScore>;
}

interface ModernGradebookRosterResponse {
  success: boolean;
  offering_id: number;
  grading_classification: string;
  active_assessment_count: number;
  roster_count: number;
  offering_status?: string;

  terms: {
    MIDTERM: {
      categories: ModernGradebookCategory[];
    };
    FINAL_TERM: {
      categories: ModernGradebookCategory[];
    };
  };

  students: ModernGradebookStudent[];

  code?: string;
  message?: string;
}
interface GradebookScoreSaveResponse {
  success: boolean;
  offering_id: number;
  assessment_id: number;
  enrollment_subject_id: number;
  score?: {
    score_id: number;
    score_status: ModernGradebookScoreStatus;
    earned_score: string | null;
    not_applicable_reason: string | null;
    record_version: number;
  };
  persisted?: boolean;
  code?: string;
  message?: string;
}

type SaveAssessmentScore = (
  offeringId: number,
  enrollmentSubjectId: number,
  assessmentId: number,
  previousVersion: number | null,
  scoreStatus: ModernGradebookScoreStatus,
  earnedScore: string | null,
  notApplicableReason: string | null,
) => Promise<void>;

interface AssessmentStructureResponse {
  success: boolean;
  offering_id: number;
  terms: Record<
    AssessmentTerm,
    {
      can_edit_structure: boolean;
      structure_locked: boolean;
      categories: ModernGradebookCategory[];
    }
  >;
  message?: string;
  code?: string;
}

interface AssessmentMutationResponse {
  success: boolean;
  code?: string;
  message?: string;
  affected_score_rows?: number;
  affected_scored_rows?: number;
}

interface AssessmentTarget {
  assessment_id: number;
  record_version: number;
  category_code: string;
  header_name: string;
  maximum_score: string;
}

interface TermAssessmentColumn {
  category: ModernGradebookCategory;
  assessment: ModernGradebookAssessment | null;
}

interface GradeMutationResponse {
  success: boolean;

  message?: string;
  error?: string;

  missing_fields?: string[];

  grade?: {
    grade_id: number;
    enrollment_subject_id: number;

    midterm_grade: number | null;
    final_grade: number | null;
    overall_percentage?: number | null;
    final_rating: number | null;

    grading_policy?: string;
    grading_outcome?: string;
    outcome_reason?: string | null;

    remarks: GradeRemark | null;

    grade_status: GradeStatus;
  };
}

interface GradeForm {
  gradingOutcome: GradeOutcome;
  outcomeReason: string;
  midtermGrade: string;
  finalGrade: string;
}

interface GradePreview {
  complete: boolean;
  overallPercentage: number | null;
  finalRating: number | null;
  remarks: GradeRemark | null;
}

interface RowFeedback {
  type: "success" | "error";
  message: string;
}

interface IncCompletionForm {
  midtermGrade: string;
  finalGrade: string;
  completionRemarks: string;
}

interface IncCompletionResponse {
  success: boolean;
  message?: string;
  error?: string;

  request?: {
    grade_change_request_id: number;
    grade_id: number;
    request_type: "INC_COMPLETION";
    status: string;
  };

  proposed_grade?: {
    midterm_grade: number;
    final_grade: number;
    overall_percentage: number;
    final_rating: number;
    grading_outcome: "NUMERIC";
    remarks: "Passed" | "Failed";
  };
}

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

function parsePositiveInt(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function gradeValueToString(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function createGradeForm(grade: FacultyGrade | null): GradeForm {
  const storedOutcome = grade?.grading_outcome;

  const gradingOutcome: GradeOutcome =
    storedOutcome === "INCOMPLETE" || storedOutcome === "UNOFFICIAL_DROP"
      ? storedOutcome
      : "NUMERIC";

  return {
    gradingOutcome,
    outcomeReason: grade?.outcome_reason || "",
    midtermGrade: gradeValueToString(grade?.midterm_grade),
    finalGrade: gradeValueToString(grade?.final_grade),
  };
}

function formatDays(value: string | null): string {
  if (!value) {
    return "Not scheduled";
  }

  return value
    .split(",")
    .map((item) => {
      const day = item.trim();

      if (!day) {
        return "";
      }

      return day.charAt(0).toUpperCase() + day.slice(1).toLowerCase();
    })
    .filter(Boolean)
    .join(", ");
}

function getRoomLabel(room: FacultyClass["room"]): string {
  if (!room) {
    return "—";
  }

  if (room.room_code && room.room_name) {
    return `${room.room_code} • ${room.room_name}`;
  }

  return room.room_code || room.room_name || "—";
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function getGradeStatus(
  student: GradebookStudent,
): GradeStatus | "Not Started" {
  return student.grade?.grade_status || "Not Started";
}

function isEditable(student: GradebookStudent): boolean {
  if (!LEGACY_DIRECT_PERCENTAGE_ENTRY_ENABLED) {
    return false;
  }

  if (student.subject_status !== "Enrolled") {
    return false;
  }

  if (!student.grade) {
    return true;
  }

  return (
    student.grade.grade_status === "Draft" ||
    student.grade.grade_status === "Returned"
  );
}

function isApprovedIncomplete(student: GradebookStudent): boolean {
  return (
    student.subject_status === "Incomplete" &&
    student.grade?.grade_status === "Approved" &&
    student.grade?.grading_outcome === "INCOMPLETE" &&
    student.grade?.remarks === "Incomplete" &&
    Number(student.grade?.final_rating) === 4
  );
}

function getIncCompletionStatusLabel(
  request: IncCompletionRequestSummary,
): string {
  if (request.status === "For Registrar Processing") {
    return "Waiting for Registrar";
  }

  return "Waiting for Program Head";
}

function getIncCompletionStatusClass(
  request: IncCompletionRequestSummary,
): string {
  return request.status === "For Registrar Processing"
    ? "registrar"
    : "program-head";
}

const GRADE_BANDS = [
  [97, 1.0],
  [94, 1.25],
  [91, 1.5],
  [88, 1.75],
  [85, 2.0],
  [82, 2.25],
  [79, 2.5],
  [76, 2.75],
  [75, 3.0],
  [0, 5.0],
] as const;

function parsePercentageHundredths(value: string): number | null {
  const clean = value.trim();

  if (!clean || !/^\d+(?:\.\d{1,2})?$/.test(clean)) {
    return null;
  }

  const numeric = Number(clean);

  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    return null;
  }

  return Math.round(numeric * 100);
}

function calculateGradePreview(form: GradeForm): GradePreview {
  if (form.gradingOutcome === "INCOMPLETE") {
    return {
      complete: true,
      overallPercentage: null,
      finalRating: 4,
      remarks: "Incomplete",
    };
  }

  if (form.gradingOutcome === "UNOFFICIAL_DROP") {
    return {
      complete: true,
      overallPercentage: null,
      finalRating: 6,
      remarks: "Unofficial Drop",
    };
  }

  const midterm = parsePercentageHundredths(form.midtermGrade);
  const finalTerm = parsePercentageHundredths(form.finalGrade);

  if (midterm === null || finalTerm === null) {
    return {
      complete: false,
      overallPercentage: null,
      finalRating: null,
      remarks: null,
    };
  }

  // Same TWO_TERM_50_50 rule used by the backend.
  // Keep hundredths so 74.995 never rounds up to a passing 75.
  const sum = midterm + finalTerm;
  const overallPercentage = sum / 200;

  const finalRating =
    GRADE_BANDS.find(([threshold]) => sum >= threshold * 200)?.[1] ?? 5;

  const remarks: GradeRemark =
    finalRating >= 1 && finalRating <= 3 ? "Passed" : "Failed";

  return {
    complete: true,
    overallPercentage,
    finalRating,
    remarks,
  };
}

function validatePercentageField(
  value: string,
  label: string,
  required = false,
): string | null {
  const clean = value.trim();

  if (!clean) {
    return required ? `${label} is required.` : null;
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(clean)) {
    return `${label} must be a percentage from 0 to 100 with at most two decimal places.`;
  }

  const numeric = Number(clean);

  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    return `${label} must be between 0 and 100.`;
  }

  return null;
}

function emptySummary(): GradebookSummary {
  return {
    total_students: 0,
    without_grade: 0,
    draft: 0,
    submitted: 0,
    returned: 0,
    approved: 0,
  };
}

// Inline assessment scores
function scoreCents(value: string): bigint | null {
  const matched = /^(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!matched) return null;
  return BigInt(matched[1]) * 100n + BigInt((matched[2] ?? "").padEnd(2, "0"));
}

interface AssessmentScoreCellProps {
  offeringId: number;
  enrollmentSubjectId: number;
  studentNumber: string;
  assessment: ModernGradebookAssessment;
  score: ModernGradebookScore | null;
  canEdit: boolean;
  onSave: SaveAssessmentScore;
  onConflict: () => void;
}

function AssessmentScoreCell({
  offeringId,
  enrollmentSubjectId,
  studentNumber,
  assessment,
  score,
  canEdit,
  onSave,
  onConflict,
}: AssessmentScoreCellProps) {
  const storedValue =
    score?.score_status === "SCORED" ? (score.earned_score ?? "") : "";
  const [value, setValue] = useState(storedValue);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const version = score?.record_version ?? null;

  useEffect(() => {
    setValue(storedValue);
    setMessage("");
    setError("");
  }, [storedValue, version, score?.score_status]);

  const save = async (
    nextStatus: ModernGradebookScoreStatus,
    nextValue: string | null = null,
    reason: string | null = null,
  ) => {
    if (!canEdit || savingRef.current) return;
    const normalized = nextValue?.trim() ?? "";

    if (nextStatus === "SCORED") {
      const cents = scoreCents(normalized);
      const maximum = scoreCents(assessment.maximum_score);
      if (cents === null || maximum === null || cents > maximum) {
        setError(
          `Enter a score from 0 to ${assessment.maximum_score} (up to 2 decimals).`,
        );
        return;
      }
    }

    const unchanged =
      (nextStatus === "SCORED" &&
        score?.score_status === "SCORED" &&
        scoreCents(normalized) === scoreCents(storedValue)) ||
      (nextStatus === "PENDING" &&
        (score?.score_status === "PENDING" || !score));

    if (unchanged) {
      setValue(storedValue);
      setError("");
      return;
    }

    savingRef.current = true;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await onSave(
        offeringId,
        enrollmentSubjectId,
        assessment.assessment_id,
        version,
        nextStatus,
        nextStatus === "SCORED" ? normalized : null,
        nextStatus === "NOT_APPLICABLE" ? reason : null,
      );
      setValue(nextStatus === "SCORED" ? normalized : "");
      setMessage("Saved");
    } catch (requestError) {
      const errorText =
        requestError instanceof Error
          ? requestError.message
          : "Score could not be saved.";
      setError(errorText);
      if (errorText.includes("SCORE_VERSION_CONFLICT")) {
        onConflict();
      }
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  const commitValue = () => {
    if (!canEdit || savingRef.current) return;
    const trimmed = value.trim();
    // Simply focusing a saved N/A cell must not clear its recorded reason.
    if (!trimmed && score?.score_status === "NOT_APPLICABLE") return;
    void save(trimmed ? "SCORED" : "PENDING", trimmed || null);
  };

  if (!canEdit) {
    const label =
      score?.score_status === "SCORED"
        ? `${score.earned_score ?? "—"} / ${assessment.maximum_score}`
        : score?.score_status === "NOT_APPLICABLE"
          ? "N/A"
          : "Pending";
    return (
      <div
        className="faculty-grade-rating-field"
        title={score?.not_applicable_reason || undefined}
      >
        <strong>{label}</strong>
        <small>{score?.saved ? "Saved record · Read-only" : "Read-only"}</small>
      </div>
    );
  }

  return (
    <div
      className="faculty-grade-rating-field"
      title={score?.not_applicable_reason || undefined}
    >
      <input
        className="faculty-grade-input"
        type="text"
        inputMode="decimal"
        aria-label={`${assessment.header_name} score for ${studentNumber}; maximum ${assessment.maximum_score}`}
        value={value}
        placeholder={
          score?.score_status === "NOT_APPLICABLE" ? "N/A" : "Pending"
        }
        onChange={(event) => {
          setValue(event.target.value);
          setError("");
          setMessage("");
        }}
        onBlur={commitValue}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        disabled={busy}
      />
      <small aria-live="polite">
        {busy
          ? "Saving..."
          : error
            ? "Not saved"
            : message || (score?.saved ? "Saved" : "Pending")}
        {` · Max ${assessment.maximum_score}`}
      </small>
      <div
        style={{
          display: "flex",
          gap: 5,
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className="faculty-grade-header-button"
          style={{ minHeight: 25, padding: "3px 7px", fontSize: 10 }}
          disabled={busy}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const previousReason =
              score?.score_status === "NOT_APPLICABLE"
                ? (score.not_applicable_reason ?? "")
                : "";
            const reason = window.prompt(
              "Reason for N/A (required):",
              previousReason,
            );
            if (reason === null) return;
            if (!reason.trim() || reason.trim().length > 2000) {
              setError("N/A requires a reason of 1–2000 characters.");
              return;
            }
            void save("NOT_APPLICABLE", null, reason.trim());
          }}
        >
          N/A
        </button>
        <button
          type="button"
          className="faculty-grade-header-button"
          style={{ minHeight: 25, padding: "3px 7px", fontSize: 10 }}
          disabled={busy || (!score?.saved && !value.trim())}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setValue("");
            void save("PENDING");
          }}
        >
          Clear
        </button>
      </div>
      {error && (
        <small
          role="alert"
          style={{
            color: "#b42318",
            textAlign: "left",
            overflowWrap: "anywhere",
          }}
        >
          {error}
        </small>
      )}
    </div>
  );
}
// Attendance

type AttendanceStatus =
  | "PENDING"
  | "PRESENT"
  | "LATE"
  | "ABSENT"
  | "EXCUSED"
  | "NOT_APPLICABLE";

interface AttendanceMeeting {
  meeting_id: number;
  meeting_date: string;
  meeting_status: string;
  session_type: string;
  start_time: string;
  end_time: string;
  record_version: number;
}

interface AttendanceMeetingsResponse {
  success: boolean;
  offering_id: number;
  grading_classification: string;
  terms: Record<
    AssessmentTerm,
    {
      meetings: AttendanceMeeting[];
      can_edit_structure: boolean;
    }
  >;
  message?: string;
}

interface AttendanceStudent {
  enrollment_subject_id: number;
  student_number: string;
  student_name: string;
  attendance_editable: boolean;
  attendance_lock_reason: string | null;
  attendance: {
    attendance_status: AttendanceStatus;
    status_reason: string | null;
    record_version: number | null;
  };
}

interface AttendanceEntriesResponse {
  success: boolean;
  offering_id: number;
  meeting: {
    meeting_id: number;
    meeting_status: string;
  };
  students: AttendanceStudent[];
  message?: string;
}

interface AttendanceDraft {
  status: AttendanceStatus;
  reason: string;
}

function AttendanceRegister({
  offeringId,
  refreshKey,
  readOnlyStudentIds,
}: {
  offeringId: number;
  refreshKey: number;
  readOnlyStudentIds: number[];
}) {
  const navigate = useNavigate();
  const lockedStudentIds = new Set(readOnlyStudentIds);

  const [term, setTerm] = useState<AssessmentTerm>("MIDTERM");

  const [meetings, setMeetings] = useState<AttendanceMeetingsResponse | null>(
    null,
  );

  const [selectedMeetingId, setSelectedMeetingId] = useState<number | null>(
    null,
  );

  const [register, setRegister] = useState<AttendanceEntriesResponse | null>(
    null,
  );

  const [drafts, setDrafts] = useState<Record<number, AttendanceDraft>>({});

  const [loading, setLoading] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [meetingReloadKey, setMeetingReloadKey] = useState(0);
  const [createMeetingOpen, setCreateMeetingOpen] = useState(false);
  const [createMeetingBusy, setCreateMeetingBusy] = useState(false);

  const [meetingDate, setMeetingDate] = useState("");

  const [meetingSession, setMeetingSession] = useState<
    "LECTURE" | "LABORATORY" | "COMBINED"
  >("LECTURE");

  const [meetingStart, setMeetingStart] = useState("");
  const [meetingEnd, setMeetingEnd] = useState("");
  const [meetingNotes, setMeetingNotes] = useState("");

  const [createMeetingError, setCreateMeetingError] = useState("");
  const [createMeetingSuccess, setCreateMeetingSuccess] = useState("");
  const [heldReason, setHeldReason] = useState("");
  const [heldBusy, setHeldBusy] = useState(false);
  const [heldError, setHeldError] = useState("");
  const [heldSuccess, setHeldSuccess] = useState("");
  const [error, setError] = useState("");

  const [feedback, setFeedback] = useState<Record<number, string>>({});

  useEffect(() => {
    const controller = new AbortController();

    setMeetings(null);
    setRegister(null);
    setError("");
    setLoading(true);

    const loadMeetings = async () => {
      try {
        const response = await authService.authFetch(
          `${MODERN_GRADEBOOK_API}/${offeringId}/attendance/meetings`,
          { signal: controller.signal },
        );

        const data =
          await readJsonResponse<AttendanceMeetingsResponse>(response);

        if (controller.signal.aborted) return;

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (!response.ok || !data.success || data.offering_id !== offeringId) {
          throw new Error(
            data.message || "Unable to load attendance meetings.",
          );
        }

        setMeetings(data);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load meetings.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadMeetings();

    return () => controller.abort();
  }, [offeringId, refreshKey, meetingReloadKey, navigate]);
  const selectedTermMeetings =
    meetings?.offering_id === offeringId ? meetings.terms[term] : undefined;

  const canCreateMeeting =
    selectedTermMeetings?.can_edit_structure === true &&
    readOnlyStudentIds.length === 0 &&
    !loading;

  const createMeeting = async () => {
    if (!canCreateMeeting || createMeetingBusy || savingId !== null) {
      return;
    }

    setCreateMeetingError("");
    setCreateMeetingSuccess("");

    if (!meetingDate || !meetingStart || !meetingEnd) {
      setCreateMeetingError("Enter a date, start time, and end time.");
      return;
    }

    if (meetingEnd <= meetingStart) {
      setCreateMeetingError("End time must be later than start time.");
      return;
    }

    if (
      meetings?.grading_classification === "PURE_LECTURE" &&
      meetingSession !== "LECTURE"
    ) {
      setCreateMeetingError(
        "Pure Lecture classes allow Lecture sessions only.",
      );
      return;
    }

    const confirmed = window.confirm(
      `Create a ${term === "MIDTERM" ? "Midterm" : "Final Term"} meeting ` +
        `on ${meetingDate}, ${meetingStart}–${meetingEnd}?\n\n` +
        "The meeting will be Scheduled, not Held.",
    );

    if (!confirmed) return;

    setCreateMeetingBusy(true);

    try {
      const response = await authService.authFetch(
        `${MODERN_GRADEBOOK_API}/${offeringId}/attendance/meetings`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            grading_term: term,
            meeting_date: meetingDate,
            session_type: meetingSession,
            start_time: meetingStart,
            end_time: meetingEnd,
            meeting_notes: meetingNotes.trim() || null,
            dry_run: false,
          }),
        },
      );

      const data = await readJsonResponse<{
        success: boolean;
        offering_id: number;
        meeting?: {
          meeting_id: number;
          meeting_status: string;
        };
        persisted?: boolean;
        code?: string;
        message?: string;
      }>(response);

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }

      if (
        !response.ok ||
        !data.success ||
        data.offering_id !== offeringId ||
        !data.meeting?.meeting_id ||
        data.meeting.meeting_status !== "SCHEDULED" ||
        data.persisted !== true
      ) {
        throw new Error(
          data.message || data.code || "Could not create meeting.",
        );
      }

      setSelectedMeetingId(data.meeting.meeting_id);
      setMeetingReloadKey((current) => current + 1);

      setCreateMeetingOpen(false);
      setMeetingDate("");
      setMeetingSession("LECTURE");
      setMeetingStart("");
      setMeetingEnd("");
      setMeetingNotes("");

      setCreateMeetingSuccess(
        "Meeting created as Scheduled. Mark it Held after the class ends before encoding attendance.",
      );
    } catch (caught) {
      setCreateMeetingError(
        caught instanceof Error ? caught.message : "Could not create meeting.",
      );
    } finally {
      setCreateMeetingBusy(false);
    }
  };
  const meetingOptions =
    meetings?.offering_id === offeringId
      ? (meetings.terms[term]?.meetings ?? [])
      : [];

  const meetingId = meetingOptions.some(
    (meeting) => meeting.meeting_id === selectedMeetingId,
  )
    ? selectedMeetingId
    : (meetingOptions[0]?.meeting_id ?? null);
  const selectedMeeting = meetingOptions.find(
    (meeting) => meeting.meeting_id === meetingId,
  );

  const meetingEndTime = selectedMeeting
    ? Date.parse(
        `${selectedMeeting.meeting_date}T${selectedMeeting.end_time}+08:00`,
      )
    : NaN;

  const canMarkHeld =
    selectedTermMeetings?.can_edit_structure === true &&
    readOnlyStudentIds.length === 0 &&
    selectedMeeting?.meeting_status === "SCHEDULED" &&
    Number.isSafeInteger(selectedMeeting.record_version) &&
    selectedMeeting.record_version > 0 &&
    Number.isFinite(meetingEndTime) &&
    Date.now() >= meetingEndTime &&
    !loading &&
    !heldBusy &&
    !createMeetingBusy &&
    savingId === null;

  const markMeetingHeld = async () => {
    if (!canMarkHeld || !selectedMeeting || heldBusy) {
      return;
    }

    const changeReason = heldReason.trim();

    if (changeReason.length < 5 || changeReason.length > 1000) {
      setHeldError("Enter a reason between 5 and 1000 characters.");
      return;
    }

    const confirmed = window.confirm(
      `Mark the meeting on ${selectedMeeting.meeting_date} as Held?\n\n` +
        "This confirms the class took place and enables attendance entry.",
    );

    if (!confirmed) return;

    setHeldBusy(true);
    setHeldError("");
    setHeldSuccess("");

    try {
      const response = await authService.authFetch(
        `${MODERN_GRADEBOOK_API}/${offeringId}/attendance/meetings/${selectedMeeting.meeting_id}/mark-held`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            record_version: selectedMeeting.record_version,
            change_reason: changeReason,
            dry_run: false,
          }),
        },
      );

      const data = await readJsonResponse<{
        success: boolean;
        offering_id: number;
        meeting?: {
          meeting_id: number;
          meeting_status: string;
        };
        persisted?: boolean;
        message?: string;
        code?: string;
      }>(response);

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }

      if (
        !response.ok ||
        !data.success ||
        data.offering_id !== offeringId ||
        data.meeting?.meeting_id !== selectedMeeting.meeting_id ||
        data.meeting.meeting_status !== "HELD" ||
        data.persisted !== true
      ) {
        throw new Error(
          data.message || data.code || "Could not mark the meeting Held.",
        );
      }

      setHeldReason("");

      setHeldSuccess(
        "Meeting marked Held. Attendance is now available for eligible students.",
      );

      setMeetingReloadKey((current) => current + 1);
      setReloadKey((current) => current + 1);
    } catch (caught) {
      setHeldError(
        caught instanceof Error
          ? caught.message
          : "Unable to update meeting status.",
      );

      setMeetingReloadKey((current) => current + 1);
    } finally {
      setHeldBusy(false);
    }
  };
  useEffect(() => {
    if (!meetingId) {
      setRegister(null);
      setDrafts({});
      return;
    }

    const controller = new AbortController();

    setRegister(null);
    setError("");
    setFeedback({});
    setRegisterLoading(true);

    const loadRegister = async () => {
      try {
        const response = await authService.authFetch(
          `${MODERN_GRADEBOOK_API}/${offeringId}/attendance/meetings/${meetingId}/entries`,
          { signal: controller.signal },
        );

        const data =
          await readJsonResponse<AttendanceEntriesResponse>(response);

        if (controller.signal.aborted) return;

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (
          !response.ok ||
          !data.success ||
          data.offering_id !== offeringId ||
          data.meeting?.meeting_id !== meetingId ||
          !Array.isArray(data.students)
        ) {
          throw new Error(
            data.message || "Unable to load the attendance register.",
          );
        }

        const nextDrafts: Record<number, AttendanceDraft> = {};

        for (const student of data.students) {
          nextDrafts[student.enrollment_subject_id] = {
            status: student.attendance.attendance_status,
            reason: student.attendance.status_reason ?? "",
          };
        }

        setDrafts(nextDrafts);
        setRegister(data);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load attendance.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setRegisterLoading(false);
        }
      }
    };

    void loadRegister();

    return () => controller.abort();
  }, [offeringId, meetingId, reloadKey, navigate]);

  const updateDraft = (id: number, patch: Partial<AttendanceDraft>) => {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...current[id],
        ...patch,
      },
    }));

    setFeedback((current) => ({
      ...current,
      [id]: "",
    }));
  };

  const saveAttendance = async (student: AttendanceStudent) => {
    if (!meetingId || !student.attendance_editable || savingId !== null) {
      return;
    }

    const id = student.enrollment_subject_id;

    if (lockedStudentIds.has(id)) return;

    const draft = drafts[id];

    if (!draft) return;

    const reasonRequired = ["EXCUSED", "NOT_APPLICABLE"].includes(draft.status);

    const reason = reasonRequired ? draft.reason.trim() : null;

    if (reasonRequired && !reason) {
      setFeedback((current) => ({
        ...current,
        [id]: "Add a reason for Excused or N/A.",
      }));
      return;
    }

    if (reason && reason.length > 1000) {
      setFeedback((current) => ({
        ...current,
        [id]: "Reason must be 1000 characters or fewer.",
      }));
      return;
    }

    if (
      draft.status === student.attendance.attendance_status &&
      reason === student.attendance.status_reason
    ) {
      return;
    }

    setSavingId(id);

    setFeedback((current) => ({
      ...current,
      [id]: "",
    }));

    try {
      const response = await authService.authFetch(
        `${MODERN_GRADEBOOK_API}/${offeringId}/attendance/meetings/${meetingId}/entries`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            enrollment_subject_id: id,
            attendance_status: draft.status,
            status_reason: reason,
            record_version: student.attendance.record_version,
            dry_run: false,
          }),
        },
      );

      const data = await readJsonResponse<{
        success: boolean;
        message?: string;
      }>(response);

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Attendance could not be saved.");
      }

      setReloadKey((current) => current + 1);
    } catch (caught) {
      setFeedback((current) => ({
        ...current,
        [id]:
          caught instanceof Error
            ? caught.message
            : "Unable to save attendance.",
      }));
    } finally {
      setSavingId(null);
    }
  };

  const currentRegister =
    register?.offering_id === offeringId &&
    register.meeting.meeting_id === meetingId
      ? register
      : null;

  return (
    <section className="faculty-gradebook">
      <header className="faculty-gradebook-header">
        <div className="faculty-gradebook-header__title">
          <span className="faculty-gradebook-header__icon">
            <CalendarDays size={18} />
          </span>

          <div>
            <span>Class Attendance</span>
            <h2>Attendance Register</h2>
            <p>
              Record attendance only for held class meetings. Pending does not
              mean absent.
            </p>
          </div>
        </div>

        <div className="faculty-gradebook-tools">
          <label className="faculty-gradebook-filter">
            <span>Grading Term</span>

            <select
              value={term}
              disabled={savingId !== null}
              onChange={(event) => {
                setTerm(event.target.value as AssessmentTerm);
                setSelectedMeetingId(null);
              }}
            >
              <option value="MIDTERM">Midterm</option>
              <option value="FINAL_TERM">Final Term</option>
            </select>
          </label>

          <label className="faculty-gradebook-filter">
            <span>Class Meeting</span>

            <select
              value={meetingId ?? ""}
              disabled={!meetingOptions.length || savingId !== null}
              onChange={(event) =>
                setSelectedMeetingId(Number(event.target.value))
              }
            >
              {meetingOptions.length === 0 && (
                <option value="">No meetings</option>
              )}

              {meetingOptions.map((meeting) => (
                <option key={meeting.meeting_id} value={meeting.meeting_id}>
                  {meeting.meeting_date} · {meeting.session_type} ·{" "}
                  {meeting.meeting_status}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <div className="faculty-gradebook-table-meta">
        <strong>Attendance Meetings</strong>

        {canCreateMeeting ? (
          <button
            type="button"
            className="faculty-grade-header-button"
            disabled={createMeetingBusy || savingId !== null}
            onClick={() => {
              setCreateMeetingOpen((current) => !current);
              setCreateMeetingError("");
              setCreateMeetingSuccess("");
            }}
          >
            <CalendarDays size={15} />
            {createMeetingOpen ? "Cancel" : "Add Meeting"}
          </button>
        ) : (
          <small>
            Meeting creation is locked or unavailable for this class.
          </small>
        )}
      </div>

      {createMeetingOpen && canCreateMeeting && (
        <form
          className="faculty-gradebook-tools"
          style={{
            flex: "none",
            width: "100%",
            gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))",
            padding: "14px 16px",
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void createMeeting();
          }}
        >
          <label className="faculty-gradebook-filter">
            <span>Meeting Date</span>
            <input
              type="date"
              className="faculty-grade-input"
              required
              value={meetingDate}
              disabled={createMeetingBusy}
              onChange={(event) => setMeetingDate(event.target.value)}
            />
          </label>

          <label className="faculty-gradebook-filter">
            <span>Session Type</span>
            <select
              value={meetingSession}
              disabled={createMeetingBusy}
              onChange={(event) =>
                setMeetingSession(
                  event.target.value as "LECTURE" | "LABORATORY" | "COMBINED",
                )
              }
            >
              <option value="LECTURE">Lecture</option>

              {meetings?.grading_classification !== "PURE_LECTURE" && (
                <>
                  <option value="LABORATORY">Laboratory</option>
                  <option value="COMBINED">Combined</option>
                </>
              )}
            </select>
          </label>

          <label className="faculty-gradebook-filter">
            <span>Start Time</span>
            <input
              type="time"
              className="faculty-grade-input"
              required
              value={meetingStart}
              disabled={createMeetingBusy}
              onChange={(event) => setMeetingStart(event.target.value)}
            />
          </label>

          <label className="faculty-gradebook-filter">
            <span>End Time</span>
            <input
              type="time"
              className="faculty-grade-input"
              required
              value={meetingEnd}
              disabled={createMeetingBusy}
              onChange={(event) => setMeetingEnd(event.target.value)}
            />
          </label>

          <label className="faculty-gradebook-filter">
            <span>Meeting Notes (optional)</span>
            <input
              type="text"
              className="faculty-grade-input"
              maxLength={2000}
              value={meetingNotes}
              disabled={createMeetingBusy}
              onChange={(event) => setMeetingNotes(event.target.value)}
              placeholder="Class meeting notes"
            />
          </label>

          <button
            type="submit"
            className="faculty-grade-header-button"
            disabled={createMeetingBusy || !canCreateMeeting}
          >
            <Save size={14} />
            {createMeetingBusy ? "Creating..." : "Create Meeting"}
          </button>
        </form>
      )}

      {createMeetingError && (
        <div className="faculty-grade-error" role="alert">
          {createMeetingError}
        </div>
      )}

      {createMeetingSuccess && (
        <div className="faculty-gradebook-table-meta" role="status">
          {createMeetingSuccess}
        </div>
      )}
      {selectedMeeting?.meeting_status === "SCHEDULED" && (
        <div className="faculty-gradebook-table-meta">
          <strong>Meeting Status: Scheduled</strong>

          <label className="faculty-gradebook-filter">
            <span>Reason for marking Held</span>

            <input
              type="text"
              className="faculty-grade-input"
              maxLength={1000}
              value={heldReason}
              placeholder="Class completed as scheduled"
              disabled={!canMarkHeld}
              onChange={(event) => {
                setHeldReason(event.target.value);
                setHeldError("");
              }}
            />
          </label>

          <button
            type="button"
            className="faculty-grade-header-button"
            disabled={!canMarkHeld || heldReason.trim().length < 5}
            onClick={() => void markMeetingHeld()}
          >
            <CheckCircle2 size={15} />
            {heldBusy ? "Updating..." : "Mark as Held"}
          </button>

          {!canMarkHeld && (
            <small>Only completed, editable meetings can be marked Held.</small>
          )}
        </div>
      )}

      {heldError && (
        <div className="faculty-grade-error" role="alert">
          {heldError}
        </div>
      )}

      {heldSuccess && (
        <div className="faculty-gradebook-table-meta" role="status">
          {heldSuccess}
        </div>
      )}
      {error && (
        <div className="faculty-grade-error" role="alert">
          {error}
        </div>
      )}

      {(loading || registerLoading) && (
        <div className="faculty-grade-empty">
          <p>Loading attendance...</p>
        </div>
      )}

      {!loading && !registerLoading && meetingOptions.length === 0 && (
        <div className="faculty-grade-empty">
          <strong>No attendance meetings for this term</strong>
          <p>
            Meetings must be created and marked Held before recording
            attendance.
          </p>
        </div>
      )}

      {!registerLoading && currentRegister && (
        <div className="faculty-grade-table-wrapper">
          <table className="faculty-grade-table" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Attendance</th>
                <th>Reason (Excused / N/A)</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {currentRegister.students.map((student) => {
                const draft = drafts[student.enrollment_subject_id];

                const editable =
                  student.attendance_editable &&
                  !lockedStudentIds.has(student.enrollment_subject_id) &&
                  savingId === null;

                const reasonRequired =
                  draft?.status === "EXCUSED" ||
                  draft?.status === "NOT_APPLICABLE";

                const currentReason = reasonRequired
                  ? draft?.reason.trim() || null
                  : null;

                const changed =
                  draft &&
                  (draft.status !== student.attendance.attendance_status ||
                    currentReason !== student.attendance.status_reason);

                return (
                  <tr key={student.enrollment_subject_id}>
                    <td>
                      <div className="faculty-grade-student">
                        <div>
                          <strong>{student.student_name}</strong>
                          <span>{student.student_number}</span>
                        </div>
                      </div>
                    </td>

                    <td>
                      <select
                        className="faculty-grade-remarks"
                        value={draft?.status ?? "PENDING"}
                        disabled={!editable}
                        onChange={(event) =>
                          updateDraft(student.enrollment_subject_id, {
                            status: event.target.value as AttendanceStatus,
                          })
                        }
                      >
                        <option value="PENDING">Pending</option>
                        <option value="PRESENT">Present</option>
                        <option value="LATE">Late</option>
                        <option value="ABSENT">Absent</option>
                        <option value="EXCUSED">Excused</option>
                        <option value="NOT_APPLICABLE">N/A</option>
                      </select>
                    </td>

                    <td>
                      {reasonRequired ? (
                        <input
                          className="faculty-grade-input"
                          value={draft?.reason ?? ""}
                          maxLength={1000}
                          disabled={!editable}
                          placeholder="Required reason"
                          onChange={(event) =>
                            updateDraft(student.enrollment_subject_id, {
                              reason: event.target.value,
                            })
                          }
                        />
                      ) : (
                        <span>—</span>
                      )}
                    </td>

                    <td>
                      <div className="faculty-grade-row-actions">
                        <button
                          type="button"
                          className="faculty-grade-save"
                          disabled={!editable || !changed || savingId !== null}
                          onClick={() => void saveAttendance(student)}
                        >
                          <Save size={13} />
                          {savingId === student.enrollment_subject_id
                            ? "Saving..."
                            : "Save"}
                        </button>

                        {(!student.attendance_editable ||
                          lockedStudentIds.has(
                            student.enrollment_subject_id,
                          )) && (
                          <small>
                            {lockedStudentIds.has(student.enrollment_subject_id)
                              ? "Official grade locked"
                              : student.attendance_lock_reason?.replaceAll(
                                  "_",
                                  " ",
                                ) || "Locked"}
                          </small>
                        )}

                        {feedback[student.enrollment_subject_id] && (
                          <small role="alert">
                            {feedback[student.enrollment_subject_id]}
                          </small>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
export default function EnterGrades() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const session = authService.getSession();

  const token = authService.getToken();

  const userRole = session?.role;

  const authenticated = Boolean(session && token);

  const requestedOfferingId = useMemo(
    () => parsePositiveInt(searchParams.get("offering_id")),
    [searchParams],
  );

  const [faculty, setFaculty] = useState<FacultyInfo | null>(null);

  const [classes, setClasses] = useState<FacultyClass[]>([]);

  const [classesLoading, setClassesLoading] = useState(true);

  const [classesError, setClassesError] = useState("");

  const [selectedOfferingId, setSelectedOfferingId] = useState<number | null>(
    null,
  );

  const [classSearch, setClassSearch] = useState("");
  const [classSearchFocused, setClassSearchFocused] = useState(false);

  const [gradebookClass, setGradebookClass] = useState<FacultyClass | null>(
    null,
  );

  const [students, setStudents] = useState<GradebookStudent[]>([]);

  const [summary, setSummary] = useState<GradebookSummary>(emptySummary());

  const [gradebookLoading, setGradebookLoading] = useState(false);

  const [gradebookError, setGradebookError] = useState("");

  const [gradebookRefreshKey, setGradebookRefreshKey] = useState(0);

  const [modernGradebook, setModernGradebook] =
    useState<ModernGradebookRosterResponse | null>(null);

  const [modernGradebookLoading, setModernGradebookLoading] = useState(false);

  const [modernGradebookError, setModernGradebookError] = useState("");

  const [assessmentTerm, setAssessmentTerm] =
    useState<AssessmentTerm>("MIDTERM");

  const [assessmentManagerOpen, setAssessmentManagerOpen] = useState(false);
  const [assessmentStructure, setAssessmentStructure] =
    useState<AssessmentStructureResponse | null>(null);
  const [assessmentManagerLoading, setAssessmentManagerLoading] =
    useState(false);
  const [assessmentManagerBusy, setAssessmentManagerBusy] = useState(false);
  const [assessmentManagerError, setAssessmentManagerError] = useState("");
  const [assessmentMode, setAssessmentMode] =
    useState<AssessmentMode>("create");
  const [assessmentTarget, setAssessmentTarget] =
    useState<AssessmentTarget | null>(null);
  const [assessmentCategoryCode, setAssessmentCategoryCode] = useState("");
  const [assessmentName, setAssessmentName] = useState("");
  const [assessmentMaximum, setAssessmentMaximum] = useState("");
  const [assessmentRemovalReason, setAssessmentRemovalReason] = useState("");

  const [forms, setForms] = useState<Record<number, GradeForm>>({});

  const [rowFeedback, setRowFeedback] = useState<Record<number, RowFeedback>>(
    {},
  );

  const [savingId, setSavingId] = useState<number | null>(null);

  const [submittingId, setSubmittingId] = useState<number | null>(null);

  const [submitStudent, setSubmitStudent] = useState<GradebookStudent | null>(
    null,
  );

  const [submitModalError, setSubmitModalError] = useState("");

  const [studentSearch, setStudentSearch] = useState("");

  const [statusFilter, setStatusFilter] = useState("All");

  const [incStudent, setIncStudent] = useState<GradebookStudent | null>(null);

  const [incForm, setIncForm] = useState<IncCompletionForm>({
    midtermGrade: "",
    finalGrade: "",
    completionRemarks: "",
  });

  const [incSubmitting, setIncSubmitting] = useState(false);

  const [incError, setIncError] = useState("");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (userRole !== "Faculty") {
      if (session) {
        navigate(authService.getDashboardRoute(session.role), {
          replace: true,
        });
      }
    }
  }, [authenticated, userRole, session, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Faculty") {
      return;
    }

    const controller = new AbortController();

    const loadClasses = async () => {
      try {
        setClassesLoading(true);

        setClassesError("");

        const response = await authService.authFetch(API_BASE_URL, {
          method: "GET",

          signal: controller.signal,
        });

        const data = await readJsonResponse<FacultyClassesResponse>(response);

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        if (response.status === 403) {
          throw new Error(data.message || "Faculty access is required.");
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || data.error || "Unable to load Faculty classes.",
          );
        }

        const loadedClasses = Array.isArray(data.classes)
          ? data.classes.filter((item) => item.offering_status !== "Cancelled")
          : [];

        setFaculty(data.faculty || null);

        setClasses(loadedClasses);

        if (loadedClasses.length === 0) {
          setSelectedOfferingId(null);

          return;
        }

        setSelectedOfferingId((current) => {
          if (
            requestedOfferingId &&
            loadedClasses.some(
              (item) => item.offering_id === requestedOfferingId,
            )
          ) {
            return requestedOfferingId;
          }

          if (
            current &&
            loadedClasses.some((item) => item.offering_id === current)
          ) {
            return current;
          }

          return loadedClasses[0].offering_id;
        });
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD FACULTY CLASSES ERROR:", requestError);

        setClasses([]);
        setSelectedOfferingId(null);

        setClassesError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load Faculty classes.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setClassesLoading(false);
        }
      }
    };

    void loadClasses();

    return () => {
      controller.abort();
    };
  }, [authenticated, userRole, navigate, requestedOfferingId]);

  const loadGradebook = useCallback(
    async (signal?: AbortSignal) => {
      if (!selectedOfferingId) {
        setGradebookClass(null);

        setStudents([]);
        setForms({});
        setSummary(emptySummary());

        return;
      }

      try {
        setGradebookLoading(true);

        setGradebookError("");

        const response = await authService.authFetch(
          `${API_BASE_URL}/${selectedOfferingId}/gradebook`,
          {
            method: "GET",

            signal,
          },
        );

        const data = await readJsonResponse<GradebookResponse>(response);

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        if (response.status === 403) {
          throw new Error(data.message || "You cannot access this class.");
        }

        if (response.status === 404) {
          throw new Error(data.message || "The selected class was not found.");
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || data.error || "Unable to load the class gradebook.",
          );
        }

        const loadedStudents = Array.isArray(data.students)
          ? data.students
          : [];

        if (data.faculty) {
          setFaculty(data.faculty);
        }

        setGradebookClass(data.class || null);

        setStudents(loadedStudents);

        setSummary({
          total_students: data.summary?.total_students ?? loadedStudents.length,

          without_grade:
            data.summary?.without_grade ??
            loadedStudents.filter((student) => student.grade === null).length,

          draft:
            data.summary?.draft ??
            loadedStudents.filter(
              (student) => student.grade?.grade_status === "Draft",
            ).length,

          submitted:
            data.summary?.submitted ??
            loadedStudents.filter(
              (student) => student.grade?.grade_status === "Submitted",
            ).length,

          returned:
            data.summary?.returned ??
            loadedStudents.filter(
              (student) => student.grade?.grade_status === "Returned",
            ).length,

          approved:
            data.summary?.approved ??
            loadedStudents.filter(
              (student) => student.grade?.grade_status === "Approved",
            ).length,
        });

        const nextForms: Record<number, GradeForm> = {};

        loadedStudents.forEach((student) => {
          nextForms[student.enrollment_subject_id] = createGradeForm(
            student.grade,
          );
        });

        setForms(nextForms);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD FACULTY GRADEBOOK ERROR:", requestError);

        setGradebookClass(null);

        setStudents([]);
        setForms({});
        setSummary(emptySummary());

        setGradebookError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load the class gradebook.",
        );
      } finally {
        if (!signal?.aborted) {
          setGradebookLoading(false);
        }
      }
    },
    [selectedOfferingId, navigate],
  );

  useEffect(() => {
    if (!authenticated || userRole !== "Faculty" || !selectedOfferingId) {
      return;
    }

    const controller = new AbortController();

    void loadGradebook(controller.signal);

    return () => {
      controller.abort();
    };
  }, [
    authenticated,
    userRole,
    selectedOfferingId,
    gradebookRefreshKey,
    loadGradebook,
  ]);
  useEffect(() => {
    if (!authenticated || userRole !== "Faculty" || !selectedOfferingId) {
      setModernGradebook(null);
      setModernGradebookError("");
      setModernGradebookLoading(false);
      return;
    }

    const controller = new AbortController();
    const offeringId = selectedOfferingId;

    const loadModernGradebook = async () => {
      setModernGradebook(null);
      setModernGradebookError("");
      setModernGradebookLoading(true);

      try {
        const response = await authService.authFetch(
          `${MODERN_GRADEBOOK_API}/${offeringId}/roster`,
          { method: "GET", signal: controller.signal },
        );

        if (controller.signal.aborted) return;

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        const data =
          await readJsonResponse<ModernGradebookRosterResponse>(response);

        if (controller.signal.aborted) return;

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || "Unable to load assessment gradebook.",
          );
        }

        if (
          Number(data.offering_id) !== offeringId ||
          !data.terms?.MIDTERM ||
          !data.terms?.FINAL_TERM ||
          !Array.isArray(data.students)
        ) {
          throw new Error("Assessment gradebook returned incomplete data.");
        }

        setModernGradebook(data);
      } catch (error) {
        if (controller.signal.aborted) return;
        setModernGradebookError(
          error instanceof Error
            ? error.message
            : "Unable to load assessment gradebook.",
        );
      } finally {
        if (!controller.signal.aborted) setModernGradebookLoading(false);
      }
    };

    void loadModernGradebook();

    return () => controller.abort();
  }, [
    authenticated,
    userRole,
    selectedOfferingId,
    gradebookRefreshKey,
    navigate,
  ]);

  const saveAssessmentScore = useCallback<SaveAssessmentScore>(
    async (
      offeringId,
      enrollmentSubjectId,
      assessmentId,
      previousVersion,
      scoreStatus,
      earnedScore,
      notApplicableReason,
    ) => {
      const body = {
        enrollment_subject_id: enrollmentSubjectId,
        assessment_id: assessmentId,
        record_version: previousVersion,
        score_status: scoreStatus,
        ...(scoreStatus === "SCORED" ? { earned_score: earnedScore } : {}),
        ...(scoreStatus === "NOT_APPLICABLE"
          ? { not_applicable_reason: notApplicableReason }
          : {}),
        dry_run: false,
      };

      const response = await authService.authFetch(
        `${MODERN_GRADEBOOK_API}/${offeringId}/scores`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        throw new Error("Your session has expired.");
      }

      const data = await readJsonResponse<GradebookScoreSaveResponse>(response);
      if (!response.ok || !data.success || !data.score) {
        throw new Error(
          [data.code, data.message || "Unable to save this assessment score."]
            .filter(Boolean)
            .join(": "),
        );
      }
      if (
        data.persisted !== true ||
        Number(data.offering_id) !== offeringId ||
        Number(data.enrollment_subject_id) !== enrollmentSubjectId ||
        Number(data.assessment_id) !== assessmentId
      ) {
        throw new Error(
          "The score server returned an unexpected result. Reload the gradebook.",
        );
      }

      setModernGradebook((current) => {
        if (!current || current.offering_id !== offeringId) return current;
        return {
          ...current,
          students: current.students.map((student) => {
            if (student.enrollment_subject_id !== enrollmentSubjectId)
              return student;
            const existing =
              student.scores_by_assessment_id[String(assessmentId)];
            // A class refresh or another write must not be overwritten by an older response.
            if ((existing?.record_version ?? null) !== previousVersion)
              return student;
            return {
              ...student,
              scores_by_assessment_id: {
                ...student.scores_by_assessment_id,
                [String(assessmentId)]: {
                  assessment_id: assessmentId,
                  score_id: data.score!.score_id,
                  score_status: data.score!.score_status,
                  earned_score: data.score!.earned_score,
                  not_applicable_reason: data.score!.not_applicable_reason,
                  record_version: data.score!.record_version,
                  updated_at: null,
                  saved: true,
                },
              },
            };
          }),
        };
      });
    },
    [navigate],
  );

  const reloadAfterScoreConflict = useCallback(() => {
    setGradebookRefreshKey((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!assessmentManagerOpen || !selectedOfferingId || !authenticated) {
      return;
    }

    const controller = new AbortController();
    const offeringId = selectedOfferingId;

    const loadAssessmentStructure = async () => {
      setAssessmentStructure(null);
      setAssessmentManagerError("");
      setAssessmentManagerLoading(true);

      try {
        const response = await authService.authFetch(
          `${MODERN_GRADEBOOK_API}/${offeringId}/assessments`,
          { method: "GET", signal: controller.signal },
        );
        const data =
          await readJsonResponse<AssessmentStructureResponse>(response);
        if (controller.signal.aborted) return;

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }
        if (
          !response.ok ||
          !data.success ||
          data.offering_id !== offeringId ||
          !data.terms?.MIDTERM ||
          !data.terms?.FINAL_TERM
        ) {
          throw new Error(
            data.message || "Unable to load assessment settings.",
          );
        }
        setAssessmentStructure(data);
      } catch (error) {
        if (controller.signal.aborted) return;
        setAssessmentManagerError(
          error instanceof Error
            ? error.message
            : "Unable to load assessment settings.",
        );
      } finally {
        if (!controller.signal.aborted) setAssessmentManagerLoading(false);
      }
    };

    void loadAssessmentStructure();
    return () => controller.abort();
  }, [assessmentManagerOpen, selectedOfferingId, authenticated, navigate]);

  const assessmentCategories =
    assessmentStructure?.offering_id === selectedOfferingId
      ? assessmentStructure.terms[assessmentTerm].categories
      : [];
  const assessmentStructureEditable =
    assessmentStructure?.offering_id === selectedOfferingId &&
    assessmentStructure.terms[assessmentTerm].can_edit_structure === true;
  const assessmentExistingColumns = assessmentCategories.flatMap((category) =>
    category.assessments.map((assessment) => ({ category, assessment })),
  );
  const assessmentWriteAllowed =
    assessmentStructureEditable &&
    (assessmentMode === "edit"
      ? [127, 128, 131].includes(selectedOfferingId ?? -1)
      : selectedOfferingId === 131);

  const openAssessmentManager = () => {
    setAssessmentMode("create");
    setAssessmentTarget(null);
    setAssessmentName("");
    setAssessmentMaximum("");
    setAssessmentCategoryCode("");
    setAssessmentRemovalReason("");
    setAssessmentManagerError("");
    setAssessmentManagerOpen(true);
  };

  const closeAssessmentManager = () => {
    if (assessmentManagerBusy) return;
    setAssessmentManagerOpen(false);
    setAssessmentStructure(null);
    setAssessmentManagerError("");
  };

  const beginAssessmentEdit = (
    category: ModernGradebookCategory,
    assessment: ModernGradebookAssessment,
  ) => {
    setAssessmentMode("edit");
    setAssessmentTarget({
      assessment_id: assessment.assessment_id,
      record_version: assessment.record_version,
      category_code: category.category_code,
      header_name: assessment.header_name,
      maximum_score: assessment.maximum_score,
    });
    setAssessmentCategoryCode(category.category_code);
    setAssessmentName(assessment.header_name);
    setAssessmentMaximum(assessment.maximum_score);
    setAssessmentRemovalReason("");
    setAssessmentManagerError("");
  };

  const beginAssessmentRemoval = (
    category: ModernGradebookCategory,
    assessment: ModernGradebookAssessment,
  ) => {
    beginAssessmentEdit(category, assessment);
    setAssessmentMode("remove");
  };

  const resetAssessmentForm = () => {
    setAssessmentMode("create");
    setAssessmentTarget(null);
    setAssessmentCategoryCode("");
    setAssessmentName("");
    setAssessmentMaximum("");
    setAssessmentRemovalReason("");
    setAssessmentManagerError("");
  };

  const saveAssessmentChanges = async () => {
    if (!assessmentWriteAllowed || !selectedOfferingId || assessmentManagerBusy)
      return;
    const offeringId = selectedOfferingId;
    const target = assessmentTarget;

    if (assessmentMode !== "create" && !target) {
      setAssessmentManagerError("Select an assessment before continuing.");
      return;
    }

    const name = assessmentName.trim();
    const max = assessmentMaximum.trim();
    if (assessmentMode !== "remove") {
      if (
        !name ||
        Array.from(name).length > 120 ||
        Array.from(name).some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        })
      ) {
        setAssessmentManagerError(
          "Assessment name must be 1–120 valid characters.",
        );
        return;
      }
      if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(max) || Number(max) <= 0) {
        setAssessmentManagerError(
          "Maximum score must be greater than zero, with up to two decimals.",
        );
        return;
      }
      if (
        assessmentMode === "create" &&
        (!assessmentCategoryCode ||
          assessmentCategoryCode === "ATTENDANCE" ||
          !assessmentCategories.some(
            (item) => item.category_code === assessmentCategoryCode,
          ))
      ) {
        setAssessmentManagerError(
          "Choose an official non-attendance category.",
        );
        return;
      }
    }

    setAssessmentManagerBusy(true);
    setAssessmentManagerError("");
    try {
      const url =
        `${MODERN_GRADEBOOK_API}/${offeringId}/assessments` +
        (target && assessmentMode !== "create"
          ? `/${target.assessment_id}`
          : "");
      const method =
        assessmentMode === "create"
          ? "POST"
          : assessmentMode === "edit"
            ? "PATCH"
            : "DELETE";
      const base =
        assessmentMode === "create"
          ? {
              grading_term: assessmentTerm,
              category_code: assessmentCategoryCode,
              header_name: name,
              maximum_score: max,
            }
          : assessmentMode === "edit"
            ? {
                record_version: target!.record_version,
                header_name: name,
                maximum_score: max,
              }
            : {
                record_version: target!.record_version,
                confirm_removal: true,
                confirm_scored_removal: true,
                change_reason: assessmentRemovalReason.trim(),
              };

      const request = async (dryRun: boolean) => {
        const response = await authService.authFetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...base, dry_run: dryRun }),
        });
        const data =
          await readJsonResponse<AssessmentMutationResponse>(response);
        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          throw new Error("Your session has expired.");
        }
        if (!response.ok || !data.success) {
          throw new Error(
            data.message || data.code || "Assessment request failed.",
          );
        }
        return data;
      };

      const preview = await request(true);
      if (assessmentMode === "remove") {
        const scoredCount = preview.affected_scored_rows ?? 0;
        const affectedCount = preview.affected_score_rows ?? 0;
        const confirmed = window.confirm(
          `Remove "${target!.header_name}" from ${assessmentTerm === "MIDTERM" ? "Midterm" : "Final Term"}?` +
            `\n\nExisting score records: ${affectedCount} (${scoredCount} scored).` +
            "\nSaved score history will be preserved for audit.",
        );
        if (!confirmed) return;
      }
      await request(false);
      setAssessmentManagerOpen(false);
      setAssessmentStructure(null);
      setGradebookRefreshKey((current) => current + 1);
    } catch (error) {
      setAssessmentManagerError(
        error instanceof Error
          ? error.message
          : "Unable to save assessment changes.",
      );
    } finally {
      setAssessmentManagerBusy(false);
    }
  };

  const selectedClass = useMemo(() => {
    return (
      classes.find((item) => item.offering_id === selectedOfferingId) ||
      gradebookClass ||
      null
    );
  }, [classes, selectedOfferingId, gradebookClass]);

  const termAssessmentColumns = useMemo<TermAssessmentColumn[]>(() => {
    if (
      !modernGradebook ||
      modernGradebook.offering_id !== selectedOfferingId
    ) {
      return [];
    }

    const categories = modernGradebook.terms[assessmentTerm].categories;
    if (!Array.isArray(categories)) return [];

    return categories.flatMap<TermAssessmentColumn>((category) => {
      if (
        !Array.isArray(category.assessments) ||
        category.assessments.length === 0
      ) {
        return [{ category, assessment: null }];
      }
      return category.assessments.map((assessment) => ({
        category,
        assessment,
      }));
    });
  }, [modernGradebook, selectedOfferingId, assessmentTerm]);

  const modernStudentByEnrollmentSubject = useMemo(() => {
    const roster =
      modernGradebook?.offering_id === selectedOfferingId
        ? modernGradebook.students
        : [];

    return new Map(
      roster.map((student) => [student.enrollment_subject_id, student]),
    );
  }, [modernGradebook, selectedOfferingId]);

  const filteredStudents = useMemo(() => {
    const query = studentSearch.trim().toLowerCase();

    return students.filter((student) => {
      const matchesSearch =
        !query ||
        student.student_number.toLowerCase().includes(query) ||
        student.full_name.toLowerCase().includes(query) ||
        (student.email || "").toLowerCase().includes(query);

      const currentStatus = getGradeStatus(student);

      const matchesStatus =
        statusFilter === "All" || currentStatus === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [students, studentSearch, statusFilter]);

  const handleClassChange = (value: string) => {
    const nextId = parsePositiveInt(value);

    if (!nextId) {
      return;
    }

    if (nextId === selectedOfferingId) {
      return;
    }

    setAssessmentManagerOpen(false);
    setAssessmentStructure(null);
    setSelectedOfferingId(nextId);

    setStudentSearch("");
    setStatusFilter("All");

    setRowFeedback({});

    setGradebookError("");
  };

  const filteredAssignedClasses = useMemo(() => {
    const query = classSearch.trim().toLowerCase();

    if (!query) {
      return [];
    }

    return classes.filter((item) => {
      const searchableText = [
        String(item.offering_id),
        item.subject.subject_code,
        item.subject.subject_name,
        item.section.section_name,
        item.section.course.course_code,
        item.section.course.course_name,
        item.academic_period.academic_year,
        item.academic_period.semester_name,
        item.schedule.days || "",
        item.schedule.time || "",
        getRoomLabel(item.room),
        item.offering_status,
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(query);
    });
  }, [classes, classSearch]);

  const selectAssignedClass = (item: FacultyClass) => {
    handleClassChange(String(item.offering_id));
    setClassSearch("");
  };

  const updateForm = (
    enrollmentSubjectId: number,
    field: keyof GradeForm,
    value: string,
  ) => {
    setForms((current) => ({
      ...current,

      [enrollmentSubjectId]: {
        ...(current[enrollmentSubjectId] || {
          gradingOutcome: "NUMERIC",
          outcomeReason: "",
          midtermGrade: "",
          finalGrade: "",
        }),

        [field]: value,
      },
    }));

    setRowFeedback((current) => {
      const next = {
        ...current,
      };

      delete next[enrollmentSubjectId];

      return next;
    });
  };

  const buildGradeBody = (form: GradeForm) => {
    const specialOutcome = form.gradingOutcome !== "NUMERIC";

    return {
      midterm_grade: specialOutcome ? null : form.midtermGrade.trim() || null,
      final_grade: specialOutcome ? null : form.finalGrade.trim() || null,
      grading_outcome: form.gradingOutcome,
      outcome_reason: specialOutcome ? form.outcomeReason.trim() : null,
    };
  };

  const validateOutcomeReason = (form: GradeForm): string | null => {
    if (form.gradingOutcome === "NUMERIC") {
      return null;
    }

    const reason = form.outcomeReason.trim();

    if (!reason) {
      return "A reason is required for Incomplete or Unofficial Drop.";
    }

    if (reason.length > 500) {
      return "Outcome reason must not exceed 500 characters.";
    }

    return null;
  };

  const validateNumericFields = (form: GradeForm): string | null => {
    if (form.gradingOutcome !== "NUMERIC") {
      return validateOutcomeReason(form);
    }

    return (
      validatePercentageField(form.midtermGrade, "Midterm") ||
      validatePercentageField(form.finalGrade, "Final Term")
    );
  };

  const validateForSubmit = (form: GradeForm): string | null => {
    if (form.gradingOutcome !== "NUMERIC") {
      return validateOutcomeReason(form);
    }

    return (
      validatePercentageField(form.midtermGrade, "Midterm", true) ||
      validatePercentageField(form.finalGrade, "Final Term", true)
    );
  };

  const saveDraftRequest = async (
    student: GradebookStudent,
    showSuccess: boolean,
  ) => {
    if (!selectedOfferingId) {
      throw new Error("No class is selected.");
    }

    const id = student.enrollment_subject_id;

    const form = forms[id];

    if (!form) {
      throw new Error("Grade form is unavailable.");
    }

    const numericError = validateNumericFields(form);

    if (numericError) {
      throw new Error(numericError);
    }

    const response = await authService.authFetch(
      `${API_BASE_URL}/${selectedOfferingId}/grades/${id}/draft`,
      {
        method: "PUT",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify(buildGradeBody(form)),
      },
    );

    const data = await readJsonResponse<GradeMutationResponse>(response);

    if (response.status === 401) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      throw new Error("Your session has expired.");
    }

    if (!response.ok || !data.success) {
      throw new Error(data.message || data.error || "Unable to save grade.");
    }

    if (showSuccess) {
      setRowFeedback((current) => ({
        ...current,

        [id]: {
          type: "success",

          message: data.message || "Draft grade saved successfully.",
        },
      }));
    }

    return data;
  };

  const saveDraft = async (student: GradebookStudent) => {
    const id = student.enrollment_subject_id;

    if (!isEditable(student)) {
      return;
    }

    try {
      setSavingId(id);

      setRowFeedback((current) => {
        const next = {
          ...current,
        };

        delete next[id];

        return next;
      });

      await saveDraftRequest(student, true);

      setGradebookRefreshKey((current) => current + 1);
    } catch (requestError) {
      console.error("SAVE FACULTY DRAFT GRADE ERROR:", requestError);

      setRowFeedback((current) => ({
        ...current,

        [id]: {
          type: "error",

          message:
            requestError instanceof Error
              ? requestError.message
              : "Unable to save draft grade.",
        },
      }));
    } finally {
      setSavingId(null);
    }
  };

  const submitGrade = (student: GradebookStudent) => {
    if (!selectedOfferingId) {
      return;
    }

    const id = student.enrollment_subject_id;

    if (!isEditable(student)) {
      return;
    }

    const form = forms[id];

    if (!form) {
      return;
    }

    const validationError = validateForSubmit(form);

    if (validationError) {
      setRowFeedback((current) => ({
        ...current,

        [id]: {
          type: "error",

          message: validationError,
        },
      }));

      return;
    }

    setSubmitModalError("");
    setSubmitStudent(student);
  };

  const closeSubmitModal = () => {
    if (submitStudent && submittingId === submitStudent.enrollment_subject_id) {
      return;
    }

    setSubmitStudent(null);
    setSubmitModalError("");
  };

  const confirmSubmitGrade = async () => {
    if (!submitStudent || !selectedOfferingId) {
      return;
    }

    const student = submitStudent;
    const id = student.enrollment_subject_id;

    if (!isEditable(student)) {
      setSubmitStudent(null);
      return;
    }

    const form = forms[id];

    if (!form) {
      setSubmitModalError("Grade form is unavailable.");
      return;
    }

    const validationError = validateForSubmit(form);

    if (validationError) {
      setSubmitModalError(validationError);

      setRowFeedback((current) => ({
        ...current,

        [id]: {
          type: "error",
          message: validationError,
        },
      }));

      return;
    }

    try {
      setSubmittingId(id);
      setSubmitModalError("");

      setRowFeedback((current) => {
        const next = {
          ...current,
        };

        delete next[id];

        return next;
      });

      await saveDraftRequest(student, false);

      const response = await authService.authFetch(
        `${API_BASE_URL}/${selectedOfferingId}/grades/${id}/submit`,
        {
          method: "PATCH",
        },
      );

      const data = await readJsonResponse<GradeMutationResponse>(response);

      if (response.status === 401) {
        authService.logout();

        navigate("/login", {
          replace: true,
        });

        return;
      }

      if (!response.ok || !data.success) {
        const missing =
          Array.isArray(data.missing_fields) && data.missing_fields.length > 0
            ? ` Missing: ${data.missing_fields.join(", ")}.`
            : "";

        throw new Error(
          `${
            data.message || data.error || "Unable to submit grade."
          }${missing}`,
        );
      }

      setRowFeedback((current) => ({
        ...current,

        [id]: {
          type: "success",

          message: data.message || "Grade submitted successfully.",
        },
      }));

      setSubmitStudent(null);
      setSubmitModalError("");

      setGradebookRefreshKey((current) => current + 1);
    } catch (requestError) {
      console.error("SUBMIT FACULTY GRADE ERROR:", requestError);

      const message =
        requestError instanceof Error
          ? requestError.message
          : "Unable to submit grade.";

      setSubmitModalError(message);

      setRowFeedback((current) => ({
        ...current,

        [id]: {
          type: "error",

          message,
        },
      }));
    } finally {
      setSubmittingId(null);
    }
  };

  const submitModalForm = submitStudent
    ? forms[submitStudent.enrollment_subject_id] ||
      createGradeForm(submitStudent.grade)
    : null;

  const submitModalPreview = submitModalForm
    ? calculateGradePreview(submitModalForm)
    : null;

  const submitModalOutcomeLabel =
    submitModalForm?.gradingOutcome === "NUMERIC"
      ? "Numeric Grade"
      : submitModalForm?.gradingOutcome === "INCOMPLETE"
        ? "Incomplete"
        : submitModalForm?.gradingOutcome === "UNOFFICIAL_DROP"
          ? "Unofficial Drop"
          : "—";

  const openIncCompletion = (student: GradebookStudent) => {
    if (!isApprovedIncomplete(student)) {
      return;
    }

    setIncStudent(student);

    setIncForm({
      midtermGrade: gradeValueToString(student.grade?.midterm_grade),
      finalGrade: gradeValueToString(student.grade?.final_grade),
      completionRemarks: "",
    });

    setIncError("");
  };

  const closeIncCompletion = () => {
    if (incSubmitting) {
      return;
    }

    setIncStudent(null);

    setIncForm({
      midtermGrade: "",
      finalGrade: "",
      completionRemarks: "",
    });

    setIncError("");
  };

  const incPreview = calculateGradePreview({
    gradingOutcome: "NUMERIC",
    outcomeReason: "",
    midtermGrade: incForm.midtermGrade,
    finalGrade: incForm.finalGrade,
  });

  const submitIncCompletion = async () => {
    if (!incStudent || !selectedOfferingId) {
      return;
    }

    const midtermError = validatePercentageField(
      incForm.midtermGrade,
      "Midterm",
      true,
    );

    if (midtermError) {
      setIncError(midtermError);
      return;
    }

    const finalError = validatePercentageField(
      incForm.finalGrade,
      "Final Term",
      true,
    );

    if (finalError) {
      setIncError(finalError);
      return;
    }

    const completionRemarks = incForm.completionRemarks.trim();

    if (!completionRemarks) {
      setIncError("Completion remarks are required.");
      return;
    }

    if (completionRemarks.length > 1000) {
      setIncError("Completion remarks must not exceed 1000 characters.");
      return;
    }

    if (!incPreview.complete) {
      setIncError("Both Midterm and Final Term grades are required.");
      return;
    }

    const confirmed = window.confirm(
      `Submit INC completion for ${incStudent.student_number} - ${incStudent.full_name}?\n\n` +
        `Midterm: ${incForm.midtermGrade}\n` +
        `Final Term: ${incForm.finalGrade}\n` +
        `Overall: ${
          incPreview.overallPercentage !== null
            ? incPreview.overallPercentage.toFixed(2)
            : "—"
        }\n` +
        `Final Rating: ${
          incPreview.finalRating !== null
            ? incPreview.finalRating.toFixed(2)
            : "—"
        }\n` +
        `Result: ${incPreview.remarks || "—"}\n\n` +
        "This will be sent to the Program Head for approval.",
    );

    if (!confirmed) {
      return;
    }

    try {
      setIncSubmitting(true);
      setIncError("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${selectedOfferingId}/grades/${incStudent.enrollment_subject_id}/inc-completion`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            midterm_grade: Number(incForm.midtermGrade),
            final_grade: Number(incForm.finalGrade),
            completion_remarks: completionRemarks,
          }),
        },
      );

      const data = await readJsonResponse<IncCompletionResponse>(response);

      if (response.status === 401) {
        authService.logout();

        navigate("/login", {
          replace: true,
        });

        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
            data.error ||
            "Unable to submit INC completion request.",
        );
      }

      const enrollmentSubjectId = incStudent.enrollment_subject_id;

      setRowFeedback((current) => ({
        ...current,
        [enrollmentSubjectId]: {
          type: "success",
          message:
            data.message ||
            "INC completion request submitted to the Program Head.",
        },
      }));

      setIncStudent(null);

      setIncForm({
        midtermGrade: "",
        finalGrade: "",
        completionRemarks: "",
      });

      setGradebookRefreshKey((current) => current + 1);
    } catch (requestError) {
      console.error("SUBMIT INC COMPLETION ERROR:", requestError);

      setIncError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to submit INC completion request.",
      );
    } finally {
      setIncSubmitting(false);
    }
  };

  const refreshGradebook = () => {
    setGradebookRefreshKey((current) => current + 1);
  };

  const backToClasses = () => {
    navigate("/faculty/classes");
  };

  const viewRoster = () => {
    if (!selectedOfferingId) {
      return;
    }

    navigate(`/faculty/classes/students?offering_id=${selectedOfferingId}`);
  };

  if (!authenticated || userRole !== "Faculty") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="faculty-enter-grades-page">
        <section className="faculty-grade-header">
          <div className="faculty-grade-header__copy">
            <div className="faculty-grade-eyebrow">
              <span className="faculty-grade-eyebrow__icon">
                <FilePenLine size={16} strokeWidth={2.2} />
              </span>
              Faculty · Grade Encoding
            </div>

            <h1>Enter Grades</h1>

            <p>
              Encode and submit grades for students with official Approved
              enrollment in your assigned classes.
            </p>
          </div>

          <div className="faculty-grade-header-actions">
            <button
              type="button"
              className="faculty-grade-header-button"
              onClick={viewRoster}
              disabled={!selectedOfferingId}
            >
              <UsersRound size={16} />
              View Student List
            </button>

            <button
              type="button"
              className="faculty-grade-header-button faculty-grade-header-button--back"
              onClick={backToClasses}
            >
              <ArrowLeft size={16} strokeWidth={2.1} />
              My Classes
            </button>
          </div>
        </section>

        <section className="faculty-grade-toolbar">
          <div className="faculty-grade-faculty">
            <span className="faculty-grade-faculty__icon">
              <GraduationCap size={20} />
            </span>

            <div className="faculty-grade-faculty__copy">
              <small>Faculty</small>
              <strong>{faculty?.faculty_name || "Faculty"}</strong>
              <span>
                {faculty?.employee_number || "Employee number unavailable"}
              </span>
            </div>
          </div>

          <div className="faculty-grade-class-select">
            <div className="faculty-grade-class-select__heading">
              <div>
                <small>Gradebook Context</small>
                <strong>Select Assigned Class</strong>
              </div>

              <span>
                {classes.length} class{classes.length === 1 ? "" : "es"}
              </span>
            </div>

            <div className="faculty-assigned-class-search">
              <label htmlFor="faculty-grade-class">Search Assigned Class</label>

              <div className="faculty-assigned-class-search__control">
                <div className="faculty-assigned-class-search__input">
                  <Search size={16} />

                  <input
                    id="faculty-grade-class"
                    type="text"
                    name="faculty-assigned-class-filter"
                    value={classSearch}
                    onChange={(event) => setClassSearch(event.target.value)}
                    onFocus={() => setClassSearchFocused(true)}
                    onBlur={() => {
                      window.setTimeout(() => {
                        setClassSearchFocused(false);
                      }, 120);
                    }}
                    placeholder="Search subject, section, course, year..."
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={classesLoading || classes.length === 0}
                  />

                  {classSearch && (
                    <button
                      type="button"
                      aria-label="Clear class search"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setClassSearch("")}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>

                {classSearchFocused && classSearch.trim() && (
                  <div
                    className="faculty-assigned-class-suggestions"
                    role="listbox"
                    aria-label="Matching assigned classes"
                  >
                    {filteredAssignedClasses.length === 0 ? (
                      <div className="faculty-assigned-class-suggestions__empty">
                        <Search size={16} />
                        <span>No matching assigned class</span>
                      </div>
                    ) : (
                      filteredAssignedClasses.slice(0, 8).map((item) => {
                        const isSelected =
                          item.offering_id === selectedOfferingId;

                        return (
                          <button
                            key={item.offering_id}
                            type="button"
                            className={`faculty-assigned-class-suggestion ${
                              isSelected ? "is-selected" : ""
                            }`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              selectAssignedClass(item);
                              setClassSearchFocused(false);
                            }}
                          >
                            <div>
                              <strong>
                                {item.subject.subject_code} —{" "}
                                {item.section.section_name}
                              </strong>
                              <span>
                                {item.academic_period.academic_year} /{" "}
                                {item.academic_period.semester_name}
                              </span>
                            </div>

                            <small>
                              {item.subject.subject_name} ·{" "}
                              {item.section.course.course_code}
                            </small>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              <small>Start typing to see matching assigned classes.</small>
            </div>
          </div>
        </section>

        {classesError && (
          <section className="faculty-grade-error" role="alert">
            <span className="faculty-grade-error__icon">
              <AlertCircle size={20} />
            </span>

            <div>
              <strong>Assigned classes could not be loaded</strong>
              <p>{classesError}</p>
            </div>
          </section>
        )}

        {selectedClass && (
          <section className="faculty-grade-class-card">
            <div className="faculty-grade-subject">
              <div className="faculty-grade-subject__label">
                <span className="faculty-grade-subject__icon">
                  <BookOpenCheck size={18} />
                </span>
                Selected Subject
              </div>

              <strong>{selectedClass.subject.subject_code}</strong>
              <p>{selectedClass.subject.subject_name}</p>

              <span className="faculty-grade-subject__units">
                {selectedClass.subject.units} unit
                {selectedClass.subject.units === 1 ? "" : "s"}
              </span>
            </div>

            <div className="faculty-grade-class-details">
              <div>
                <span className="faculty-grade-detail-icon">
                  <GraduationCap size={15} />
                </span>
                <section>
                  <small>Section</small>
                  <strong>{selectedClass.section.section_name}</strong>
                  <p>
                    {selectedClass.section.course.course_code} · Year{" "}
                    {selectedClass.section.year_level}
                  </p>
                </section>
              </div>

              <div>
                <span className="faculty-grade-detail-icon">
                  <CalendarDays size={15} />
                </span>
                <section>
                  <small>Academic Period</small>
                  <strong>{selectedClass.academic_period.academic_year}</strong>
                  <p>{selectedClass.academic_period.semester_name}</p>
                </section>
              </div>

              <div>
                <span className="faculty-grade-detail-icon">
                  <Clock3 size={15} />
                </span>
                <section>
                  <small>Schedule</small>
                  <strong>{formatDays(selectedClass.schedule.days)}</strong>
                  <p>{selectedClass.schedule.time || "Not scheduled"}</p>
                </section>
              </div>

              <div>
                <span className="faculty-grade-detail-icon">
                  <MapPin size={15} />
                </span>
                <section>
                  <small>Room</small>
                  <strong>{getRoomLabel(selectedClass.room)}</strong>
                  <p>Registrar-assigned classroom</p>
                </section>
              </div>

              <div>
                <span className="faculty-grade-detail-icon">
                  <UsersRound size={15} />
                </span>
                <section>
                  <small>Official Students</small>
                  <strong>{summary.total_students}</strong>
                  <p title={modernGradebookError || undefined}>
                    {modernGradebook?.offering_id === selectedOfferingId
                      ? `${modernGradebook.active_assessment_count} assessments connected`
                      : modernGradebookLoading
                        ? "Checking assessment gradebook..."
                        : modernGradebookError
                          ? "Assessment gradebook unavailable"
                          : "Approved enrollment memberships"}
                  </p>
                </section>
              </div>

              <div>
                <span className="faculty-grade-detail-icon">
                  <ShieldCheck size={15} />
                </span>
                <section>
                  <small>Offering Status</small>
                  <strong
                    className={`faculty-grade-offering-status ${selectedClass.offering_status.toLowerCase()}`}
                  >
                    {selectedClass.offering_status}
                  </strong>
                  <p>Current class availability</p>
                </section>
              </div>
            </div>
          </section>
        )}

        <section
          className="faculty-grade-summary"
          aria-label="Grade status summary"
        >
          <article className="faculty-grade-summary-card faculty-grade-summary-card--total">
            <span className="faculty-grade-summary-icon">
              <UsersRound size={18} />
            </span>
            <div>
              <small>Official Students</small>
              <strong>{summary.total_students}</strong>
              <span>Students in this gradebook</span>
            </div>
          </article>

          <article className="faculty-grade-summary-card faculty-grade-summary-card--empty">
            <span className="faculty-grade-summary-icon">
              <CircleDashed size={18} />
            </span>
            <div>
              <small>Not Started</small>
              <strong>{summary.without_grade}</strong>
              <span>No grade record yet</span>
            </div>
          </article>

          <article className="faculty-grade-summary-card faculty-grade-summary-card--draft">
            <span className="faculty-grade-summary-icon">
              <FilePenLine size={18} />
            </span>
            <div>
              <small>Draft</small>
              <strong>{summary.draft}</strong>
              <span>Still editable</span>
            </div>
          </article>

          <article className="faculty-grade-summary-card faculty-grade-summary-card--submitted">
            <span className="faculty-grade-summary-icon">
              <Send size={18} />
            </span>
            <div>
              <small>Submitted</small>
              <strong>{summary.submitted}</strong>
              <span>Waiting for review</span>
            </div>
          </article>

          <article className="faculty-grade-summary-card faculty-grade-summary-card--returned">
            <span className="faculty-grade-summary-icon">
              <RotateCcw size={18} />
            </span>
            <div>
              <small>Returned</small>
              <strong>{summary.returned}</strong>
              <span>Needs correction</span>
            </div>
          </article>

          <article className="faculty-grade-summary-card faculty-grade-summary-card--approved">
            <span className="faculty-grade-summary-icon">
              <BadgeCheck size={18} />
            </span>
            <div>
              <small>Approved</small>
              <strong>{summary.approved}</strong>
              <span>Official and locked</span>
            </div>
          </article>
        </section>

        {gradebookError && (
          <section className="faculty-grade-error" role="alert">
            <span className="faculty-grade-error__icon">
              <AlertCircle size={20} />
            </span>

            <div>
              <strong>Gradebook could not be loaded</strong>
              <p>{gradebookError}</p>
            </div>

            <button type="button" onClick={refreshGradebook}>
              <RefreshCw size={14} />
              Try Again
            </button>
          </section>
        )}

        {(classesLoading || gradebookLoading) && (
          <section className="faculty-grade-loading">
            <div className="faculty-grade-spinner" />

            <div>
              <strong>Loading gradebook</strong>
              <span>Retrieving official students and grade records...</span>
            </div>
          </section>
        )}

        {!classesLoading &&
          !gradebookLoading &&
          !gradebookError &&
          gradebookClass && (
            <section className="faculty-gradebook">
              <header className="faculty-gradebook-header">
                <div className="faculty-gradebook-header__title">
                  <span className="faculty-gradebook-header__icon">
                    <BookOpenCheck size={18} />
                  </span>

                  <div>
                    <span>Official Class Record</span>
                    <h2>Class Gradebook</h2>
                    <p>
                      View recorded grades and encode assessment scores for
                      eligible students. Legacy percentage entry remains
                      read-only.
                    </p>
                  </div>
                </div>

                <div className="faculty-gradebook-tools">
                  <label className="faculty-gradebook-search">
                    <span>Search Student</span>
                    <div>
                      <Search size={15} />
                      <input
                        type="search"
                        value={studentSearch}
                        onChange={(event) =>
                          setStudentSearch(event.target.value)
                        }
                        placeholder="Name, student no., or email..."
                      />
                    </div>
                  </label>

                  <label className="faculty-gradebook-filter">
                    <span>
                      <Filter size={13} />
                      Grade Status
                    </span>
                    <select
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value)}
                    >
                      <option value="All">All Statuses</option>
                      <option value="Not Started">Not Started</option>
                      <option value="Draft">Draft</option>
                      <option value="Submitted">Submitted</option>
                      <option value="Returned">Returned</option>
                      <option value="Approved">Approved</option>
                    </select>
                  </label>
                </div>
              </header>

              {students.length === 0 ? (
                <div className="faculty-grade-empty">
                  <span className="faculty-grade-empty__icon">
                    <UsersRound size={23} />
                  </span>
                  <strong>No official students</strong>
                  <p>This class has no Approved enrollment memberships.</p>
                  {modernGradebook?.offering_id === selectedOfferingId && (
                    <button type="button" onClick={openAssessmentManager}>
                      <FilePenLine size={14} />
                      Manage Assessments
                    </button>
                  )}
                </div>
              ) : filteredStudents.length === 0 ? (
                <div className="faculty-grade-empty">
                  <span className="faculty-grade-empty__icon">
                    <Search size={23} />
                  </span>
                  <strong>No matching students</strong>
                  <p>No gradebook row matches your current filters.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setStudentSearch("");
                      setStatusFilter("All");
                    }}
                  >
                    <RotateCcw size={14} />
                    Clear Filters
                  </button>
                </div>
              ) : (
                <>
                  <div className="faculty-gradebook-table-meta">
                    <span>
                      Showing <strong>{filteredStudents.length}</strong> of{" "}
                      <strong>{students.length}</strong> students
                      {termAssessmentColumns.length > 0 &&
                        " · Scroll right to enter assessment scores"}
                    </span>
                    {modernGradebook?.offering_id === selectedOfferingId ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "end",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <label className="faculty-gradebook-filter">
                          <span>Assessment Term</span>
                          <select
                            value={assessmentTerm}
                            onChange={(event) =>
                              setAssessmentTerm(
                                event.target.value as "MIDTERM" | "FINAL_TERM",
                              )
                            }
                            aria-label="Assessment term to display"
                          >
                            <option value="MIDTERM">Midterm</option>
                            <option value="FINAL_TERM">Final Term</option>
                          </select>
                        </label>
                        <button
                          type="button"
                          className="faculty-grade-header-button"
                          onClick={openAssessmentManager}
                          disabled={assessmentManagerBusy}
                        >
                          <FilePenLine size={15} />
                          Manage Assessments
                        </button>
                      </div>
                    ) : (
                      <small title={modernGradebookError || undefined}>
                        {modernGradebookLoading
                          ? "Loading assessment columns..."
                          : modernGradebookError
                            ? `Assessment data unavailable: ${modernGradebookError}`
                            : "Direct percentage entry is read-only."}
                      </small>
                    )}
                  </div>

                  <div className="faculty-grade-table-wrapper">
                    <table
                      className="faculty-grade-table"
                      style={{
                        minWidth: 1910 + termAssessmentColumns.length * 185,
                      }}
                    >
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Outcome</th>
                          <th>Midterm %</th>
                          <th>Final Term %</th>
                          <th>Overall %</th>
                          <th>Final Rating</th>
                          <th>Result</th>
                          <th>Reason</th>
                          <th>Status</th>
                          <th>Program Head Review</th>
                          <th>Actions</th>
                          {termAssessmentColumns.map(
                            ({ category, assessment }) => (
                              <th
                                key={`${category.category_code}:${assessment?.assessment_id ?? "none"}`}
                                title={`${category.category_name} · ${category.category_percent}%`}
                                style={{ width: 185, minWidth: 185 }}
                              >
                                <div>
                                  {category.category_name} ·{" "}
                                  {category.category_percent}%
                                </div>
                                <small>
                                  {assessment
                                    ? `${assessment.header_name} (Max ${assessment.maximum_score})`
                                    : category.category_code === "ATTENDANCE"
                                      ? "Per-meeting attendance"
                                      : "No assessment yet"}
                                </small>
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>

                      <tbody>
                        {filteredStudents.map((student) => {
                          const id = student.enrollment_subject_id;
                          const form =
                            forms[id] || createGradeForm(student.grade);
                          const editable = isEditable(student);
                          const isSaving = savingId === id;
                          const isSubmitting = submittingId === id;
                          const busy = isSaving || isSubmitting;
                          const status = getGradeStatus(student);
                          const feedback = rowFeedback[id];
                          const preview = calculateGradePreview(form);

                          const useStoredResult =
                            !editable && Boolean(student.grade);

                          const overallPercentage = useStoredResult
                            ? (student.grade?.overall_percentage ?? null)
                            : preview.overallPercentage;

                          const finalRating = useStoredResult
                            ? (student.grade?.final_rating ?? null)
                            : preview.finalRating;

                          const resultRemark = useStoredResult
                            ? (student.grade?.remarks ?? null)
                            : preview.remarks;

                          return (
                            <tr
                              key={id}
                              className={
                                student.grade?.grade_status === "Returned"
                                  ? "returned-row"
                                  : ""
                              }
                            >
                              <td>
                                <div className="faculty-grade-student">
                                  <span className="faculty-grade-student__avatar">
                                    <UserRound size={16} />
                                  </span>

                                  <div>
                                    <strong>{student.full_name}</strong>
                                    <span>{student.student_number}</span>
                                    <small>
                                      Enrollment Subject #
                                      {student.enrollment_subject_id}
                                    </small>
                                  </div>
                                </div>
                              </td>

                              <td>
                                <select
                                  className="faculty-grade-remarks"
                                  value={form.gradingOutcome}
                                  onChange={(event) =>
                                    updateForm(
                                      id,
                                      "gradingOutcome",
                                      event.target.value as GradeOutcome,
                                    )
                                  }
                                  disabled={!editable || busy}
                                  aria-label={`Grade outcome for ${student.full_name}`}
                                >
                                  <option value="NUMERIC">Numeric Grade</option>
                                  <option value="INCOMPLETE">Incomplete</option>
                                  <option value="UNOFFICIAL_DROP">
                                    Unofficial Drop
                                  </option>
                                </select>
                              </td>

                              <td>
                                <input
                                  className="faculty-grade-input"
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.01"
                                  value={form.midtermGrade}
                                  onChange={(event) =>
                                    updateForm(
                                      id,
                                      "midtermGrade",
                                      event.target.value,
                                    )
                                  }
                                  disabled={
                                    !editable ||
                                    busy ||
                                    form.gradingOutcome !== "NUMERIC"
                                  }
                                  placeholder={
                                    form.gradingOutcome === "NUMERIC"
                                      ? "0-100"
                                      : "—"
                                  }
                                  aria-label={`Midterm percentage for ${student.full_name}`}
                                />
                              </td>

                              <td>
                                <input
                                  className="faculty-grade-input"
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.01"
                                  value={form.finalGrade}
                                  onChange={(event) =>
                                    updateForm(
                                      id,
                                      "finalGrade",
                                      event.target.value,
                                    )
                                  }
                                  disabled={
                                    !editable ||
                                    busy ||
                                    form.gradingOutcome !== "NUMERIC"
                                  }
                                  placeholder={
                                    form.gradingOutcome === "NUMERIC"
                                      ? "0-100"
                                      : "—"
                                  }
                                  aria-label={`Final Term percentage for ${student.full_name}`}
                                />
                              </td>

                              <td>
                                <div className="faculty-grade-rating-field">
                                  <strong>
                                    {overallPercentage !== null
                                      ? overallPercentage.toFixed(3)
                                      : "—"}
                                  </strong>
                                  <small>Automatic 50/50 average</small>
                                </div>
                              </td>

                              <td>
                                <div className="faculty-grade-rating-field">
                                  <strong>
                                    {finalRating !== null
                                      ? Number(finalRating).toFixed(2)
                                      : "—"}
                                  </strong>
                                  <small>Automatic</small>
                                </div>
                              </td>

                              <td>
                                <div className="faculty-grade-rating-field">
                                  <strong>{resultRemark || "—"}</strong>
                                  <small>Calculated by policy</small>
                                </div>
                              </td>

                              <td>
                                {form.gradingOutcome === "NUMERIC" ? (
                                  <span className="faculty-grade-no-review">
                                    Not required
                                  </span>
                                ) : (
                                  <input
                                    className="faculty-grade-remarks"
                                    type="text"
                                    maxLength={500}
                                    value={form.outcomeReason}
                                    onChange={(event) =>
                                      updateForm(
                                        id,
                                        "outcomeReason",
                                        event.target.value,
                                      )
                                    }
                                    disabled={!editable || busy}
                                    placeholder={
                                      form.gradingOutcome === "INCOMPLETE"
                                        ? "Reason for incomplete..."
                                        : "Reason for unofficial drop..."
                                    }
                                    aria-label={`Outcome reason for ${student.full_name}`}
                                  />
                                )}
                              </td>

                              <td>
                                <div className="faculty-grade-status-cell">
                                  <span
                                    className={`faculty-grade-status ${status
                                      .toLowerCase()
                                      .replace(/\s+/g, "-")}`}
                                  >
                                    {status}
                                  </span>

                                  {student.grade?.submitted_at && (
                                    <small>
                                      Submitted{" "}
                                      {formatDateTime(
                                        student.grade.submitted_at,
                                      )}
                                    </small>
                                  )}
                                </div>
                              </td>

                              <td>
                                {student.grade?.review?.review_remarks ? (
                                  <div className="faculty-grade-review">
                                    <span className="faculty-grade-review__icon">
                                      <MessageSquareText size={14} />
                                    </span>

                                    <div>
                                      <strong>
                                        {student.grade.review
                                          .reviewed_by_username ||
                                          "Program Head"}
                                      </strong>
                                      <p>
                                        {student.grade.review.review_remarks}
                                      </p>
                                      <small>
                                        {formatDateTime(
                                          student.grade.review.reviewed_at,
                                        )}
                                      </small>
                                    </div>
                                  </div>
                                ) : student.grade?.grade_status ===
                                  "Approved" ? (
                                  <div className="faculty-grade-review approved">
                                    <span className="faculty-grade-review__icon">
                                      <CheckCircle2 size={14} />
                                    </span>

                                    <div>
                                      <strong>Approved</strong>
                                      <small>
                                        {formatDateTime(
                                          student.grade.review.reviewed_at,
                                        )}
                                      </small>
                                    </div>
                                  </div>
                                ) : (
                                  <span className="faculty-grade-no-review">
                                    No review yet
                                  </span>
                                )}
                              </td>

                              <td>
                                <div className="faculty-grade-actions">
                                  {editable ? (
                                    <>
                                      <button
                                        type="button"
                                        className="faculty-grade-save"
                                        onClick={() => void saveDraft(student)}
                                        disabled={busy}
                                      >
                                        <Save size={13} />
                                        {isSaving
                                          ? "Saving..."
                                          : student.grade?.grade_status ===
                                              "Returned"
                                            ? "Save Correction"
                                            : "Save Draft"}
                                      </button>

                                      <button
                                        type="button"
                                        className="faculty-grade-submit"
                                        onClick={() =>
                                          void submitGrade(student)
                                        }
                                        disabled={busy}
                                      >
                                        <Send size={13} />
                                        {isSubmitting
                                          ? "Submitting..."
                                          : student.grade?.grade_status ===
                                              "Returned"
                                            ? "Resubmit"
                                            : "Submit Grade"}
                                      </button>
                                    </>
                                  ) : isApprovedIncomplete(student) &&
                                    student.inc_completion_request ? (
                                    <>
                                      <span
                                        className={`faculty-grade-inc-request-status ${getIncCompletionStatusClass(
                                          student.inc_completion_request,
                                        )}`}
                                      >
                                        <Clock3 size={13} />
                                        {getIncCompletionStatusLabel(
                                          student.inc_completion_request,
                                        )}
                                      </span>

                                      <span className="faculty-grade-locked">
                                        <ShieldCheck size={13} />
                                        Approved INC · Request #
                                        {
                                          student.inc_completion_request
                                            .grade_change_request_id
                                        }
                                      </span>
                                    </>
                                  ) : isApprovedIncomplete(student) ? (
                                    <>
                                      <button
                                        type="button"
                                        className="faculty-grade-inc-complete"
                                        onClick={() =>
                                          openIncCompletion(student)
                                        }
                                      >
                                        <FilePenLine size={13} />
                                        Complete INC
                                      </button>

                                      <span className="faculty-grade-locked">
                                        <ShieldCheck size={13} />
                                        Approved INC
                                      </span>
                                    </>
                                  ) : (
                                    <span className="faculty-grade-locked">
                                      <ShieldCheck size={13} />
                                      {student.subject_status !== "Enrolled"
                                        ? `Academic result: ${student.subject_status}`
                                        : status === "Submitted"
                                          ? "Waiting for Program Head"
                                          : status === "Approved"
                                            ? "Official grade locked"
                                            : "Locked"}
                                    </span>
                                  )}

                                  {feedback && (
                                    <div
                                      className={`faculty-grade-feedback ${feedback.type}`}
                                    >
                                      {feedback.message}
                                    </div>
                                  )}
                                </div>
                              </td>
                              {termAssessmentColumns.map(
                                ({ category, assessment }) => {
                                  const record =
                                    modernStudentByEnrollmentSubject.get(id);
                                  const score = assessment
                                    ? (record?.scores_by_assessment_id[
                                        String(assessment.assessment_id)
                                      ] ?? null)
                                    : null;
                                  const canEditAssessment = Boolean(
                                    assessment &&
                                    record?.is_current_enrolled &&
                                    selectedClass?.offering_status === "Open" &&
                                    [127, 128, 130, 131].includes(
                                      selectedOfferingId ?? -1,
                                    ) &&
                                    status !== "Submitted" &&
                                    status !== "Approved",
                                  );

                                  return (
                                    <td
                                      key={`${category.category_code}:${assessment?.assessment_id ?? "none"}`}
                                    >
                                      {assessment &&
                                      record &&
                                      selectedOfferingId ? (
                                        <AssessmentScoreCell
                                          key={`${selectedOfferingId}:${id}:${assessment.assessment_id}`}
                                          offeringId={selectedOfferingId}
                                          enrollmentSubjectId={id}
                                          studentNumber={student.student_number}
                                          assessment={assessment}
                                          score={score}
                                          canEdit={canEditAssessment}
                                          onSave={saveAssessmentScore}
                                          onConflict={reloadAfterScoreConflict}
                                        />
                                      ) : (
                                        <div className="faculty-grade-rating-field">
                                          <strong>
                                            {assessment
                                              ? "Not on roster"
                                              : category.category_code ===
                                                  "ATTENDANCE"
                                                ? "Tracked by meeting"
                                                : "Not configured"}
                                          </strong>
                                          <small>
                                            {category.category_code ===
                                            "ATTENDANCE"
                                              ? "Separate attendance register"
                                              : "Assessment not created"}
                                          </small>
                                        </div>
                                      )}
                                    </td>
                                  );
                                },
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}
        {!classesLoading &&
          !gradebookLoading &&
          !gradebookError &&
          gradebookClass &&
          selectedOfferingId && (
            <AttendanceRegister
              key={selectedOfferingId}
              offeringId={selectedOfferingId}
              refreshKey={gradebookRefreshKey}
              readOnlyStudentIds={students
                .filter((student) =>
                  ["Approved", "Submitted"].includes(
                    student.grade?.grade_status ?? "",
                  ),
                )
                .map((student) => student.enrollment_subject_id)}
            />
          )}
        {!classesLoading && classes.length > 0 && (
          <section className="faculty-grade-workflow-section">
            <header>
              <div>
                <span>Grade Submission Process</span>
                <h2>Faculty Grade Workflow</h2>
                <p>
                  Follow the normal grading sequence before a grade becomes an
                  official academic result.
                </p>
              </div>
            </header>

            <div className="faculty-grade-workflow">
              <article>
                <span className="faculty-grade-workflow__number">01</span>
                <span className="faculty-grade-workflow__icon">
                  <FilePenLine size={17} />
                </span>
                <div>
                  <strong>Encode</strong>
                  <p>
                    Choose Numeric Grade for normal 0–100 Midterm and Final Term
                    encoding, or choose Incomplete / Unofficial Drop and provide
                    a required reason. Final Rating and Result are calculated
                    automatically by policy.
                  </p>
                </div>
              </article>

              <article>
                <span className="faculty-grade-workflow__number">02</span>
                <span className="faculty-grade-workflow__icon">
                  <Save size={17} />
                </span>
                <div>
                  <strong>Save Draft</strong>
                  <p>
                    Keep unfinished grade records editable before submission.
                  </p>
                </div>
              </article>

              <article>
                <span className="faculty-grade-workflow__number">03</span>
                <span className="faculty-grade-workflow__icon">
                  <Send size={17} />
                </span>
                <div>
                  <strong>Submit</strong>
                  <p>
                    Lock the grade and send it to the Program Head for review.
                  </p>
                </div>
              </article>

              <article>
                <span className="faculty-grade-workflow__number">04</span>
                <span className="faculty-grade-workflow__icon">
                  <BadgeCheck size={17} />
                </span>
                <div>
                  <strong>Review</strong>
                  <p>
                    The Program Head approves the grade or returns it for
                    correction.
                  </p>
                </div>
              </article>
            </div>
          </section>
        )}

        {assessmentManagerOpen && selectedOfferingId && (
          <div
            className="faculty-inc-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget)
                closeAssessmentManager();
            }}
          >
            <section
              className="faculty-inc-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="faculty-assessment-modal-title"
            >
              <header className="faculty-inc-modal__header">
                <div>
                  <span>Faculty · Assessment Columns</span>
                  <h2 id="faculty-assessment-modal-title">
                    Manage Assessments
                  </h2>
                  <p>
                    {assessmentTerm === "MIDTERM" ? "Midterm" : "Final Term"} ·
                    Official category percentages are fixed by the grading
                    policy.
                  </p>
                </div>
                <button
                  type="button"
                  className="faculty-inc-modal__close"
                  onClick={closeAssessmentManager}
                  disabled={assessmentManagerBusy}
                  aria-label="Close assessment manager"
                >
                  <X size={18} />
                </button>
              </header>

              {assessmentManagerLoading ? (
                <div className="faculty-inc-modal__notice">
                  <Clock3 size={16} />
                  <p>Loading assessment settings...</p>
                </div>
              ) : assessmentStructure ? (
                <>
                  <div className="faculty-inc-modal__notice">
                    <ShieldCheck size={17} />
                    <p>
                      {assessmentStructureEditable
                        ? "This grading term is open for assessment changes."
                        : "This grading term is locked or the class is not Open. Assessment changes are not allowed."}
                      {selectedOfferingId !== 131 &&
                        " Creating and removing columns are currently limited to QA Offering #131."}
                    </p>
                  </div>

                  <div
                    className="faculty-inc-modal__student"
                    style={{ gridTemplateColumns: "1fr" }}
                  >
                    {assessmentExistingColumns.length === 0 ? (
                      <div>
                        <strong>No assessment columns yet</strong>
                        <span>
                          Choose a category below to add one while this term is
                          editable.
                        </span>
                      </div>
                    ) : (
                      assessmentExistingColumns.map(
                        ({ category, assessment }) => (
                          <div
                            key={assessment.assessment_id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              flexWrap: "wrap",
                            }}
                          >
                            <div
                              style={{ minWidth: 0, display: "grid", gap: 3 }}
                            >
                              <small>
                                {category.category_name} ·{" "}
                                {category.category_percent}%
                              </small>
                              <strong>{assessment.header_name}</strong>
                              <span>Max {assessment.maximum_score}</span>
                            </div>
                            {assessmentStructureEditable && (
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  type="button"
                                  className="faculty-grade-header-button"
                                  onClick={() =>
                                    beginAssessmentEdit(category, assessment)
                                  }
                                  disabled={
                                    assessmentManagerBusy ||
                                    ![127, 128, 131].includes(
                                      selectedOfferingId,
                                    )
                                  }
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="faculty-grade-header-button"
                                  onClick={() =>
                                    beginAssessmentRemoval(category, assessment)
                                  }
                                  disabled={
                                    assessmentManagerBusy ||
                                    selectedOfferingId !== 131
                                  }
                                >
                                  Remove
                                </button>
                              </div>
                            )}
                          </div>
                        ),
                      )
                    )}
                  </div>

                  {assessmentStructureEditable && (
                    <>
                      <div className="faculty-inc-modal__notice">
                        <FilePenLine size={17} />
                        <p>
                          {assessmentMode === "create"
                            ? "Add an assessment under an official category. Attendance uses a separate meeting register."
                            : assessmentMode === "edit"
                              ? `Editing ${assessmentTarget?.header_name || "assessment"}. Scores and audit history are preserved.`
                              : `Removing ${assessmentTarget?.header_name || "assessment"}. This keeps previous score records for audit.`}
                        </p>
                      </div>
                      {assessmentMode !== "remove" ? (
                        <div className="faculty-inc-modal__form">
                          <label className="faculty-gradebook-filter">
                            <span>Official Category</span>
                            <select
                              value={assessmentCategoryCode}
                              onChange={(event) =>
                                setAssessmentCategoryCode(event.target.value)
                              }
                              disabled={
                                assessmentMode === "edit" ||
                                assessmentManagerBusy
                              }
                            >
                              <option value="">Select category</option>
                              {assessmentCategories
                                .filter(
                                  (category) =>
                                    category.category_code !== "ATTENDANCE",
                                )
                                .map((category) => (
                                  <option
                                    key={category.category_code}
                                    value={category.category_code}
                                  >
                                    {category.category_name} (
                                    {category.category_percent}%)
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label>
                            <span>Assessment Name</span>
                            <input
                              value={assessmentName}
                              maxLength={120}
                              onChange={(event) =>
                                setAssessmentName(event.target.value)
                              }
                              placeholder="Example: Quiz 1"
                              disabled={assessmentManagerBusy}
                            />
                          </label>
                          <label>
                            <span>Maximum Score</span>
                            <input
                              value={assessmentMaximum}
                              onChange={(event) =>
                                setAssessmentMaximum(event.target.value)
                              }
                              inputMode="decimal"
                              placeholder="Example: 30"
                              disabled={assessmentManagerBusy}
                            />
                          </label>
                        </div>
                      ) : (
                        <label className="faculty-inc-modal__remarks">
                          <span>
                            Reason for Removal (required if scores exist)
                          </span>
                          <textarea
                            value={assessmentRemovalReason}
                            onChange={(event) =>
                              setAssessmentRemovalReason(event.target.value)
                            }
                            maxLength={2000}
                            rows={3}
                            disabled={assessmentManagerBusy}
                            placeholder="Explain why this assessment should be removed"
                          />
                        </label>
                      )}
                    </>
                  )}
                </>
              ) : null}

              {assessmentManagerError && (
                <div className="faculty-inc-modal__error" role="alert">
                  <AlertCircle size={16} />
                  <span>{assessmentManagerError}</span>
                </div>
              )}

              <footer className="faculty-inc-modal__footer">
                {assessmentMode !== "create" && assessmentStructureEditable && (
                  <button
                    type="button"
                    className="faculty-inc-modal__cancel"
                    onClick={resetAssessmentForm}
                    disabled={assessmentManagerBusy}
                  >
                    Add New Instead
                  </button>
                )}
                <button
                  type="button"
                  className="faculty-inc-modal__cancel"
                  onClick={closeAssessmentManager}
                  disabled={assessmentManagerBusy}
                >
                  Close
                </button>
                {assessmentStructureEditable && (
                  <button
                    type="button"
                    className="faculty-inc-modal__submit"
                    onClick={() => void saveAssessmentChanges()}
                    disabled={
                      assessmentManagerLoading ||
                      assessmentManagerBusy ||
                      !assessmentWriteAllowed
                    }
                    title={
                      !assessmentWriteAllowed
                        ? "QA offering restriction or locked grading term"
                        : undefined
                    }
                  >
                    <Save size={15} />
                    {assessmentManagerBusy
                      ? "Saving..."
                      : assessmentMode === "create"
                        ? "Add Assessment"
                        : assessmentMode === "edit"
                          ? "Save Changes"
                          : "Remove Assessment"}
                  </button>
                )}
              </footer>
            </section>
          </div>
        )}

        {submitStudent && submitModalForm && submitModalPreview && (
          <div
            className="faculty-inc-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeSubmitModal();
              }
            }}
          >
            <section
              className="faculty-inc-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="faculty-submit-grade-modal-title"
            >
              <header className="faculty-inc-modal__header">
                <div>
                  <span>Grade Submission</span>
                  <h2 id="faculty-submit-grade-modal-title">
                    Confirm Grade Submission
                  </h2>
                  <p>
                    Review the grade details before sending this record to the
                    Program Head.
                  </p>
                </div>

                <button
                  type="button"
                  className="faculty-inc-modal__close"
                  onClick={closeSubmitModal}
                  disabled={
                    submittingId === submitStudent.enrollment_subject_id
                  }
                  aria-label="Close grade submission modal"
                >
                  <X size={18} />
                </button>
              </header>

              <div className="faculty-inc-modal__student">
                <div>
                  <small>Student</small>
                  <strong>{submitStudent.full_name}</strong>
                  <span>{submitStudent.student_number}</span>
                </div>

                <div>
                  <small>Class</small>
                  <strong>
                    {selectedClass
                      ? `${selectedClass.subject.subject_code} — ${selectedClass.section.section_name}`
                      : "Selected Class"}
                  </strong>
                  <span>
                    {selectedClass
                      ? `${selectedClass.academic_period.academic_year} / ${selectedClass.academic_period.semester_name}`
                      : "Current gradebook"}
                  </span>
                </div>
              </div>

              <div className="faculty-inc-modal__preview">
                <div>
                  <small>Outcome</small>
                  <strong>{submitModalOutcomeLabel}</strong>
                </div>

                <div>
                  <small>Final Rating</small>
                  <strong>
                    {submitModalPreview.finalRating !== null
                      ? submitModalPreview.finalRating.toFixed(2)
                      : "—"}
                  </strong>
                </div>

                <div>
                  <small>Result</small>
                  <strong>{submitModalPreview.remarks || "—"}</strong>
                </div>
              </div>

              {submitModalForm.gradingOutcome === "NUMERIC" ? (
                <div className="faculty-inc-modal__student">
                  <div>
                    <small>Midterm Grade</small>
                    <strong>{submitModalForm.midtermGrade || "—"}</strong>
                    <span>Percentage grade</span>
                  </div>

                  <div>
                    <small>Final Term Grade</small>
                    <strong>{submitModalForm.finalGrade || "—"}</strong>
                    <span>Percentage grade</span>
                  </div>
                </div>
              ) : (
                <div className="faculty-inc-modal__notice">
                  <MessageSquareText size={17} />
                  <p>
                    <strong>Reason:</strong>{" "}
                    {submitModalForm.outcomeReason.trim() ||
                      "No reason provided."}
                  </p>
                </div>
              )}

              {submitModalError && (
                <div className="faculty-inc-modal__error" role="alert">
                  <AlertCircle size={16} />
                  <span>{submitModalError}</span>
                </div>
              )}

              <div className="faculty-inc-modal__notice">
                <ShieldCheck size={17} />
                <p>
                  After submission, Faculty cannot edit this grade unless the
                  Program Head returns it for correction.
                </p>
              </div>

              <footer className="faculty-inc-modal__footer">
                <button
                  type="button"
                  className="faculty-inc-modal__cancel"
                  onClick={closeSubmitModal}
                  disabled={
                    submittingId === submitStudent.enrollment_subject_id
                  }
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="faculty-inc-modal__submit"
                  onClick={() => void confirmSubmitGrade()}
                  disabled={
                    submittingId === submitStudent.enrollment_subject_id
                  }
                >
                  <Send size={15} />
                  {submittingId === submitStudent.enrollment_subject_id
                    ? "Submitting..."
                    : "Submit Grade"}
                </button>
              </footer>
            </section>
          </div>
        )}

        {incStudent && (
          <div
            className="faculty-inc-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeIncCompletion();
              }
            }}
          >
            <section
              className="faculty-inc-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="faculty-inc-modal-title"
            >
              <header className="faculty-inc-modal__header">
                <div>
                  <span>INC Completion</span>
                  <h2 id="faculty-inc-modal-title">
                    Complete Incomplete Grade
                  </h2>
                  <p>
                    Enter the completed numeric grades after verifying the
                    student's missing course requirement.
                  </p>
                </div>

                <button
                  type="button"
                  className="faculty-inc-modal__close"
                  onClick={closeIncCompletion}
                  disabled={incSubmitting}
                  aria-label="Close INC completion modal"
                >
                  <X size={18} />
                </button>
              </header>

              <div className="faculty-inc-modal__student">
                <div>
                  <small>Student</small>
                  <strong>{incStudent.full_name}</strong>
                  <span>{incStudent.student_number}</span>
                </div>

                <div>
                  <small>Current Official Grade</small>
                  <strong>4.00 — Incomplete</strong>
                  <span>
                    {incStudent.grade?.outcome_reason ||
                      "No incomplete reason recorded."}
                  </span>
                </div>
              </div>

              <div className="faculty-inc-modal__form">
                <label>
                  <span>Midterm Grade</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={incForm.midtermGrade}
                    onChange={(event) =>
                      setIncForm((current) => ({
                        ...current,
                        midtermGrade: event.target.value,
                      }))
                    }
                    disabled={incSubmitting}
                    placeholder="0-100"
                  />
                </label>

                <label>
                  <span>Final Term Grade</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={incForm.finalGrade}
                    onChange={(event) =>
                      setIncForm((current) => ({
                        ...current,
                        finalGrade: event.target.value,
                      }))
                    }
                    disabled={incSubmitting}
                    placeholder="0-100"
                  />
                </label>
              </div>

              <div className="faculty-inc-modal__preview">
                <div>
                  <small>Overall</small>
                  <strong>
                    {incPreview.overallPercentage !== null
                      ? incPreview.overallPercentage.toFixed(2)
                      : "—"}
                  </strong>
                </div>

                <div>
                  <small>Final Rating</small>
                  <strong>
                    {incPreview.finalRating !== null
                      ? incPreview.finalRating.toFixed(2)
                      : "—"}
                  </strong>
                </div>

                <div>
                  <small>Result</small>
                  <strong>{incPreview.remarks || "—"}</strong>
                </div>
              </div>

              <label className="faculty-inc-modal__remarks">
                <span>Completion Remarks</span>
                <textarea
                  value={incForm.completionRemarks}
                  onChange={(event) =>
                    setIncForm((current) => ({
                      ...current,
                      completionRemarks: event.target.value,
                    }))
                  }
                  disabled={incSubmitting}
                  rows={4}
                  maxLength={1000}
                  placeholder="Example: Student completed and passed the missing final activity submitted through Google Drive."
                />
                <small>
                  Describe the completed requirement that you verified.
                </small>
              </label>

              {incError && (
                <div className="faculty-inc-modal__error" role="alert">
                  <AlertCircle size={16} />
                  <span>{incError}</span>
                </div>
              )}

              <div className="faculty-inc-modal__notice">
                <ShieldCheck size={17} />
                <p>
                  Submitting this does not immediately change the student's
                  official grade. The request will first be sent to the Program
                  Head for review, then to the Registrar for official
                  processing.
                </p>
              </div>

              <footer className="faculty-inc-modal__footer">
                <button
                  type="button"
                  className="faculty-inc-modal__cancel"
                  onClick={closeIncCompletion}
                  disabled={incSubmitting}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="faculty-inc-modal__submit"
                  onClick={() => void submitIncCompletion()}
                  disabled={
                    incSubmitting ||
                    !incPreview.complete ||
                    !incForm.completionRemarks.trim()
                  }
                >
                  <Send size={15} />
                  {incSubmitting ? "Submitting..." : "Send to Program Head"}
                </button>
              </footer>
            </section>
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
