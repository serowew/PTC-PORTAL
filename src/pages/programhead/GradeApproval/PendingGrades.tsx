import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  BookOpenCheck,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  ClipboardCheck,
  Filter,
  GraduationCap,
  RotateCcw,
  Search,
  ShieldCheck,
  Undo2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { api } from "../../../services/api";
import "../../../styles/PendingGrades.css";

const COMBINED_QUEUE_API = api.url(
  "/api/program-head/gradebook/semester-submissions",
);

interface ProgramHeadInfo {
  program_head_id: number;
  faculty_id: number | null;
  user_id: number;
  employee_number: string;
  username: string;
  program_head_name: string;
  department: {
    department_id: number;
    department_code: string;
    department_name: string;
  };
}

interface SubmittedGrade {
  submission_id: string;
  record_version: number;
  sheet_status: string;
  officially_published: boolean;
  grade_id: number;
  enrollment_subject_id: number;
  grade_status: "Submitted";
  grades: {
    midterm_grade: number | null;
    final_grade: number | null;
    overall_percentage: number | null;
    final_rating: number | null;
    grading_policy: string;
    grading_outcome: "NUMERIC" | "INCOMPLETE" | "UNOFFICIAL_DROP" | string;
    outcome_reason: string | null;
    remarks: "Passed" | "Failed" | "Incomplete" | "Unofficial Drop" | null;
  };
  student: {
    student_id: number;
    student_number: string;
    first_name: string;
    middle_name: string | null;
    last_name: string;
    full_name: string;
    enrollment_id: number;
    enrollment_status: string;
    subject_status: string;
  };
  faculty: {
    faculty_id: number;
    employee_number: string;
    first_name: string;
    middle_name: string | null;
    last_name: string;
    faculty_name: string;
    email: string | null;
  };
  class: {
    offering_id: number;
    offering_status: string;
    subject: {
      subject_id: number;
      subject_code: string;
      subject_name: string;
      units: number;
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
  };
  submitted_at: string | null;
  review: {
    reviewed_by: number | null;
    reviewed_at: string | null;
    review_remarks: string | null;
  };
  created_at: string | null;
  updated_at: string | null;
}

interface CombinedQueueRow {
  submission_id: string;
  grade_id: number;
  record_version: number;
  submission_status: string;
  grade_status: string;
  grading_outcome_snapshot: string;
  midterm_percentage_snapshot: string | number | null;
  final_term_percentage_snapshot: string | number | null;
  overall_percentage_snapshot: string | number | null;
  final_rating_snapshot: string | number;
  special_outcome_reason_snapshot: string | null;
  remarks: SubmittedGrade["grades"]["remarks"];
  grading_policy: string;
  enrollment_subject_id: number;
  subject_status: string;
  enrollment_id: number;
  enrollment_status: string;
  student_id: number;
  student_number: string;
  student_first_name: string;
  student_middle_name: string | null;
  student_last_name: string;
  student_name: string;
  offering_id: number;
  offering_status: string;
  schedule_days: string | null;
  schedule_time: string | null;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  units: number;
  section_id: number;
  section_name: string;
  year_level: number;
  course_id: number;
  course_code: string;
  course_name: string;
  academic_year_id: number;
  academic_year: string;
  academic_year_is_current: number | boolean;
  semester_id: number;
  semester_name: string;
  faculty_id: number;
  faculty_employee_number: string;
  faculty_first_name: string;
  faculty_middle_name: string | null;
  faculty_last_name: string;
  faculty_name: string;
  faculty_email: string | null;
  submitted_at: string | null;
  reviewed_by_user_id: number | null;
  reviewed_at: string | null;
  review_remarks: string | null;
  sheet_status: string;
  officially_published: boolean;
}
interface CombinedEvidenceAssessment {
  assessment_id: number;
  header_name: string;
  maximum_score: string;
  score_status: string;
  earned_score: string | null;
  not_applicable_reason?: string | null;
}

interface CombinedEvidenceSession {
  meeting_id: number;
  meeting_date: string;
  attendance_status: string;
  status_reason?: string | null;
}

interface CombinedEvidenceCategory {
  category_code: string;
  category_name: string;
  category_weight_percent: string;
  state: string;

  category_percentage?: {
    display: string;
  } | null;

  contribution_percent_points?: {
    display: string;
  } | null;

  assessments?: CombinedEvidenceAssessment[];
  sessions?: CombinedEvidenceSession[];
}

interface CombinedEvidenceTerm {
  state: string;

  term_percentage?: {
    display: string;
  } | null;

  categories?: CombinedEvidenceCategory[];
}

interface CombinedEvidenceResponse {
  success: boolean;
  read_only: boolean;

  submission: {
    submission_id: string;
    offering_id: number;
    enrollment_subject_id: number;
    record_version: number;
    grading_outcome: string;
  };

  calculation_snapshot: {
    classification?: string;

    calculated_terms?: {
      MIDTERM?: CombinedEvidenceTerm;
      FINAL_TERM?: CombinedEvidenceTerm;
    };

    calculated_semester?: {
      state: string;
      semester_percentage?: {
        display: string;
      } | null;
    };

    special_outcome?: {
      outcome_type: string;
      outcome_reason: string;
      missing_requirements: string | null;
      evidence_summary: string;
    } | null;
  };

