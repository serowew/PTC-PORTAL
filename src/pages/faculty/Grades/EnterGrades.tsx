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

const PROGRAM_HEAD_CLASSES_API_BASE_URL = `${api.baseUrl}/api/program-head/classes`;

const MODERN_GRADEBOOK_API = `${api.baseUrl}/api/gradebook`;

type GradeStatus = "Draft" | "Submitted" | "Returned" | "Approved";

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

  faculty?: {
    faculty_id: number;
  } | null;

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
  program_head?: {
    faculty_id: number;
    employee_number: string;
    program_head_name: string;
  };
  classes?: FacultyClass[];

  message?: string;
  error?: string;
}
interface FacultyGrade {
  midterm_grade?: number | null;
  final_grade?: number | null;
  overall_percentage?: number | null;
  final_rating: number | null;
  grading_outcome?: string;
  grade_status: GradeStatus;
}

interface GradebookStudent {
  enrollment_subject_id: number;
  student_number: string;
  full_name: string;
  email: string | null;
  subject_status: string;
  grade: FacultyGrade | null;
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
  term: AssessmentTerm;
  category: ModernGradebookCategory;
  assessment: ModernGradebookAssessment | null;
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

function getGradeStatus(
  student: GradebookStudent,
): GradeStatus | "Not Started" {
  return student.grade?.grade_status || "Not Started";
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

interface ModernGradePercent {
  display: string;
}

interface ModernGradeCategoryPreview {
  category_code: string;
  category_name: string;
  category_weight_percent: string;
  state: string;
  category_percentage: ModernGradePercent | null;
  contribution_percent_points: ModernGradePercent | null;
}

interface ModernGradePreviewResponse {
  success: boolean;
  read_only: boolean;
  offering_id: number;
  student: {
    enrollment_subject_id: number;
    student_number: string;
    student_name: string;
  };
  terms: Record<
    AssessmentTerm,
    {
      state: string;
      term_percentage: ModernGradePercent | null;
      categories: ModernGradeCategoryPreview[];
      incomplete_category_codes: string[];
    }
  >;
  semester: {
    state: string;
    semester_percentage: ModernGradePercent | null;
    numeric_equivalent: string | null;
    pass_fail: "PASS" | "FAIL" | null;
  };
  code?: string;
  message?: string;
}
interface ReturnedSpecialEvidence {
  outcome_type: "INCOMPLETE" | "UNOFFICIAL_DROP";
  outcome_reason: string;
  missing_requirements: string | null;
  evidence_summary: string;
  review_notes: string | null;
  evidence_review_notes: string | null;
}
interface LatestCombinedSubmissionResponse {
  success: boolean;
  offering_id: number;
  enrollment_subject_id: number;

  grade: {
    grade_status: string;
    grading_outcome: string;
  } | null;

  latest_submission: {
    submission_id: string;
    record_version: number;
    attempt_number: number;
    submission_status: string;
    returned_edit_scope: AssessmentTerm | "BOTH" | null;
    review_remarks: string | null;
  } | null;
  returned_special_outcome?: ReturnedSpecialEvidence | null;
  code?: string;
  message?: string;
}

interface CombinedSemesterResubmitResponse {
  success: boolean;
  dry_run: boolean;
  persisted: boolean;
  previous_submission_id: string;
  submission_id: string | null;
  status: string;
  returned_scope: AssessmentTerm | "BOTH";
  message?: string;
  code?: string;
}

interface CombinedSemesterSubmissionResponse {
  success: boolean;
  dry_run?: boolean;
  persisted?: boolean;
  offering_id?: number;
  enrollment_subject_id?: number;
  submission_id?: string | null;
  status?: string;
  code?: string;
  message?: string;
}
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
// Attendance Summary

interface AttendancePreviewPercent {
  display: string;
}

interface AttendancePreviewCategory {
  category_code: string;
  category_weight_percent: string;
  state: string;
  held_session_count: number;
  present_or_late_count: number;
  absent_count: number;
  excused_count: number;
  not_applicable_count: number;
  pending_count: number;
  counted_session_count: number;
  category_percentage: AttendancePreviewPercent | null;
  contribution_percent_points: AttendancePreviewPercent | null;
}

interface AttendancePreviewResponse {
  success: boolean;
  offering_id: number;
  student: {
    enrollment_subject_id: number;
  };
  terms: Record<AssessmentTerm, { categories: AttendancePreviewCategory[] }>;
  message?: string;
}

function AttendanceSummary({
  offeringId,
  term,
  students,
  refreshKey,
}: {
  offeringId: number;
  term: AssessmentTerm;
  students: AttendanceStudent[];
  refreshKey: number;
}) {
  const navigate = useNavigate();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [preview, setPreview] = useState<AttendancePreviewResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const studentId = students.some(
    (student) => student.enrollment_subject_id === selectedId,
  )
    ? selectedId
    : (students[0]?.enrollment_subject_id ?? null);

  useEffect(() => {
    const controller = new AbortController();

    setPreview(null);
    setError("");

    if (studentId === null) {
      setLoading(false);
      return () => controller.abort();
    }

    setLoading(true);

    const load = async () => {
      try {
        const response = await authService.authFetch(
          `${MODERN_GRADEBOOK_API}/${offeringId}/students/${studentId}/grade-preview`,
          {
            method: "GET",
            signal: controller.signal,
          },
        );

        const data =
          await readJsonResponse<AttendancePreviewResponse>(response);

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
          data.student?.enrollment_subject_id !== studentId ||
          !Array.isArray(data.terms?.[term]?.categories)
        ) {
          throw new Error(
            data.message ||
              "Attendance summary is unavailable for this student.",
          );
        }

        setPreview(data);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load attendance summary.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => controller.abort();
  }, [offeringId, studentId, term, refreshKey, navigate]);

  const attendance = preview?.terms[term].categories.find(
    (category) => category.category_code === "ATTENDANCE",
  );

  const ready = attendance?.state === "READY";

  return (
    <div className="faculty-gradebook-table-meta">
      <div className="faculty-gradebook-header__title">
        <div>
          <strong>
            Attendance Summary — {term === "MIDTERM" ? "Midterm" : "Final Term"}
          </strong>

          <p>
            Read-only calculation from saved Held meetings. No grade is
            submitted here.
          </p>
        </div>
      </div>

      <label className="faculty-gradebook-filter">
        <span>Student</span>

        <select
          value={studentId ?? ""}
          disabled={students.length === 0}
          onChange={(event) => setSelectedId(Number(event.target.value))}
        >
          {students.map((student) => (
            <option
              key={student.enrollment_subject_id}
              value={student.enrollment_subject_id}
            >
              {student.student_number} — {student.student_name}
            </option>
          ))}
        </select>
      </label>

      {loading ? (
        <small>Calculating attendance...</small>
      ) : error ? (
        <small role="alert">{error}</small>
      ) : attendance ? (
        <div>
          <strong>
            {ready
              ? `${attendance.category_percentage?.display ?? "—"}%`
              : "Incomplete"}
          </strong>

          <p>
            Attended: {attendance.present_or_late_count} /{" "}
            {attendance.counted_session_count}
            {" · "}Absent: {attendance.absent_count}
            {" · "}Excused: {attendance.excused_count}
            {" · "}N/A: {attendance.not_applicable_count}
            {" · "}Pending: {attendance.pending_count}
          </p>

          <p>
            Attendance weight: {attendance.category_weight_percent}%{" · "}
            Weighted contribution:{" "}
            {ready
              ? `${
                  attendance.contribution_percent_points?.display ?? "—"
                } percentage points`
              : "Not available until attendance is complete"}
          </p>

          {!ready && (
            <small>
              Status: {attendance.state.replaceAll("_", " ")}. Incomplete
              attendance is not an official percentage.
            </small>
          )}

          {ready && (
            <small>
              Calculated preview only; official grades require the separate
              approval and finalization process.
            </small>
          )}
        </div>
      ) : (
        <small>No saved attendance summary available.</small>
      )}
    </div>
  );
}

function AttendanceRegister({
  offeringId,
  refreshKey,
  readOnlyStudentIds,
  returnedStudentIds,
  returnedPermission,
  onAttendanceSaved,
}: {
  offeringId: number;
  refreshKey: number;
  readOnlyStudentIds: number[];
  returnedStudentIds: number[];
  returnedPermission: {
    enrollmentSubjectId: number;
    scope: AssessmentTerm | "BOTH";
  } | null;
  onAttendanceSaved: () => void;
}) {
  const navigate = useNavigate();

  const [term, setTerm] = useState<AssessmentTerm>("MIDTERM");

  const lockedStudentIds = new Set([
    ...readOnlyStudentIds,
    ...returnedStudentIds.filter(
      (id) =>
        returnedPermission?.enrollmentSubjectId !== id ||
        (returnedPermission.scope !== "BOTH" &&
          returnedPermission.scope !== term),
    ),
  ]);

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
      onAttendanceSaved();
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
  }, [offeringId, meetingId, reloadKey, refreshKey, navigate]);

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

    const currentStudent = register?.students.find(
      (item) => item.enrollment_subject_id === id,
    );

    if (
      loading ||
      registerLoading ||
      register?.offering_id !== offeringId ||
      register?.meeting?.meeting_id !== meetingId ||
      currentStudent?.attendance_editable !== true ||
      currentStudent.attendance.record_version !==
        student.attendance.record_version
    ) {
      return;
    }

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
        persisted?: boolean;
        offering_id?: number;
        meeting_id?: number;
        enrollment_subject_id?: number;
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
        data.persisted !== true ||
        Number(data.offering_id) !== offeringId ||
        Number(data.meeting_id) !== meetingId ||
        Number(data.enrollment_subject_id) !== id
      ) {
        if (response.status === 409 || response.status === 403) {
          setReloadKey((current) => current + 1);
        }

        throw new Error(
          data.message ||
            "Attendance was not confirmed as saved. Reload the register.",
        );
      }

      setReloadKey((current) => current + 1);
      onAttendanceSaved();
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

  const attendanceCounts = currentRegister?.students.reduce(
    (counts, student) => {
      const status = student.attendance.attendance_status;
      counts[status] += 1;
      return counts;
    },
    {
      PENDING: 0,
      PRESENT: 0,
      LATE: 0,
      ABSENT: 0,
      EXCUSED: 0,
      NOT_APPLICABLE: 0,
    } as Record<AttendanceStatus, number>,
  );

