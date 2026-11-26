import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FilePenLine,
  GraduationCap,
  History,
  RotateCcw,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/GradeChangeRequestsR.css";

const API_BASE_URL = apiUrl("/api/registrar/grade-change-requests");

type RegistrarRequestStatus = "For Registrar Processing" | "Completed";

interface GradeSnapshot {
  midterm_grade: number | null;
  final_grade: number | null;
  overall_percentage: number | null;
  final_rating: number | null;
  grading_outcome: string | null;
  remarks: string | null;
  outcome_reason: string | null;
}

interface RegistrarGradeChangeRequest {
  grade_change_request_id: number;
  grade_id: number;
  request_type: string;
  status: RegistrarRequestStatus;
  completion_remarks: string;
  requested_at: string | null;
  review_remarks: string | null;
  reviewed_at: string | null;
  reviewed_by_username: string | null;
  processed_at: string | null;
  processed_by_username: string | null;
  registrar_remarks: string | null;

  student: {
    student_id: number | null;
    student_number: string;
    full_name: string;
  };

  class: {
    offering_id: number | null;
    enrollment_subject_id: number | null;
    subject: {
      subject_id: number | null;
      subject_code: string;
      subject_name: string;
    };
    section: {
      section_id: number | null;
      section_name: string;
    };
  };

  faculty: {
    faculty_id: number | null;
    employee_number: string | null;
    faculty_name: string;
  };

  original_grade: GradeSnapshot;
  proposed_grade: GradeSnapshot;
  current_official_grade: GradeSnapshot & {
    grading_policy: string | null;
    grade_status: string | null;
  };
}

interface QueueResponse {
  success?: boolean;
  message?: string;
  error?: string;
  requests?: unknown[];
  grade_change_requests?: unknown[];
}

interface ProcessResponse {
  success?: boolean;
  message?: string;
  error?: string;
}