  message?: string;
}
interface CombinedQueueResponse {
  success: boolean;
  program_head?: ProgramHeadInfo;
  submissions?: CombinedQueueRow[];
  status_filter?: string;
  limit?: number;
  count?: number;
  code?: string;
  message?: string;
  error?: string;
}

interface CombinedPublicationResponse {
  success: boolean;
  dry_run?: boolean;
  persisted?: boolean;
  publication_id?: string | null;
  submission_id?: string;
  grade_id?: number;
  publication_source?: string;
  grade_status?: string;
  official_sheet_finalized?: boolean;
  code?: string;
  message?: string;
}
interface CombinedReviewResponse {
  success: boolean;
  dry_run?: boolean;
  persisted?: boolean;
  submission_id?: string;
  submission_status?: string;
  record_version?: number;
  code?: string;
  message?: string;
}

function toNumberOrNull(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

function mapCombinedQueueGrade(row: CombinedQueueRow): SubmittedGrade {
  return {
    submission_id: String(row.submission_id),
    record_version: Number(row.record_version),
    sheet_status: row.sheet_status,
    officially_published: row.officially_published === true,
    grade_id: Number(row.grade_id),
    enrollment_subject_id: Number(row.enrollment_subject_id),
    grade_status: "Submitted",
    grades: {
      midterm_grade: toNumberOrNull(row.midterm_percentage_snapshot),
      final_grade: toNumberOrNull(row.final_term_percentage_snapshot),
      overall_percentage: toNumberOrNull(row.overall_percentage_snapshot),
      final_rating: Number(row.final_rating_snapshot),
      grading_policy: row.grading_policy,
      grading_outcome: row.grading_outcome_snapshot,
      outcome_reason: row.special_outcome_reason_snapshot,
      remarks: row.remarks,
    },
    student: {
      student_id: Number(row.student_id),
      student_number: row.student_number,
      first_name: row.student_first_name,
      middle_name: row.student_middle_name,
      last_name: row.student_last_name,
      full_name: row.student_name,
      enrollment_id: Number(row.enrollment_id),
      enrollment_status: row.enrollment_status,
      subject_status: row.subject_status,
    },
    faculty: {
      faculty_id: Number(row.faculty_id),
      employee_number: row.faculty_employee_number,
      first_name: row.faculty_first_name,
      middle_name: row.faculty_middle_name,
      last_name: row.faculty_last_name,
      faculty_name: row.faculty_name,
      email: row.faculty_email,
    },
    class: {
      offering_id: Number(row.offering_id),
      offering_status: row.offering_status,
      subject: {
        subject_id: Number(row.subject_id),
        subject_code: row.subject_code,
        subject_name: row.subject_name,
        units: Number(row.units),
      },
      section: {
        section_id: Number(row.section_id),
        section_name: row.section_name,
        year_level: Number(row.year_level),
        course: {
          course_id: Number(row.course_id),
          course_code: row.course_code,
          course_name: row.course_name,
        },
      },
      academic_period: {
        academic_year_id: Number(row.academic_year_id),
        academic_year: row.academic_year,
        is_current_academic_year: Boolean(Number(row.academic_year_is_current)),
        semester_id: Number(row.semester_id),
        semester_name: row.semester_name,
      },
      schedule: { days: row.schedule_days, time: row.schedule_time },
    },
    submitted_at: row.submitted_at,
    review: {
      reviewed_by: row.reviewed_by_user_id,
      reviewed_at: row.reviewed_at,
      review_remarks: row.review_remarks,
    },
    created_at: null,
    updated_at: null,
  };
}

interface ActionNotice {
  type: "success" | "error";
  message: string;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(
      `Server returned a non-JSON response (${response.status}): ${text.slice(0, 200)}`,
    );
  }
  return response.json() as Promise<T>;
}

function formatGrade(value: number | null) {
  return value === null || value === undefined ? "—" : Number(value).toFixed(2);
}

function formatDateTime(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDays(value: string | null) {
  if (!value) return "Not scheduled";
  return value
    .split(",")
    .map((item) => {
      const day = item.trim();
      return day
        ? day.charAt(0).toUpperCase() + day.slice(1).toLowerCase()
        : "";
    })
    .filter(Boolean)
    .join(", ");
}

function getRemarkClass(
  remark: "Passed" | "Failed" | "Incomplete" | "Unofficial Drop" | null,
) {
  return remark ? remark.toLowerCase().replace(/\s+/g, "-") : "none";
}

function formatPercentage(value: number | null) {
  return value === null || value === undefined
    ? "—"
    : `${Number(value).toFixed(3)}%`;
}

function getOutcomeLabel(value: string | null | undefined) {
  if (value === "INCOMPLETE") return "Incomplete";
  if (value === "UNOFFICIAL_DROP") return "Unofficial Drop";
  return "Numeric Grade";
}

function getOutcomeClass(value: string | null | undefined) {
  if (value === "INCOMPLETE") return "incomplete";
  if (value === "UNOFFICIAL_DROP") return "unofficial-drop";
  return "numeric";
}

// Official Sheet Finalization

interface OfficialSheetOption {
  offering_id: number;
  offering_status: string;
  subject_code: string;
  subject_name: string;
  section_name: string;
  academic_year: string;
  semester_name: string;
  sheet_id: string | null;
  sheet_status: "IN_PROGRESS" | "FINALIZED" | "NOT_RECORDED";
  sheet_record_version: number | null;
  original_official_submitted_on: string | null;
  official_submission_reference: string | null;
  original_date_verified: boolean;
  official_date_verified_at: string | null;
  inc_completion_deadline_on: string | null;
  finalized_at: string | null;
}

interface OfficialSheetListResponse {
  success: boolean;
  read_only: boolean;
  offerings: OfficialSheetOption[];
  message?: string;
}

interface OfficialSheetReadinessResponse {
  success: boolean;
  read_only: boolean;
  offering_id: number;
  sheet_id: string;
  sheet_status: string;
  sheet_record_version: number;
  roster_count: number;
  verified_historical_count: number;
  blockers: string[];
  problematic_rows: {
    enrollment_subject_id: number;
    student_number: string;
    errors: string[];
  }[];
  can_finalize: boolean;
  grades_modified: false;
  message?: string;
}

interface OfficialSheetVerifyResponse {
  success: boolean;
  action: "VERIFY_ORIGINAL_DATE";
  dry_run: boolean;
  persisted: boolean;
  sheet_id: string;
  record_version: number;
  original_official_submitted_on: string;
  proposed_inc_completion_deadline_on: string;
  inc_completion_deadline_on: string | null;
  grades_modified: false;
  finalized: false;
  message?: string;
  code?: string;
}
interface OfficialSheetFinalizeResponse {
  success: boolean;
  action: "FINALIZE";
  dry_run: boolean;
  persisted: boolean;
  sheet_id: string;
  offering_id: number;
  roster_count: number;
  sheet_status: "IN_PROGRESS" | "FINALIZED";
  record_version: number;
  original_date_preserved: boolean;
  grades_modified: false;
  snapshot_persisted: boolean;
  message?: string;
}

function OfficialSheetFinalization({
  refreshKey,
  onFinalized,
}: {
  refreshKey: number;
  onFinalized: () => void;
}) {
  const navigate = useNavigate();

  const [offerings, setOfferings] = useState<OfficialSheetOption[]>([]);

  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");

  const [readiness, setReadiness] =
    useState<OfficialSheetReadinessResponse | null>(null);

  const [readinessLoading, setReadinessLoading] = useState(false);

  const [readinessError, setReadinessError] = useState("");
  const [remarks, setRemarks] = useState("");
  const [finalizing, setFinalizing] = useState(false);
  const [verifyingOriginalDate, setVerifyingOriginalDate] = useState(false);

  const [feedback, setFeedback] = useState<ActionNotice | null>(null);

  const [localReload, setLocalReload] = useState(0);

  const selected =
    offerings.find((item) => item.offering_id === selectedId) ?? offerings[0];

  const offeringId = selected?.offering_id ?? null;

  useEffect(() => {
    const controller = new AbortController();

    setListLoading(true);
    setListError("");

    const load = async () => {
      try {
        const response = await authService.authFetch(
          api.url("/api/program-head/gradebook/official-sheets"),
          { signal: controller.signal },
        );

        const data =
          await readJsonResponse<OfficialSheetListResponse>(response);

        if (controller.signal.aborted) return;

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (
          !response.ok ||
          !data.success ||
          !data.read_only ||
          !Array.isArray(data.offerings)
        ) {
          throw new Error(data.message || "Could not load official sheets.");
        }

        setOfferings(data.offerings);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setOfferings([]);

          setListError(
            caught instanceof Error
              ? caught.message
              : "Could not load official sheets.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setListLoading(false);
        }
      }
    };

    void load();

    return () => controller.abort();
  }, [navigate, refreshKey, localReload]);

  useEffect(() => {
    const controller = new AbortController();

    setReadiness(null);
    setReadinessError("");

    if (!offeringId) {
      setReadinessLoading(false);
      return () => controller.abort();
    }

    setReadinessLoading(true);

    const load = async () => {
      try {
        const response = await authService.authFetch(
          api.url(
            `/api/program-head/gradebook/official-sheets/${offeringId}/finalization-readiness`,
          ),
          { signal: controller.signal },
        );

        const data =
          await readJsonResponse<OfficialSheetReadinessResponse>(response);

        if (controller.signal.aborted) return;

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (
          !response.ok ||
          !data.success ||
          !data.read_only ||
          data.offering_id !== offeringId ||
          !Array.isArray(data.blockers) ||
          !Array.isArray(data.problematic_rows) ||
          !Number.isSafeInteger(data.sheet_record_version)
        ) {
          throw new Error(
            data.message || "Could not load finalization readiness.",
          );
        }

        setReadiness(data);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setReadinessError(
            caught instanceof Error
              ? caught.message
              : "Could not check readiness.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setReadinessLoading(false);
        }
      }
    };

    void load();

    return () => controller.abort();
  }, [offeringId, navigate, refreshKey, localReload]);

  const canVerifyOriginalDate =
    !verifyingOriginalDate &&
    !finalizing &&
    !listLoading &&
    selected?.sheet_status === "IN_PROGRESS" &&
    selected.original_date_verified === false &&
    selected.sheet_record_version === 1 &&
    typeof selected.sheet_id === "string" &&
    /^\d+$/.test(selected.sheet_id) &&
    /^\d{4}-\d{2}-\d{2}$/.test(selected.original_official_submitted_on ?? "") &&
    Boolean(selected.official_submission_reference?.trim()) &&
    offeringId !== null;

  const verifyOriginalDate = async () => {
    if (!canVerifyOriginalDate || !selected || offeringId === null) {
      return;
    }

    const sheetId = selected.sheet_id!;
    const originalDate = selected.original_official_submitted_on!;
    const reference = selected.official_submission_reference!.trim();
    const version = selected.sheet_record_version!;

    setVerifyingOriginalDate(true);
    setFeedback(null);

    const request = async (dryRun: boolean) => {
      const response = await authService.authFetch(
        api.url(
          `/api/program-head/gradebook/official-sheets/${offeringId}/verify-submission`,
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            expected_sheet_version: version,
            confirm_original_date: true,
            dry_run: dryRun,
          }),
        },
      );

      const data =
        await readJsonResponse<OfficialSheetVerifyResponse>(response);

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        throw new Error("Your session has expired.");
      }

      if (
        !response.ok ||
        !data.success ||
        data.action !== "VERIFY_ORIGINAL_DATE" ||
        data.dry_run !== dryRun ||
        data.persisted !== !dryRun ||
        data.sheet_id !== sheetId ||
        data.record_version !== (dryRun ? version : version + 1) ||
        data.original_official_submitted_on !== originalDate ||
        !/^\d{4}-\d{2}-\d{2}$/.test(data.proposed_inc_completion_deadline_on) ||
        data.inc_completion_deadline_on !==
          (dryRun ? null : data.proposed_inc_completion_deadline_on) ||
        data.grades_modified !== false ||
        data.finalized !== false
      ) {
        throw new Error(
          [data.code, data.message].filter(Boolean).join(": ") ||
            "The backend did not confirm original-date verification.",
        );
      }

      return data;
    };