  return (
    <section id="faculty-attendance-register" className="faculty-gradebook">
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
              disabled={savingId !== null || createMeetingBusy || heldBusy}
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
              disabled={
                !meetingOptions.length ||
                savingId !== null ||
                createMeetingBusy ||
                heldBusy
              }
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

      {!registerLoading && currentRegister && attendanceCounts && (
        <div className="faculty-attendance-overview">
          <div className="faculty-attendance-overview__heading">
            <div>
              <strong>Meeting Attendance</strong>
              <p>
                {selectedMeeting?.meeting_date} ·{" "}
                {selectedMeeting?.session_type} ·{" "}
                {selectedMeeting?.meeting_status}
              </p>
            </div>
            <span className="faculty-attendance-overview__recorded">
              {currentRegister.students.length - attendanceCounts.PENDING} of{" "}
              {currentRegister.students.length} recorded
            </span>
          </div>
          <div
            className="faculty-attendance-overview__statuses"
            aria-label="Saved attendance counts"
          >
            <span className="faculty-attendance-count faculty-attendance-count--present">
              <strong>{attendanceCounts.PRESENT}</strong> Present
            </span>
            <span className="faculty-attendance-count faculty-attendance-count--late">
              <strong>{attendanceCounts.LATE}</strong> Late
            </span>
            <span className="faculty-attendance-count faculty-attendance-count--absent">
              <strong>{attendanceCounts.ABSENT}</strong> Absent
            </span>
            <span className="faculty-attendance-count faculty-attendance-count--excused">
              <strong>{attendanceCounts.EXCUSED}</strong> Excused
            </span>
            <span className="faculty-attendance-count faculty-attendance-count--pending">
              <strong>{attendanceCounts.PENDING}</strong> Pending
            </span>
            <span className="faculty-attendance-count faculty-attendance-count--not-applicable">
              <strong>{attendanceCounts.NOT_APPLICABLE}</strong> N/A
            </span>
          </div>
          <small>
            Counts reflect saved attendance for this meeting. Late counts as
            present when attendance grades are calculated.
          </small>
        </div>
      )}

      {!registerLoading && currentRegister && (
        <div className="faculty-grade-table-wrapper faculty-attendance-table-wrapper">
          <table className="faculty-grade-table faculty-attendance-table">
            <colgroup>
              <col style={{ width: 230 }} />
              <col style={{ width: 180 }} />
              <col style={{ width: 300 }} />
              <col style={{ width: 190 }} />
            </colgroup>
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
                    <td className="faculty-attendance-table__student">
                      <div className="faculty-grade-student">
                        <div>
                          <strong>{student.student_name}</strong>
                          <span>{student.student_number}</span>
                        </div>
                      </div>
                    </td>

                    <td>
                      <select
                        className={`faculty-grade-remarks faculty-attendance-status faculty-attendance-status--${(draft?.status ?? "PENDING").toLowerCase().replaceAll("_", "-")}`}
                        aria-label={`Attendance status for ${student.student_name}`}
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

      {currentRegister && !registerLoading && (
        <AttendanceSummary
          key={`${offeringId}-${term}`}
          offeringId={offeringId}
          term={term}
          students={currentRegister.students}
          refreshKey={reloadKey}
        />
      )}
    </section>
  );
}
// Special Outcomes (QA pilot)
type SpecialOutcomeType = "INCOMPLETE" | "UNOFFICIAL_DROP";

interface SpecialOutcomeSubmitResponse {
  success: boolean;
  dry_run?: boolean;
  persisted?: boolean;
  offering_id?: number;
  enrollment_subject_id?: number;
  submission_id?: string | null;
  status?: string;
  grading_outcome?: string;
  pending_assessment_count?: number;
  absent_meetings?: number;
  code?: string;
  message?: string;
  note?: string;
}

function SpecialOutcomeSubmission({
  offeringId,
  student,
  onSubmitted,
}: {
  offeringId: number;
  student: GradebookStudent;
  onSubmitted: () => void;
}) {
  const navigate = useNavigate();

  const [type, setType] = useState<SpecialOutcomeType>("INCOMPLETE");

  const [reason, setReason] = useState("");
  const [missingRequirements, setMissingRequirements] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const hasControlChars = (value: string) =>
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    });

  const validText = (value: string, min: number, max: number) => {
    const text = value.trim();

    return text.length >= min && text.length <= max && !hasControlChars(text);
  };

  const canSubmit =
    !busy &&
    !success &&
    validText(reason, 10, 500) &&
    validText(evidence, 20, 2000) &&
    (type === "UNOFFICIAL_DROP" || validText(missingRequirements, 10, 2000));

  const submit = async () => {
    if (!canSubmit) {
      setError("Complete the reason, evidence, and required INC details.");
      return;
    }

    const specialOutcome = {
      outcome_type: type,
      outcome_reason: reason.trim(),
      missing_requirements:
        type === "INCOMPLETE" ? missingRequirements.trim() : null,
      evidence_summary: evidence.trim(),
    };

    const endpoint =
      `${MODERN_GRADEBOOK_API}/${offeringId}/students/` +
      `${student.enrollment_subject_id}/semester-submissions`;

    const request = async (dryRun: boolean) => {
      const response = await authService.authFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expected_latest_submission_id: null,
          expected_latest_submission_record_version: null,
          special_outcome: specialOutcome,
          dry_run: dryRun,
        }),
      });

      const data =
        await readJsonResponse<SpecialOutcomeSubmitResponse>(response);

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });

        throw new Error("Your session has expired.");
      }

      if (
        !response.ok ||
        !data.success ||
        data.offering_id !== offeringId ||
        data.enrollment_subject_id !== student.enrollment_subject_id ||
        data.status !== "SUBMITTED" ||
        data.grading_outcome !== type
      ) {
        throw new Error(
          [data.code, data.message].filter(Boolean).join(": ") ||
            "Special outcome submission was rejected.",
        );
      }

      return data;
    };

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const validation = await request(true);

      if (validation.dry_run !== true || validation.persisted !== false) {
        throw new Error("The backend did not confirm a safe dry-run.");
      }

      const label = type === "INCOMPLETE" ? "INC (4.00)" : "UD (6.00)";

      const confirmed = window.confirm(
        `Submit ${label} for ${student.full_name}?\n\n` +
          `Documented absent meetings: ${validation.absent_meetings ?? 0}\n` +
          `Pending assessments: ${
            validation.pending_assessment_count ?? 0
          }\n\n` +
          "The Program Head must review this outcome individually. " +
          "Submitting does not publish an official grade.",
      );

      if (!confirmed) return;

      const result = await request(false);

      if (
        result.dry_run !== false ||
        result.persisted !== true ||
        !result.submission_id
      ) {
        throw new Error("The backend did not confirm a saved submission.");
      }

      setSuccess(
        `${label} submission #${result.submission_id} saved for ` +
          "individual Program Head review. It is not yet official.",
      );

      onSubmitted();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to submit special outcome.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="faculty-gradebook-table-meta" style={{ display: "block" }}>
      <strong>Special Outcome — INC / UD</strong>

      <p>
        Use this for documented incomplete requirements or unofficial-drop
        evidence. Each submission requires individual Program Head review and
        does not become an official grade until published.
      </p>

      <div className="faculty-gradebook-tools">
        <label className="faculty-gradebook-filter">
          <span>Outcome</span>

          <select
            value={type}
            disabled={busy}
            onChange={(event) => {
              setType(event.target.value as SpecialOutcomeType);
              setError("");
              setSuccess("");
            }}
          >
            <option value="INCOMPLETE">INC — 4.00</option>

            <option value="UNOFFICIAL_DROP">UD — 6.00</option>
          </select>
        </label>

        <label className="faculty-gradebook-filter">
          <span>Outcome reason (10–500 characters)</span>

          <textarea
            className="faculty-grade-input"
            rows={3}
            maxLength={500}
            value={reason}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Explain why the special outcome is necessary"
          />
        </label>

        {type === "INCOMPLETE" && (
          <label className="faculty-gradebook-filter">
            <span>Missing requirements (10–2000 characters)</span>

            <textarea
              className="faculty-grade-input"
              rows={3}
              maxLength={2000}
              value={missingRequirements}
              disabled={busy}
              onChange={(event) => setMissingRequirements(event.target.value)}
              placeholder="List specific unfinished Final Term requirements"
            />
          </label>
        )}

        <label className="faculty-gradebook-filter">
          <span>Evidence summary (20–2000 characters)</span>

          <textarea
            className="faculty-grade-input"
            rows={3}
            maxLength={2000}
            value={evidence}
            disabled={busy}
            onChange={(event) => setEvidence(event.target.value)}
            placeholder="Describe the assessment and attendance evidence on record"
          />
        </label>

        <button
          type="button"
          className="faculty-grade-header-button"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          <Send size={15} />

          {busy ? "Validating..." : "Submit Special Outcome"}
        </button>
      </div>

      {error && <p role="alert">{error}</p>}

      {success && <p role="status">{success}</p>}

      <small>
        INC requires a complete Midterm and pending Final Term assessments. UD
        requires recorded absences and supporting evidence. The backend verifies
        attendance, submission period, and official-sheet locks.
      </small>
    </div>
  );
}
// Returned special outcome

interface SpecialOutcomeResubmitResponse {
  success: boolean;
  dry_run: boolean;
  persisted: boolean;
  offering_id: number;
  enrollment_subject_id: number;
  previous_submission_id: string;
  submission_id: string | null;
  grading_outcome: "INCOMPLETE" | "UNOFFICIAL_DROP";
  submission_status: string;
  original_review_preserved: boolean;
  message?: string;
  code?: string;
}