interface ActionNotice {
  type: "success" | "error";
  message: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function buildGradeSnapshot(
  raw: Record<string, unknown>,
  nestedKey: string,
  prefix: "old" | "new" | "current",
): GradeSnapshot {
  const nested = asRecord(raw[nestedKey]);

  return {
    midterm_grade:
      asNumber(nested.midterm_grade) ??
      asNumber(raw[`${prefix}_midterm_grade`]),

    final_grade:
      asNumber(nested.final_grade) ?? asNumber(raw[`${prefix}_final_grade`]),

    overall_percentage:
      asNumber(nested.overall_percentage) ??
      asNumber(raw[`${prefix}_overall_percentage`]),

    final_rating:
      asNumber(nested.final_rating) ?? asNumber(raw[`${prefix}_final_rating`]),

    grading_outcome:
      asNullableString(nested.grading_outcome) ??
      asNullableString(raw[`${prefix}_grading_outcome`]),

    remarks:
      asNullableString(nested.remarks) ??
      asNullableString(raw[`${prefix}_remarks`]),

    outcome_reason:
      asNullableString(nested.outcome_reason) ??
      asNullableString(raw[`${prefix}_outcome_reason`]),
  };
}
function normalizeRequest(value: unknown): RegistrarGradeChangeRequest | null {
  const raw = asRecord(value);
  const requestId = asNumber(raw.grade_change_request_id);
  const gradeId = asNumber(raw.grade_id);
  const status = asString(raw.status);

  if (
    requestId === null ||
    gradeId === null ||
    (status !== "For Registrar Processing" && status !== "Completed")
  ) {
    return null;
  }

  const studentRaw = asRecord(raw.student);
  const classRaw = asRecord(raw.class);
  const subjectRaw = asRecord(classRaw.subject);
  const sectionRaw = asRecord(classRaw.section);
  const facultyRaw = asRecord(raw.faculty);
  const requestedByRaw = asRecord(raw.requested_by);
  const reviewedByRaw = asRecord(raw.reviewed_by);
  const processedByRaw = asRecord(raw.processed_by);

  const firstName = asString(pick(studentRaw, "first_name"));
  const middleName = asString(pick(studentRaw, "middle_name"));
  const lastName = asString(pick(studentRaw, "last_name"));
  const joinedName = [firstName, middleName, lastName]
    .filter(Boolean)
    .join(" ");

  return {
    grade_change_request_id: requestId,
    grade_id: gradeId,
    request_type: asString(raw.request_type, "INC_COMPLETION"),
    status,
    completion_remarks: asString(
      raw.completion_remarks,
      "No remarks provided.",
    ),
    requested_at:
      asNullableString(raw.requested_at) ??
      asNullableString(requestedByRaw.requested_at),
    review_remarks:
      asNullableString(raw.review_remarks) ??
      asNullableString(reviewedByRaw.review_remarks),
    reviewed_at:
      asNullableString(raw.reviewed_at) ??
      asNullableString(reviewedByRaw.reviewed_at),
    reviewed_by_username:
      asNullableString(raw.reviewed_by_username) ??
      asNullableString(reviewedByRaw.username),
    processed_at:
      asNullableString(raw.processed_at) ??
      asNullableString(processedByRaw.processed_at),
    processed_by_username:
      asNullableString(raw.processed_by_username) ??
      asNullableString(processedByRaw.username),
    registrar_remarks: asNullableString(raw.registrar_remarks),

    student: {
      student_id: asNumber(studentRaw.student_id) ?? asNumber(raw.student_id),
      student_number:
        asString(studentRaw.student_number) ||
        asString(raw.student_number, "—"),
      full_name:
        asString(studentRaw.full_name) ||
        asString(studentRaw.student_name) ||
        asString(raw.student_name) ||
        joinedName ||
        "Student",
    },

    class: {
      offering_id: asNumber(classRaw.offering_id) ?? asNumber(raw.offering_id),
      enrollment_subject_id:
        asNumber(classRaw.enrollment_subject_id) ??
        asNumber(raw.enrollment_subject_id),
      subject: {
        subject_id: asNumber(subjectRaw.subject_id) ?? asNumber(raw.subject_id),
        subject_code:
          asString(subjectRaw.subject_code) || asString(raw.subject_code, "—"),
        subject_name:
          asString(subjectRaw.subject_name) ||
          asString(raw.subject_name, "Subject unavailable"),
      },
      section: {
        section_id: asNumber(sectionRaw.section_id) ?? asNumber(raw.section_id),
        section_name:
          asString(sectionRaw.section_name) || asString(raw.section_name, "—"),
      },
    },

    faculty: {
      faculty_id: asNumber(facultyRaw.faculty_id) ?? asNumber(raw.faculty_id),
      employee_number:
        asNullableString(facultyRaw.employee_number) ??
        asNullableString(raw.employee_number),
      faculty_name:
        asString(facultyRaw.faculty_name) ||
        asString(raw.faculty_name) ||
        asString(requestedByRaw.username, "Faculty"),
    },

    original_grade: buildGradeSnapshot(raw, "original_grade", "old"),
    proposed_grade: buildGradeSnapshot(raw, "proposed_grade", "new"),
    current_official_grade: {
      ...buildGradeSnapshot(raw, "current_official_grade", "current"),
      grading_policy:
        asNullableString(asRecord(raw.current_official_grade).grading_policy) ??
        asNullableString(raw.current_grading_policy),
      grade_status:
        asNullableString(asRecord(raw.current_official_grade).grade_status) ??
        asNullableString(raw.current_grade_status),
    },
  };
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

function formatGrade(value: number | null): string {
  return value === null ? "—" : Number(value).toFixed(2);
}

function formatPercentage(value: number | null): string {
  return value === null ? "—" : `${Number(value).toFixed(2)}%`;
}

function formatDateTime(value: string | null): string {
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

function outcomeLabel(value: string | null): string {
  if (value === "INCOMPLETE") return "Incomplete";
  if (value === "NUMERIC") return "Numeric";
  if (value === "UNOFFICIAL_DROP") return "Unofficial Drop";
  return value || "—";
}
// Original Official Sheet Submission

interface RegistrarOfficialSheetOption {
  offering_id: number;
  offering_status: string;
  subject_code: string;
  subject_name: string;
  section_name: string;
  academic_year: string;
  semester_name: string;
  sheet_id: string | null;
  sheet_status: string;
  sheet_record_version: number | null;
  original_official_submitted_on: string | null;
  official_submission_reference: string | null;
  original_date_verified: boolean;
  official_date_verified_at: string | null;
  inc_completion_deadline_on: string | null;
  can_record_original_date: boolean;
}

interface RegistrarOfficialSheetListResponse {
  success: boolean;
  read_only: boolean;
  offerings: RegistrarOfficialSheetOption[];
  message?: string;
}

interface RegistrarOfficialSheetRecordResponse {
  success: boolean;
  action: "RECORDED";
  dry_run: boolean;
  persisted: boolean;
  official_sheet: {
    sheet_id: string | null;
    sheet_status: string;
    record_version: number;
    original_official_submitted_on: string;
    official_submission_reference: string;
    deadline_established: boolean;
  };
  audit_event: string;
  audit_event_id: string | null;
  message?: string;
  code?: string;
}

function OriginalOfficialSheetRecorder() {
  const navigate = useNavigate();

  const [offerings, setOfferings] = useState<RegistrarOfficialSheetOption[]>(
    [],
  );

  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [date, setDate] = useState("");
  const [reference, setReference] = useState("");
  const [evidenceChecked, setEvidenceChecked] = useState(false);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [listError, setListError] = useState("");

  const [feedback, setFeedback] = useState<ActionNotice | null>(null);

  const sheetsApi = apiUrl("/api/registrar/gradebook/official-sheets");

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setListError("");

    const load = async () => {
      try {
        const response = await authService.authFetch(sheetsApi, {
          method: "GET",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        const data =
          await readJsonResponse<RegistrarOfficialSheetListResponse>(response);

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
          setLoading(false);
        }
      }
    };

    void load();

    return () => controller.abort();
  }, [navigate, reloadKey, sheetsApi]);

  const selected =
    offerings.find((item) => item.offering_id === selectedId) ??
    offerings.find((item) => item.can_record_original_date) ??
    offerings[0];

  const selectedOfferingId = selected?.offering_id ?? null;

  const [readiness, setReadiness] = useState<{
    offering_id: number;
    reload_key: number;
    roster_count: number;
    unresolved_count: number;
    roster_ready: boolean;
  } | null>(null);

  const [readinessError, setReadinessError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    setReadiness(null);
    setReadinessError("");

    if (selectedOfferingId === null || loading) {
      return () => controller.abort();
    }

    const loadReadiness = async () => {
      try {
        const response = await authService.authFetch(
          `${sheetsApi}/${selectedOfferingId}`,
          {
            method: "GET",
            signal: controller.signal,
          },
        );

        if (controller.signal.aborted) return;

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        const result = await readJsonResponse<{
          success: boolean;
          read_only: boolean;
          offering_id: number;

          recording_readiness?: {
            roster_count: number;
            unresolved_count: number;
            roster_ready: boolean;
          };

          message?: string;
        }>(response);

        if (controller.signal.aborted) return;

        const r = result.recording_readiness;

        if (
          !response.ok ||
          !result.success ||
          !result.read_only ||
          result.offering_id !== selectedOfferingId ||
          !r ||
          !Number.isSafeInteger(r.roster_count) ||
          !Number.isSafeInteger(r.unresolved_count) ||
          r.roster_count < 0 ||
          r.unresolved_count < 0 ||
          r.unresolved_count > r.roster_count ||
          r.roster_ready !== (r.roster_count > 0 && r.unresolved_count === 0)
        ) {
          throw new Error(
            result.message || "Unable to verify class recording readiness.",
          );
        }

        setReadiness({
          ...r,
          offering_id: selectedOfferingId,
          reload_key: reloadKey,
        });
      } catch (caught) {
        if (!controller.signal.aborted) {
          setReadinessError(
            caught instanceof Error
              ? caught.message
              : "Unable to check readiness.",
          );
        }
      }
    };

    void loadReadiness();

    return () => controller.abort();
  }, [selectedOfferingId, loading, reloadKey, sheetsApi, navigate]);

  const currentReadiness =
    readiness &&
    readiness.offering_id === selectedOfferingId &&
    readiness.reload_key === reloadKey &&
    !loading
      ? readiness
      : null;

  const rosterReady = currentReadiness?.roster_ready === true;

  const validDate =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

  const validReference =
    reference.trim().length >= 8 &&
    reference.trim().length <= 255 &&
    !Array.from(reference.trim()).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });

  const canRecord =
    !loading &&
    !busy &&
    selected?.can_record_original_date === true &&
    rosterReady &&
    validDate &&
    validReference &&
    evidenceChecked;

  const recordOriginalDate = async () => {
    if (!canRecord || !selected) return;

    const offeringId = selected.offering_id;
    const expectedVersion = selected.sheet_record_version;

    const recordedVersion =
      expectedVersion === null || expectedVersion === 1
        ? 1
        : expectedVersion + 1;
    const originalDate = date;
    const sourceReference = reference.trim();

    setBusy(true);
    setFeedback(null);

    const submit = async (dryRun: boolean) => {
      const response = await authService.authFetch(
        `${sheetsApi}/${offeringId}/record-submission`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            expected_sheet_version: expectedVersion,
            original_official_submitted_on: originalDate,
            official_submission_reference: sourceReference,
            confirm_original_submission_evidence: true,
            dry_run: dryRun,
          }),
        },
      );

      const data =
        await readJsonResponse<RegistrarOfficialSheetRecordResponse>(response);

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });

        throw new Error("Your session has expired.");
      }

      if (
        !response.ok ||
        !data.success ||
        data.action !== "RECORDED" ||
        data.dry_run !== dryRun ||
        data.persisted !== !dryRun ||
        data.audit_event !== "RECORDED" ||
        data.official_sheet?.sheet_status !== "IN_PROGRESS" ||
        data.official_sheet.record_version !== recordedVersion ||
        data.official_sheet.original_official_submitted_on !== originalDate ||
        data.official_sheet.official_submission_reference !== sourceReference ||
        data.official_sheet.deadline_established !== false ||
        (!dryRun && (!data.official_sheet.sheet_id || !data.audit_event_id))
      ) {
        throw new Error(
          [data.code, data.message].filter(Boolean).join(": ") ||
            "The server did not confirm the original submission record.",
        );
      }

      return data;
    };

    try {
      await submit(true);

      const confirmed = window.confirm(
        `Record the ORIGINAL official sheet submission?\n\n` +
          `${selected.subject_code} · ${selected.section_name}\n` +
          `Date: ${originalDate}\n` +
          `Reference: ${sourceReference}\n\n` +
          "Confirm only if you checked the actual original submission evidence. " +
          "The Program Head must verify the date separately.",
      );

      if (!confirmed) return;

      const saved = await submit(false);

      setFeedback({
        type: "success",
        message:
          `Original submission recorded (sheet #${saved.official_sheet.sheet_id}). ` +
          "It is not yet verified. The INC deadline remains unset until Program Head verification.",
      });

      setDate("");
      setReference("");
      setEvidenceChecked(false);

      setReloadKey((value) => value + 1);
    } catch (caught) {
      setFeedback({
        type: "error",
        message:
          caught instanceof Error
            ? caught.message
            : "Could not record the original submission.",
      });

      setReloadKey((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="registrar-official-sheet-recording"
      className="registrar-grade-change-panel"
    >
      <header className="registrar-grade-change-panel-heading">
        <div>
          <span>Official Grading Sheets</span>
          <h2>Record Original Submission Date</h2>

          <p>
            Enter the authentic date and source reference from the original
            grading-sheet submission. Program Head verification is a separate
            step.
          </p>
        </div>

        <strong className="registrar-grade-change-count">
          {loading
            ? "…"
            : offerings.filter((item) => item.can_record_original_date)
                .length}{" "}
          awaiting recording check{" "}
        </strong>
      </header>

      <form
        className="registrar-grade-change-sheet-form"
        onSubmit={(event) => {
          event.preventDefault();
          void recordOriginalDate();
        }}
      >
        {listError && (
          <p role="alert" className="registrar-grade-change-sheet-message">
            {listError}
          </p>
        )}

        {feedback && (
          <p
            role={feedback.type === "error" ? "alert" : "status"}
            className={`registrar-grade-change-sheet-message ${feedback.type}`}
          >
            {feedback.message}
          </p>
        )}

        <label className="registrar-grade-change-sheet-field">
          <span>Subject offering</span>

          <select
            value={selected?.offering_id ?? ""}
            disabled={busy || loading || offerings.length === 0}
            onChange={(event) => {
              setReadiness(null);
              setReadinessError("");
              setSelectedId(Number(event.target.value));
              setDate("");
              setReference("");
              setEvidenceChecked(false);
              setFeedback(null);
            }}
          >
            {offerings.length === 0 && (
              <option value="">No gradebooks available</option>
            )}

            {offerings.map((item) => (
              <option key={item.offering_id} value={item.offering_id}>
                {item.subject_code} · {item.section_name} · {item.academic_year}{" "}
                · {item.semester_name}
                {item.can_record_original_date
                  ? " · Not yet recorded"
                  : ` · ${item.sheet_status.replaceAll("_", " ")}`}
              </option>
            ))}
          </select>
        </label>

        {selected && (
          <div className="registrar-grade-change-sheet-message" role="status">
            {readinessError
              ? readinessError
              : !currentReadiness
                ? "Checking class grade readiness…"
                : currentReadiness.roster_count === 0
                  ? "No class records are available for recording."
                  : !rosterReady
                    ? `${currentReadiness.unresolved_count} of ${currentReadiness.roster_count} class records require resolution, approval, or publication.`
                    : "Class roster passed the recording precheck."}

            {(readinessError || (currentReadiness && !rosterReady)) && (
              <button
                type="button"
                className="registrar-grade-change-process"
                disabled={loading || busy}
                onClick={() => {
                  setReadiness(null);
                  setReloadKey((n) => n + 1);
                }}
              >
                Check Readiness Again
              </button>
            )}
          </div>
        )}

        {selected && !selected.can_record_original_date ? (
          <p className="registrar-grade-change-sheet-message">
            Recording is unavailable for this offering. Sheet:{" "}
            {selected.sheet_status.replaceAll("_", " ")}.
            {selected.original_official_submitted_on
              ? ` Original date: ${selected.original_official_submitted_on}.`
              : ""}
            {selected.original_date_verified
              ? ` Program Head verification completed on ${
                  selected.official_date_verified_at ?? "unknown date"
                }. INC deadline: ${
                  selected.inc_completion_deadline_on ??
                  "Unavailable — review required"
                }.`
              : selected.original_official_submitted_on
                ? " Awaiting Program Head verification. INC deadline not established."
                : ""}
          </p>
        ) : selected && !rosterReady ? null : selected ? (
          <>
            <div className="registrar-grade-change-sheet-fields">
              <label className="registrar-grade-change-sheet-field">
                <span>Original submission date</span>

                <input
                  type="date"
                  required
                  value={date}
                  disabled={busy}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>

              <label className="registrar-grade-change-sheet-field">
                <span>Official source reference (8–255 characters)</span>

                <input
                  type="text"
                  required
                  minLength={8}
                  maxLength={255}
                  value={reference}
                  disabled={busy}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="Enter the actual document or filing reference"
                />
              </label>
            </div>

            <label className="registrar-grade-change-sheet-check">
              <input
                type="checkbox"
                checked={evidenceChecked}
                disabled={busy}
                onChange={(event) => setEvidenceChecked(event.target.checked)}
              />

              <span>
                I checked the original submitted grading-sheet evidence and
                confirm these details match it.
              </span>
            </label>

            <div className="registrar-grade-change-sheet-actions">
              <small>
                This records evidence only. It does not verify the date,
                establish the INC deadline, or finalize grades.
              </small>

              <button
                type="submit"
                className="registrar-grade-change-process"
                disabled={!canRecord}
              >
                <FileCheck2 size={15} />

                {busy ? "Checking…" : "Record Original Date"}
              </button>
            </div>
          </>
        ) : !loading && !listError ? (
          <p className="registrar-grade-change-sheet-message">
            No initialized gradebooks are available for original-date recording.
          </p>
        ) : null}
      </form>
    </section>
  );
}

// Modern INC Conversion

interface ModernIncConversionRow {
  submission_id: string;
  grade_id: number;
  claim_id: string;
  claim_version: number;
  current_claim_version: number;
  claim_verification_status: string;
  sheet_id: string;
  sheet_status: string;
  sheet_record_version: number;
  roster_snapshot_id: string;
  offering_id: number;
  enrollment_subject_id: number;
  student_number: string;
  student_name: string;
  subject_code: string;
  subject_name: string;
  submission_status: string;
  submission_record_version: number;
  reviewed_at: string | null;
  review_remarks: string | null;
  grade_status: string;
  current_grading_outcome: string;
  current_final_rating: string | null;
  conversion_state: "NOT_APPROVED" | "REQUIRES_PREFLIGHT" | "AMENDED";
  amendment: {
    amendment_id: string;
    sheet_revision_number: number;
    applied_at: string;
  } | null;
}

interface ModernIncConversionListResponse {
  success: boolean;
  read_only: boolean;
  listing_scope: "ALL_MODERN_INC_SUBMISSIONS";
  submissions: ModernIncConversionRow[];
  message?: string;
}

interface ModernIncConversionResult {
  success: boolean;
  dry_run: boolean;
  persisted: boolean;
  submission_id: string;
  claim_id: string;
  grade_id: number;
  sheet_id: string;
  roster_snapshot_id: string;
  amendment_id: string | null;
  sheet_revision_number: number;
  proposed_official_grade: {
    midterm_grade: string | number;
    final_grade: string | number;
    overall_percentage: string | number;
    final_rating: string | number;
    remarks: string;
  };
  original_snapshot_unchanged: boolean;
  official_sheet_unchanged: boolean;
  progression_review_required: boolean;
  conversion_validated: boolean;
  grade_conversion_performed: boolean;
  official_grade_unchanged: boolean;
  code?: string;
  message?: string;
}

function ModernIncConversionQueue({
  onProcessed,
}: {
  onProcessed: () => void;
}) {
  const navigate = useNavigate();

  const endpoint = apiUrl(
    "/api/registrar/gradebook/inc-completion-conversions/modern-submissions",
  );

  const [rows, setRows] = useState<ModernIncConversionRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [remarks, setRemarks] = useState("");
  const [processing, setProcessing] = useState(false);

  const [notice, setNotice] = useState<ActionNotice | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError("");

    const load = async () => {
      try {
        const response = await authService.authFetch(endpoint, {
          method: "GET",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        const data =
          await readJsonResponse<ModernIncConversionListResponse>(response);

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
          data.listing_scope !== "ALL_MODERN_INC_SUBMISSIONS" ||
          !Array.isArray(data.submissions)
        ) {
          throw new Error(
            data.message || "Could not load modern INC submissions.",
          );
        }

        setRows(data.submissions);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setRows([]);

          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load modern INC submissions.",
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
  }, [endpoint, navigate, reloadKey]);

  const selected = rows.find((item) => item.submission_id === selectedId);

  const canProcess = (row: ModernIncConversionRow) =>
    row.conversion_state === "REQUIRES_PREFLIGHT" &&
    row.amendment === null &&
    row.submission_status === "APPROVED" &&
    row.submission_record_version === 2 &&
    row.claim_verification_status === "VERIFIED_TIMELY" &&
    Number.isSafeInteger(row.current_claim_version) &&
    row.current_claim_version >= 2 &&
    row.claim_version === row.current_claim_version &&
    row.sheet_status === "FINALIZED" &&
    Number.isSafeInteger(row.sheet_record_version) &&
    row.sheet_record_version > 0 &&
    row.grade_status === "Approved" &&
    row.current_grading_outcome === "INCOMPLETE" &&
    Number(row.current_final_rating) === 4;

  const validRemarks =
    remarks.trim().length >= 20 &&
    remarks.trim().length <= 1000 &&
    !Array.from(remarks).some((character) => {
      const code = character.charCodeAt(0);

      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    });

  const process = async () => {
    if (
      !selected ||
      !canProcess(selected) ||
      !validRemarks ||
      processing ||
      loading
    ) {
      return;
    }

    setProcessing(true);
    setNotice(null);

    const request = async (dryRun: boolean) => {
      const response = await authService.authFetch(
        `${endpoint}/${selected.submission_id}/process`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            expected_record_version: selected.submission_record_version,

            expected_claim_id: selected.claim_id,

            expected_claim_version: selected.current_claim_version,

            expected_sheet_version: selected.sheet_record_version,

            expected_grade_id: selected.grade_id,

            registrar_remarks: remarks.trim(),

            confirm_conversion: true,
            dry_run: dryRun,
          }),
        },
      );

      const data = await readJsonResponse<ModernIncConversionResult>(response);

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
        data.submission_id !== selected.submission_id ||
        data.claim_id !== selected.claim_id ||
        data.grade_id !== selected.grade_id ||
        data.sheet_id !== selected.sheet_id ||
        data.roster_snapshot_id !== selected.roster_snapshot_id ||
        data.original_snapshot_unchanged !== true ||
        data.official_sheet_unchanged !== true ||
        data.progression_review_required !== true ||
        data.conversion_validated !== true ||
        data.grade_conversion_performed !== !dryRun ||
        data.official_grade_unchanged !== dryRun ||
        (dryRun && data.amendment_id !== null) ||
        (!dryRun && !data.amendment_id) ||
        !data.proposed_official_grade
      ) {
        throw new Error(
          [data.code, data.message].filter(Boolean).join(": ") ||
            "The modern INC conversion was not confirmed.",
        );
      }

      return data;
    };

    try {
      const response = await authService.authFetch(
        `${endpoint}/${encodeURIComponent(selected.submission_id)}/readiness`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
      );

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }

      const readiness = await readJsonResponse<{
        success: boolean;
        read_only: boolean;
        preflight_only: boolean;
        submission_id: string;
        expected_record_version: number;
        expected_claim_id: string;
        expected_claim_version: number;
        expected_sheet_version: number;
        expected_grade_id: number;
        preflight_passed: boolean;
        requires_conversion_dry_run: boolean;

        blockers: {
          code: string;
          message: string;
        }[];

        message?: string;
      }>(response);

      if (!response.ok || !readiness.success) {
        throw new Error(
          readiness.message || "Could not check conversion readiness.",
        );
      }

      if (
        readiness.read_only !== true ||
        readiness.preflight_only !== true ||
        readiness.requires_conversion_dry_run !== true ||
        !Array.isArray(readiness.blockers) ||
        readiness.preflight_passed !== true ||
        readiness.blockers.length !== 0
      ) {
        throw new Error(
          readiness.blockers?.map((blocker) => blocker.message).join("; ") ||
            "The replacement is not ready for conversion.",
        );
      }

      if (
        readiness.submission_id !== selected.submission_id ||
        readiness.expected_record_version !==
          selected.submission_record_version ||
        readiness.expected_claim_id !== selected.claim_id ||
        readiness.expected_claim_version !== selected.current_claim_version ||
        readiness.expected_sheet_version !== selected.sheet_record_version ||
        readiness.expected_grade_id !== selected.grade_id
      ) {
        throw new Error(
          "The conversion record changed. Select it again after reloading.",
        );
      }

      const preview = await request(true);

      const grade = preview.proposed_official_grade;

      const confirmed = window.confirm(
        `Process approved INC completion for ${selected.student_name}?\n\n` +
          `${selected.subject_code} · Grade #${selected.grade_id}\n` +
          `Midterm: ${grade.midterm_grade}%\n` +
          `Final Term: ${grade.final_grade}%\n` +
          `Semester: ${grade.overall_percentage}%\n` +
          `Numeric equivalent: ${grade.final_rating} (${grade.remarks})\n\n` +
          "This updates the official INC to a numeric result and records an " +
          "audited sheet amendment. The original finalized snapshot remains unchanged.",
      );

      if (!confirmed) return;

      const saved = await request(false);

      setNotice({
        type: "success",
        message:
          `Conversion completed. Amendment #${saved.amendment_id}, ` +
          `revision ${saved.sheet_revision_number}. ` +
          "Progression review is required.",
      });

      setSelectedId(null);
      setRemarks("");

      setReloadKey((value) => value + 1);
      onProcessed();
    } catch (caught) {
      setNotice({
        type: "error",
        message:
          caught instanceof Error
            ? caught.message
            : "The modern INC conversion could not be processed.",
      });

      setSelectedId(null);
      setReloadKey((value) => value + 1);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <section className="registrar-grade-change-panel">
      <header className="registrar-grade-change-panel-heading">
        <div>
          <span>Modern Grading</span>

          <h2>INC Completion Conversions</h2>

          <p>
            Review approved replacement submissions and existing official-sheet
            amendments. Conversion requires server authorization and validation.
          </p>
        </div>

        <strong className="registrar-grade-change-count">
          {loading ? "…" : rows.length} submissions
        </strong>
      </header>

      <div className="registrar-grade-change-sheet-form">
        {error && (
          <p
            role="alert"
            className="registrar-grade-change-sheet-message error"
          >
            {error}
          </p>
        )}

        {notice && (
          <p
            role={notice.type === "error" ? "alert" : "status"}
            className={`registrar-grade-change-sheet-message ${notice.type}`}
          >
            {notice.message}
          </p>
        )}

        {loading && <p>Loading modern INC submissions...</p>}

        {!loading && !error && rows.length === 0 && (
          <p>No modern INC replacement submissions are available.</p>
        )}
      </div>

      {!loading && !error && rows.length > 0 && (
        <div className="registrar-grade-change-request-list">
          {rows.map((row) => (
            <article
              key={row.submission_id}
              className="registrar-grade-change-card"
            >
              <header className="registrar-grade-change-card-header">
                <div className="registrar-grade-change-student">
                  <div>
                    <strong>{row.student_name}</strong>

                    <p>
                      {row.student_number} · {row.subject_code} ·{" "}
                      {row.subject_name}
                    </p>

                    <small>
                      Replacement #{row.submission_id} · Grade #{row.grade_id}
                    </small>
                  </div>
                </div>

                <span
                  className={`registrar-grade-change-status ${
                    row.conversion_state === "AMENDED"
                      ? "registrar-grade-change-status--completed"
                      : "registrar-grade-change-status--pending"
                  }`}
                >
                  {row.conversion_state.replaceAll("_", " ")}
                </span>
              </header>

              <div className="registrar-grade-change-sheet-form">
                <p>
                  Submission: {row.submission_status} · Claim:{" "}
                  {row.claim_verification_status}
                  {" · "}
                  Sheet: {row.sheet_status}
                </p>

                {row.review_remarks && (
                  <p>Program Head review: {row.review_remarks}</p>
                )}

                {row.amendment && (
                  <p role="status">
                    Amendment #{row.amendment.amendment_id}
                    {" · "}
                    Sheet revision {row.amendment.sheet_revision_number}
                    {" · "}
                    Applied {row.amendment.applied_at}
                  </p>
                )}

                {canProcess(row) && (
                  <button
                    type="button"
                    className="registrar-grade-change-process"
                    disabled={processing}
                    onClick={() => {
                      setSelectedId((current) =>
                        current === row.submission_id
                          ? null
                          : row.submission_id,
                      );

                      setRemarks("");
                      setNotice(null);
                    }}
                  >
                    <FileCheck2 size={14} />

                    {selectedId === row.submission_id
                      ? "Cancel"
                      : "Process INC Conversion"}
                  </button>
                )}

                {selectedId === row.submission_id && canProcess(row) && (
                  <form
                    className="registrar-grade-change-sheet-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void process();
                    }}
                  >
                    <label className="registrar-grade-change-modal-field">
                      <span>
                        Registrar conversion remarks (20–1000 characters)
                      </span>

                      <textarea
                        rows={4}
                        maxLength={1000}
                        required
                        value={remarks}
                        disabled={processing}
                        onChange={(event) => setRemarks(event.target.value)}
                        placeholder="Describe the verified evidence and authorization for this INC conversion"
                      />
                    </label>

                    <button
                      type="submit"
                      className="registrar-grade-change-process"
                      disabled={!validRemarks || processing}
                    >
                      <ShieldCheck size={14} />

                      {processing
                        ? "Validating…"
                        : "Validate & Process Conversion"}
                    </button>
                  </form>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
export default function GradeChangeRequestsR() {
  const navigate = useNavigate();
  const session = authService.getSession();
  const token = authService.getToken();
  const authenticated = Boolean(session && token);
  const userRole = session?.role;

  const [statusFilter, setStatusFilter] = useState<RegistrarRequestStatus>(
    "For Registrar Processing",
  );
  const [requests, setRequests] = useState<RegistrarGradeChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [processRequest, setProcessRequest] =
    useState<RegistrarGradeChangeRequest | null>(null);
  const [registrarRemarks, setRegistrarRemarks] = useState("");
  const [processError, setProcessError] = useState("");
  const [processingId, setProcessingId] = useState<number | null>(null);

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Registrar" && session) {
      navigate(authService.getDashboardRoute(session.role), { replace: true });
    }
  }, [authenticated, userRole, session, navigate]);

  const loadRequests = useCallback(
    async (signal?: AbortSignal) => {
      try {
        if (refreshKey === 0) setLoading(true);
        else setRefreshing(true);

        setError("");

        const query =
          statusFilter === "For Registrar Processing"
            ? ""
            : `?status=${encodeURIComponent(statusFilter)}`;

        const response = await authService.authFetch(
          `${API_BASE_URL}${query}`,
          {
            method: "GET",
            headers: { Accept: "application/json" },
            signal,
          },
        );

        const data = await readJsonResponse<QueueResponse>(response);

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          throw new Error(data.message || "Registrar access is required.");
        }

        if (!response.ok || data.success === false) {
          throw new Error(
            data.message ||
              data.error ||
              "Unable to load grade change requests.",
          );
        }

        const rawRequests = Array.isArray(data.requests)
          ? data.requests
          : Array.isArray(data.grade_change_requests)
            ? data.grade_change_requests
            : [];

        setRequests(
          rawRequests
            .map(normalizeRequest)
            .filter(
              (request): request is RegistrarGradeChangeRequest =>
                request !== null,
            ),
        );
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("REGISTRAR GRADE CHANGE LOAD ERROR:", requestError);
        setRequests([]);
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load grade change requests.",
        );
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [navigate, refreshKey, statusFilter],
  );

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") return;

    const controller = new AbortController();
    void loadRequests(controller.signal);

    return () => controller.abort();
  }, [authenticated, userRole, loadRequests]);

  const filteredRequests = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return requests;

    return requests.filter((request) =>
      [
        request.student.student_number,
        request.student.full_name,
        request.class.subject.subject_code,
        request.class.subject.subject_name,
        request.class.section.section_name,
        request.faculty.faculty_name,
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [requests, search]);

  const openProcessModal = (request: RegistrarGradeChangeRequest) => {
    if (request.status !== "For Registrar Processing") return;

    setProcessRequest(request);
    setRegistrarRemarks(
      "Approved INC completion was verified and posted to the official academic record.",
    );
    setProcessError("");
    setNotice(null);
  };

  const closeProcessModal = () => {
    if (processingId !== null) return;
    setProcessRequest(null);
    setRegistrarRemarks("");
    setProcessError("");
  };

  const processApprovedRequest = async () => {
    if (!processRequest) return;

    const remarks = registrarRemarks.trim();
    if (!remarks) {
      setProcessError("Registrar remarks are required.");
      return;
    }

    if (remarks.length > 1000) {
      setProcessError("Registrar remarks must not exceed 1000 characters.");
      return;
    }

    try {
      const requestId = processRequest.grade_change_request_id;
      setProcessingId(requestId);
      setProcessError("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${requestId}/process`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ registrar_remarks: remarks }),
        },
      );

      const data = await readJsonResponse<ProcessResponse>(response);

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }

      if (!response.ok || data.success === false) {
        throw new Error(
          data.message ||
            data.error ||
            "Unable to process grade change request.",
        );
      }

      setNotice({
        type: "success",
        message:
          data.message ||
          "INC completion grade change was posted to the official academic record.",
      });

      setProcessRequest(null);
      setRegistrarRemarks("");
      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      console.error("REGISTRAR GRADE CHANGE PROCESS ERROR:", requestError);
      setProcessError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to process grade change request.",
      );
    } finally {
      setProcessingId(null);
    }
  };

  useEffect(() => {
    if (!processRequest) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && processingId === null) {
        closeProcessModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [processRequest, processingId]);

  if (!authenticated || userRole !== "Registrar") return null;
  return (
    <DashboardLayout>
      <main
        className="registrar-grade-change-page"
        aria-busy={loading || refreshing}
      >
        <section className="registrar-grade-change-hero">
          <div className="registrar-grade-change-hero-copy">
            <div className="registrar-grade-change-eyebrow">
              <span className="registrar-grade-change-eyebrow-icon">
                <FileCheck2 size={16} />
              </span>
              REGISTRAR · STUDENT RECORDS
            </div>
            <h1>INC Completion Processing</h1>
            <p>
              Verify Program Head-approved INC completion requests and post the
              approved values to the student's official academic record.
              Registrar processing does not recalculate the grade.
            </p>
          </div>
          <div className="registrar-grade-change-hero-actions">
            <a
              href="#registrar-official-sheet-recording"
              className="registrar-grade-change-back registrar-grade-change-jump"
            >
              <FileCheck2 size={16} aria-hidden="true" />
              Record Official Sheet
            </a>

            <button
              type="button"
              className="registrar-grade-change-back"
              onClick={() => navigate("/registrar/dashboard")}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Back to Registrar
            </button>
          </div>
        </section>

        {notice && (
          <section
            className={`registrar-grade-change-notice ${notice.type}`}
            role="status"
          >
            <span className="registrar-grade-change-notice-icon">
              {notice.type === "success" ? (
                <CheckCircle2 size={18} />
              ) : (
                <AlertCircle size={18} />
              )}
            </span>
            <div>
              <strong>
                {notice.type === "success"
                  ? "Official record updated"
                  : "Action failed"}
              </strong>
              <p>{notice.message}</p>
            </div>
          </section>
        )}

        <section
          className="registrar-grade-change-stats"
          aria-label="Grade change request summary"
        >
          <article className="registrar-grade-change-stat-card registrar-grade-change-stat-card--primary">
            <span className="registrar-grade-change-stat-icon registrar-grade-change-stat-icon--primary">
              <ShieldCheck size={19} />
            </span>
            <div>
              <small>Current Queue</small>
              <strong>{loading ? "…" : requests.length}</strong>
              <p>{statusFilter}</p>
            </div>
          </article>
          <article className="registrar-grade-change-stat-card">
            <span className="registrar-grade-change-stat-icon">
              {statusFilter === "Completed" ? (
                <History size={19} />
              ) : (
                <FilePenLine size={19} />
              )}
            </span>
            <div>
              <small>Queue View</small>
              <strong>
                {statusFilter === "Completed" ? "History" : "Ready"}
              </strong>
              <p>
                {statusFilter === "Completed"
                  ? "Processed grade changes"
                  : "Program Head approved"}
              </p>
            </div>
          </article>
          <article className="registrar-grade-change-stat-card">
            <span className="registrar-grade-change-stat-icon">
              <BadgeCheck size={19} />
            </span>
            <div>
              <small>Registrar Rule</small>
              <strong>Post</strong>
              <p>No grade recalculation</p>
            </div>
          </article>
        </section>
        <OriginalOfficialSheetRecorder />
        <ModernIncConversionQueue
          onProcessed={() => setRefreshKey((current) => current + 1)}
        />
        <section className="registrar-grade-change-panel">
          <header className="registrar-grade-change-panel-heading">
            <div>
              <span>Official Record Queue</span>
              <h2>Grade Change Requests</h2>
              <p>
                Review approved INC completion details before posting the exact
                proposed grade to the official student record.
              </p>
            </div>
            <strong className="registrar-grade-change-count">
              {loading ? "…" : filteredRequests.length}{" "}
              {!loading &&
                (filteredRequests.length === 1 ? "request" : "requests")}
            </strong>
          </header>

          <div className="registrar-grade-change-toolbar">
            <label className="registrar-grade-change-search">
              <span>Search Requests</span>
              <div>
                <Search size={15} />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Student, subject, section, or Faculty..."
                />
              </div>
            </label>
            <label className="registrar-grade-change-filter-field">
              <span>Request Status</span>
              <select
                value={statusFilter}
                onChange={(event) => {
                  setSearch("");
                  setNotice(null);
                  setStatusFilter(event.target.value as RegistrarRequestStatus);
                  setRefreshKey((current) => current + 1);
                }}
              >
                <option value="For Registrar Processing">
                  For Registrar Processing
                </option>
                <option value="Completed">Completed History</option>
              </select>
            </label>
            <button
              type="button"
              className="registrar-grade-change-clear"
              onClick={() => setSearch("")}
              disabled={!search}
            >
              <RotateCcw size={14} />
              Clear Search
            </button>
          </div>

          {error && !loading && (
            <div
              className="registrar-grade-change-state registrar-grade-change-state--error"
              role="alert"
            >
              <span className="registrar-grade-change-state-icon">
                <AlertCircle size={21} />
              </span>
              <div>
                <strong>Grade change requests could not be loaded</strong>
                <p>{error}</p>
              </div>
              <button
                type="button"
                onClick={() => setRefreshKey((current) => current + 1)}
              >
                Try Again
              </button>
            </div>
          )}

          {loading && (
            <div className="registrar-grade-change-state registrar-grade-change-state--loading">
              <div className="registrar-grade-change-spinner" />
              <div>
                <strong>Loading grade change requests</strong>
                <p>Retrieving approved INC completion records...</p>
              </div>
            </div>
          )}

          {!loading && !error && filteredRequests.length === 0 && (
            <div className="registrar-grade-change-state registrar-grade-change-state--empty">
              <span className="registrar-grade-change-state-icon">
                {statusFilter === "Completed" ? (
                  <History size={24} />
                ) : (
                  <CheckCircle2 size={24} />
                )}
              </span>
              <div>
                <strong>
                  {statusFilter === "Completed"
                    ? "No completed INC grade changes found"
                    : "No requests waiting for Registrar processing"}
                </strong>
                <p>
                  {requests.length === 0
                    ? statusFilter === "Completed"
                      ? "Completed INC completion transactions will appear here."
                      : "Program Head-approved INC completion requests will appear here."
                    : "No requests match your current search."}
                </p>
              </div>
            </div>
          )}

          {!loading && !error && filteredRequests.length > 0 && (
            <div className="registrar-grade-change-request-list">
              {filteredRequests.map((request) => (
                <article
                  className="registrar-grade-change-card"
                  key={request.grade_change_request_id}
                >
                  <header className="registrar-grade-change-card-header">
                    <div className="registrar-grade-change-student">
                      <span className="registrar-grade-change-student-icon">
                        <GraduationCap size={18} />
                      </span>
                      <div>
                        <strong>{request.student.full_name}</strong>
                        <p>{request.student.student_number}</p>
                        <small>
                          Request #{request.grade_change_request_id} · Grade #
                          {request.grade_id}
                        </small>
                      </div>
                    </div>
                    <span
                      className={`registrar-grade-change-status ${
                        request.status === "Completed"
                          ? "registrar-grade-change-status--completed"
                          : "registrar-grade-change-status--pending"
                      }`}
                    >
                      <span aria-hidden="true" />
                      {request.status}
                    </span>
                  </header>

                  <div className="registrar-grade-change-context">
                    <div className="registrar-grade-change-context-item">
                      <span className="registrar-grade-change-context-icon">
                        <BookOpenCheck size={15} />
                      </span>
                      <div>
                        <small>Subject</small>
                        <strong>{request.class.subject.subject_code}</strong>
                        <p>{request.class.subject.subject_name}</p>
                      </div>
                    </div>
                    <div className="registrar-grade-change-context-item">
                      <span className="registrar-grade-change-context-icon">
                        <UserRound size={15} />
                      </span>
                      <div>
                        <small>Faculty</small>
                        <strong>{request.faculty.faculty_name}</strong>
                        <p>
                          {request.faculty.employee_number || "Faculty request"}
                        </p>
                      </div>
                    </div>
                    <div className="registrar-grade-change-context-item">
                      <span className="registrar-grade-change-context-icon">
                        <Clock3 size={15} />
                      </span>
                      <div>
                        <small>Program Head Review</small>
                        <strong>
                          {request.reviewed_by_username || "Program Head"}
                        </strong>
                        <p>{formatDateTime(request.reviewed_at)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="registrar-grade-change-comparison">
                    <section className="registrar-grade-change-grade-block registrar-grade-change-grade-block--original">
                      <header>
                        <span>
                          <ShieldCheck size={16} />
                        </span>
                        <div>
                          <small>Original Request Snapshot</small>
                          <strong>Approved INC</strong>
                        </div>
                      </header>
                      <div className="registrar-grade-change-grade-grid">
                        <div>
                          <small>Midterm</small>
                          <strong>
                            {formatGrade(request.original_grade.midterm_grade)}
                          </strong>
                        </div>
                        <div>
                          <small>Final</small>
                          <strong>
                            {formatGrade(request.original_grade.final_grade)}
                          </strong>
                        </div>
                        <div>
                          <small>Overall</small>
                          <strong>
                            {formatPercentage(
                              request.original_grade.overall_percentage,
                            )}
                          </strong>
                        </div>
                        <div>
                          <small>Rating</small>
                          <strong>
                            {formatGrade(request.original_grade.final_rating)}
                          </strong>
                        </div>
                        <div>
                          <small>Outcome</small>
                          <strong>
                            {outcomeLabel(
                              request.original_grade.grading_outcome,
                            )}
                          </strong>
                        </div>
                        <div>
                          <small>Remarks</small>
                          <strong>
                            {request.original_grade.remarks || "—"}
                          </strong>
                        </div>
                      </div>
                      <div className="registrar-grade-change-reason">
                        <small>INC Reason</small>
                        <p>
                          {request.original_grade.outcome_reason ||
                            "No reason recorded."}
                        </p>
                      </div>
                    </section>

                    <section className="registrar-grade-change-grade-block registrar-grade-change-grade-block--approved">
                      <header>
                        <span>
                          <FilePenLine size={16} />
                        </span>
                        <div>
                          <small>Program Head-Approved Proposal</small>
                          <strong>Ready for Posting</strong>
                        </div>
                      </header>
                      <div className="registrar-grade-change-grade-grid">
                        <div>
                          <small>Midterm</small>
                          <strong>
                            {formatGrade(request.proposed_grade.midterm_grade)}
                          </strong>
                        </div>
                        <div>
                          <small>Final</small>
                          <strong>
                            {formatGrade(request.proposed_grade.final_grade)}
                          </strong>
                        </div>
                        <div>
                          <small>Overall</small>
                          <strong>
                            {formatPercentage(
                              request.proposed_grade.overall_percentage,
                            )}
                          </strong>
                        </div>
                        <div>
                          <small>Rating</small>
                          <strong>
                            {formatGrade(request.proposed_grade.final_rating)}
                          </strong>
                        </div>
                        <div>
                          <small>Outcome</small>
                          <strong>
                            {outcomeLabel(
                              request.proposed_grade.grading_outcome,
                            )}
                          </strong>
                        </div>
                        <div>
                          <small>Remarks</small>
                          <strong>
                            {request.proposed_grade.remarks || "—"}
                          </strong>
                        </div>
                      </div>
                      <div className="registrar-grade-change-reason">
                        <small>Faculty Completion Remarks</small>
                        <p>{request.completion_remarks}</p>
                      </div>
                    </section>
                  </div>

                  <div className="registrar-grade-change-review-grid">
                    <div className="registrar-grade-change-review-note">
                      <span>
                        <ShieldCheck size={15} />
                      </span>
                      <div>
                        <strong>Current Official Grade Verification</strong>
                        <p>
                          Database record now shows{" "}
                          <b>
                            {formatGrade(
                              request.current_official_grade.final_rating,
                            )}
                            {" · "}
                            {request.current_official_grade.remarks || "—"}
                          </b>
                          {" · "}
                          {formatPercentage(
                            request.current_official_grade.overall_percentage,
                          )}
                          {" · "}
                          {request.current_official_grade.grade_status ||
                            "status unavailable"}
                          .
                        </p>
                      </div>
                    </div>
                    <div className="registrar-grade-change-review-note">
                      <span>
                        <CheckCircle2 size={15} />
                      </span>
                      <div>
                        <strong>Program Head Review</strong>
                        <p>
                          {request.review_remarks ||
                            "No review remarks recorded."}
                        </p>
                      </div>
                    </div>
                  </div>

                  {request.status === "Completed" && (
                    <div className="registrar-grade-change-completed-note">
                      <span>
                        <BadgeCheck size={15} />
                      </span>
                      <div>
                        <strong>
                          Processed by{" "}
                          {request.processed_by_username || "Registrar"}
                        </strong>
                        <p>
                          {request.registrar_remarks ||
                            "Official grade change completed."}
                        </p>
                        <small>{formatDateTime(request.processed_at)}</small>
                      </div>
                    </div>
                  )}

                  <footer className="registrar-grade-change-card-footer">
                    <div>
                      <small>Section</small>
                      <strong>{request.class.section.section_name}</strong>
                    </div>
                    {request.status === "For Registrar Processing" ? (
                      <button
                        type="button"
                        className="registrar-grade-change-process"
                        onClick={() => openProcessModal(request)}
                        disabled={
                          processingId === request.grade_change_request_id
                        }
                      >
                        <FileCheck2 size={14} />
                        Process Official Grade Change
                      </button>
                    ) : (
                      <span className="registrar-grade-change-complete-label">
                        <BadgeCheck size={14} />
                        Official grade change completed
                      </span>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          )}
        </section>

        {processRequest && (
          <div
            className="registrar-grade-change-modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeProcessModal();
            }}
          >
            <section
              className="registrar-grade-change-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="registrar-grade-change-modal-title"
            >
              <header className="registrar-grade-change-modal-header">
                <div>
                  <span className="registrar-grade-change-modal-icon">
                    <FileCheck2 size={18} />
                  </span>
                  <div>
                    <small>Registrar Processing</small>
                    <h2 id="registrar-grade-change-modal-title">
                      Post Approved INC Completion
                    </h2>
                    <p>
                      Replace the current Approved INC with the exact Program
                      Head-approved numeric grade and update the enrollment
                      subject result.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="registrar-grade-change-modal-close"
                  onClick={closeProcessModal}
                  disabled={processingId !== null}
                  aria-label="Close processing modal"
                >
                  <X size={18} />
                </button>
              </header>

              <div className="registrar-grade-change-modal-summary">
                <div>
                  <small>Student</small>
                  <strong>{processRequest.student.full_name}</strong>
                  <span>{processRequest.student.student_number}</span>
                </div>
                <div>
                  <small>Subject</small>
                  <strong>{processRequest.class.subject.subject_code}</strong>
                  <span>{processRequest.class.subject.subject_name}</span>
                </div>
                <div>
                  <small>Approved Result</small>
                  <strong>
                    {formatGrade(processRequest.proposed_grade.final_rating)} —{" "}
                    {processRequest.proposed_grade.remarks || "—"}
                  </strong>
                  <span>
                    {formatPercentage(
                      processRequest.proposed_grade.overall_percentage,
                    )}
                  </span>
                </div>
              </div>

              <div className="registrar-grade-change-modal-warning">
                <ShieldCheck size={17} />
                <p>
                  Registrar does not change or recalculate the approved
                  proposal. Processing posts the existing approved values to the
                  official grade record and records the transaction in the audit
                  trail.
                </p>
              </div>

              <div className="registrar-grade-change-modal-field">
                <div>
                  <label htmlFor="registrar-grade-change-remarks">
                    Registrar Remarks
                  </label>
                  <span>{registrarRemarks.length}/1000</span>
                </div>
                <textarea
                  id="registrar-grade-change-remarks"
                  value={registrarRemarks}
                  onChange={(event) => setRegistrarRemarks(event.target.value)}
                  maxLength={1000}
                  rows={5}
                  disabled={processingId !== null}
                />
                {processError && (
                  <div
                    className="registrar-grade-change-modal-error"
                    role="alert"
                  >
                    <AlertCircle size={15} />
                    {processError}
                  </div>
                )}
              </div>

              <footer>
                <button
                  type="button"
                  className="cancel"
                  onClick={closeProcessModal}
                  disabled={processingId !== null}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="confirm"
                  onClick={() => void processApprovedRequest()}
                  disabled={processingId !== null}
                >
                  <FileCheck2 size={14} />
                  {processingId !== null
                    ? "Processing..."
                    : "Post Official Grade"}
                </button>
              </footer>
            </section>
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