    try {
      const preview = await request(true);

      const confirmed = window.confirm(
        `Verify the Registrar-recorded original submission date?\n\n` +
          `${selected.subject_code} · ${selected.section_name}\n` +
          `Official date: ${originalDate}\n` +
          `Reference: ${reference}\n` +
          `INC completion deadline: ${preview.proposed_inc_completion_deadline_on}\n\n` +
          "Confirm only after checking the original official submission record. " +
          "Verification will be audited and cannot be repeated or edited normally.",
      );

      if (!confirmed) return;

      await request(false);

      setFeedback({
        type: "success",
        message:
          `Sheet #${sheetId} original date verified. ` +
          `INC completion deadline: ${preview.proposed_inc_completion_deadline_on}. ` +
          "Grades and official-sheet finalization are unchanged.",
      });

      setLocalReload((current) => current + 1);
    } catch (caught) {
      setFeedback({
        type: "error",
        message:
          caught instanceof Error
            ? caught.message
            : "Could not verify the original official-sheet date.",
      });

      setLocalReload((current) => current + 1);
    } finally {
      setVerifyingOriginalDate(false);
    }
  };

  const canFinalize =
    !verifyingOriginalDate &&
    !finalizing &&
    !listLoading &&
    !readinessLoading &&
    selected?.sheet_status === "IN_PROGRESS" &&
    selected.original_date_verified === true &&
    selected.inc_completion_deadline_on !== null &&
    readiness?.offering_id === offeringId &&
    readiness.sheet_id === selected.sheet_id &&
    readiness.sheet_record_version === selected.sheet_record_version &&
    readiness.can_finalize === true &&
    readiness.blockers.length === 0 &&
    readiness.roster_count > 0 &&
    remarks.trim().length >= 20 &&
    remarks.trim().length <= 1000;

  const finalize = async () => {
    if (!canFinalize || !selected || !readiness || offeringId === null) {
      return;
    }

    const version = readiness.sheet_record_version;
    const sheetId = readiness.sheet_id;
    const rosterCount = readiness.roster_count;

    setFinalizing(true);
    setFeedback(null);

    const request = async (dryRun: boolean) => {
      const response = await authService.authFetch(
        api.url(
          `/api/program-head/gradebook/official-sheets/${offeringId}/finalize`,
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            expected_sheet_version: version,
            finalization_remarks: remarks.trim(),
            confirm_finalization: true,
            dry_run: dryRun,
          }),
        },
      );

      const data =
        await readJsonResponse<OfficialSheetFinalizeResponse>(response);

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        throw new Error("Session expired.");
      }

      if (
        !response.ok ||
        !data.success ||
        data.action !== "FINALIZE" ||
        data.dry_run !== dryRun ||
        data.persisted !== !dryRun ||
        data.sheet_id !== sheetId ||
        data.offering_id !== offeringId ||
        data.roster_count !== rosterCount ||
        data.original_date_preserved !== true ||
        data.grades_modified !== false ||
        data.snapshot_persisted !== !dryRun ||
        data.sheet_status !== (dryRun ? "IN_PROGRESS" : "FINALIZED") ||
        data.record_version !== (dryRun ? version : version + 1)
      ) {
        throw new Error(
          data.message || "The backend did not confirm finalization.",
        );
      }

      return data;
    };

    try {
      await request(true);

      const confirmed = window.confirm(
        `Finalize the official sheet for ${selected.subject_code} · ${selected.section_name}?\n\n` +
          `${rosterCount} roster entries will be snapshotted permanently.\n` +
          `Sheet #${sheetId}, version ${version}.\n\n` +
          "This cannot be undone through normal grade editing. Subsequent changes require audited amendments.",
      );

      if (!confirmed) return;

      await request(false);

      setFeedback({
        type: "success",
        message:
          `Sheet #${sheetId} finalized. ` +
          `${rosterCount} roster entries were preserved; ` +
          "grades and the original sheet date were not changed.",
      });

      setRemarks("");
      onFinalized();
    } catch (caught) {
      setFeedback({
        type: "error",
        message:
          caught instanceof Error ? caught.message : "Finalization failed.",
      });

      setLocalReload((value) => value + 1);
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <section className="program-head-grade-queue">
      <header className="program-head-grade-queue-header">
        <div>
          <span>Official Semester Records</span>

          <h2>Official Sheet Readiness & Finalization</h2>

          <p>
            Review the entire roster and verified official submission date
            before permanently finalizing a sheet.
          </p>
        </div>

        <strong>
          {listLoading ? "Loading…" : `${offerings.length} gradebooks`}
        </strong>
      </header>

      <div
        style={{
          padding: 20,
          display: "grid",
          gap: 14,
        }}
      >
        {listError && (
          <p role="alert" className="program-head-grade-reason">
            {listError}
          </p>
        )}

        {!listLoading && !listError && offerings.length === 0 && (
          <p>No initialized gradebooks in your department yet.</p>
        )}

        {offerings.length > 0 && (
          <div
            className="program-head-grade-filter-grid"
            style={{
              gridTemplateColumns: "minmax(0, 1fr)",
            }}
          >
            <label>
              <span>Subject offering</span>

              <select
                value={offeringId ?? ""}
                disabled={finalizing}
                onChange={(event) => {
                  setSelectedId(Number(event.target.value));
                  setRemarks("");
                  setFeedback(null);
                }}
              >
                {offerings.map((item) => (
                  <option key={item.offering_id} value={item.offering_id}>
                    {item.subject_code} · {item.section_name} ·{" "}
                    {item.academic_year} {item.semester_name} · #
                    {item.offering_id}
                    {` · ${item.sheet_status.replaceAll("_", " ")}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {selected && (
          <>
            <p>
              <strong>{selected.subject_name}</strong>
              {" · "}
              {selected.offering_status}
              {" · "}Sheet: {selected.sheet_status.replaceAll("_", " ")}
            </p>

            <p>
              Original submitted date:{" "}
              {selected.original_official_submitted_on ?? "Not recorded"}
              {" · "}Reference:{" "}
              {selected.official_submission_reference ?? "Not recorded"}
              {" · "}Program Head verification:{" "}
              {selected.original_date_verified ? "Verified" : "Required"}
            </p>
            {selected.original_date_verified ? (
              <p role="status">
                Verified:{" "}
                {selected.official_date_verified_at ?? "Date not available"}
                {" · "}
                INC completion deadline:{" "}
                {selected.inc_completion_deadline_on ??
                  "Unavailable — check the sheet record"}
              </p>
            ) : selected.original_official_submitted_on ? (
              <p role="status">
                Registrar submission recorded; Program Head verification is
                pending. The INC completion deadline is not established yet.
              </p>
            ) : (
              <p>
                Original sheet date not yet recorded by the Registrar. INC
                deadline not established.
              </p>
            )}
            {!selected.sheet_id && (
              <p>
                The Registrar must first record the real original official-sheet
                submission date and its source reference. The Program Head
                cannot create or edit this date here.
              </p>
            )}

            {selected.sheet_status === "IN_PROGRESS" &&
              selected.sheet_id &&
              !selected.original_date_verified && (
                <div className="program-head-grade-queue-header">
                  <div>
                    <strong>Verify Original Official Sheet Date</strong>

                    <p>
                      Check the Registrar-recorded date and source reference
                      against the actual submission record before verifying.
                    </p>

                    {selected.sheet_record_version !== 1 && (
                      <p role="alert">
                        This sheet is not at the original verification version.
                        Refresh its records before proceeding.
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    className="program-head-approve-button"
                    disabled={!canVerifyOriginalDate}
                    onClick={() => void verifyOriginalDate()}
                  >
                    <ShieldCheck size={15} />
                    {verifyingOriginalDate
                      ? "Verifying…"
                      : "Verify Original Date"}
                  </button>
                </div>
              )}

            {readinessLoading && (
              <p>Checking roster and publication evidence...</p>
            )}

            {readinessError && (
              <p role="alert" className="program-head-grade-reason">
                {readinessError}
              </p>
            )}

            {!readinessLoading &&
              readiness &&
              readiness.offering_id === selected.offering_id && (
                <>
                  <p>
                    <strong>
                      {readiness.can_finalize
                        ? "Ready for finalization"
                        : "Finalization blocked"}
                    </strong>
                    {" · "}Roster: {readiness.roster_count}
                    {" · "}Verified historical records:{" "}
                    {readiness.verified_historical_count}
                  </p>

                  {readiness.blockers.length > 0 && (
                    <div role="status">
                      <strong>Blocking conditions</strong>

                      <ul>
                        {readiness.blockers.map((blocker) => (
                          <li key={blocker}>{blocker.replaceAll("_", " ")}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {readiness.problematic_rows.length > 0 && (
                    <div>
                      <strong>Roster issues (first 30)</strong>

                      <div className="program-head-grade-table-wrapper">
                        <table
                          className="program-head-grade-table"
                          style={{ minWidth: 640 }}
                        >
                          <thead>
                            <tr>
                              <th>Student</th>
                              <th>Enrollment Subject</th>
                              <th>Issue</th>
                            </tr>
                          </thead>

                          <tbody>
                            {readiness.problematic_rows.map((row) => (
                              <tr key={row.enrollment_subject_id}>
                                <td>{row.student_number}</td>

                                <td>#{row.enrollment_subject_id}</td>

                                <td>
                                  {row.errors
                                    .map((code) => code.replaceAll("_", " "))
                                    .join(", ")}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}

            {readiness?.offering_id === selected.offering_id &&
              readiness.can_finalize && (
                <>
                  <div
                    className="program-head-return-field"
                    style={{ padding: 0 }}
                  >
                    <label htmlFor="official-finalization-remarks">
                      Finalization remarks (20–1000 characters)
                    </label>

                    <textarea
                      id="official-finalization-remarks"
                      maxLength={1000}
                      rows={3}
                      disabled={finalizing || verifyingOriginalDate}
                      value={remarks}
                      onChange={(event) => setRemarks(event.target.value)}
                      placeholder="Document why the official semester roster is complete and verified"
                    />
                  </div>

                  <button
                    type="button"
                    className="program-head-approve-button"
                    disabled={!canFinalize}
                    onClick={() => void finalize()}
                  >
                    <ShieldCheck size={15} />
                    {finalizing ? "Validating…" : "Finalize Official Sheet"}
                  </button>
                </>
              )}
          </>
        )}

        {feedback && (
          <p role={feedback.type === "error" ? "alert" : "status"}>
            {feedback.message}
          </p>
        )}
      </div>
    </section>
  );
}

export default function PendingGrades() {
  const navigate = useNavigate();
  const session = authService.getSession();
  const token = authService.getToken();
  const authenticated = Boolean(session && token);
  const userRole = session?.role;

  const [programHead, setProgramHead] = useState<ProgramHeadInfo | null>(null);
  const [grades, setGrades] = useState<SubmittedGrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [approvedGrades, setApprovedGrades] = useState<SubmittedGrade[]>([]);
  const [approvedLoading, setApprovedLoading] = useState(true);
  const [approvedError, setApprovedError] = useState("");

  const [search, setSearch] = useState("");
  const [academicYearFilter, setAcademicYearFilter] = useState("All");
  const [semesterFilter, setSemesterFilter] = useState("All");
  const [courseFilter, setCourseFilter] = useState("All");
  const [facultyFilter, setFacultyFilter] = useState("All");

  const [actionGradeId, setActionGradeId] = useState<number | null>(null);
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);
  const [returnGrade, setReturnGrade] = useState<SubmittedGrade | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [returnScope, setReturnScope] = useState<
    "MIDTERM" | "FINAL_TERM" | "BOTH"
  >("BOTH");
  const [returnError, setReturnError] = useState("");
  const [evidenceGrade, setEvidenceGrade] = useState<SubmittedGrade | null>(
    null,
  );

  const [evidence, setEvidence] = useState<CombinedEvidenceResponse | null>(
    null,
  );

  const [evidenceLoading, setEvidenceLoading] = useState(false);

  const [evidenceError, setEvidenceError] = useState("");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }
    if (userRole !== "Program Head") {
      navigate(authService.getDashboardRoute(session!.role), { replace: true });
    }
  }, [authenticated, userRole, session, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Program Head") return;
    const controller = new AbortController();

    const loadSubmittedGrades = async () => {
      try {
        setLoading(true);
        setError("");

        const response = await authService.authFetch(
          `${COMBINED_QUEUE_API}?status=SUBMITTED&limit=100`,
          {
            method: "GET",
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
        );
        const data = await readJsonResponse<CombinedQueueResponse>(response);

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }
        if (response.status === 403) {
          throw new Error(data.message || "Program Head access is required.");
        }
        if (!response.ok || !data.success) {
          throw new Error(
            data.message || data.error || "Unable to load submitted grades.",
          );
        }

        const loadedGrades = Array.isArray(data.submissions)
          ? data.submissions
              .filter(
                (row) =>
                  row.submission_status === "SUBMITTED" &&
                  row.grade_status === "Submitted",
              )
              .map(mapCombinedQueueGrade)
          : [];

        setProgramHead(data.program_head || null);
        setGrades(loadedGrades);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        )
          return;
        console.error(
          "LOAD PROGRAM HEAD SUBMITTED GRADES ERROR:",
          requestError,
        );
        setProgramHead(null);
        setGrades([]);
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load submitted grades.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadSubmittedGrades();
    return () => controller.abort();
  }, [authenticated, userRole, navigate, refreshKey]);

  // Approved submissions remain separate from pending review counts.
  useEffect(() => {
    if (!authenticated || userRole !== "Program Head") return;

    const controller = new AbortController();

    const loadApproved = async () => {
      setApprovedLoading(true);
      setApprovedError("");

      try {
        const response = await authService.authFetch(
          `${COMBINED_QUEUE_API}?status=APPROVED&limit=100`,
          {
            method: "GET",
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
        );

        const data = await readJsonResponse<CombinedQueueResponse>(response);

        if (controller.signal.aborted) return;

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (!response.ok || !data.success || !Array.isArray(data.submissions)) {
          throw new Error(
            data.message || "Unable to load approved submissions.",
          );
        }

        setApprovedGrades(
          data.submissions
            .filter(
              (row) =>
                row.submission_status === "APPROVED" &&
                row.grading_outcome_snapshot === "NUMERIC" &&
                row.sheet_status === "IN_PROGRESS" &&
                row.officially_published === false,
            )
            .map(mapCombinedQueueGrade),
        );
      } catch (caught) {
        if (controller.signal.aborted) return;

        setApprovedGrades([]);
        setApprovedError(
          caught instanceof Error
            ? caught.message
            : "Unable to load approved submissions.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setApprovedLoading(false);
        }
      }
    };

    void loadApproved();

    return () => controller.abort();
  }, [authenticated, userRole, navigate, refreshKey]);

  const academicYears = useMemo(() => {
    const values = new Map<number, string>();
    grades.forEach((grade) =>
      values.set(
        grade.class.academic_period.academic_year_id,
        grade.class.academic_period.academic_year,
      ),
    );
    return Array.from(values.entries()).sort((a, b) => b[0] - a[0]);
  }, [grades]);

  const semesters = useMemo(() => {
    const values = new Map<number, string>();
    grades.forEach((grade) => {
      const id = Number(grade.class.academic_period.semester_id);
      if (id === 1 || id === 2)
        values.set(id, grade.class.academic_period.semester_name);
    });
    return Array.from(values.entries()).sort((a, b) => a[0] - b[0]);
  }, [grades]);

  const courses = useMemo(
    () =>
      Array.from(
        new Map(
          grades.map((grade) => [
            grade.class.section.course.course_id,
            grade.class.section.course.course_code,
          ]),
        ).entries(),
      ).sort((a, b) => a[1].localeCompare(b[1])),
    [grades],
  );

  const faculties = useMemo(
    () =>
      Array.from(
        new Map(
          grades.map((grade) => [
            grade.faculty.faculty_id,
            grade.faculty.faculty_name,
          ]),
        ).entries(),
      ).sort((a, b) => a[1].localeCompare(b[1])),
    [grades],
  );

  const filteredGrades = useMemo(() => {
    const q = search.trim().toLowerCase();
    return grades.filter((grade) => {
      const matchesSearch =
        !q ||
        grade.student.student_number.toLowerCase().includes(q) ||
        grade.student.full_name.toLowerCase().includes(q) ||
        grade.class.subject.subject_code.toLowerCase().includes(q) ||
        grade.class.subject.subject_name.toLowerCase().includes(q) ||
        grade.class.section.section_name.toLowerCase().includes(q) ||
        grade.faculty.faculty_name.toLowerCase().includes(q) ||
        getOutcomeLabel(grade.grades.grading_outcome)
          .toLowerCase()
          .includes(q) ||
        (grade.grades.outcome_reason || "").toLowerCase().includes(q);

      return (
        matchesSearch &&
        (academicYearFilter === "All" ||
          String(grade.class.academic_period.academic_year_id) ===
            academicYearFilter) &&
        (semesterFilter === "All" ||
          String(grade.class.academic_period.semester_id) === semesterFilter) &&
        (courseFilter === "All" ||
          String(grade.class.section.course.course_id) === courseFilter) &&
        (facultyFilter === "All" ||
          String(grade.faculty.faculty_id) === facultyFilter)
      );
    });
  }, [
    grades,
    search,
    academicYearFilter,
    semesterFilter,
    courseFilter,
    facultyFilter,
  ]);

  const summary = useMemo(() => {
    const classIds = new Set<number>();
    const facultyIds = new Set<number>();
    filteredGrades.forEach((grade) => {
      classIds.add(grade.class.offering_id);
      facultyIds.add(grade.faculty.faculty_id);
    });
    return {
      totalPending: filteredGrades.length,
      classes: classIds.size,
      faculties: facultyIds.size,
      passed: filteredGrades.filter((g) => g.grades.remarks === "Passed")
        .length,
      incomplete: filteredGrades.filter(
        (g) => g.grades.remarks === "Incomplete",
      ).length,
      failed: filteredGrades.filter((g) => g.grades.remarks === "Failed")
        .length,
      unofficialDrop: filteredGrades.filter(
        (g) => g.grades.remarks === "Unofficial Drop",
      ).length,
    };
  }, [filteredGrades]);

  const hasActiveFilters =
    search.trim() !== "" ||
    academicYearFilter !== "All" ||
    semesterFilter !== "All" ||
    courseFilter !== "All" ||
    facultyFilter !== "All";

  const clearFilters = () => {
    setSearch("");
    setAcademicYearFilter("All");
    setSemesterFilter("All");
    setCourseFilter("All");
    setFacultyFilter("All");
  };

  const refreshQueue = () => {
    setActionNotice(null);
    setRefreshKey((current) => current + 1);
  };

  const approveGrade = async (grade: SubmittedGrade) => {
    if (
      grade.grades.grading_outcome !== "NUMERIC" ||
      grade.sheet_status !== "IN_PROGRESS" ||
      grade.officially_published
    )
      return;

    const remarks = window.prompt(
      `Review remarks for ${grade.student.full_name} (10–500 characters):`,
      "",
    );
    if (remarks === null) return;
    const cleanRemarks = remarks.trim();
    if (cleanRemarks.length < 10 || cleanRemarks.length > 500) {
      setActionNotice({
        type: "error",
        message: "Review remarks must be between 10 and 500 characters.",
      });
      return;
    }

    const endpoint = `${COMBINED_QUEUE_API}/${grade.submission_id}/approve`;

    const request = async (dryRun: boolean) => {
      const response = await authService.authFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expected_record_version: grade.record_version,
          review_remarks: cleanRemarks,
          confirm_approval: true,
          dry_run: dryRun,
        }),
      });
      const data = await readJsonResponse<CombinedReviewResponse>(response);
      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        throw new Error("Your session has expired.");
      }
      if (
        !response.ok ||
        !data.success ||
        data.submission_id !== grade.submission_id ||
        data.submission_status !== "APPROVED" ||
        data.dry_run !== dryRun ||
        data.persisted !== !dryRun
      ) {
        throw new Error(
          [data.code, data.message].filter(Boolean).join(": ") ||
            "Combined semester approval failed.",
        );
      }
    };

    setActionGradeId(grade.grade_id);
    setActionNotice(null);

    try {
      await request(true);
      const confirmed = window.confirm(
        `Approve the combined semester submission for ${grade.student.full_name}?\n\n` +
          `${grade.class.subject.subject_code} · ${grade.class.section.section_name}\n` +
          `Semester: ${formatPercentage(grade.grades.overall_percentage)}\n` +
          `Numeric rating: ${formatGrade(grade.grades.final_rating)}\n\n` +
          "This approves the submission for review. Official publication is a separate step.",
      );
      if (!confirmed) return;
      await request(false);
      setActionNotice({
        type: "success",
        message:
          "Combined semester submission approved. Official publication remains separate.",
      });
      setRefreshKey((value) => value + 1);
    } catch (caught) {
      setActionNotice({
        type: "error",
        message: caught instanceof Error ? caught.message : "Approval failed.",
      });
      setRefreshKey((value) => value + 1);
    } finally {
      setActionGradeId(null);
    }
  };

  const publishApprovedGrade = async (grade: SubmittedGrade) => {
    if (
      actionGradeId !== null ||
      !programHead ||
      grade.review.reviewed_by !== programHead.user_id ||
      grade.grades.grading_outcome !== "NUMERIC" ||
      grade.sheet_status !== "IN_PROGRESS" ||
      grade.officially_published ||
      !Number.isSafeInteger(grade.record_version) ||
      grade.record_version <= 0
    ) {
      setActionNotice({
        type: "error",
        message:
          "Only the Program Head who approved this current numeric submission can publish it.",
      });
      return;
    }

    const endpoint = `${COMBINED_QUEUE_API}/${grade.submission_id}/publish`;

    const request = async (dryRun: boolean) => {
      const response = await authService.authFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expected_record_version: grade.record_version,
          confirm_publication: true,
          dry_run: dryRun,
        }),
      });

      const data =
        await readJsonResponse<CombinedPublicationResponse>(response);

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
        data.submission_id !== grade.submission_id ||
        data.grade_id !== grade.grade_id ||
        data.publication_source !== "COMBINED_SEMESTER" ||
        data.grade_status !== "Approved" ||
        data.official_sheet_finalized !== false ||
        (!dryRun && !data.publication_id)
      ) {
        throw new Error(
          [data.code, data.message].filter(Boolean).join(": ") ||
            "Official publication was not confirmed by the backend.",
        );
      }

      return data;
    };

    setActionGradeId(grade.grade_id);
    setActionNotice(null);

    try {
      await request(true);

      const confirmed = window.confirm(
        `Publish the official numeric grade for ${grade.student.full_name}?\n\n` +
          `${grade.class.subject.subject_code} · ${grade.class.section.section_name}\n` +
          `Midterm: ${formatGrade(grade.grades.midterm_grade)}%\n` +
          `Final: ${formatGrade(grade.grades.final_grade)}%\n` +
          `Semester: ${formatPercentage(grade.grades.overall_percentage)}\n` +
          `Numeric equivalent: ${formatGrade(grade.grades.final_rating)}\n\n` +
          "This creates an official publication record and updates the approved grade. " +
          "It does not finalize the official sheet.",
      );

      if (!confirmed) return;

      const saved = await request(false);

      setActionNotice({
        type: "success",
        message:
          `Official grade published (publication #${saved.publication_id}). ` +
          "The official sheet is not yet finalized.",
      });

      setRefreshKey((current) => current + 1);
    } catch (caught) {
      setActionNotice({
        type: "error",
        message:
          caught instanceof Error
            ? caught.message
            : "Official publication failed.",
      });

      setRefreshKey((current) => current + 1);
    } finally {
      setActionGradeId(null);
    }
  };

  const openReturnModal = (grade: SubmittedGrade) => {
    setReturnGrade(grade);
    setReturnReason("");
    setReturnScope("BOTH");
    setReturnError("");
  };

  const closeReturnModal = useCallback(() => {
    if (actionGradeId !== null) return;
    setReturnGrade(null);
    setReturnReason("");
    setReturnError("");
  }, [actionGradeId]);

  const submitReturn = async () => {
    if (!returnGrade || returnGrade.grades.grading_outcome !== "NUMERIC")
      return;
    const reason = returnReason.trim();
    if (reason.length < 15 || reason.length > 500) {
      setReturnError("Return reason must be 15–500 characters.");
      return;
    }

    const grade = returnGrade;
    const endpoint = `${COMBINED_QUEUE_API}/${grade.submission_id}/return`;

    const request = async (dryRun: boolean) => {
      const response = await authService.authFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expected_record_version: grade.record_version,
          returned_edit_scope: returnScope,
          review_remarks: reason,
          confirm_return: true,
          dry_run: dryRun,
        }),
      });
      const data = await readJsonResponse<CombinedReviewResponse>(response);
      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        throw new Error("Your session has expired.");
      }
      if (
        !response.ok ||
        !data.success ||
        data.submission_id !== grade.submission_id ||
        data.submission_status !== "RETURNED" ||
        data.dry_run !== dryRun ||
        data.persisted !== !dryRun
      ) {
        throw new Error(
          [data.code, data.message].filter(Boolean).join(": ") ||
            "Combined semester return failed.",
        );
      }
    };

    setActionGradeId(grade.grade_id);
    setReturnError("");
    setActionNotice(null);

    try {
      await request(true);
      if (
        !window.confirm(
          `Return ${grade.student.full_name}'s ${returnScope.replaceAll("_", " ")} grades to Faculty?`,
        )
      )
        return;
      await request(false);
      setActionNotice({
        type: "success",
        message:
          "Combined semester submission returned for the selected term scope.",
      });
      setReturnGrade(null);
      setReturnReason("");
      setReturnScope("BOTH");
      setRefreshKey((value) => value + 1);
    } catch (caught) {
      setReturnError(
        caught instanceof Error ? caught.message : "Return failed.",
      );
      setRefreshKey((value) => value + 1);
    } finally {
      setActionGradeId(null);
    }
  };

  useEffect(() => {
    if (!returnGrade) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && actionGradeId === null) closeReturnModal();
    };
    window.addEventListener("keydown", handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [returnGrade, actionGradeId, closeReturnModal]);
  useEffect(() => {
    if (!evidenceGrade || !authenticated || userRole !== "Program Head") {
      return;
    }

    const controller = new AbortController();

    setEvidence(null);
    setEvidenceError("");
    setEvidenceLoading(true);

    const load = async () => {
      try {
        const response = await authService.authFetch(
          `${COMBINED_QUEUE_API}/${evidenceGrade.submission_id}/evidence`,
          {
            method: "GET",
            signal: controller.signal,
          },
        );

        const data = await readJsonResponse<CombinedEvidenceResponse>(response);

        if (controller.signal.aborted) return;

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (
          !response.ok ||
          !data.success ||
          !data.read_only ||
          data.submission?.submission_id !== evidenceGrade.submission_id ||
          data.submission?.offering_id !== evidenceGrade.class.offering_id ||
          data.submission?.enrollment_subject_id !==
            evidenceGrade.enrollment_subject_id ||
          data.submission?.record_version !== evidenceGrade.record_version
        ) {
          throw new Error(
            data.message || "Could not verify the saved evidence.",
          );
        }

        setEvidence(data);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setEvidenceError(
            caught instanceof Error
              ? caught.message
              : "Could not load saved evidence.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setEvidenceLoading(false);
        }
      }
    };

    void load();

    return () => controller.abort();
  }, [evidenceGrade, authenticated, userRole, navigate]);

  useEffect(() => {
    if (!evidenceGrade) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEvidenceGrade(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [evidenceGrade]);
  if (!authenticated || !session || userRole !== "Program Head") return null;

  return (
    <DashboardLayout>
      <main className="program-head-pending-grades-page">
        <section className="program-head-grades-header">
          <div className="program-head-grades-header-copy">
            <div className="program-head-grades-eyebrow">
              <span>
                <ClipboardCheck size={16} strokeWidth={2.2} />
              </span>
              Program Head · Grade Review
            </div>
            <h1>Pending Grade Approvals</h1>
            <p>
              Review combined-semester submissions from Faculty within your
              department before separate official publication.
            </p>
            {programHead && (
              <div className="program-head-grades-context">
                <span>
                  <Building2 size={14} />
                  {programHead.department.department_name}
                </span>
                <i />
                <span>
                  <UserRound size={14} />
                  {programHead.program_head_name}
                </span>
              </div>
            )}
          </div>
        </section>

        {programHead && (
          <section className="program-head-review-profile">
            <div>
              <span className="program-head-review-profile-icon">
                <ShieldCheck size={18} />
              </span>
              <div>
                <small>Program Head</small>
                <strong>{programHead.program_head_name}</strong>
              </div>
            </div>
            <div>
              <span className="program-head-review-profile-icon">
                <UserRound size={18} />
              </span>
              <div>
                <small>Employee Number</small>
                <strong>{programHead.employee_number}</strong>
              </div>
            </div>
            <div>
              <span className="program-head-review-profile-icon">
                <Building2 size={18} />
              </span>
              <div>
                <small>Department</small>
                <strong>{programHead.department.department_code}</strong>
                <span>{programHead.department.department_name}</span>
              </div>
            </div>
          </section>
        )}

        {actionNotice && (
          <section
            className={`program-head-action-notice ${actionNotice.type}`}
            role="status"
          >
            <span>
              {actionNotice.type === "success" ? (
                <CheckCircle2 size={19} />
              ) : (
                <AlertCircle size={19} />
              )}
            </span>
            <div>
              <strong>
                {actionNotice.type === "success"
                  ? "Grade review updated"
                  : "Grade review failed"}
              </strong>
              <p>{actionNotice.message}</p>
            </div>
          </section>
        )}

        <section
          className="program-head-grade-summary"
          aria-label="Grade review summary"
        >
          <article className="program-head-grade-summary-card program-head-grade-summary-card--primary">
            <span className="program-head-grade-summary-icon">
              <ClipboardCheck size={19} />
            </span>
            <div>
              <small>Pending Review</small>
              <strong>{loading ? "…" : summary.totalPending}</strong>
              <span>Submitted grades in this view</span>
            </div>
          </article>
          <article className="program-head-grade-summary-card">
            <span className="program-head-grade-summary-icon">
              <BookOpenCheck size={19} />
            </span>
            <div>
              <small>Classes</small>
              <strong>{loading ? "…" : summary.classes}</strong>
              <span>Classes represented in queue</span>
            </div>
          </article>
          <article className="program-head-grade-summary-card">
            <span className="program-head-grade-summary-icon">
              <UsersRound size={19} />
            </span>
            <div>
              <small>Faculty</small>
              <strong>{loading ? "…" : summary.faculties}</strong>
              <span>Submitting Faculty members</span>
            </div>
          </article>
          <article className="program-head-grade-summary-card">
            <span className="program-head-grade-summary-icon program-head-grade-summary-icon--passed">
              <Check size={19} />
            </span>
            <div>
              <small>Passed</small>
              <strong>{loading ? "…" : summary.passed}</strong>
              <span>Submitted passing results</span>
            </div>
          </article>
          <article className="program-head-grade-summary-card">
            <span className="program-head-grade-summary-icon program-head-grade-summary-icon--incomplete">
              <Clock3 size={19} />
            </span>
            <div>
              <small>Incomplete</small>
              <strong>{loading ? "…" : summary.incomplete}</strong>
              <span>Incomplete submitted results</span>
            </div>
          </article>
          <article className="program-head-grade-summary-card">
            <span className="program-head-grade-summary-icon program-head-grade-summary-icon--failed">
              <AlertCircle size={19} />
            </span>
            <div>
              <small>Failed</small>
              <strong>{loading ? "…" : summary.failed}</strong>
              <span>Submitted failing results</span>
            </div>
          </article>
          <article className="program-head-grade-summary-card">
            <span className="program-head-grade-summary-icon program-head-grade-summary-icon--unofficial-drop">
              <X size={19} />
            </span>
            <div>
              <small>Unofficial Drop</small>
              <strong>{loading ? "…" : summary.unofficialDrop}</strong>
              <span>Special drop outcomes</span>
            </div>
          </article>
        </section>

        <section className="program-head-grade-filters">
          <header className="program-head-grade-filters-header">
            <div>
              <span className="program-head-grade-filters-icon">
                <Filter size={16} />
              </span>
              <div>
                <strong>Review Filters</strong>
                <p>
                  Find a student or narrow the approval queue by academic
                  period, course, Faculty, outcome, or reason.
                </p>
              </div>
            </div>
            {hasActiveFilters && (
              <button
                type="button"
                className="program-head-filter-clear"
                onClick={clearFilters}
              >
                <RotateCcw size={14} /> Clear Filters
              </button>
            )}
          </header>

          <div className="program-head-grade-filter-grid">
            <label className="program-head-grade-search">
              <span>Search</span>
              <div>
                <Search size={15} />
                <input
                  id="program-head-grade-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Student, subject, faculty, outcome, reason..."
                />
              </div>
            </label>
            <label>
              <span>Academic Year</span>
              <select
                value={academicYearFilter}
                onChange={(event) => setAcademicYearFilter(event.target.value)}
              >
                <option value="All">All Years</option>
                {academicYears.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Semester</span>
              <select
                value={semesterFilter}
                onChange={(event) => setSemesterFilter(event.target.value)}
              >
                <option value="All">All Semesters</option>
                {semesters.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Course</span>
              <select
                value={courseFilter}
                onChange={(event) => setCourseFilter(event.target.value)}
              >
                <option value="All">All Courses</option>
                {courses.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Faculty</span>
              <select
                value={facultyFilter}
                onChange={(event) => setFacultyFilter(event.target.value)}
              >
                <option value="All">All Faculty</option>
                {faculties.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {error && !loading && (
          <section className="program-head-grade-error" role="alert">
            <span>
              <AlertCircle size={20} />
            </span>
            <div>
              <strong>Pending grades could not be loaded</strong>
              <p>{error}</p>
            </div>
            <button type="button" onClick={refreshQueue}>
              Try Again
            </button>
          </section>
        )}

        {loading && (
          <section className="program-head-grade-loading">
            <div className="program-head-grade-loading-header">
              <div>
                <span>Grade Review Queue</span>
                <h2>Submitted Grades</h2>
              </div>
            </div>
            <div className="program-head-grade-skeleton-list">
              {[1, 2, 3].map((item) => (
                <div className="program-head-grade-skeleton" key={item}>
                  <i />
                  <span>
                    <i />
                    <i />
                  </span>
                  <span>
                    <i />
                    <i />
                  </span>
                  <i />
                </div>
              ))}
            </div>
          </section>
        )}

        {!loading && !error && filteredGrades.length === 0 && (
          <section className="program-head-grade-empty">
            <span>
              <CheckCircle2 size={24} />
            </span>
            <strong>No pending grade approvals</strong>
            <p>
              {grades.length === 0
                ? "There are currently no Faculty-submitted grades waiting for your department review."
                : "There are no Faculty-submitted grades matching the current filters."}
            </p>
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters}>
                <RotateCcw size={14} /> Clear Filters
              </button>
            )}
          </section>
        )}

        {!loading && !error && filteredGrades.length > 0 && (
          <section className="program-head-grade-queue">
            <header className="program-head-grade-queue-header">
              <div>
                <span>Grade Review Queue</span>
                <h2>Submitted Grades</h2>
                <p>
                  Review assessment-based calculations, final rating, Faculty,
                  and class details before approving the combined submission.
                  INC/UD requires separate individual evidence review.
                </p>
              </div>
              <strong>
                {filteredGrades.length}{" "}
                {filteredGrades.length === 1
                  ? "pending grade"
                  : "pending grades"}
              </strong>
            </header>

            <div className="program-head-grade-table-wrapper">
              <table className="program-head-grade-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Class</th>
                    <th>Faculty</th>
                    <th>Outcome</th>
                    <th>Midterm</th>
                    <th>Final</th>
                    <th>Overall</th>
                    <th>Final Rating</th>
                    <th>Result</th>
                    <th>Reason</th>
                    <th>Submitted</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGrades.map((grade) => {
                    const busy = actionGradeId === grade.grade_id;
                    return (
                      <tr key={grade.grade_id}>
                        <td>
                          <div className="program-head-review-student">
                            <span className="program-head-review-avatar">
                              <GraduationCap size={16} />
                            </span>
                            <div>
                              <strong>{grade.student.full_name}</strong>
                              <span>{grade.student.student_number}</span>
                              <small>ES #{grade.enrollment_subject_id}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="program-head-review-class">
                            <strong>{grade.class.subject.subject_code}</strong>
                            <span>{grade.class.subject.subject_name}</span>
                            <small>
                              {grade.class.section.section_name} ·{" "}
                              {grade.class.section.course.course_code} ·{" "}
                              {grade.class.academic_period.academic_year} ·{" "}
                              {grade.class.academic_period.semester_name}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="program-head-review-faculty">
                            <strong>{grade.faculty.faculty_name}</strong>
                            <small>{grade.faculty.employee_number}</small>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`program-head-grade-outcome ${getOutcomeClass(grade.grades.grading_outcome)}`}
                          >
                            {getOutcomeLabel(grade.grades.grading_outcome)}
                          </span>
                        </td>
                        <td>
                          <span className="program-head-grade-value">
                            {formatGrade(grade.grades.midterm_grade)}
                          </span>
                        </td>
                        <td>
                          <span className="program-head-grade-value">
                            {formatGrade(grade.grades.final_grade)}
                          </span>
                        </td>
                        <td>
                          <span className="program-head-grade-overall">
                            {formatPercentage(grade.grades.overall_percentage)}
                          </span>
                        </td>
                        <td>
                          <strong className="program-head-final-rating">
                            {formatGrade(grade.grades.final_rating)}
                          </strong>
                        </td>
                        <td>
                          <span
                            className={`program-head-grade-remark ${getRemarkClass(grade.grades.remarks)}`}
                          >
                            {grade.grades.remarks || "—"}
                          </span>
                        </td>
                        <td>
                          <div className="program-head-grade-reason">
                            {grade.grades.outcome_reason ? (
                              <span title={grade.grades.outcome_reason}>
                                {grade.grades.outcome_reason}
                              </span>
                            ) : (
                              <span className="program-head-grade-reason--none">
                                Not required
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="program-head-submitted-time">
                            <span>
                              <CalendarDays size={13} />
                              {formatDateTime(grade.submitted_at)}
                            </span>
                            <small>
                              {formatDays(grade.class.schedule.days)} ·{" "}
                              {grade.class.schedule.time || "No schedule"}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="program-head-grade-actions">
                            <button
                              type="button"
                              className="program-head-return-button"
                              onClick={() => openReturnModal(grade)}
                              disabled={
                                busy ||
                                actionGradeId !== null ||
                                grade.grades.grading_outcome !== "NUMERIC" ||
                                grade.sheet_status !== "IN_PROGRESS" ||
                                grade.officially_published
                              }
                              title={
                                grade.grades.grading_outcome !== "NUMERIC"
                                  ? "INC/UD requires individual special-evidence review"
                                  : undefined
                              }
                            >
                              <Undo2 size={14} /> Return
                            </button>
                            <button
                              type="button"
                              className="program-head-approve-button"
                              onClick={() => void approveGrade(grade)}
                              disabled={
                                busy ||
                                actionGradeId !== null ||
                                grade.grades.grading_outcome !== "NUMERIC" ||
                                grade.sheet_status !== "IN_PROGRESS" ||
                                grade.officially_published
                              }
                              title={
                                grade.grades.grading_outcome !== "NUMERIC"
                                  ? "INC/UD requires individual special-evidence review"
                                  : undefined
                              }
                            >
                              <Check size={14} />{" "}
                              {busy ? "Processing..." : "Approve"}
                            </button>
                            <button
                              type="button"
                              className="program-head-return-button"
                              onClick={() => {
                                setEvidence(null);
                                setEvidenceError("");
                                setEvidenceGrade(grade);
                              }}
                              disabled={actionGradeId !== null}
                            >
                              <BookOpenCheck size={14} />
                              Review Evidence
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {/* Approved Combined Submissions */}
        <section className="program-head-grade-queue">
          <header className="program-head-grade-queue-header">
            <div>
              <span>Combined Semester Grades</span>
              <h2>Approved for Publication</h2>

              <p>
                Only approved numeric submissions may be published here.
                Publication is separate from official-sheet finalization.
              </p>
            </div>

            <strong>
              {approvedLoading ? "…" : approvedGrades.length} awaiting
              publication
            </strong>
          </header>

          {approvedError && (
            <div className="program-head-grade-error" role="alert">
              <AlertCircle size={16} />
              {approvedError}

              <button type="button" onClick={refreshQueue}>
                Try Again
              </button>
            </div>
          )}

          {approvedLoading ? (
            <div className="program-head-grade-empty">
              <p>Loading approved submissions...</p>
            </div>
          ) : !approvedError && approvedGrades.length === 0 ? (
            <div className="program-head-grade-empty">
              <p>No approved numeric submissions are awaiting publication.</p>
            </div>
          ) : !approvedError ? (
            <div className="program-head-grade-table-wrapper">
              <table className="program-head-grade-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Class</th>
                    <th>Faculty</th>
                    <th>Midterm</th>
                    <th>Final Term</th>
                    <th>Semester</th>
                    <th>Rating</th>
                    <th>Approved</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {approvedGrades.map((grade) => {
                    const isReviewer =
                      programHead?.user_id === grade.review.reviewed_by;

                    const busy = actionGradeId === grade.grade_id;

                    return (
                      <tr key={grade.submission_id}>
                        <td>
                          <div className="program-head-review-student">
                            <strong>{grade.student.full_name}</strong>
                            <small>{grade.student.student_number}</small>
                          </div>
                        </td>

                        <td>
                          <div className="program-head-review-class">
                            <strong>{grade.class.subject.subject_code}</strong>

                            <span>{grade.class.subject.subject_name}</span>

                            <small>{grade.class.section.section_name}</small>
                          </div>
                        </td>

                        <td>{grade.faculty.faculty_name}</td>

                        <td>{formatGrade(grade.grades.midterm_grade)}%</td>

                        <td>{formatGrade(grade.grades.final_grade)}%</td>

                        <td>
                          {formatPercentage(grade.grades.overall_percentage)}
                        </td>

                        <td>{formatGrade(grade.grades.final_rating)}</td>

                        <td>{formatDateTime(grade.review.reviewed_at)}</td>

                        <td>
                          <div className="program-head-grade-actions">
                            <button
                              type="button"
                              className="program-head-approve-button"
                              disabled={!isReviewer || actionGradeId !== null}
                              title={
                                !isReviewer
                                  ? "Only the approving Program Head may publish this grade."
                                  : undefined
                              }
                              onClick={() => void publishApprovedGrade(grade)}
                            >
                              <ShieldCheck size={14} />

                              {busy ? "Publishing..." : "Publish Official"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
        <OfficialSheetFinalization
          refreshKey={refreshKey}
          onFinalized={() => setRefreshKey((value) => value + 1)}
        />
        {!loading && !error && (
          <section className="program-head-review-workflow">
            <header>
              <span>Grade Approval Process</span>
              <h2>Review Workflow</h2>
              <p>
                Submitted grades remain pending until the Program Head approves
                them or returns them to Faculty for correction.
              </p>
            </header>
            <div className="program-head-review-workflow-grid">
              <article>
                <span>1</span>
                <div>
                  <strong>Faculty Submits</strong>
                  <p>
                    Faculty submits the completed Midterm and Final Term
                    gradebook together for review.
                  </p>
                </div>
              </article>
              <article>
                <span>2</span>
                <div>
                  <strong>Review</strong>
                  <p>
                    Verify the grading outcome, percentages, final rating,
                    result, reason, student, and class information.
                  </p>
                </div>
              </article>
              <article>
                <span>3</span>
                <div>
                  <strong>Approve</strong>
                  <p>
                    Approval validates the combined semester result; official
                    publication is a separate authorized step.
                  </p>
                </div>
              </article>
              <article>
                <span>4</span>
                <div>
                  <strong>Return</strong>
                  <p>
                    Returned grades go back to Faculty with your reason for
                    correction and resubmission.
                  </p>
                </div>
              </article>
            </div>
          </section>
        )}

        {evidenceGrade && (
          <div
            className="program-head-return-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setEvidenceGrade(null);
              }
            }}
          >
            <section
              className="program-head-return-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="program-head-evidence-title"
            >
              <header className="program-head-return-modal-header">
                <div>
                  <span className="program-head-return-modal-icon">
                    <BookOpenCheck size={18} />
                  </span>

                  <div>
                    <small>Saved Submission Evidence · Read-only</small>

                    <h2 id="program-head-evidence-title">Gradebook Evidence</h2>

                    <p>
                      {evidenceGrade.student.full_name} ·{" "}
                      {evidenceGrade.class.subject.subject_code}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  className="program-head-return-close"
                  aria-label="Close evidence review"
                  onClick={() => setEvidenceGrade(null)}
                >
                  <X size={18} />
                </button>
              </header>

              <div
                style={{
                  maxHeight: "65vh",
                  overflowY: "auto",
                  padding: 18,
                }}
              >
                {evidenceLoading ? (
                  <p>Loading saved assessment and attendance evidence...</p>
                ) : evidenceError ? (
                  <p role="alert" className="program-head-grade-reason">
                    {evidenceError}
                  </p>
                ) : evidence ? (
                  <>
                    <p>
                      Submission #{evidence.submission.submission_id}
                      {" · "}
                      {evidence.submission.grading_outcome.replaceAll("_", " ")}
                      {" · "}
                      {evidence.calculation_snapshot.classification ??
                        "Gradebook"}
                    </p>

                    {(["MIDTERM", "FINAL_TERM"] as const).map((term) => {
                      const termEvidence =
                        evidence.calculation_snapshot.calculated_terms?.[term];

                      return (
                        <div key={term} style={{ marginTop: 18 }}>
                          <h3>
                            {term === "MIDTERM" ? "Midterm" : "Final Term"}
                          </h3>

                          <p>
                            {termEvidence?.state ?? "Not available"}
                            {" · "}
                            {termEvidence?.term_percentage?.display ?? "—"}%
                          </p>

                          {(termEvidence?.categories ?? []).map((category) => (
                            <div
                              key={category.category_code}
                              style={{ marginTop: 12 }}
                            >
                              <strong>
                                {category.category_name}
                                {" ("}
                                {category.category_weight_percent}
                                {"%)"}
                              </strong>

                              <p>
                                {category.state}
                                {" · "}Category:{" "}
                                {category.category_percentage?.display ?? "—"}%
                                {" · "}Contribution:{" "}
                                {category.contribution_percent_points
                                  ?.display ?? "—"}
                                {" pts"}
                              </p>

                              {(category.assessments ?? []).map(
                                (assessment) => (
                                  <p key={assessment.assessment_id}>
                                    {assessment.header_name}
                                    {": "}
                                    {assessment.score_status === "SCORED"
                                      ? `${assessment.earned_score} / ${assessment.maximum_score}`
                                      : assessment.score_status}

                                    {assessment.not_applicable_reason
                                      ? ` · ${assessment.not_applicable_reason}`
                                      : ""}
                                  </p>
                                ),
                              )}

                              {(category.sessions ?? []).map((session) => (
                                <p key={session.meeting_id}>
                                  {session.meeting_date}
                                  {": "}
                                  {session.attendance_status}

                                  {session.status_reason
                                    ? ` · ${session.status_reason}`
                                    : ""}
                                </p>
                              ))}
                            </div>
                          ))}
                        </div>
                      );
                    })}

                    {evidence.calculation_snapshot.special_outcome && (
                      <div style={{ marginTop: 18 }}>
                        <h3>Special Outcome Evidence</h3>

                        <p>
                          {
                            evidence.calculation_snapshot.special_outcome
                              .outcome_type
                          }
                        </p>

                        <p>
                          {
                            evidence.calculation_snapshot.special_outcome
                              .outcome_reason
                          }
                        </p>

                        <p>
                          {evidence.calculation_snapshot.special_outcome
                            .missing_requirements ?? ""}
                        </p>

                        <p>
                          {
                            evidence.calculation_snapshot.special_outcome
                              .evidence_summary
                          }
                        </p>
                      </div>
                    )}

                    <p style={{ marginTop: 18 }}>
                      This is the original saved submission snapshot, not a
                      recalculation. Review actions remain separate.
                    </p>
                  </>
                ) : null}
              </div>
            </section>
          </div>
        )}

        {returnGrade && (
          <div
            className="program-head-return-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeReturnModal();
            }}
          >
            <section
              className="program-head-return-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="program-head-return-title"
            >
              <header className="program-head-return-modal-header">
                <div>
                  <span className="program-head-return-modal-icon">
                    <Undo2 size={18} />
                  </span>
                  <div>
                    <small>Grade Review</small>
                    <h2 id="program-head-return-title">
                      Return Grade to Faculty
                    </h2>
                    <p>
                      Explain what needs to be reviewed or corrected before
                      resubmission.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="program-head-return-close"
                  onClick={closeReturnModal}
                  disabled={actionGradeId !== null}
                  aria-label="Close return grade modal"
                >
                  <X size={18} />
                </button>
              </header>

              <div className="program-head-return-grade-summary">
                <div>
                  <span>Student</span>
                  <strong>{returnGrade.student.full_name}</strong>
                  <small>{returnGrade.student.student_number}</small>
                </div>
                <div>
                  <span>Subject</span>
                  <strong>{returnGrade.class.subject.subject_code}</strong>
                  <small>{returnGrade.class.subject.subject_name}</small>
                </div>
                <div>
                  <span>Faculty</span>
                  <strong>{returnGrade.faculty.faculty_name}</strong>
                  <small>{returnGrade.faculty.employee_number}</small>
                </div>
                <div>
                  <span>Outcome</span>
                  <strong>
                    {getOutcomeLabel(returnGrade.grades.grading_outcome)}
                  </strong>
                  <small>{returnGrade.grades.grading_policy || "—"}</small>
                </div>
                <div>
                  <span>Overall / Final Rating</span>
                  <strong>
                    {formatPercentage(returnGrade.grades.overall_percentage)} ·{" "}
                    {formatGrade(returnGrade.grades.final_rating)}
                  </strong>
                  <small>{returnGrade.grades.remarks || "No result"}</small>
                </div>
                <div className="program-head-return-grade-summary__reason">
                  <span>Outcome Reason</span>
                  <strong>
                    {returnGrade.grades.outcome_reason || "Not required"}
                  </strong>
                  <small>Faculty-provided special outcome reason</small>
                </div>
              </div>

              <div className="program-head-return-field">
                <div className="program-head-return-label">
                  <label htmlFor="program-head-return-scope">
                    Returned Grading Term
                  </label>
                </div>
                <select
                  id="program-head-return-scope"
                  style={{
                    width: "100%",
                    minHeight: 42,
                    padding: "10px 14px",
                    border: "1px solid var(--pg-border)",
                    borderRadius: 10,
                    background: "var(--pg-field)",
                    color: "var(--pg-text)",
                  }}
                  value={returnScope}
                  disabled={actionGradeId !== null}
                  onChange={(event) =>
                    setReturnScope(
                      event.target.value as "MIDTERM" | "FINAL_TERM" | "BOTH",
                    )
                  }
                >
                  <option value="MIDTERM">Midterm Only</option>
                  <option value="FINAL_TERM">Final Term Only</option>
                  <option value="BOTH">Both Terms</option>
                </select>
              </div>

              <div className="program-head-return-field">
                <div className="program-head-return-label">
                  <label htmlFor="program-head-return-reason">
                    Return Reason
                  </label>
                  <span>{returnReason.length}/500</span>
                </div>
                <textarea
                  id="program-head-return-reason"
                  value={returnReason}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value.length <= 500) {
                      setReturnReason(value);
                      setReturnError("");
                    }
                  }}
                  disabled={actionGradeId !== null}
                  maxLength={500}
                  rows={6}
                  placeholder="Example: Please verify the final rating before resubmitting."
                  autoFocus
                />
                <small>
                  A clear reason is required so the Faculty knows what needs
                  correction.
                </small>
              </div>

              {returnError && (
                <div className="program-head-return-error" role="alert">
                  <AlertCircle size={14} />
                  {returnError}
                </div>
              )}

              <footer className="program-head-return-modal-actions">
                <button
                  type="button"
                  className="program-head-return-cancel"
                  onClick={closeReturnModal}
                  disabled={actionGradeId !== null}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="program-head-return-confirm"
                  onClick={() => void submitReturn()}
                  disabled={
                    actionGradeId !== null || returnReason.trim().length < 15
                  }
                >
                  <Undo2 size={14} />
                  {actionGradeId === returnGrade.grade_id
                    ? "Returning..."
                    : "Return to Faculty"}
                </button>
              </footer>
            </section>
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