function ReturnedSpecialOutcomeResubmission({
  offeringId,
  student,
  previous,
  original,
  onSubmitted,
}: {
  offeringId: number;
  student: GradebookStudent;
  previous: NonNullable<LatestCombinedSubmissionResponse["latest_submission"]>;
  original: ReturnedSpecialEvidence;
  onSubmitted: (newSubmissionId: string) => void;
}) {
  const navigate = useNavigate();

  const [reason, setReason] = useState(original.outcome_reason);
  const [missing, setMissing] = useState(original.missing_requirements ?? "");
  const [evidence, setEvidence] = useState(original.evidence_summary);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const validText = (value: string, min: number, max: number) => {
    const trimmed = value.trim();

    return (
      trimmed.length >= min &&
      trimmed.length <= max &&
      ![...trimmed].some((character) => {
        const code = character.charCodeAt(0);

        return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
      })
    );
  };

  const revised =
    reason.trim() !== original.outcome_reason ||
    evidence.trim() !== original.evidence_summary ||
    (original.outcome_type === "INCOMPLETE" &&
      missing.trim() !== (original.missing_requirements ?? ""));

  const canResubmit =
    !busy &&
    revised &&
    validText(reason, 10, 500) &&
    validText(evidence, 20, 2000) &&
    (original.outcome_type === "UNOFFICIAL_DROP" ||
      validText(missing, 10, 2000));

  const submit = async () => {
    if (!canResubmit) return;

    setBusy(true);
    setError("");

    const endpoint =
      `${MODERN_GRADEBOOK_API}/${offeringId}/students/` +
      `${student.enrollment_subject_id}/special-outcome-submissions/` +
      `${previous.submission_id}/resubmit`;

    const specialOutcome = {
      outcome_type: original.outcome_type,
      outcome_reason: reason.trim(),
      missing_requirements:
        original.outcome_type === "INCOMPLETE" ? missing.trim() : null,
      evidence_summary: evidence.trim(),
    };

    const request = async (dryRun: boolean) => {
      const response = await authService.authFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expected_record_version: previous.record_version,
          confirm_resubmission: true,
          dry_run: dryRun,
          special_outcome: specialOutcome,
        }),
      });

      const data =
        await readJsonResponse<SpecialOutcomeResubmitResponse>(response);

      if (response.status === 401) {
        authService.logout();

        navigate("/login", { replace: true });

        throw new Error("Your session has expired.");
      }

      if (
        !response.ok ||
        !data.success ||
        data.dry_run !== dryRun ||
        data.persisted !== !dryRun ||
        data.offering_id !== offeringId ||
        data.enrollment_subject_id !== student.enrollment_subject_id ||
        data.previous_submission_id !== previous.submission_id ||
        data.grading_outcome !== original.outcome_type ||
        data.submission_status !== "SUBMITTED" ||
        data.original_review_preserved !== true ||
        (!dryRun && !data.submission_id)
      ) {
        throw new Error(
          [data.code, data.message].filter(Boolean).join(": ") ||
            "The server rejected the special-outcome resubmission.",
        );
      }

      return data;
    };

    try {
      // Verify the evidence revision without committing.
      await request(true);

      const label =
        original.outcome_type === "INCOMPLETE" ? "INC (4.00)" : "UD (6.00)";

      const confirmed = window.confirm(
        `Resubmit revised ${label} evidence for ${student.full_name}?\n\n` +
          "Only the supporting documentation changes. " +
          "The original submission and Program Head return " +
          "remain preserved for review.",
      );

      if (!confirmed) return;

      // Save the revised evidence and new submission attempt.
      const saved = await request(false);

      onSubmitted(saved.submission_id!);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to resubmit the special outcome.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="faculty-gradebook-table-meta" style={{ display: "block" }}>
      <strong>
        Returned{" "}
        {original.outcome_type === "INCOMPLETE" ? "INC (4.00)" : "UD (6.00)"}
        {" — Revise Evidence"}
      </strong>

      <p>
        Program Head return scope:{" "}
        {previous.returned_edit_scope?.replaceAll("_", " ") ?? "—"}. This
        resubmission revises documentation only; scores and attendance remain
        unchanged.
      </p>

      {previous.review_remarks && (
        <p>Return remarks: {previous.review_remarks}</p>
      )}

      {original.evidence_review_notes && (
        <p>Evidence review: {original.evidence_review_notes}</p>
      )}

      <div className="faculty-gradebook-tools">
        <label className="faculty-gradebook-filter">
          <span>Outcome reason (10–500 characters)</span>

          <textarea
            className="faculty-grade-input"
            rows={3}
            maxLength={500}
            disabled={busy}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>

        {original.outcome_type === "INCOMPLETE" && (
          <label className="faculty-gradebook-filter">
            <span>Missing requirements (10–2000 characters)</span>

            <textarea
              className="faculty-grade-input"
              rows={3}
              maxLength={2000}
              disabled={busy}
              value={missing}
              onChange={(event) => setMissing(event.target.value)}
            />
          </label>
        )}

        <label className="faculty-gradebook-filter">
          <span>Evidence summary (20–2000 characters)</span>

          <textarea
            className="faculty-grade-input"
            rows={3}
            maxLength={2000}
            disabled={busy}
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
          />
        </label>

        <button
          type="button"
          className="faculty-grade-header-button"
          disabled={!canResubmit}
          onClick={() => void submit()}
        >
          <Send size={15} />

          {busy ? "Validating..." : "Resubmit Special Outcome"}
        </button>
      </div>

      {!revised && (
        <small>Revise at least one evidence field before resubmitting.</small>
      )}

      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export default function EnterGrades() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const session = authService.getSession();

  const token = authService.getToken();

  const userRole = session?.role;

  const authenticated = Boolean(session && token);

  const canUseTeachingGradebook =
    userRole === "Faculty" || userRole === "Program Head";

  const classesApiBase =
    userRole === "Program Head"
      ? PROGRAM_HEAD_CLASSES_API_BASE_URL
      : API_BASE_URL;

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
  const activeOfferingIdRef = useRef<number | null>(selectedOfferingId);

  useEffect(() => {
    activeOfferingIdRef.current = selectedOfferingId;
  }, [selectedOfferingId]);

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

  const [attendanceModalOpen, setAttendanceModalOpen] = useState(false);
  const attendanceDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = attendanceDialogRef.current;
    if (!dialog) return;

    if (attendanceModalOpen && !dialog.open) {
      dialog.showModal();
    } else if (!attendanceModalOpen && dialog.open) {
      dialog.close();
    }
  }, [attendanceModalOpen]);

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

  const [studentSearch, setStudentSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [previewStudentId, setPreviewStudentId] = useState<number | null>(null);
  const activePreviewStudentIdRef = useRef<number | null>(previewStudentId);

  useEffect(() => {
    activePreviewStudentIdRef.current = previewStudentId;
  }, [previewStudentId]);
  const [modernPreview, setModernPreview] =
    useState<ModernGradePreviewResponse | null>(null);
  const [modernPreviewLoading, setModernPreviewLoading] = useState(false);
  const [modernPreviewError, setModernPreviewError] = useState("");
  const [modernPreviewRefreshKey, setModernPreviewRefreshKey] = useState(0);

  // Calculated values for the combined semester sheet (read-only).
  const [rowGradePreviews, setRowGradePreviews] = useState<
    Record<number, ModernGradePreviewResponse>
  >({});
  const [rowGradePreviewsLoading, setRowGradePreviewsLoading] = useState(false);
  const rowPreviewChangeVersions = useRef<Record<number, number>>({});
  const [rowPreviewBatchRefreshKey, setRowPreviewBatchRefreshKey] = useState(0);
  const [rowPreviewRefreshTarget, setRowPreviewRefreshTarget] = useState({
    studentId: 0,
    sequence: 0,
  });
  const [latestCombined, setLatestCombined] =
    useState<LatestCombinedSubmissionResponse | null>(null);

  const [latestCombinedLoading, setLatestCombinedLoading] = useState(false);

  const [latestCombinedError, setLatestCombinedError] = useState("");

  const [resubmittingCombined, setResubmittingCombined] = useState(false);

  const [resubmissionMessage, setResubmissionMessage] = useState("");
  const [resubmissionError, setResubmissionError] = useState("");
  const [semesterSubmitting, setSemesterSubmitting] = useState(false);
  const [semesterSubmissionError, setSemesterSubmissionError] = useState("");
  const [semesterSubmissionMessage, setSemesterSubmissionMessage] =
    useState("");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (!canUseTeachingGradebook) {
      if (session) {
        navigate(authService.getDashboardRoute(session.role), {
          replace: true,
        });
      }
    }
  }, [authenticated, canUseTeachingGradebook, session, navigate]);

  useEffect(() => {
    if (!authenticated || !canUseTeachingGradebook) {
      return;
    }

    const controller = new AbortController();

    const loadClasses = async () => {
      try {
        setClassesLoading(true);

        setClassesError("");

        const response = await authService.authFetch(classesApiBase, {
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
          throw new Error(
            data.message || "Teaching gradebook access is required.",
          );
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || data.error || "Unable to load assigned classes.",
          );
        }

        const programHeadInstructorId = data.program_head?.faculty_id;

        if (
          userRole === "Program Head" &&
          (!Number.isSafeInteger(programHeadInstructorId) ||
            (programHeadInstructorId ?? 0) <= 0)
        ) {
          throw new Error(
            "Your Program Head account has no valid linked instructor record.",
          );
        }

        const loadedClasses = Array.isArray(data.classes)
          ? data.classes.filter(
              (item) =>
                item.offering_status !== "Cancelled" &&
                (userRole !== "Program Head" ||
                  item.faculty?.faculty_id === programHeadInstructorId),
            )
          : [];

        setFaculty(
          userRole === "Program Head" && data.program_head
            ? {
                faculty_id: data.program_head.faculty_id,
                employee_number: data.program_head.employee_number,
                faculty_name: data.program_head.program_head_name,
              }
            : data.faculty || null,
        );

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

        console.error("LOAD TEACHING CLASSES ERROR:", requestError);

        setClasses([]);
        setSelectedOfferingId(null);

        setClassesError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load assigned classes.",
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
  }, [
    authenticated,
    canUseTeachingGradebook,
    userRole,
    navigate,
    requestedOfferingId,
    classesApiBase,
  ]);

  const loadGradebook = useCallback(
    async (signal?: AbortSignal) => {
      if (!selectedOfferingId) {
        setGradebookClass(null);

        setStudents([]);
        setSummary(emptySummary());

        return;
      }

      try {
        setGradebookLoading(true);
        setGradebookError("");

        setGradebookClass(null);
        setStudents([]);
        setSummary(emptySummary());

        const response = await authService.authFetch(
          `${classesApiBase}/${selectedOfferingId}/gradebook`,
          {
            method: "GET",

            signal,
          },
        );

        const data = await readJsonResponse<GradebookResponse>(response);

        if (
          signal?.aborted ||
          activeOfferingIdRef.current !== selectedOfferingId
        ) {
          return;
        }

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
              (student) =>
                student.grade?.grade_status === "Returned" &&
                student.grade?.grading_outcome === "NUMERIC",
            ).length,

          approved:
            data.summary?.approved ??
            loadedStudents.filter(
              (student) => student.grade?.grade_status === "Approved",
            ).length,
        });
      } catch (requestError) {
        if (
          signal?.aborted ||
          activeOfferingIdRef.current !== selectedOfferingId
        ) {
          return;
        }

        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD TEACHING GRADEBOOK ERROR:", requestError);

        setGradebookClass(null);

        setStudents([]);
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
    [selectedOfferingId, navigate, classesApiBase],
  );

  useEffect(() => {
    if (!authenticated || !canUseTeachingGradebook || !selectedOfferingId) {
      return;
    }

    const controller = new AbortController();

    void loadGradebook(controller.signal);

    return () => {
      controller.abort();
    };
  }, [
    authenticated,
    canUseTeachingGradebook,
    selectedOfferingId,
    gradebookRefreshKey,
    loadGradebook,
  ]);
  useEffect(() => {
    if (!authenticated || !canUseTeachingGradebook || !selectedOfferingId) {
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
    canUseTeachingGradebook,
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
      if (activeOfferingIdRef.current !== offeringId) {
        throw new Error(
          "You switched to another class. The previous score was not saved.",
        );
      }

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

      // Ignore a response that belongs to a class the user has left.
      if (activeOfferingIdRef.current !== offeringId) return;

      // If the server version is unexpected, reload instead of displaying stale data.
      if (
        !Number.isSafeInteger(data.score.record_version) ||
        data.score.record_version <= (previousVersion ?? 0) ||
        data.score.score_status !== scoreStatus
      ) {
        setGradebookRefreshKey((current) => current + 1);
        throw new Error(
          "The server saved an unexpected score version or status. Reload the gradebook before editing again.",
        );
      }

      setModernGradebook((current) => {
        if (
          !current ||
          current.offering_id !== offeringId ||
          activeOfferingIdRef.current !== offeringId
        )
          return current;
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
      if (activeOfferingIdRef.current === offeringId) {
        rowPreviewChangeVersions.current[enrollmentSubjectId] =
          (rowPreviewChangeVersions.current[enrollmentSubjectId] ?? 0) + 1;
        setRowGradePreviews((current) => {
          const next = { ...current };
          delete next[enrollmentSubjectId];
          return next;
        });
        setModernPreviewRefreshKey((current) => current + 1);
        setRowPreviewRefreshTarget((current) => ({
          studentId: enrollmentSubjectId,
          sequence: current.sequence + 1,
        }));
      }
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
    assessmentStructureEditable && !semesterSubmitting && !resubmittingCombined;

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

  useEffect(() => {
    const offeringId = selectedOfferingId;
    const enrollmentSubjectId = previewStudentId;
    const controller = new AbortController();
    setModernPreview(null);
    setModernPreviewError("");

    if (
      !authenticated ||
      !canUseTeachingGradebook ||
      !offeringId ||
      !enrollmentSubjectId ||
      modernGradebook?.offering_id !== offeringId ||
      !modernGradebook.students.some(
        (student) =>
          student.enrollment_subject_id === enrollmentSubjectId &&
          student.is_current_enrolled,
      )
    ) {
      setModernPreviewLoading(false);
      return () => controller.abort();
    }

    setModernPreviewLoading(true);
    const loadPreview = async () => {
      try {
        const response = await authService.authFetch(
          `${MODERN_GRADEBOOK_API}/${offeringId}/students/${enrollmentSubjectId}/grade-preview`,
          { method: "GET", signal: controller.signal },
        );
        const data =
          await readJsonResponse<ModernGradePreviewResponse>(response);
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
          data.student?.enrollment_subject_id !== enrollmentSubjectId ||
          !data.terms?.MIDTERM ||
          !data.terms?.FINAL_TERM ||
          !data.semester
        ) {
          throw new Error(data.message || "Grade calculation is unavailable.");
        }
        setModernPreview(data);
      } catch (error) {
        if (!controller.signal.aborted) {
          setModernPreviewError(
            error instanceof Error
              ? error.message
              : "Unable to load the grade calculation.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setModernPreviewLoading(false);
      }
    };
    void loadPreview();
    return () => controller.abort();
  }, [
    authenticated,
    canUseTeachingGradebook,
    selectedOfferingId,
    previewStudentId,
    modernGradebook?.offering_id,
    modernGradebook?.students,
    modernPreviewRefreshKey,
    navigate,
  ]);
  useEffect(() => {
    const offeringId = selectedOfferingId;
    const studentId = previewStudentId;
    const controller = new AbortController();

    setLatestCombined(null);
    setLatestCombinedError("");

    if (
      !authenticated ||
      !canUseTeachingGradebook ||
      !offeringId ||
      !studentId
    ) {
      setLatestCombinedLoading(false);
      return () => controller.abort();
    }

    setLatestCombinedLoading(true);

    const load = async () => {
      try {
        const response = await authService.authFetch(
          `${MODERN_GRADEBOOK_API}/${offeringId}/students/${studentId}/semester-submissions/latest`,
          {
            method: "GET",
            signal: controller.signal,
          },
        );

        const data =
          await readJsonResponse<LatestCombinedSubmissionResponse>(response);

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
          data.enrollment_subject_id !== studentId
        ) {
          throw new Error(data.message || "Could not load submission status.");
        }

        setLatestCombined(data);
      } catch (error) {
        if (!controller.signal.aborted) {
          setLatestCombinedError(
            error instanceof Error
              ? error.message
              : "Could not load submission status.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLatestCombinedLoading(false);
        }
      }
    };

    void load();

    return () => controller.abort();
  }, [
    authenticated,
    canUseTeachingGradebook,
    selectedOfferingId,
    previewStudentId,
    gradebookRefreshKey,
    navigate,
  ]);

  const selectedClass = useMemo(() => {
    const assignedClass = classes.find(
      (item) => item.offering_id === selectedOfferingId,
    );

    return (
      assignedClass ??
      (gradebookClass?.offering_id === selectedOfferingId
        ? gradebookClass
        : null)
    );
  }, [classes, selectedOfferingId, gradebookClass]);

  const attendanceRosterReady = useMemo(() => {
    if (
      classesLoading ||
      gradebookLoading ||
      Boolean(gradebookError) ||
      !selectedClass ||
      !selectedOfferingId ||
      modernGradebook?.offering_id !== selectedOfferingId ||
      modernGradebook.students.length !== students.length
    ) {
      return false;
    }

    const verifiedStudents = new Map(
      students.map(
        (student) =>
          [
            student.enrollment_subject_id,
            student.student_number.trim().toUpperCase(),
          ] as const,
      ),
    );

    return modernGradebook.students.every(
      (student) =>
        verifiedStudents.get(student.enrollment_subject_id) ===
        student.student_number.trim().toUpperCase(),
    );
  }, [
    classesLoading,
    gradebookLoading,
    gradebookError,
    selectedClass,
    selectedOfferingId,
    modernGradebook,
    students,
  ]);

  // Keep Midterm and Final Term visible together, in official category order.
  const termAssessmentColumns = useMemo<TermAssessmentColumn[]>(() => {
    if (modernGradebook?.offering_id !== selectedOfferingId) return [];

    return (["MIDTERM", "FINAL_TERM"] as const).flatMap((term) => {
      const categories = modernGradebook.terms[term]?.categories;
      if (!Array.isArray(categories)) return [];

      return categories.flatMap<TermAssessmentColumn>((category) => {
        if (
          !Array.isArray(category.assessments) ||
          !category.assessments.length
        ) {
          return [{ term, category, assessment: null }];
        }
        return category.assessments.map((assessment) => ({
          term,
          category,
          assessment,
        }));
      });
    });
  }, [modernGradebook, selectedOfferingId]);

  const midtermAssessmentColumns = termAssessmentColumns.filter(
    (column) => column.term === "MIDTERM",
  );
  const finalTermAssessmentColumns = termAssessmentColumns.filter(
    (column) => column.term === "FINAL_TERM",
  );

  const modernStudentByEnrollmentSubject = useMemo(() => {
    if (modernGradebook?.offering_id !== selectedOfferingId) {
      return new Map<number, ModernGradebookStudent>();
    }

    const officialStudentNumbers = new Map(
      students.map(
        (student) =>
          [
            student.enrollment_subject_id,
            student.student_number.trim().toUpperCase(),
          ] as const,
      ),
    );

    return new Map(
      modernGradebook.students
        .filter(
          (student) =>
            officialStudentNumbers.get(student.enrollment_subject_id) ===
            student.student_number.trim().toUpperCase(),
        )
        .map((student) => [student.enrollment_subject_id, student] as const),
    );
  }, [modernGradebook, selectedOfferingId, students]);

  const returnedSpecialSubmission =
    selectedClass?.offering_status === "Open" &&
    latestCombined?.offering_id === selectedOfferingId &&
    latestCombined.enrollment_subject_id === previewStudentId &&
    latestCombined.grade?.grade_status === "Returned" &&
    ["INCOMPLETE", "UNOFFICIAL_DROP"].includes(
      latestCombined.grade.grading_outcome,
    ) &&
    latestCombined.latest_submission?.submission_status === "RETURNED" &&
    latestCombined.returned_special_outcome?.outcome_type ===
      latestCombined.grade.grading_outcome
      ? {
          previous: latestCombined.latest_submission,
          original: latestCombined.returned_special_outcome,
        }
      : null;
  const returnedSubmission =
    latestCombined?.offering_id === selectedOfferingId &&
    latestCombined.enrollment_subject_id === previewStudentId &&
    latestCombined.grade?.grade_status === "Returned" &&
    latestCombined.grade.grading_outcome === "NUMERIC" &&
    latestCombined.latest_submission?.submission_status === "RETURNED" &&
    ["MIDTERM", "FINAL_TERM", "BOTH"].includes(
      latestCombined.latest_submission.returned_edit_scope ?? "",
    )
      ? latestCombined.latest_submission
      : null;

  const resubmitReturnedSemester = async () => {
    const offeringId = selectedOfferingId;
    const studentId = previewStudentId;
    const previous = returnedSubmission;

    const rosterStudent = modernStudentByEnrollmentSubject.get(studentId ?? -1);

    if (
      resubmittingCombined ||
      modernPreviewLoading ||
      Boolean(modernPreviewError) ||
      !offeringId ||
      !studentId ||
      !previous ||
      !rosterStudent?.is_current_enrolled ||
      selectedClass?.offering_status !== "Open" ||
      modernPreview?.offering_id !== offeringId ||
      modernPreview.student.enrollment_subject_id !== studentId ||
      modernPreview.terms.MIDTERM.state !== "READY" ||
      modernPreview.terms.FINAL_TERM.state !== "READY" ||
      modernPreview.semester.state !== "READY"
    ) {
      setResubmissionError(
        "A complete, current returned submission is required.",
      );
      return;
    }

    const endpoint =
      `${MODERN_GRADEBOOK_API}/${offeringId}/students/${studentId}` +
      `/semester-submissions/${previous.submission_id}/resubmit`;

    const request = async (dryRun: boolean) => {
      const response = await authService.authFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expected_record_version: previous.record_version,
          confirm_resubmission: true,
          dry_run: dryRun,
        }),
      });

      const data =
        await readJsonResponse<CombinedSemesterResubmitResponse>(response);

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        throw new Error("Your session has expired.");
      }

      if (
        !response.ok ||
        !data.success ||
        data.status !== "SUBMITTED" ||
        data.previous_submission_id !== previous.submission_id ||
        data.returned_scope !== previous.returned_edit_scope
      ) {
        throw new Error(
          [data.code, data.message].filter(Boolean).join(": ") ||
            "The backend rejected resubmission.",
        );
      }

      return data;
    };

    setResubmittingCombined(true);
    setResubmissionError("");
    setResubmissionMessage("");

    try {
      const validation = await request(true);

      if (validation.dry_run !== true || validation.persisted !== false) {
        throw new Error(
          "The backend did not confirm safe resubmission validation.",
        );
      }

      const scopeLabel =
        previous.returned_edit_scope === "BOTH"
          ? "Midterm and Final Term"
          : previous.returned_edit_scope === "MIDTERM"
            ? "Midterm"
            : "Final Term";

      const confirmed = window.confirm(
        `Resubmit the returned semester grade?\n\n` +
          `Returned scope: ${scopeLabel}\n` +
          "The Program Head will review the revised, server-calculated result.",
      );

      if (!confirmed) return;

      // Check that the selected class and student have not changed.
      if (
        activeOfferingIdRef.current !== offeringId ||
        activePreviewStudentIdRef.current !== studentId
      ) {
        throw new Error(
          "The selected class or student has changed. Please review the returned grade and resubmit again.",
        );
      }

      const result = await request(false);

      if (!result.persisted || result.dry_run || !result.submission_id) {
        throw new Error("The backend did not confirm a saved resubmission.");
      }

      setResubmissionMessage(
        `Resubmission #${result.submission_id} saved. ` +
          "Waiting for Program Head review.",
      );

      setGradebookRefreshKey((value) => value + 1);
      setModernPreviewRefreshKey((value) => value + 1);
    } catch (error) {
      setResubmissionError(
        error instanceof Error
          ? error.message
          : "Unable to resubmit semester grade.",
      );

      setGradebookRefreshKey((value) => value + 1);
    } finally {
      setResubmittingCombined(false);
    }
  };

  const submitCombinedSemester = async () => {
    const offeringId = selectedOfferingId;
    const studentId = previewStudentId;

    const student = students.find(
      (item) => item.enrollment_subject_id === studentId,
    );

    const rosterStudent = modernStudentByEnrollmentSubject.get(studentId ?? -1);

    if (
      semesterSubmitting ||
      modernPreviewLoading ||
      Boolean(modernPreviewError) ||
      !offeringId ||
      !studentId ||
      !student ||
      student.grade !== null ||
      !rosterStudent?.is_current_enrolled ||
      selectedClass?.offering_status !== "Open" ||
      modernPreview?.offering_id !== offeringId ||
      modernPreview.student.enrollment_subject_id !== studentId ||
      modernPreview.terms.MIDTERM.state !== "READY" ||
      modernPreview.terms.FINAL_TERM.state !== "READY" ||
      modernPreview.semester.state !== "READY"
    ) {
      setSemesterSubmissionError(
        "This student is not eligible for a new combined submission. " +
          "Check both terms, enrollment, and existing grade history.",
      );
      return;
    }

    setSemesterSubmitting(true);
    setSemesterSubmissionError("");
    setResubmissionError("");
    setResubmissionMessage("");

    const endpoint =
      `${MODERN_GRADEBOOK_API}/${offeringId}` +
      `/students/${studentId}/semester-submissions`;

    const request = async (dryRun: boolean) => {
      const response = await authService.authFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expected_latest_submission_id: null,
          expected_latest_submission_record_version: null,
          dry_run: dryRun,
        }),
      });

      const data =
        await readJsonResponse<CombinedSemesterSubmissionResponse>(response);

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        throw new Error("Your session has expired.");
      }

      if (
        !response.ok ||
        !data.success ||
        data.offering_id !== offeringId ||
        data.enrollment_subject_id !== studentId ||
        data.status !== "SUBMITTED"
      ) {
        throw new Error(
          [data.code, data.message].filter(Boolean).join(": ") ||
            "Combined semester submission was rejected.",
        );
      }

      return data;
    };

    try {
      // Validate all grading requirements without saving.
      const validation = await request(true);

      if (validation.dry_run !== true || validation.persisted !== false) {
        throw new Error("The backend did not confirm a safe dry-run.");
      }

      const confirmed = window.confirm(
        `Submit the combined semester grade for ${student.full_name}?\n\n` +
          `Midterm: ${modernPreview.terms.MIDTERM.term_percentage?.display ?? "—"}%\n` +
          `Final Term: ${modernPreview.terms.FINAL_TERM.term_percentage?.display ?? "—"}%\n` +
          `Semester: ${modernPreview.semester.semester_percentage?.display ?? "—"}%\n` +
          `Numeric Equivalent: ${modernPreview.semester.numeric_equivalent ?? "—"}\n\n` +
          "The backend will recalculate and lock the submitted result " +
          "for Program Head review. This does not publish an official grade.",
      );

      if (!confirmed) return;

      // Make sure the same class and student are still selected.
      if (
        activeOfferingIdRef.current !== offeringId ||
        activePreviewStudentIdRef.current !== studentId
      ) {
        throw new Error(
          "The selected class or student has changed. Please review the grade and submit again.",
        );
      }

      // Save the combined semester submission.
      const result = await request(false);

      if (result.persisted !== true || !result.submission_id) {
        throw new Error("The server did not confirm a saved submission.");
      }

      setSemesterSubmissionMessage(
        `Submission #${result.submission_id} was saved. ` +
          "Waiting for Program Head review; the grade is not yet published.",
      );

      setGradebookRefreshKey((current) => current + 1);
      setModernPreviewRefreshKey((current) => current + 1);
    } catch (error) {
      setSemesterSubmissionError(
        error instanceof Error ? error.message : "Unable to submit grade.",
      );
    } finally {
      setSemesterSubmitting(false);
    }
  };

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

  const rowPreviewStudentIds = useMemo(() => {
    if (modernGradebook?.offering_id !== selectedOfferingId) return "";

    return filteredStudents
      .filter(
        (student) =>
          student.grade?.grade_status !== "Approved" &&
          modernStudentByEnrollmentSubject.get(student.enrollment_subject_id)
            ?.is_current_enrolled === true,
      )
      .map((student) => student.enrollment_subject_id)
      .join(",");
  }, [
    filteredStudents,
    modernStudentByEnrollmentSubject,
    modernGradebook?.offering_id,
    selectedOfferingId,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    const offeringId = selectedOfferingId;
    const ids = rowPreviewStudentIds.split(",").filter(Boolean).map(Number);

    setRowGradePreviews({});
    if (
      !authenticated ||
      !canUseTeachingGradebook ||
      !offeringId ||
      !ids.length
    ) {
      setRowGradePreviewsLoading(false);
      return () => controller.abort();
    }

    setRowGradePreviewsLoading(true);
    let nextIndex = 0;
    // Bound requests so a full class never floods the backend.
    const worker = async () => {
      while (!controller.signal.aborted) {
        const index = nextIndex++;
        if (index >= ids.length) return;
        const studentId = ids[index];
        const versionAtRequest =
          rowPreviewChangeVersions.current[studentId] ?? 0;
        try {
          const response = await authService.authFetch(
            `${MODERN_GRADEBOOK_API}/${offeringId}/students/${studentId}/grade-preview`,
            { method: "GET", signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          if (response.status === 401) {
            controller.abort();
            authService.logout();
            navigate("/login", { replace: true });
            return;
          }
          const data =
            await readJsonResponse<ModernGradePreviewResponse>(response);
          if (
            !controller.signal.aborted &&
            response.ok &&
            data.success &&
            data.offering_id === offeringId &&
            data.student?.enrollment_subject_id === studentId &&
            data.terms?.MIDTERM &&
            data.terms?.FINAL_TERM &&
            data.semester &&
            (rowPreviewChangeVersions.current[studentId] ?? 0) ===
              versionAtRequest
          ) {
            setRowGradePreviews((current) => ({
              ...current,
              [studentId]: data,
            }));
          }
        } catch {
          // Some historical/locked grades do not expose a live calculation.
          // Their official numeric rating is displayed separately.
        }
      }
    };

    void Promise.all(
      Array.from({ length: Math.min(4, ids.length) }, worker),
    ).finally(() => {
      if (!controller.signal.aborted) setRowGradePreviewsLoading(false);
    });

    return () => controller.abort();
  }, [
    authenticated,
    canUseTeachingGradebook,
    selectedOfferingId,
    rowPreviewStudentIds,
    gradebookRefreshKey,
    rowPreviewBatchRefreshKey,
    navigate,
  ]);

  // After a score auto-save, refresh only that student's totals.
  useEffect(() => {
    const offeringId = selectedOfferingId;
    const studentId = rowPreviewRefreshTarget.studentId;
    if (
      !offeringId ||
      !studentId ||
      !rowPreviewStudentIds.split(",").includes(String(studentId))
    )
      return;

    const controller = new AbortController();
    const versionAtRequest = rowPreviewChangeVersions.current[studentId] ?? 0;
    const reload = async () => {
      try {
        const response = await authService.authFetch(
          `${MODERN_GRADEBOOK_API}/${offeringId}/students/${studentId}/grade-preview`,
          { method: "GET", signal: controller.signal },
        );
        if (controller.signal.aborted || !response.ok) return;
        const data =
          await readJsonResponse<ModernGradePreviewResponse>(response);
        if (
          !controller.signal.aborted &&
          activeOfferingIdRef.current === offeringId &&
          (rowPreviewChangeVersions.current[studentId] ?? 0) ===
            versionAtRequest &&
          data.success &&
          data.offering_id === offeringId &&
          data.student?.enrollment_subject_id === studentId &&
          data.terms?.MIDTERM &&
          data.terms?.FINAL_TERM &&
          data.semester
        ) {
          setRowGradePreviews((current) => {
            if (
              activeOfferingIdRef.current !== offeringId ||
              (rowPreviewChangeVersions.current[studentId] ?? 0) !==
                versionAtRequest
            )
              return current;
            return { ...current, [studentId]: data };
          });
        }
      } catch {
        // Leave the last confirmed calculation visible until the next refresh.
      }
    };
    void reload();
    return () => controller.abort();
  }, [rowPreviewRefreshTarget, selectedOfferingId, rowPreviewStudentIds]);

  const handleClassChange = (value: string) => {
    if (semesterSubmitting || resubmittingCombined) {
      return;
    }

    const nextId = parsePositiveInt(value);

    if (!nextId) {
      return;
    }

    if (nextId === selectedOfferingId) {
      return;
    }

    setAssessmentManagerOpen(false);
    setAssessmentStructure(null);
    setAttendanceModalOpen(false);

    activeOfferingIdRef.current = nextId;
    activePreviewStudentIdRef.current = null;
    setSelectedOfferingId(nextId);

    setStudentSearch("");
    setStatusFilter("All");

    setPreviewStudentId(null);

    setSemesterSubmissionError("");
    setSemesterSubmissionMessage("");
    setResubmissionError("");
    setResubmissionMessage("");

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

  const refreshGradebook = () => {
    setGradebookRefreshKey((current) => current + 1);
  };

  const backToClasses = () => {
    navigate(
      userRole === "Program Head"
        ? "/programhead/class/management"
        : "/faculty/classes",
    );
  };

  const viewRoster = () => {
    if (!selectedOfferingId) return;

    if (userRole === "Program Head") {
      navigate("/programhead/class/management");
      return;
    }

    navigate(`/faculty/classes/students?offering_id=${selectedOfferingId}`);
  };

  if (!authenticated || !canUseTeachingGradebook) {
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
              {userRole === "Program Head"
                ? "Program Head · Teaching Gradebook"
                : "Faculty · Grade Encoding"}
            </div>

            <h1>Enter Grades</h1>

            <p>
              Record assessments and attendance, then review the calculated
              Midterm, Final Term and semester grades.
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
              {userRole === "Program Head"
                ? "Class Management"
                : "View Student List"}
            </button>

            <button
              type="button"
              className="faculty-grade-header-button faculty-grade-header-button--back"
              onClick={backToClasses}
            >
              <ArrowLeft size={16} strokeWidth={2.1} />
              {userRole === "Program Head" ? "Class Management" : "My Classes"}
            </button>
          </div>
        </section>

        <section className="faculty-grade-toolbar">
          <div className="faculty-grade-faculty">
            <span className="faculty-grade-faculty__icon">
              <GraduationCap size={20} />
            </span>

            <div className="faculty-grade-faculty__copy">
              <small>
                {userRole === "Program Head" ? "Program Head" : "Faculty"}
              </small>
              <strong>{faculty?.faculty_name || "Instructor"}</strong>
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
                    disabled={
                      classesLoading ||
                      classes.length === 0 ||
                      semesterSubmitting ||
                      resubmittingCombined
                    }
                  />

                  {classSearch && (
                    <button
                      type="button"
                      aria-label="Clear class search"
                      disabled={semesterSubmitting || resubmittingCombined}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setClassSearch("")}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>

                {classSearchFocused &&
                  !semesterSubmitting &&
                  !resubmittingCombined &&
                  classSearch.trim() && (
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
          style={gradebookError ? { display: "none" } : undefined}
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

        {gradebookError &&
          !classesLoading &&
          modernGradebook?.offering_id === selectedOfferingId && (
            <section
              className="faculty-gradebook"
              aria-label="Read-only assessment roster"
            >
              <header className="faculty-gradebook-header">
                <div className="faculty-gradebook-header__title">
                  <span className="faculty-gradebook-header__icon">
                    <BookOpenCheck size={18} />
                  </span>

                  <div>
                    <span>Assessment Roster</span>
                    <h2>Students — Read-only</h2>
                    <p>
                      The modern roster loaded, but official grade statuses are
                      unavailable. Editing and submission remain locked.
                    </p>
                  </div>
                </div>
              </header>

              <div className="faculty-grade-table-wrapper">
                <table className="faculty-grade-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Subject Status</th>
                      <th>Official Grade Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {modernGradebook.students.map((student) => (
                      <tr key={student.enrollment_subject_id}>
                        <td>
                          <div className="faculty-grade-student">
                            <div>
                              <strong>{student.student_name}</strong>
                              <span>{student.student_number}</span>
                            </div>
                          </div>
                        </td>

                        <td>{student.enrollment_subject_status}</td>

                        <td>
                          <span className="faculty-grade-locked">
                            <ShieldCheck size={13} />
                            Unknown · Read-only
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
          selectedClass && (
            <section className="faculty-gradebook">
              <header className="faculty-gradebook-header">
                <div className="faculty-gradebook-header__title">
                  <span className="faculty-gradebook-header__icon">
                    <BookOpenCheck size={18} />
                  </span>

                  <div>
                    <span>Assessment-Based Grading · One Sheet</span>
                    <h2>Semester Gradebook</h2>
                    <p>
                      Midterm and Final Term are displayed together. Enter
                      scores directly; attendance and semester totals are
                      calculated by the backend. Official grades stay read-only.
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
                        " · Scroll right to view Midterm, Final Term and semester results"}
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
                        <span className="faculty-semester-grade-table__hint">
                          Midterm 50% + Final Term 50% · One sheet
                        </span>
                        <label className="faculty-gradebook-filter">
                          <span>Manage Term</span>
                          <select
                            value={assessmentTerm}
                            onChange={(event) =>
                              setAssessmentTerm(
                                event.target.value as AssessmentTerm,
                              )
                            }
                            aria-label="Term for assessment management"
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
                        <button
                          type="button"
                          className="faculty-grade-header-button"
                          onClick={() => setAttendanceModalOpen(true)}
                          disabled={!attendanceRosterReady}
                        >
                          <CalendarDays size={15} />
                          Attendance
                        </button>
                        <button
                          type="button"
                          className="faculty-grade-header-button"
                          onClick={() =>
                            document
                              .getElementById(
                                "faculty-grade-calculation-preview",
                              )
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              })
                          }
                          disabled={previewStudentId === null}
                        >
                          <BookOpenCheck size={15} />
                          Grade Preview
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

                  <div
                    className="faculty-grade-table-wrapper faculty-grade-table-wrapper--semester"
                    role="region"
                    aria-label="Combined Midterm and Final Term gradebook"
                    tabIndex={0}
                  >
                    <table
                      className="faculty-grade-table faculty-semester-grade-table"
                      style={{
                        minWidth:
                          230 +
                          termAssessmentColumns.length * 155 +
                          2 * 112 +
                          3 * 125,
                      }}
                    >
                      <colgroup>
                        <col style={{ width: 230 }} />
                        {midtermAssessmentColumns.map((column, index) => (
                          <col
                            key={`midterm-${column.assessment?.assessment_id ?? `category-${index}`}`}
                            style={{ width: 155 }}
                          />
                        ))}
                        <col style={{ width: 112 }} />
                        {finalTermAssessmentColumns.map((column, index) => (
                          <col
                            key={`final-${column.assessment?.assessment_id ?? `category-${index}`}`}
                            style={{ width: 155 }}
                          />
                        ))}
                        <col style={{ width: 112 }} />
                        <col style={{ width: 125 }} />
                        <col style={{ width: 125 }} />
                        <col style={{ width: 125 }} />
                      </colgroup>
                      <thead>
                        <tr className="faculty-semester-grade-table__groups">
                          <th
                            rowSpan={2}
                            className="faculty-semester-grade-table__sticky"
                          >
                            Student / Class Status
                          </th>
                          <th
                            colSpan={midtermAssessmentColumns.length + 1}
                            className="faculty-semester-grade-table__group faculty-semester-grade-table__group--midterm"
                          >
                            Midterm · 50%
                          </th>
                          <th
                            colSpan={finalTermAssessmentColumns.length + 1}
                            className="faculty-semester-grade-table__group faculty-semester-grade-table__group--final"
                          >
                            Final Term · 50%
                          </th>
                          <th
                            colSpan={3}
                            className="faculty-semester-grade-table__group faculty-semester-grade-table__group--semester"
                          >
                            Semester Result
                          </th>
                        </tr>
                        <tr className="faculty-semester-grade-table__columns">
                          {(["MIDTERM", "FINAL_TERM"] as const).flatMap(
                            (term) => [
                              ...termAssessmentColumns
                                .filter((column) => column.term === term)
                                .map(({ category, assessment }) => (
                                  <th
                                    key={`${term}:${category.category_code}:${assessment?.assessment_id ?? "none"}`}
                                    className={
                                      term === "MIDTERM"
                                        ? "faculty-semester-grade-table__midterm"
                                        : "faculty-semester-grade-table__final"
                                    }
                                    title={`${category.category_name} · ${category.category_percent}% of ${term === "MIDTERM" ? "Midterm" : "Final Term"}`}
                                  >
                                    <div>
                                      {category.category_name} ·{" "}
                                      {category.category_percent}%
                                    </div>
                                    <small>
                                      {assessment
                                        ? `${assessment.header_name} · Max ${assessment.maximum_score}`
                                        : category.category_code ===
                                            "ATTENDANCE"
                                          ? "Per held meeting"
                                          : "Not configured"}
                                    </small>
                                  </th>
                                )),
                              <th
                                key={`${term}:total`}
                                className={
                                  term === "MIDTERM"
                                    ? "faculty-semester-grade-table__term-total-head"
                                    : "faculty-semester-grade-table__term-total-head faculty-semester-grade-table__final-total-head"
                                }
                              >
                                {term === "MIDTERM" ? "Midterm" : "Final Term"}
                                <small>Total %</small>
                              </th>,
                            ],
                          )}
                          <th className="faculty-semester-grade-table__result-head">
                            Semester <small>Percentage</small>
                          </th>
                          <th className="faculty-semester-grade-table__result-head">
                            Numeric <small>Equivalent</small>
                          </th>
                          <th className="faculty-semester-grade-table__result-head">
                            Grade <small>Status</small>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredStudents.map((student) => {
                          const id = student.enrollment_subject_id;
                          const record =
                            modernStudentByEnrollmentSubject.get(id);
                          const status = getGradeStatus(student);
                          const currentPreview =
                            modernPreview?.offering_id === selectedOfferingId &&
                            modernPreview.student.enrollment_subject_id ===
                              id &&
                            !modernPreviewLoading
                              ? modernPreview
                              : (rowGradePreviews[id] ?? null);

                          const officialRating = student.grade?.final_rating;
                          const savedOfficialTerm = (term: AssessmentTerm) => {
                            if (status !== "Approved") return null;
                            const value =
                              term === "MIDTERM"
                                ? student.grade?.midterm_grade
                                : student.grade?.final_grade;
                            return value == null
                              ? null
                              : Number(value).toFixed(2);
                          };
                          const savedOfficialSemester =
                            status === "Approved" &&
                            student.grade?.overall_percentage != null
                              ? Number(
                                  student.grade.overall_percentage,
                                ).toFixed(2)
                              : null;
                          const numeric =
                            status === "Approved" && officialRating != null
                              ? Number(officialRating).toFixed(2)
                              : (currentPreview?.semester.numeric_equivalent ??
                                (officialRating != null
                                  ? Number(officialRating).toFixed(2)
                                  : "—"));

                          const renderTermCells = (term: AssessmentTerm) => {
                            const columns = termAssessmentColumns.filter(
                              (column) => column.term === term,
                            );
                            return [
                              ...columns.map(({ category, assessment }) => {
                                const score = assessment
                                  ? (record?.scores_by_assessment_id[
                                      String(assessment.assessment_id)
                                    ] ?? null)
                                  : null;
                                const canEditAssessment = Boolean(
                                  assessment &&
                                  record?.is_current_enrolled &&
                                  selectedClass?.offering_status === "Open" &&
                                  !semesterSubmitting &&
                                  !resubmittingCombined &&
                                  (status === "Not Started" ||
                                    status === "Draft" ||
                                    (status === "Returned" &&
                                      previewStudentId === id &&
                                      returnedSubmission !== null &&
                                      (returnedSubmission.returned_edit_scope ===
                                        "BOTH" ||
                                        returnedSubmission.returned_edit_scope ===
                                          term))),
                                );
                                const attendance =
                                  category.category_code === "ATTENDANCE"
                                    ? currentPreview?.terms?.[
                                        term
                                      ]?.categories.find(
                                        (item) =>
                                          item.category_code === "ATTENDANCE",
                                      )
                                    : null;
                                return (
                                  <td
                                    key={`${term}:${category.category_code}:${assessment?.assessment_id ?? "none"}`}
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
                                            : attendance?.state === "READY"
                                              ? `${attendance.category_percentage?.display ?? "—"}%`
                                              : category.category_code ===
                                                  "ATTENDANCE"
                                                ? "—"
                                                : "Not configured"}
                                        </strong>
                                        <small>
                                          {category.category_code ===
                                          "ATTENDANCE"
                                            ? "From attendance register"
                                            : "Read-only"}
                                        </small>
                                      </div>
                                    )}
                                  </td>
                                );
                              }),
                              <td
                                key={`${term}:total`}
                                className={`faculty-semester-grade-table__term-total ${term === "FINAL_TERM" ? "faculty-semester-grade-table__term-total--final" : ""}`}
                              >
                                <strong>
                                  {currentPreview?.terms?.[term]
                                    ?.term_percentage?.display != null
                                    ? `${currentPreview.terms[term].term_percentage!.display}%`
                                    : savedOfficialTerm(term) != null
                                      ? `${savedOfficialTerm(term)}%`
                                      : "—"}
                                </strong>
                                <small>
                                  {currentPreview?.terms?.[
                                    term
                                  ]?.state?.replaceAll("_", " ") ??
                                    (savedOfficialTerm(term) != null
                                      ? "Official record"
                                      : rowGradePreviewsLoading &&
                                          record?.is_current_enrolled
                                        ? "Calculating..."
                                        : "Not available")}
                                </small>
                              </td>,
                            ];
                          };

                          return (
                            <tr
                              key={id}
                              className={`${status === "Returned" ? "returned-row" : ""} ${previewStudentId === id ? "faculty-semester-grade-table__selected" : ""}`}
                            >
                              <td className="faculty-semester-grade-table__sticky">
                                <div className="faculty-grade-student">
                                  <span className="faculty-grade-student__avatar">
                                    <UserRound size={16} />
                                  </span>
                                  <div>
                                    <strong>{student.full_name}</strong>
                                    <span>{student.student_number}</span>
                                    <small>
                                      {student.subject_status} · #{id}
                                    </small>
                                    {record?.is_current_enrolled && (
                                      <button
                                        type="button"
                                        className="faculty-semester-grade-table__view"
                                        disabled={
                                          semesterSubmitting ||
                                          resubmittingCombined
                                        }
                                        onClick={() => {
                                          activePreviewStudentIdRef.current =
                                            id;
                                          setPreviewStudentId(id);
                                          setSemesterSubmissionError("");
                                          setSemesterSubmissionMessage("");
                                          setResubmissionError("");
                                          setResubmissionMessage("");
                                        }}
                                        aria-pressed={previewStudentId === id}
                                      >
                                        <BookOpenCheck size={13} />
                                        {previewStudentId === id
                                          ? "Selected for review"
                                          : "Review grade"}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </td>
                              {renderTermCells("MIDTERM")}
                              {renderTermCells("FINAL_TERM")}
                              <td className="faculty-semester-grade-table__semester-value">
                                <strong>
                                  {currentPreview?.semester.semester_percentage
                                    ?.display != null
                                    ? `${currentPreview.semester.semester_percentage.display}%`
                                    : savedOfficialSemester != null
                                      ? `${savedOfficialSemester}%`
                                      : "—"}
                                </strong>
                                <small>
                                  {currentPreview?.semester.state?.replaceAll(
                                    "_",
                                    " ",
                                  ) ??
                                    (savedOfficialSemester != null
                                      ? "Official record"
                                      : "Not available")}
                                </small>
                              </td>
                              <td className="faculty-semester-grade-table__numeric-value">
                                <strong>{numeric}</strong>
                                <small>
                                  {status === "Approved"
                                    ? "Official"
                                    : "Calculated / saved"}
                                </small>
                              </td>
                              <td className="faculty-semester-grade-table__status-value">
                                <span
                                  className={`faculty-grade-status ${status.toLowerCase().replace(/\s+/g, "-")}`}
                                >
                                  {status}
                                </span>
                                {status === "Approved" && (
                                  <small>
                                    <ShieldCheck size={12} /> Read-only
                                  </small>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="faculty-gradebook-table-meta faculty-semester-grade-table__note">
                    <small>
                      Midterm and Final Term share one sheet. Attendance comes
                      from held meetings; all percentages are calculated by the
                      backend. Unavailable calculations are shown as —. Approved
                      grades use preserved official results where available.
                    </small>
                  </div>
                  {previewStudentId !== null && (
                    <div
                      id="faculty-grade-calculation-preview"
                      className="faculty-gradebook-table-meta"
                      style={{ display: "block" }}
                    >
                      <strong>Calculated Semester Grade</strong>
                      {modernPreviewLoading && <p>Calculating grades...</p>}
                      {modernPreviewError && (
                        <p role="alert">{modernPreviewError}</p>
                      )}
                      {modernPreview &&
                        !modernPreviewLoading &&
                        modernPreview.offering_id === selectedOfferingId &&
                        modernPreview.student.enrollment_subject_id ===
                          previewStudentId && (
                          <div>
                            <p>
                              <strong>
                                {modernPreview.student.student_name}
                              </strong>{" "}
                              · {modernPreview.student.student_number}
                            </p>
                            <div
                              className="faculty-grade-summary"
                              style={{ margin: "12px 0" }}
                            >
                              {(["MIDTERM", "FINAL_TERM"] as const).map(
                                (value) => (
                                  <article
                                    key={value}
                                    className="faculty-grade-summary-card faculty-grade-summary-card--total"
                                  >
                                    <div>
                                      <small>
                                        {value === "MIDTERM"
                                          ? "Midterm · 50%"
                                          : "Final Term · 50%"}
                                      </small>
                                      <strong>
                                        {modernPreview.terms[value]
                                          .term_percentage?.display ?? "—"}
                                        %
                                      </strong>
                                      <span>
                                        {modernPreview.terms[value].state}
                                      </span>
                                    </div>
                                  </article>
                                ),
                              )}
                              <article className="faculty-grade-summary-card faculty-grade-summary-card--approved">
                                <div>
                                  <small>Semester Result</small>
                                  <strong>
                                    {modernPreview.semester.semester_percentage
                                      ?.display ?? "—"}
                                    %
                                  </strong>
                                  <span>{modernPreview.semester.state}</span>
                                </div>
                              </article>
                              <article className="faculty-grade-summary-card faculty-grade-summary-card--draft">
                                <div>
                                  <small>Numeric Equivalent</small>
                                  <strong>
                                    {modernPreview.semester
                                      .numeric_equivalent ?? "—"}
                                  </strong>
                                  <span>
                                    {modernPreview.semester.pass_fail ??
                                      "Not complete"}
                                  </span>
                                </div>
                              </article>
                            </div>
                            <table className="faculty-grade-table">
                              <thead>
                                <tr>
                                  <th>Term</th>
                                  <th>Category</th>
                                  <th>Weight</th>
                                  <th>Category %</th>
                                  <th>Contribution</th>
                                  <th>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(["MIDTERM", "FINAL_TERM"] as const).flatMap(
                                  (value) =>
                                    modernPreview.terms[value].categories.map(
                                      (category) => (
                                        <tr
                                          key={`${value}:${category.category_code}`}
                                        >
                                          <td>
                                            {value === "MIDTERM"
                                              ? "Midterm"
                                              : "Final Term"}
                                          </td>
                                          <td>{category.category_name}</td>
                                          <td>
                                            {category.category_weight_percent}%
                                          </td>
                                          <td>
                                            {category.category_percentage
                                              ?.display ?? "—"}
                                          </td>
                                          <td>
                                            {category
                                              .contribution_percent_points
                                              ?.display ?? "—"}
                                          </td>
                                          <td>
                                            {category.state.replaceAll(
                                              "_",
                                              " ",
                                            )}
                                          </td>
                                        </tr>
                                      ),
                                    ),
                                )}
                              </tbody>
                            </table>
                            {students.some(
                              (student) =>
                                student.enrollment_subject_id ===
                                  previewStudentId &&
                                student.grade?.grade_status === "Returned",
                            ) && (
                              <div className="faculty-gradebook-table-meta">
                                <div>
                                  <strong>
                                    Returned Grade — Revise and Resubmit
                                  </strong>
                                  {returnedSpecialSubmission &&
                                    selectedOfferingId &&
                                    selectedClass?.offering_status === "Open" &&
                                    modernStudentByEnrollmentSubject.get(
                                      previewStudentId,
                                    )?.is_current_enrolled &&
                                    students.some(
                                      (student) =>
                                        student.enrollment_subject_id ===
                                          previewStudentId &&
                                        student.grade?.grade_status ===
                                          "Returned",
                                    ) && (
                                      <ReturnedSpecialOutcomeResubmission
                                        key={`${selectedOfferingId}:${previewStudentId}:${returnedSpecialSubmission.previous.submission_id}`}
                                        offeringId={selectedOfferingId}
                                        student={
                                          students.find(
                                            (student) =>
                                              student.enrollment_subject_id ===
                                              previewStudentId,
                                          )!
                                        }
                                        previous={
                                          returnedSpecialSubmission.previous
                                        }
                                        original={
                                          returnedSpecialSubmission.original
                                        }
                                        onSubmitted={(submissionId) => {
                                          if (
                                            activeOfferingIdRef.current !==
                                              selectedOfferingId ||
                                            activePreviewStudentIdRef.current !==
                                              previewStudentId
                                          ) {
                                            return;
                                          }

                                          setResubmissionMessage(
                                            `Revised special-outcome submission #${submissionId} saved for Program Head review.`,
                                          );

                                          setGradebookRefreshKey(
                                            (value) => value + 1,
                                          );
                                          setModernPreviewRefreshKey(
                                            (value) => value + 1,
                                          );
                                        }}
                                      />
                                    )}
                                  {students.some(
                                    (student) =>
                                      student.enrollment_subject_id ===
                                        previewStudentId &&
                                      student.grade?.grade_status ===
                                        "Returned" &&
                                      [
                                        "INCOMPLETE",
                                        "UNOFFICIAL_DROP",
                                      ].includes(
                                        student.grade.grading_outcome ?? "",
                                      ),
                                  ) &&
                                    !returnedSpecialSubmission && (
                                      <div className="faculty-gradebook-table-meta">
                                        <strong>Returned INC / UD</strong>

                                        <p>
                                          {latestCombinedLoading
                                            ? "Checking return evidence..."
                                            : latestCombinedError ||
                                              "Special-outcome evidence resubmission is unavailable for this student. Editing is locked."}
                                        </p>
                                      </div>
                                    )}

                                  {latestCombinedLoading ? (
                                    <p>Checking return instructions...</p>
                                  ) : returnedSubmission ? (
                                    <>
                                      <p>
                                        Editable scope:{" "}
                                        {returnedSubmission.returned_edit_scope ===
                                        "BOTH"
                                          ? "Midterm and Final Term"
                                          : returnedSubmission.returned_edit_scope ===
                                              "MIDTERM"
                                            ? "Midterm only"
                                            : "Final Term only"}
                                      </p>

                                      <p>
                                        {returnedSubmission.review_remarks ||
                                          "See Program Head comments."}
                                      </p>
                                    </>
                                  ) : returnedSpecialSubmission ? (
                                    <p>
                                      Revise the returned INC/UD evidence using
                                      the form above. The revised submission
                                      requires another Program Head review.
                                    </p>
                                  ) : (
                                    <p>
                                      Returned submission details are
                                      unavailable. Editing is locked.
                                    </p>
                                  )}

                                  {latestCombinedError && (
                                    <p role="alert">{latestCombinedError}</p>
                                  )}
                                </div>

                                {returnedSubmission && (
                                  <button
                                    type="button"
                                    className="faculty-grade-header-button"
                                    disabled={
                                      resubmittingCombined ||
                                      modernPreviewLoading ||
                                      Boolean(modernPreviewError) ||
                                      modernPreview.semester.state !==
                                        "READY" ||
                                      modernPreview.terms.MIDTERM.state !==
                                        "READY" ||
                                      modernPreview.terms.FINAL_TERM.state !==
                                        "READY"
                                    }
                                    onClick={() =>
                                      void resubmitReturnedSemester()
                                    }
                                  >
                                    <Send size={15} />
                                    {resubmittingCombined
                                      ? "Validating..."
                                      : "Resubmit Semester Grade"}
                                  </button>
                                )}
                              </div>
                            )}

                            {resubmissionError && (
                              <p role="alert">{resubmissionError}</p>
                            )}

                            {resubmissionMessage && (
                              <p role="status">{resubmissionMessage}</p>
                            )}
                            {selectedOfferingId !== null &&
                              previewStudentId !== null &&
                              selectedClass?.offering_status === "Open" &&
                              modernStudentByEnrollmentSubject.get(
                                previewStudentId,
                              )?.is_current_enrolled &&
                              students.some(
                                (student) =>
                                  student.enrollment_subject_id ===
                                    previewStudentId && student.grade === null,
                              ) && (
                                <SpecialOutcomeSubmission
                                  key={`${selectedOfferingId}:${previewStudentId}`}
                                  offeringId={selectedOfferingId}
                                  student={
                                    students.find(
                                      (student) =>
                                        student.enrollment_subject_id ===
                                        previewStudentId,
                                    )!
                                  }
                                  onSubmitted={() => {
                                    if (
                                      activeOfferingIdRef.current !==
                                        selectedOfferingId ||
                                      activePreviewStudentIdRef.current !==
                                        previewStudentId
                                    ) {
                                      return;
                                    }

                                    setGradebookRefreshKey(
                                      (value) => value + 1,
                                    );
                                    setModernPreviewRefreshKey(
                                      (value) => value + 1,
                                    );
                                  }}
                                />
                              )}
                            <div className="faculty-gradebook-table-meta">
                              <div>
                                <strong>Combined Semester Submission</strong>
                                <p>
                                  New submissions include both grading terms and
                                  are checked against saved scores and
                                  attendance.
                                </p>
                              </div>

                              {!students.some((student) => {
                                const rosterStudent =
                                  modernStudentByEnrollmentSubject.get(
                                    student.enrollment_subject_id,
                                  );

                                return (
                                  student.enrollment_subject_id ===
                                    previewStudentId &&
                                  student.grade === null &&
                                  rosterStudent?.is_current_enrolled === true &&
                                  rosterStudent.student_number
                                    .trim()
                                    .toUpperCase() ===
                                    student.student_number.trim().toUpperCase()
                                );
                              }) ? (
                                <small>
                                  New submission is unavailable. The student
                                  must have a matching active roster record and
                                  no existing grade.
                                </small>
                              ) : (
                                <button
                                  type="button"
                                  className="faculty-grade-header-button"
                                  disabled={
                                    semesterSubmitting ||
                                    resubmittingCombined ||
                                    modernPreviewLoading ||
                                    Boolean(modernPreviewError) ||
                                    modernPreview.semester.state !== "READY" ||
                                    modernPreview.terms.MIDTERM.state !==
                                      "READY" ||
                                    modernPreview.terms.FINAL_TERM.state !==
                                      "READY" ||
                                    selectedClass?.offering_status !== "Open" ||
                                    !modernStudentByEnrollmentSubject.get(
                                      previewStudentId,
                                    )?.is_current_enrolled
                                  }
                                  onClick={() => void submitCombinedSemester()}
                                >
                                  <Send size={15} />
                                  {semesterSubmitting
                                    ? "Validating / Submitting..."
                                    : "Submit Semester Grade"}
                                </button>
                              )}
                            </div>

                            {semesterSubmissionError && (
                              <p role="alert">{semesterSubmissionError}</p>
                            )}

                            {semesterSubmissionMessage && (
                              <p role="status">{semesterSubmissionMessage}</p>
                            )}
                            <p>
                              {modernPreview.semester.state === "READY"
                                ? "All required categories are complete. This is a calculated preview, not an official submitted grade."
                                : "Complete all required Midterm and Final Term assessments and attendance before submission."}
                            </p>
                          </div>
                        )}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

        <dialog
          ref={attendanceDialogRef}
          className="faculty-attendance-modal"
          aria-modal="true"
          aria-labelledby="faculty-attendance-modal-title"
          onClose={() => setAttendanceModalOpen(false)}
        >
          <div className="faculty-attendance-modal__layout">
            <header className="faculty-attendance-modal__topbar">
              <div>
                <span>Faculty · Class Attendance</span>
                <h2 id="faculty-attendance-modal-title">Attendance Register</h2>
                <p>
                  {selectedClass
                    ? `${selectedClass.subject.subject_code} · ${selectedClass.section.section_name}`
                    : "Select a class to manage attendance."}
                </p>
              </div>
              <button
                type="button"
                className="faculty-attendance-modal__close"
                autoFocus
                aria-label="Close attendance modal"
                onClick={() => setAttendanceModalOpen(false)}
              >
                <X size={19} />
              </button>
            </header>
            <div className="faculty-attendance-modal__content">
              {attendanceModalOpen &&
              attendanceRosterReady &&
              selectedOfferingId ? (
                <AttendanceRegister
                  key={selectedOfferingId}
                  offeringId={selectedOfferingId}
                  refreshKey={gradebookRefreshKey}
                  onAttendanceSaved={() => {
                    if (activeOfferingIdRef.current === selectedOfferingId) {
                      setModernPreviewRefreshKey((current) => current + 1);
                      setRowPreviewBatchRefreshKey((current) => current + 1);
                    }
                  }}
                  readOnlyStudentIds={students
                    .filter((student) =>
                      ["Approved", "Submitted"].includes(
                        student.grade?.grade_status ?? "",
                      ),
                    )
                    .map((student) => student.enrollment_subject_id)}
                  returnedStudentIds={students
                    .filter(
                      (student) => student.grade?.grade_status === "Returned",
                    )
                    .map((student) => student.enrollment_subject_id)}
                  returnedPermission={
                    returnedSubmission && previewStudentId
                      ? {
                          enrollmentSubjectId: previewStudentId,
                          scope: returnedSubmission.returned_edit_scope as
                            | AssessmentTerm
                            | "BOTH",
                        }
                      : null
                  }
                />
              ) : (
                <div className="faculty-grade-empty" role="status">
                  <strong>Attendance is unavailable for this class</strong>
                  <p>
                    Wait for the class roster and official grade statuses to
                    finish loading. Editing stays locked until both student
                    lists match.
                  </p>
                </div>
              )}
            </div>
            <footer className="faculty-attendance-modal__footer">
              <span>
                Save each student’s attendance before closing this window.
              </span>
              <button
                type="button"
                className="faculty-grade-header-button"
                onClick={() => setAttendanceModalOpen(false)}
              >
                Close
              </button>
            </footer>
          </div>
        </dialog>
        {!classesLoading && classes.length > 0 && (
          <section className="faculty-grade-workflow-section">
            <header>
              <div>
                <span>Assessment-Based Grading</span>
                <h2>
                  {userRole === "Program Head"
                    ? "Program Head Teaching Grade Workflow"
                    : "Faculty Grade Workflow"}
                </h2>
                <p>
                  Enter assessment scores, record held-meeting attendance,
                  review the Midterm and Final Term calculation, and submit the
                  combined semester grade through the authorized backend
                  workflow.
                </p>
              </div>
            </header>
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
                  <span>
                    {userRole === "Program Head"
                      ? "Program Head · Assessment Columns"
                      : "Faculty · Assessment Columns"}
                  </span>
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
                                  disabled={assessmentManagerBusy}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="faculty-grade-header-button"
                                  onClick={() =>
                                    beginAssessmentRemoval(category, assessment)
                                  }
                                  disabled={assessmentManagerBusy}
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
      </main>
    </DashboardLayout>
  );
}
