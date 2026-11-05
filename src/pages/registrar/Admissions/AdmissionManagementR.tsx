import { useCallback, useEffect, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileSearch,
  GraduationCap,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { apiUrl } from "../../../services/api";
import { authService } from "../../../services/auth.service";
import "../../../styles/RegistrarStudentlist.css";
import "../../../styles/AdmissionManagementR.css";

type AdmissionStatus =
  | "Submitted"
  | "Needs Correction"
  | "Verified"
  | "Rejected"
  | "Imported";

type ReviewDecision = "Verified" | "Needs Correction" | "Rejected";

interface AdmissionApplicant {
  applicationId: number;
  applicationReference: string;
  applicationStatus: AdmissionStatus;
  firstName: string;
  middleName: string | null;
  lastName: string;
  email: string;
  contactNumber: string | null;
  applicantType: string | null;
  preferredCourseId: number | null;
  courseCode: string | null;
  courseName: string | null;
  admissionPeriodId: number;
  periodTitle: string;
  submittedAt: string | null;
  version: number;
  studentId: number | null;
  importedAt: string | null;
}

interface AdmissionDetails extends AdmissionApplicant {
  suffix: string | null;
  birthDate: string | null;
  gender: string | null;
  houseNo: string | null;
  street: string | null;
  barangay: string | null;
  city: string | null;
  province: string | null;
  zipCode: string | null;
  previousSchool: string | null;
  academicYear: string;
  privacyAccepted: boolean;
  privacyAcceptedAt: string | null;
}

interface QueueResponse {
  success: boolean;
  message?: string;
  applications: AdmissionApplicant[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface DetailsResponse {
  success: boolean;
  application: AdmissionDetails;
}

interface DuplicateResponse {
  success: boolean;
  hasPotentialDuplicate: boolean;
  existingStudents: Array<{
    studentId: number;
    studentNumber: string;
    firstName: string;
    lastName: string;
    isArchived: boolean;
  }>;
  existingAccounts: Array<{ userId: number; email: string }>;
  message: string;
}

interface CurriculumOption {
  curriculum_id: number;
  course_id: number;
  curriculum_name: string;
  effective_year: number | null;
  is_active: number;
}

interface SemesterOption {
  semester_id: number;
  semester_name: string;
}

interface BulkResult {
  success: boolean;
  applicationId: number;
  applicationStatus?: string;
  studentId?: number;
  studentNumber?: string;
  sectionName?: string;
  activationEmailStatus?: string;
  code?: string;
  message?: string;
}

interface BulkResponse {
  success: boolean;
  allImported: boolean;
  summary: { requested: number; imported: number; failed: number };
  results: BulkResult[];
  message: string;
}

interface InvitationResponse {
  success: boolean;
  applicationId: number;
  studentNumber: string;
  activationEmailStatus: string;
  message: string;
}

function invitationLabel(value: string | undefined): string {
  switch (value) {
    case "Sent":
      return "Accepted by SMTP";
    case "AlreadySent":
      return "Invitation already sent";
    case "Failed":
      return "Email delivery failed";
    case "Disabled":
      return "Email invitations disabled";
    case "AlreadyActivated":
      return "Account already activated";
    default:
      return "Not reported by backend";
  }
}

const ADMISSION_URL = apiUrl("/api/admission-applications");
const CURRICULUM_URL = apiUrl("/api/registrar/curriculums");
const ENROLLMENT_PERIOD_URL = apiUrl("/api/registrar/enrollments/period");

const STATUS_OPTIONS: AdmissionStatus[] = [
  "Submitted",
  "Needs Correction",
  "Verified",
  "Rejected",
  "Imported",
];

function displayDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function fullName(person: {
  firstName: string;
  middleName?: string | null;
  lastName: string;
}) {
  return [person.firstName, person.middleName, person.lastName]
    .filter(Boolean)
    .join(" ");
}

async function jsonRequest<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);

  headers.set("Accept", "application/json");

  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await authService.authFetch(url, {
    ...options,
    headers,
  });

  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    throw new Error(
      `Unexpected response from the server (${response.status}).`,
    );
  }

  const data: unknown = await response.json();

  if (!data || typeof data !== "object") {
    throw new Error("Invalid server response.");
  }

  const result = data as {
    success?: boolean;
    message?: string;
    error?: string;
  };

  if (!response.ok || result.success === false) {
    throw new Error(
      result.message || result.error || `Request failed (${response.status}).`,
    );
  }

  return data as T;
}

export default function AdmissionManagementR() {
  const navigate = useNavigate();
  const session = authService.getSession();
  const authenticated = Boolean(session && authService.getToken());
  const allowed = authenticated && session?.role === "Registrar";

  const [status, setStatus] = useState<AdmissionStatus>("Submitted");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [applications, setApplications] = useState<AdmissionApplicant[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [detail, setDetail] = useState<AdmissionDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [duplicates, setDuplicates] = useState<DuplicateResponse | null>(null);
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [decision, setDecision] = useState<ReviewDecision>("Verified");
  const [reviewNotes, setReviewNotes] = useState("");
  const [flags, setFlags] = useState({
    inPersonConfirmed: false,
    identityChecked: false,
    originalDocumentsChecked: false,
    academicRecordsChecked: false,
  });
  const [reviewBusy, setReviewBusy] = useState(false);

  const [batchOpen, setBatchOpen] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState("");
  const [batchResults, setBatchResults] = useState<BulkResponse | null>(null);
  const [semesters, setSemesters] = useState<SemesterOption[]>([]);
  const [semesterId, setSemesterId] = useState(0);
  const [curricula, setCurricula] = useState<
    Record<number, CurriculumOption[]>
  >({});
  const [curriculumIds, setCurriculumIds] = useState<Record<number, number>>(
    {},
  );
  const [batchConfirmed, setBatchConfirmed] = useState(false);

  const [invitationBusyId, setInvitationBusyId] = useState<number | null>(null);
  const [invitationStatuses, setInvitationStatuses] = useState<
    Record<number, string>
  >({});
  const [invitationMessage, setInvitationMessage] = useState("");
  const [invitationError, setInvitationError] = useState("");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
    } else if (session?.role !== "Registrar") {
      navigate(authService.getDashboardRoute(session!.role), { replace: true });
    }
  }, [authenticated, navigate, session?.role]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const loadQueue = useCallback(
    async (signal?: AbortSignal) => {
      if (!allowed) return;
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          status,
          page: String(page),
          limit: "20",
        });
        if (search) params.set("search", search);
        const result = await jsonRequest<QueueResponse>(
          `${ADMISSION_URL}?${params}`,
          { signal },
        );
        if (signal?.aborted) return;
        setApplications(
          Array.isArray(result.applications) ? result.applications : [],
        );
        setTotal(result.pagination?.total ?? 0);
        setTotalPages(Math.max(1, result.pagination?.totalPages ?? 1));
      } catch (problem) {
        if (signal?.aborted) return;
        setApplications([]);
        setError(
          problem instanceof Error
            ? problem.message
            : "Unable to load admission applications.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [allowed, page, search, status],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadQueue(controller.signal);
    return () => controller.abort();
  }, [loadQueue, refreshKey]);

  useEffect(() => {
    setSelectedIds([]);
    setBatchOpen(false);
    setBatchResults(null);
  }, [status, page, search]);

  const selectedApplicants = useMemo(
    () =>
      applications.filter((applicant) =>
        selectedIds.includes(applicant.applicationId),
      ),
    [applications, selectedIds],
  );

  const eligibleApplicants = useMemo(
    () =>
      applications.filter(
        (applicant) =>
          applicant.applicationStatus === "Verified" &&
          applicant.applicantType === "New" &&
          Number(applicant.preferredCourseId) > 0 &&
          applicant.studentId === null &&
          applicant.importedAt === null,
      ),
    [applications],
  );

  const allVisibleSelected =
    eligibleApplicants.length > 0 &&
    eligibleApplicants.every((applicant) =>
      selectedIds.includes(applicant.applicationId),
    );

  function clearDetail() {
    setDetail(null);
    setDetailsError("");
    setInvitationMessage("");
    setInvitationError("");
    setDuplicates(null);
    setReviewNotes("");
    setFlags({
      inPersonConfirmed: false,
      identityChecked: false,
      originalDocumentsChecked: false,
      academicRecordsChecked: false,
    });
  }

  async function openDetail(applicationId: number) {
    clearDetail();
    setDetailsLoading(true);
    try {
      const response = await jsonRequest<DetailsResponse>(
        `${ADMISSION_URL}/${applicationId}`,
      );
      setDetail(response.application);
      setDecision("Verified");
    } catch (problem) {
      setDetailsError(
        problem instanceof Error
          ? problem.message
          : "Unable to load applicant details.",
      );
    } finally {
      setDetailsLoading(false);
    }
  }

  async function checkDuplicates(applicationId: number) {
    setDuplicateLoading(true);
    setDetailsError("");
    try {
      const result = await jsonRequest<DuplicateResponse>(
        `${ADMISSION_URL}/${applicationId}/duplicates`,
      );
      setDuplicates(result);
    } catch (problem) {
      setDuplicates(null);
      setDetailsError(
        problem instanceof Error
          ? problem.message
          : "Duplicate screening failed.",
      );
    } finally {
      setDuplicateLoading(false);
    }
  }

  async function submitReview() {
    if (!detail || reviewBusy) return;
    if (decision === "Verified" && !Object.values(flags).every(Boolean)) {
      setDetailsError(
        "All four verification checks are required before marking an applicant Verified.",
      );
      return;
    }
    if (
      (decision === "Needs Correction" || decision === "Rejected") &&
      !reviewNotes.trim()
    ) {
      setDetailsError("Review notes are required for this decision.");
      return;
    }

    setReviewBusy(true);
    setDetailsError("");
    try {
      await jsonRequest(`${ADMISSION_URL}/${detail.applicationId}/review`, {
        method: "POST",
        body: JSON.stringify({
          version: detail.version,
          decision,
          ...flags,
          reviewNotes: reviewNotes.trim(),
        }),
      });
      setNotice(`Application ${detail.applicationId} reviewed as ${decision}.`);
      clearDetail();
      setRefreshKey((value) => value + 1);
    } catch (problem) {
      setDetailsError(
        problem instanceof Error
          ? problem.message
          : "Review could not be saved.",
      );
    } finally {
      setReviewBusy(false);
    }
  }

  /* Student Activation Invitation */

  async function sendInvitation(applicationId: number, forceResend = false) {
    if (invitationBusyId !== null) return;

    if (
      forceResend &&
      !window.confirm(
        "Send a new activation link? The previous unused link will stop working.",
      )
    ) {
      return;
    }

    setInvitationBusyId(applicationId);
    setInvitationError("");
    setInvitationMessage("");

    try {
      const result = await jsonRequest<InvitationResponse>(
        `${ADMISSION_URL}/${applicationId}/activation-invitation`,
        {
          method: "POST",
          body: JSON.stringify({ forceResend }),
        },
      );

      setInvitationStatuses((previous) => ({
        ...previous,
        [applicationId]: result.activationEmailStatus,
      }));
      setInvitationMessage(result.message);
    } catch (problem) {
      setInvitationError(
        problem instanceof Error
          ? problem.message
          : "Unable to send the activation invitation.",
      );
    } finally {
      setInvitationBusyId(null);
    }
  }

  async function prepareBatch() {
    if (selectedApplicants.length === 0 || batchLoading) return;
    if (
      selectedApplicants.some((item) => item.applicationStatus !== "Verified")
    )
      return;

    setBatchOpen(true);
    setBatchLoading(true);
    setBatchResults(null);
    setBatchError("");
    setBatchConfirmed(false);
    setCurricula({});
    setCurriculumIds({});
    setSemesterId(0);
    setSemesters([]);

    try {
      const courseIds = Array.from(
        new Set(selectedApplicants.map((item) => item.preferredCourseId)),
      );
      if (courseIds.some((id) => !id || id <= 0)) {
        throw new Error(
          "Every selected applicant must have a valid preferred course.",
        );
      }

      const [semesterResponse, curriculumResponses] = await Promise.all([
        jsonRequest<{ success: boolean; semesters: SemesterOption[] }>(
          ENROLLMENT_PERIOD_URL,
        ),
        Promise.all(
          courseIds.map((id) =>
            jsonRequest<{
              success: boolean;
              data: CurriculumOption[];
              pagination: { total: number };
            }>(`${CURRICULUM_URL}?course=${id}&is_active=1&limit=100`),
          ),
        ),
      ]);
      const availableSemesters = Array.isArray(semesterResponse.semesters)
        ? semesterResponse.semesters
        : [];
      if (availableSemesters.length === 0) {
        throw new Error(
          "No supported semesters are configured. Ask the Registrar to check semester setup.",
        );
      }
      setSemesters(availableSemesters);

      const byCourse: Record<number, CurriculumOption[]> = {};
      const choices: Record<number, number> = {};
      courseIds.forEach((id, index) => {
        const currentCourseId = Number(id);
        const response = curriculumResponses[index];
        const options = Array.isArray(response.data)
          ? response.data.filter(
              (item) =>
                Number(item.course_id) === currentCourseId &&
                Number(item.is_active) === 1,
            )
          : [];
        byCourse[currentCourseId] = options;
        if (response.pagination?.total > options.length) {
          throw new Error(
            `Too many active curricula for course ${currentCourseId}. Refine curriculum setup before importing.`,
          );
        }
      });
      selectedApplicants.forEach((applicant) => {
        const options = byCourse[Number(applicant.preferredCourseId)] || [];
        if (options.length === 1)
          choices[applicant.applicationId] = options[0].curriculum_id;
      });
      setCurricula(byCourse);
      setCurriculumIds(choices);
    } catch (problem) {
      setBatchError(
        problem instanceof Error
          ? problem.message
          : "Unable to prepare import options.",
      );
    } finally {
      setBatchLoading(false);
    }
  }

  const batchReady =
    selectedApplicants.length > 0 &&
    semesterId > 0 &&
    selectedApplicants.every(
      (item) => Number(curriculumIds[item.applicationId]) > 0,
    );

  async function importBatch() {
    if (!batchConfirmed || !batchReady || batchBusy) return;
    setBatchBusy(true);
    setBatchError("");
    setBatchResults(null);

    try {
      // Preliminary duplicate screening. The backend rechecks under transaction locks.
      const duplicateResults = await Promise.all(
        selectedApplicants.map((item) =>
          jsonRequest<DuplicateResponse>(
            `${ADMISSION_URL}/${item.applicationId}/duplicates`,
          ),
        ),
      );
      const blocked = selectedApplicants.filter(
        (_, index) => duplicateResults[index].hasPotentialDuplicate,
      );
      if (blocked.length) {
        throw new Error(
          `Possible duplicate detected for application(s) ${blocked.map((item) => item.applicationId).join(", ")}. Review before importing.`,
        );
      }

      const result = await jsonRequest<BulkResponse>(
        `${ADMISSION_URL}/bulk-import`,
        {
          method: "POST",
          body: JSON.stringify({
            confirm: true,
            items: selectedApplicants.map((item) => ({
              applicationId: item.applicationId,
              version: item.version,
              curriculumId: curriculumIds[item.applicationId],
              semesterId,
            })),
          }),
        },
      );
      setBatchResults(result);
      setInvitationStatuses((previous) => {
        const next = { ...previous };
        result.results.forEach((item) => {
          if (item.success && item.activationEmailStatus) {
            next[item.applicationId] = item.activationEmailStatus;
          }
        });
        return next;
      });

      const sentCount = result.results.filter(
        (item) => item.success && item.activationEmailStatus === "Sent",
      ).length;
      const emailFailures = result.results.filter(
        (item) => item.success && item.activationEmailStatus === "Failed",
      ).length;
      setNotice(
        `Bulk import: ${result.summary.imported} imported, ${result.summary.failed} failed. ` +
          `Activation emails: ${sentCount} accepted by SMTP, ${emailFailures} failed. ` +
          `See the import results for each applicant's email status.`,
      );
      setSelectedIds([]);
      setRefreshKey((value) => value + 1);
    } catch (problem) {
      setBatchError(
        problem instanceof Error
          ? problem.message
          : "Unable to process the bulk import.",
      );
    } finally {
      setBatchBusy(false);
    }
  }

  if (!allowed) return null;

  return (
    <DashboardLayout>
      <main className="registrar-student-list registrar-admission-management">
        {/* Header */}
        <section className="registrar-student-list__hero">
          <div className="registrar-student-list__hero-copy">
            <div className="registrar-student-list__eyebrow">
              <span className="registrar-student-list__eyebrow-icon">
                <ClipboardCheck size={16} />
              </span>
              REGISTRAR · ADMISSIONS
            </div>
            <h1>Admission Management</h1>
            <p>
              Review applicants, record in-person verification, and import
              verified students into the PTC Portal.
            </p>
          </div>
        </section>

        {/* Summary */}
        <section
          className="registrar-student-list__stats"
          aria-label="Admission summary"
        >
          <article className="registrar-student-list__stat-card">
            <div className="registrar-student-list__stat-icon registrar-student-list__stat-icon--primary">
              <UsersRound size={21} />
            </div>
            <div>
              <span>Current Queue</span>
              <strong>{total}</strong>
              <small>{status} applications</small>
            </div>
          </article>
          <article className="registrar-student-list__stat-card">
            <div className="registrar-student-list__stat-icon">
              <FileSearch size={21} />
            </div>
            <div>
              <span>Showing</span>
              <strong>{applications.length}</strong>
              <small>On this page</small>
            </div>
          </article>
          <article className="registrar-student-list__stat-card">
            <div className="registrar-student-list__stat-icon">
              <BadgeCheck size={21} />
            </div>
            <div>
              <span>Selected</span>
              <strong>{selectedIds.length}</strong>
              <small>Verified applications</small>
            </div>
          </article>
          <article className="registrar-student-list__stat-card">
            <div className="registrar-student-list__stat-icon">
              <GraduationCap size={21} />
            </div>
            <div>
              <span>Import</span>
              <strong>20</strong>
              <small>Max applicants per batch</small>
            </div>
          </article>
        </section>

        {/* Applicant Queue */}
        <section className="registrar-student-list__panel">
          <div className="registrar-student-list__panel-heading">
            <div>
              <h2>Applicant Queue</h2>
              <p>
                Choose a status, review the applicant's details, and process the
                next step.
              </p>
            </div>
            <button
              type="button"
              className="registrar-student-list__action"
              onClick={() => setRefreshKey((value) => value + 1)}
              disabled={loading}
            >
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
          <div className="registrar-student-list__toolbar">
            <label className="registrar-student-list__search">
              <Search size={18} aria-hidden={true} />
              <input
                aria-label="Search applicants"
                placeholder="Search applicant, reference, or email"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
              {searchInput && (
                <button
                  type="button"
                  className="registrar-student-list__search-clear"
                  onClick={() => setSearchInput("")}
                  aria-label="Clear search"
                >
                  <X size={15} />
                </button>
              )}
            </label>
            <div className="registrar-student-list__filters">
              <label
                className="registrar-student-list__filter-label"
                htmlFor="admission-status-filter"
              >
                Status
              </label>
              <select
                id="admission-status-filter"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as AdmissionStatus);
                  setPage(1);
                  clearDetail();
                }}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {status === "Verified" && (
                <button
                  type="button"
                  className="registrar-student-list__action registrar-student-list__action--primary"
                  disabled={!selectedIds.length || batchLoading || batchBusy}
                  onClick={() => void prepareBatch()}
                >
                  <CheckCircle2 size={16} /> Prepare Bulk Import (
                  {selectedIds.length})
                </button>
              )}
            </div>
          </div>
          {notice && (
            <div
              className="registrar-student-list__filter-summary"
              role="status"
            >
              {notice}
              <button
                type="button"
                className="registrar-student-list__action"
                onClick={() => setNotice("")}
              >
                Dismiss
              </button>
            </div>
          )}
          <div className="registrar-student-list__table-shell">
            <div className="registrar-student-list__table-scroll">
              <table className="registrar-student-list__table">
                <thead>
                  <tr>
                    {status === "Verified" && (
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Select all eligible verified applicants"
                          checked={allVisibleSelected}
                          disabled={eligibleApplicants.length === 0}
                          onChange={(event) =>
                            setSelectedIds(
                              event.target.checked
                                ? eligibleApplicants.map(
                                    (item) => item.applicationId,
                                  )
                                : [],
                            )
                          }
                        />
                      </th>
                    )}
                    <th>Applicant</th>
                    <th>Application Ref.</th>
                    <th>Course</th>
                    <th>Type</th>
                    <th>Submitted</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading &&
                    applications.map((item) => (
                      <tr key={item.applicationId}>
                        {status === "Verified" && (
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select ${fullName(item)}`}
                              checked={selectedIds.includes(item.applicationId)}
                              disabled={
                                !eligibleApplicants.some(
                                  (applicant) =>
                                    applicant.applicationId ===
                                    item.applicationId,
                                )
                              }
                              title={
                                item.applicantType !== "New"
                                  ? "Transferees and returnees require academic placement review before import."
                                  : undefined
                              }
                              onChange={(event) =>
                                setSelectedIds((previous) =>
                                  event.target.checked
                                    ? [...previous, item.applicationId].slice(
                                        0,
                                        20,
                                      )
                                    : previous.filter(
                                        (id) => id !== item.applicationId,
                                      ),
                                )
                              }
                            />
                          </td>
                        )}
                        <td>
                          <div className="registrar-student-list__student-copy">
                            <strong>{fullName(item)}</strong>
                            <small>{item.email}</small>
                          </div>
                        </td>
                        <td>{item.applicationReference}</td>
                        <td>
                          <span className="registrar-student-list__course-chip">
                            {item.courseCode || "Not selected"}
                          </span>
                        </td>
                        <td>{item.applicantType || "Not specified"}</td>
                        <td>{displayDate(item.submittedAt)}</td>
                        <td>
                          <span className="registrar-student-list__status registrar-student-list__status--active">
                            {item.applicationStatus}
                          </span>
                          {item.applicationStatus === "Imported" &&
                            invitationStatuses[item.applicationId] && (
                              <small className="d-block mt-1">
                                Email:{" "}
                                {invitationLabel(
                                  invitationStatuses[item.applicationId],
                                )}
                              </small>
                            )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="registrar-student-list__action"
                            onClick={() => void openDetail(item.applicationId)}
                          >
                            <FileSearch size={15} /> Review
                          </button>
                        </td>
                      </tr>
                    ))}
                  {!loading && !error && applications.length === 0 && (
                    <tr>
                      <td colSpan={status === "Verified" ? 8 : 7}>
                        <div className="registrar-student-list__state">
                          <FileSearch size={28} />
                          <h3>No applicants found</h3>
                          <p>Try another status or search term.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                  {loading && (
                    <tr>
                      <td colSpan={status === "Verified" ? 8 : 7}>
                        <div className="registrar-student-list__state">
                          <Loader2 size={26} />
                          <p>Loading admission applications...</p>
                        </div>
                      </td>
                    </tr>
                  )}
                  {!loading && error && (
                    <tr>
                      <td colSpan={status === "Verified" ? 8 : 7}>
                        <div className="registrar-student-list__state registrar-student-list__state--error">
                          <AlertCircle size={27} />
                          <h3>Unable to load applicants</h3>
                          <p>{error}</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="registrar-student-list__pagination-bar">
            <span>
              Page {page} of {totalPages} · {total} total
            </span>
            <div className="registrar-student-list__pagination">
              <button
                type="button"
                className="registrar-student-list__page-btn"
                disabled={page <= 1 || loading}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                <ChevronLeft size={17} /> Previous
              </button>
              <button
                type="button"
                className="registrar-student-list__page-btn"
                disabled={page >= totalPages || loading}
                onClick={() =>
                  setPage((value) => Math.min(totalPages, value + 1))
                }
              >
                Next <ChevronRight size={17} />
              </button>
            </div>
          </div>
        </section>

        {/* Applicant Details and Review */}
        {(detailsLoading || detailsError || detail) && (
          <section
            className="registrar-student-list__panel mt-3"
            aria-label="Admission applicant details"
          >
            <div className="registrar-student-list__panel-heading">
              <div>
                <h2>Applicant Details</h2>
                <p>Only staff-verified applications may be imported.</p>
              </div>
              <button
                type="button"
                className="registrar-student-list__action"
                onClick={clearDetail}
              >
                <X size={16} /> Close
              </button>
            </div>
            <div className="px-4 pb-4">
              {detailsLoading && <p>Loading applicant details...</p>}
              {detailsError && (
                <p role="alert" className="text-danger">
                  {detailsError}
                </p>
              )}
              {detail && (
                <>
                  <div className="row g-3 mb-3">
                    {[
                      ["Applicant", fullName(detail)],
                      ["Reference", detail.applicationReference],
                      ["Status", detail.applicationStatus],
                      ["Application version", String(detail.version)],
                      ["Date of birth", detail.birthDate || "Not provided"],
                      ["Email", detail.email],
                      ["Contact", detail.contactNumber || "Not provided"],
                      [
                        "Applicant type",
                        detail.applicantType || "Not specified",
                      ],
                      [
                        "Course",
                        `${detail.courseCode || "Not selected"} — ${detail.courseName || ""}`,
                      ],
                      ["Academic year", detail.academicYear],
                      [
                        "Previous school",
                        detail.previousSchool || "Not provided",
                      ],
                      [
                        "Address",
                        [
                          detail.houseNo,
                          detail.street,
                          detail.barangay,
                          detail.city,
                          detail.province,
                          detail.zipCode,
                        ]
                          .filter(Boolean)
                          .join(", ") || "Not provided",
                      ],
                    ].map(([label, value]) => (
                      <div className="col-lg-4 col-sm-6" key={label}>
                        <div className="registrar-student-list__record-count">
                          <small>{label}</small>
                          <div>{value}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {(
                    [
                      "Submitted",
                      "Needs Correction",
                      "Verified",
                    ] as AdmissionStatus[]
                  ).includes(detail.applicationStatus) && (
                    <div className="mb-3">
                      <button
                        type="button"
                        className="registrar-student-list__action"
                        disabled={duplicateLoading}
                        onClick={() =>
                          void checkDuplicates(detail.applicationId)
                        }
                      >
                        <Search size={15} />{" "}
                        {duplicateLoading
                          ? "Checking..."
                          : "Check Existing Students"}
                      </button>
                      {duplicates && (
                        <div
                          className="registrar-student-list__filter-summary mt-2"
                          role="status"
                        >
                          {duplicates.hasPotentialDuplicate
                            ? `Possible duplicates found: ${duplicates.existingStudents.length} student(s), ${duplicates.existingAccounts.length} account(s). Stop import and investigate these matches.`
                            : "No potential duplicates found in the preliminary screening."}
                        </div>
                      )}
                    </div>
                  )}
                  {(detail.applicationStatus === "Submitted" ||
                    detail.applicationStatus === "Needs Correction") && (
                    <div className="row g-3">
                      <div className="col-md-4 registrar-student-list__filters">
                        <label
                          className="registrar-student-list__filter-label"
                          htmlFor="admission-decision"
                        >
                          Decision
                        </label>
                        <select
                          id="admission-decision"
                          value={decision}
                          onChange={(event) =>
                            setDecision(event.target.value as ReviewDecision)
                          }
                        >
                          <option value="Verified">Verified</option>
                          {detail.applicationStatus === "Submitted" && (
                            <option value="Needs Correction">
                              Needs Correction
                            </option>
                          )}
                          <option value="Rejected">Rejected</option>
                        </select>
                      </div>
                      <div className="col-12">
                        <p className="mb-2">
                          <strong>In-person verification checklist</strong>
                        </p>
                        <div className="row g-2">
                          {(
                            [
                              [
                                "inPersonConfirmed",
                                "Applicant visited PTC in person",
                              ],
                              ["identityChecked", "Identity verified"],
                              [
                                "originalDocumentsChecked",
                                "Original documents checked",
                              ],
                              [
                                "academicRecordsChecked",
                                "Academic records checked",
                              ],
                            ] as const
                          ).map(([key, label]) => (
                            <label className="col-lg-6" key={key}>
                              <input
                                type="checkbox"
                                className="me-2"
                                checked={flags[key]}
                                onChange={(event) =>
                                  setFlags((previous) => ({
                                    ...previous,
                                    [key]: event.target.checked,
                                  }))
                                }
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                        <p className="mt-2 mb-1">
                          These checks must represent actual physical
                          verification for real applicants.
                        </p>
                      </div>
                      <div className="col-12">
                        <label htmlFor="admission-review-notes">
                          Review notes
                        </label>
                        <textarea
                          id="admission-review-notes"
                          className="form-control"
                          rows={3}
                          maxLength={1000}
                          value={reviewNotes}
                          onChange={(event) =>
                            setReviewNotes(event.target.value)
                          }
                          placeholder="Staff verification notes (required for correction or rejection)"
                        />
                      </div>
                      <div className="col-12">
                        <button
                          type="button"
                          className="registrar-student-list__action registrar-student-list__action--primary"
                          disabled={
                            reviewBusy ||
                            (decision === "Verified" &&
                              !Object.values(flags).every(Boolean))
                          }
                          onClick={() => void submitReview()}
                        >
                          <ShieldCheck size={16} />{" "}
                          {reviewBusy
                            ? "Saving..."
                            : `Save ${decision} Decision`}
                        </button>
                      </div>
                    </div>
                  )}
                  {detail.applicationStatus === "Imported" && (
                    <div className="mb-3">
                      <p className="mb-2">
                        <CheckCircle2 size={16} /> Linked official student ID:{" "}
                        {detail.studentId ?? "Not available"}. Enrollment is
                        managed separately.
                      </p>
                      <p className="mb-2">
                        Account invitations are sent after import, not when an
                        application is marked Verified. Recipient:{" "}
                        <strong>{detail.email}</strong>.
                      </p>
                      {invitationStatuses[detail.applicationId] && (
                        <div
                          className="registrar-student-list__filter-summary mb-2"
                          role="status"
                        >
                          Activation email:{" "}
                          {invitationLabel(
                            invitationStatuses[detail.applicationId],
                          )}
                        </div>
                      )}
                      {invitationMessage && (
                        <div
                          className="registrar-student-list__filter-summary mb-2"
                          role="status"
                        >
                          {invitationMessage}
                        </div>
                      )}
                      {invitationError && (
                        <p role="alert" className="text-danger mb-2">
                          <AlertCircle size={16} /> {invitationError}
                        </p>
                      )}
                      <div className="d-flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="registrar-student-list__action registrar-student-list__action--primary"
                          disabled={
                            invitationBusyId !== null ||
                            invitationStatuses[detail.applicationId] ===
                              "AlreadyActivated"
                          }
                          onClick={() =>
                            void sendInvitation(detail.applicationId)
                          }
                        >
                          {invitationBusyId === detail.applicationId ? (
                            <Loader2 size={16} />
                          ) : (
                            <Mail size={16} />
                          )}
                          {invitationBusyId === detail.applicationId
                            ? "Sending..."
                            : "Send Activation Invitation"}
                        </button>
                        <button
                          type="button"
                          className="registrar-student-list__action"
                          disabled={
                            invitationBusyId !== null ||
                            invitationStatuses[detail.applicationId] ===
                              "AlreadyActivated"
                          }
                          onClick={() =>
                            void sendInvitation(detail.applicationId, true)
                          }
                        >
                          <RefreshCw size={16} /> Replace Link &amp; Resend
                        </button>
                      </div>
                      <small className="d-block mt-2">
                        Resending invalidates the previous unused activation
                        link. A 60-second cooldown applies. SMTP acceptance does
                        not guarantee inbox delivery.
                      </small>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {/* Import Review */}
        {batchOpen && (
          <section
            className="registrar-student-list__panel mt-3"
            aria-label="Bulk import confirmation"
          >
            <div className="registrar-student-list__panel-heading">
              <div>
                <h2>Prepare Bulk Import</h2>
                <p>
                  Choose a valid curriculum for each verified applicant and one
                  semester for this batch.
                </p>
              </div>
              <button
                type="button"
                className="registrar-student-list__action"
                onClick={() => {
                  setBatchOpen(false);
                  setBatchResults(null);
                }}
                disabled={batchBusy}
              >
                <X size={16} /> Close
              </button>
            </div>
            <div className="px-4 pb-4">
              {batchLoading && (
                <p>
                  <Loader2 size={16} /> Loading curriculum and semester
                  options...
                </p>
              )}
              {batchError && (
                <p role="alert" className="text-danger">
                  <AlertCircle size={16} /> {batchError}
                </p>
              )}
              {!batchLoading && !batchResults && (
                <>
                  <div className="registrar-student-list__filters mb-3">
                    <label
                      className="registrar-student-list__filter-label"
                      htmlFor="admission-semester"
                    >
                      Semester
                    </label>
                    <select
                      id="admission-semester"
                      value={semesterId}
                      onChange={(event) =>
                        setSemesterId(Number(event.target.value))
                      }
                    >
                      <option value={0}>Select semester</option>
                      {semesters.map((item) => (
                        <option key={item.semester_id} value={item.semester_id}>
                          {item.semester_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="registrar-student-list__table-scroll">
                    <table className="registrar-student-list__table">
                      <thead>
                        <tr>
                          <th>Applicant</th>
                          <th>Course</th>
                          <th>Active curriculum</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedApplicants.map((item) => (
                          <tr key={item.applicationId}>
                            <td>
                              {fullName(item)} · #{item.applicationId}
                            </td>
                            <td>{item.courseCode || "Not selected"}</td>
                            <td>
                              <div className="registrar-student-list__filters">
                                <select
                                  aria-label={`Curriculum for ${fullName(item)}`}
                                  value={curriculumIds[item.applicationId] || 0}
                                  onChange={(event) =>
                                    setCurriculumIds((previous) => ({
                                      ...previous,
                                      [item.applicationId]: Number(
                                        event.target.value,
                                      ),
                                    }))
                                  }
                                >
                                  <option value={0}>
                                    Select active curriculum
                                  </option>
                                  {(
                                    curricula[Number(item.preferredCourseId)] ||
                                    []
                                  ).map((option) => (
                                    <option
                                      key={option.curriculum_id}
                                      value={option.curriculum_id}
                                    >
                                      {option.curriculum_name} (ID{" "}
                                      {option.curriculum_id})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <label className="d-block my-3">
                    <input
                      type="checkbox"
                      className="me-2"
                      checked={batchConfirmed}
                      onChange={(event) =>
                        setBatchConfirmed(event.target.checked)
                      }
                    />
                    I confirm these applicants were verified at PTC. Importing
                    creates official student accounts and sections, but does not
                    enroll them. Each successfully imported student can receive
                    a separate password-setup invitation by email.
                  </label>
                  <button
                    type="button"
                    className="registrar-student-list__action registrar-student-list__action--primary"
                    disabled={
                      !batchReady ||
                      !batchConfirmed ||
                      batchBusy ||
                      Boolean(batchError)
                    }
                    onClick={() => void importBatch()}
                  >
                    <GraduationCap size={16} />{" "}
                    {batchBusy
                      ? "Importing..."
                      : `Import ${selectedApplicants.length} Verified Applicant(s)`}
                  </button>
                </>
              )}
              {batchResults && (
                <div role="status">
                  <p>
                    <strong>
                      {batchResults.summary.imported} imported;{" "}
                      {batchResults.summary.failed} failed.
                    </strong>{" "}
                    Accounts are not enrolled. Passwords are created through
                    separate activation invitations.
                  </p>
                  <div className="registrar-student-list__table-scroll">
                    <table className="registrar-student-list__table">
                      <thead>
                        <tr>
                          <th>Application</th>
                          <th>Result</th>
                          <th>Student number</th>
                          <th>Section / reason</th>
                          <th>Activation email</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batchResults.results.map((result) => (
                          <tr key={result.applicationId}>
                            <td>#{result.applicationId}</td>
                            <td>{result.success ? "Imported" : "Failed"}</td>
                            <td>{result.studentNumber || "—"}</td>
                            <td>
                              {result.success
                                ? result.sectionName || "Assigned"
                                : result.message || result.code || "Failed"}
                            </td>
                            <td>
                              {result.success
                                ? invitationLabel(result.activationEmailStatus)
                                : "Not sent (import failed)"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </DashboardLayout>
  );
}
