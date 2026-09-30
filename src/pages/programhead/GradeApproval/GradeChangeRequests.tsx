import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FilePenLine,
  GraduationCap,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Undo2,
  UserRound,
  X,
  XCircle,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/GradeChangeRequestsPH.css";

const API_BASE_URL =
  "http://localhost:3000/api/program-head/grades/grade-change-requests";

type GradeChangeStatus =
  | "Pending Program Head"
  | "For Registrar Processing"
  | "Returned"
  | "Rejected"
  | "Completed";

interface GradeSnapshot {
  midterm_grade: number | null;
  final_grade: number | null;
  overall_percentage: number | null;
  final_rating: number | null;
  remarks: string | null;
  grading_outcome: string | null;
  outcome_reason?: string | null;
}

interface GradeChangeRequest {
  grade_change_request_id: number;
  grade_id: number;
  request_type: "INC_COMPLETION" | string;
  status: GradeChangeStatus;

  original_grade: GradeSnapshot;
  proposed_grade: GradeSnapshot;

  completion_remarks: string;

  student: {
    student_id: number;
    student_number: string;
    first_name?: string;
    middle_name?: string | null;
    last_name?: string;
    full_name: string;
  };

  faculty?: {
    faculty_id?: number | null;
    employee_number?: string | null;
    faculty_name?: string | null;
    email?: string | null;
  } | null;

  class: {
    offering_id: number | null;
    enrollment_subject_id: number;
    subject: {
      subject_id: number | null;
      subject_code: string | null;
      subject_name: string | null;
    };
    section: {
      section_id: number | null;
      section_name: string | null;
    };
  };

  period?: {
    academic_year_id?: number | null;
    academic_year?: string | null;
    semester_id?: number | null;
    semester_name?: string | null;
  } | null;

  requested_by?: {
    user_id: number;
    username?: string | null;
    role?: string | null;
    requested_at?: string | null;
  } | null;

  reviewed_by?: {
    user_id: number;
    username?: string | null;
    reviewed_at?: string | null;
    review_remarks?: string | null;
  } | null;

  requested_at?: string | null;
  review_remarks?: string | null;
}

interface GradeChangeListResponse {
  success: boolean;
  message?: string;
  error?: string;

  requests?: GradeChangeRequest[];
  grade_change_requests?: GradeChangeRequest[];

  summary?: {
    total_requests?: number;
    total_pending?: number;
  };
}

interface MutationResponse {
  success: boolean;
  message?: string;
  error?: string;
  request?: {
    grade_change_request_id?: number;
    status?: GradeChangeStatus;
  };
}

interface ActionNotice {
  type: "success" | "error";
  message: string;
}

type ReviewAction = "approve" | "return" | "reject";

interface ReviewDialogState {
  request: GradeChangeRequest;
  action: ReviewAction;
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

function formatGrade(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }

  return Number(value).toFixed(2);
}

function formatPercentage(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }

  return `${Number(value).toFixed(2)}%`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getRequestDate(request: GradeChangeRequest): string | null {
  return request.requested_by?.requested_at || request.requested_at || null;
}

function getOutcomeLabel(value: string | null | undefined): string {
  if (value === "INCOMPLETE") {
    return "Incomplete";
  }

  if (value === "UNOFFICIAL_DROP") {
    return "Unofficial Drop";
  }

  if (value === "NUMERIC") {
    return "Numeric";
  }

  return value || "—";
}

function getActionTitle(action: ReviewAction): string {
  if (action === "approve") {
    return "Approve INC Completion";
  }

  if (action === "return") {
    return "Return INC Completion";
  }

  return "Reject INC Completion";
}

function getActionDescription(action: ReviewAction): string {
  if (action === "approve") {
    return "Approve the proposed completed grade and forward the request to the Registrar for official posting.";
  }

  if (action === "return") {
    return "Return the completion request so the Faculty can review and correct the submitted information.";
  }

  return "Reject this INC completion request. The proposed grade will not proceed to Registrar processing.";
}

export default function GradeChangeRequests() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();

  const authenticated = Boolean(session && token);
  const userRole = session?.role;

  const [requests, setRequests] = useState<GradeChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<GradeChangeStatus | "All">(
    "Pending Program Head",
  );

  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);

  const [reviewDialog, setReviewDialog] = useState<ReviewDialogState | null>(
    null,
  );

  const [reviewRemarks, setReviewRemarks] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [processingRequestId, setProcessingRequestId] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (userRole !== "Program Head" && session) {
      navigate(authService.getDashboardRoute(session.role), {
        replace: true,
      });
    }
  }, [authenticated, userRole, session, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Program Head") {
      return;
    }

    const controller = new AbortController();

    const loadRequests = async () => {
      try {
        if (refreshKey === 0) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }

        setError("");

        const response = await authService.authFetch(API_BASE_URL, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

        const data = await readJsonResponse<GradeChangeListResponse>(response);

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        if (response.status === 403) {
          throw new Error(data.message || "Program Head access is required.");
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message ||
              data.error ||
              "Unable to load grade change requests.",
          );
        }

        const loadedRequests = Array.isArray(data.requests)
          ? data.requests
          : Array.isArray(data.grade_change_requests)
            ? data.grade_change_requests
            : [];

        setRequests(loadedRequests);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error(
          "LOAD PROGRAM HEAD GRADE CHANGE REQUESTS ERROR:",
          requestError,
        );

        setRequests([]);

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load grade change requests.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void loadRequests();

    return () => {
      controller.abort();
    };
  }, [authenticated, userRole, navigate, refreshKey]);

  const filteredRequests = useMemo(() => {
    const query = search.trim().toLowerCase();

    return requests.filter((request) => {
      const matchesStatus =
        statusFilter === "All" || request.status === statusFilter;

      const matchesSearch =
        !query ||
        request.student.student_number.toLowerCase().includes(query) ||
        request.student.full_name.toLowerCase().includes(query) ||
        (request.class.subject.subject_code || "")
          .toLowerCase()
          .includes(query) ||
        (request.class.subject.subject_name || "")
          .toLowerCase()
          .includes(query) ||
        (request.faculty?.faculty_name || "").toLowerCase().includes(query);

      return matchesStatus && matchesSearch;
    });
  }, [requests, search, statusFilter]);

  const summary = useMemo(() => {
    return {
      total: requests.length,

      pending: requests.filter(
        (request) => request.status === "Pending Program Head",
      ).length,

      registrar: requests.filter(
        (request) => request.status === "For Registrar Processing",
      ).length,

      returned: requests.filter((request) => request.status === "Returned")
        .length,

      rejected: requests.filter((request) => request.status === "Rejected")
        .length,

      completed: requests.filter((request) => request.status === "Completed")
        .length,
    };
  }, [requests]);

  const refreshQueue = () => {
    setActionNotice(null);
    setRefreshKey((current) => current + 1);
  };

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("Pending Program Head");
  };

  const openReviewDialog = (
    request: GradeChangeRequest,
    action: ReviewAction,
  ) => {
    if (request.status !== "Pending Program Head") {
      return;
    }

    setReviewDialog({
      request,
      action,
    });

    setReviewRemarks(
      action === "approve"
        ? "The completed requirement and proposed grade were reviewed and approved."
        : "",
    );

    setReviewError("");
    setActionNotice(null);
  };

  const closeReviewDialog = () => {
    if (processingRequestId !== null) {
      return;
    }

    setReviewDialog(null);
    setReviewRemarks("");
    setReviewError("");
  };

  const submitReviewAction = async () => {
    if (!reviewDialog) {
      return;
    }

    const remarks = reviewRemarks.trim();

    if (
      (reviewDialog.action === "return" || reviewDialog.action === "reject") &&
      !remarks
    ) {
      setReviewError(
        reviewDialog.action === "return"
          ? "A return reason is required."
          : "A rejection reason is required.",
      );

      return;
    }

    if (remarks.length > 1000) {
      setReviewError("Review remarks must not exceed 1000 characters.");
      return;
    }

    try {
      const requestId = reviewDialog.request.grade_change_request_id;

      setProcessingRequestId(requestId);
      setReviewError("");
      setActionNotice(null);

      const response = await authService.authFetch(
        `${API_BASE_URL}/${requestId}/${reviewDialog.action}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            review_remarks: remarks || null,
          }),
        },
      );

      const data = await readJsonResponse<MutationResponse>(response);

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
            `Unable to ${reviewDialog.action} grade change request.`,
        );
      }

      setActionNotice({
        type: "success",
        message:
          data.message ||
          (reviewDialog.action === "approve"
            ? "INC completion approved and forwarded to the Registrar."
            : reviewDialog.action === "return"
              ? "INC completion returned to Faculty."
              : "INC completion request rejected."),
      });

      setReviewDialog(null);
      setReviewRemarks("");
      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      console.error("PROGRAM HEAD GRADE CHANGE REVIEW ERROR:", requestError);

      setReviewError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to process grade change request.",
      );
    } finally {
      setProcessingRequestId(null);
    }
  };

  useEffect(() => {
    if (!reviewDialog) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && processingRequestId === null) {
        closeReviewDialog();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [reviewDialog, processingRequestId]);

  if (!authenticated || userRole !== "Program Head") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="ph-grade-change-page">
        <section className="ph-grade-change-header">
          <div>
            <button
              type="button"
              className="ph-grade-change-back"
              onClick={() => navigate("/programhead/dashboard")}
            >
              <ArrowLeft size={15} />
              Dashboard
            </button>

            <div className="ph-grade-change-eyebrow">
              <span>
                <FilePenLine size={16} />
              </span>
              Program Head · Grade Changes
            </div>

            <h1>INC Completion Requests</h1>

            <p>
              Review Faculty requests to complete previously approved Incomplete
              grades before they are forwarded to the Registrar for official
              posting.
            </p>
          </div>

          <button
            type="button"
            className="ph-grade-change-refresh"
            onClick={refreshQueue}
            disabled={loading || refreshing || processingRequestId !== null}
          >
            <RefreshCw
              size={16}
              className={refreshing ? "ph-grade-change-spin" : ""}
            />

            {refreshing ? "Refreshing..." : "Refresh Queue"}
          </button>
        </section>

        {actionNotice && (
          <section
            className={`ph-grade-change-notice ${actionNotice.type}`}
            role="status"
          >
            {actionNotice.type === "success" ? (
              <CheckCircle2 size={19} />
            ) : (
              <AlertCircle size={19} />
            )}

            <div>
              <strong>
                {actionNotice.type === "success"
                  ? "Request updated"
                  : "Request failed"}
              </strong>

              <p>{actionNotice.message}</p>
            </div>
          </section>
        )}

        <section
          className="ph-grade-change-summary"
          aria-label="INC completion request summary"
        >
          <article className="primary">
            <span>
              <ClipboardCheck size={18} />
            </span>
            <div>
              <small>Pending Review</small>
              <strong>{loading ? "…" : summary.pending}</strong>
              <p>Awaiting Program Head</p>
            </div>
          </article>

          <article>
            <span>
              <ShieldCheck size={18} />
            </span>
            <div>
              <small>For Registrar</small>
              <strong>{loading ? "…" : summary.registrar}</strong>
              <p>Approved requests</p>
            </div>
          </article>

          <article>
            <span>
              <Undo2 size={18} />
            </span>
            <div>
              <small>Returned</small>
              <strong>{loading ? "…" : summary.returned}</strong>
              <p>Needs Faculty correction</p>
            </div>
          </article>

          <article>
            <span>
              <XCircle size={18} />
            </span>
            <div>
              <small>Rejected</small>
              <strong>{loading ? "…" : summary.rejected}</strong>
              <p>Closed requests</p>
            </div>
          </article>

          <article>
            <span>
              <BadgeCheck size={18} />
            </span>
            <div>
              <small>Completed</small>
              <strong>{loading ? "…" : summary.completed}</strong>
              <p>Registrar posted</p>
            </div>
          </article>
        </section>

        <section className="ph-grade-change-filters">
          <div className="ph-grade-change-search">
            <Search size={16} />

            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search student, subject, or Faculty..."
            />
          </div>

          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as GradeChangeStatus | "All")
            }
          >
            <option value="All">All Statuses</option>
            <option value="Pending Program Head">Pending Program Head</option>
            <option value="For Registrar Processing">
              For Registrar Processing
            </option>
            <option value="Returned">Returned</option>
            <option value="Rejected">Rejected</option>
            <option value="Completed">Completed</option>
          </select>

          <button type="button" onClick={clearFilters}>
            <RotateCcw size={14} />
            Reset
          </button>
        </section>

        {error && !loading && (
          <section className="ph-grade-change-error" role="alert">
            <AlertCircle size={20} />

            <div>
              <strong>Grade change requests could not be loaded</strong>
              <p>{error}</p>
            </div>

            <button type="button" onClick={refreshQueue}>
              Try Again
            </button>
          </section>
        )}

        {loading && (
          <section className="ph-grade-change-loading">
            <div className="ph-grade-change-spinner" />

            <div>
              <strong>Loading INC completion requests</strong>
              <span>
                Retrieving Faculty requests and official grade snapshots...
              </span>
            </div>
          </section>
        )}

        {!loading && !error && filteredRequests.length === 0 && (
          <section className="ph-grade-change-empty">
            <CheckCircle2 size={26} />

            <strong>No matching INC completion requests</strong>

            <p>
              {requests.length === 0
                ? "There are currently no INC completion requests available."
                : "No requests match the current search and status filters."}
            </p>
          </section>
        )}

        {!loading && !error && filteredRequests.length > 0 && (
          <section className="ph-grade-change-list">
            <header>
              <div>
                <span>Review Queue</span>
                <h2>Grade Change Requests</h2>
                <p>
                  Compare the approved INC record against the Faculty's proposed
                  completed grade.
                </p>
              </div>

              <strong>
                {filteredRequests.length}{" "}
                {filteredRequests.length === 1 ? "request" : "requests"}
              </strong>
            </header>

            <div className="ph-grade-change-cards">
              {filteredRequests.map((request) => {
                const busy =
                  processingRequestId === request.grade_change_request_id;

                const pending = request.status === "Pending Program Head";

                return (
                  <article
                    className="ph-grade-change-card"
                    key={request.grade_change_request_id}
                  >
                    <div className="ph-grade-change-card-top">
                      <div className="ph-grade-change-student">
                        <span>
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
                        className={`ph-grade-change-status ${request.status
                          .toLowerCase()
                          .replace(/\s+/g, "-")}`}
                      >
                        {request.status}
                      </span>
                    </div>

                    <div className="ph-grade-change-context">
                      <div>
                        <BookOpenCheck size={15} />

                        <span>
                          <small>Subject</small>
                          <strong>
                            {request.class.subject.subject_code || "—"}
                          </strong>
                          <p>
                            {request.class.subject.subject_name ||
                              "Subject unavailable"}
                          </p>
                        </span>
                      </div>

                      <div>
                        <UserRound size={15} />

                        <span>
                          <small>Faculty</small>
                          <strong>
                            {request.faculty?.faculty_name ||
                              request.requested_by?.username ||
                              "Faculty"}
                          </strong>
                          <p>
                            {request.faculty?.employee_number ||
                              request.requested_by?.role ||
                              "Faculty request"}
                          </p>
                        </span>
                      </div>

                      <div>
                        <Clock3 size={15} />

                        <span>
                          <small>Requested</small>
                          <strong>
                            {formatDateTime(getRequestDate(request))}
                          </strong>
                          <p>
                            {request.class.section.section_name ||
                              "Section unavailable"}
                          </p>
                        </span>
                      </div>
                    </div>

                    <div className="ph-grade-change-comparison">
                      <section className="old">
                        <header>
                          <span>
                            <ShieldCheck size={16} />
                          </span>

                          <div>
                            <small>Current Official Grade</small>
                            <strong>Approved INC</strong>
                          </div>
                        </header>

                        <div className="ph-grade-change-grade-grid">
                          <div>
                            <small>Midterm</small>
                            <strong>
                              {formatGrade(
                                request.original_grade.midterm_grade,
                              )}
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
                              {getOutcomeLabel(
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

                        <div className="ph-grade-change-reason">
                          <small>Original INC Reason</small>
                          <p>
                            {request.original_grade.outcome_reason ||
                              "No reason recorded."}
                          </p>
                        </div>
                      </section>

                      <section className="new">
                        <header>
                          <span>
                            <FilePenLine size={16} />
                          </span>

                          <div>
                            <small>Proposed Completion Grade</small>
                            <strong>Faculty Request</strong>
                          </div>
                        </header>

                        <div className="ph-grade-change-grade-grid">
                          <div>
                            <small>Midterm</small>
                            <strong>
                              {formatGrade(
                                request.proposed_grade.midterm_grade,
                              )}
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
                              {getOutcomeLabel(
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

                        <div className="ph-grade-change-reason">
                          <small>Completion Remarks</small>

                          <p>{request.completion_remarks}</p>
                        </div>
                      </section>
                    </div>

                    {request.reviewed_by && (
                      <div className="ph-grade-change-reviewed">
                        <CheckCircle2 size={15} />

                        <div>
                          <strong>
                            Reviewed by{" "}
                            {request.reviewed_by.username || "Program Head"}
                          </strong>

                          <p>
                            {request.reviewed_by.review_remarks ||
                              request.review_remarks ||
                              "No review remarks."}
                          </p>

                          <small>
                            {formatDateTime(request.reviewed_by.reviewed_at)}
                          </small>
                        </div>
                      </div>
                    )}

                    <footer className="ph-grade-change-actions">
                      {pending ? (
                        <>
                          <button
                            type="button"
                            className="return"
                            onClick={() => openReviewDialog(request, "return")}
                            disabled={busy}
                          >
                            <Undo2 size={14} />
                            Return
                          </button>

                          <button
                            type="button"
                            className="reject"
                            onClick={() => openReviewDialog(request, "reject")}
                            disabled={busy}
                          >
                            <XCircle size={14} />
                            Reject
                          </button>

                          <button
                            type="button"
                            className="approve"
                            onClick={() => openReviewDialog(request, "approve")}
                            disabled={busy}
                          >
                            <Check size={14} />
                            Approve
                          </button>
                        </>
                      ) : (
                        <span className="ph-grade-change-readonly">
                          <ShieldCheck size={14} />
                          Request is no longer pending Program Head review.
                        </span>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {reviewDialog && (
          <div
            className="ph-grade-change-modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeReviewDialog();
              }
            }}
          >
            <section
              className={`ph-grade-change-modal ${reviewDialog.action}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="ph-grade-change-modal-title"
            >
              <header>
                <div>
                  <span className="ph-grade-change-modal-icon">
                    {reviewDialog.action === "approve" ? (
                      <Check size={18} />
                    ) : reviewDialog.action === "return" ? (
                      <Undo2 size={18} />
                    ) : (
                      <XCircle size={18} />
                    )}
                  </span>

                  <div>
                    <small>INC Completion Review</small>

                    <h2 id="ph-grade-change-modal-title">
                      {getActionTitle(reviewDialog.action)}
                    </h2>

                    <p>{getActionDescription(reviewDialog.action)}</p>
                  </div>
                </div>

                <button
                  type="button"
                  className="ph-grade-change-modal-close"
                  onClick={closeReviewDialog}
                  disabled={processingRequestId !== null}
                >
                  <X size={18} />
                </button>
              </header>

              <div className="ph-grade-change-modal-summary">
                <div>
                  <small>Student</small>
                  <strong>{reviewDialog.request.student.full_name}</strong>
                  <span>{reviewDialog.request.student.student_number}</span>
                </div>

                <div>
                  <small>Subject</small>
                  <strong>
                    {reviewDialog.request.class.subject.subject_code || "—"}
                  </strong>
                  <span>
                    {reviewDialog.request.class.subject.subject_name ||
                      "Subject unavailable"}
                  </span>
                </div>

                <div>
                  <small>Proposed Result</small>
                  <strong>
                    {formatGrade(
                      reviewDialog.request.proposed_grade.final_rating,
                    )}{" "}
                    — {reviewDialog.request.proposed_grade.remarks || "—"}
                  </strong>
                  <span>
                    {formatPercentage(
                      reviewDialog.request.proposed_grade.overall_percentage,
                    )}
                  </span>
                </div>
              </div>

              <div className="ph-grade-change-modal-field">
                <div>
                  <label htmlFor="ph-grade-change-review-remarks">
                    {reviewDialog.action === "approve"
                      ? "Review Remarks"
                      : reviewDialog.action === "return"
                        ? "Return Reason"
                        : "Rejection Reason"}
                  </label>

                  <span>{reviewRemarks.length}/1000</span>
                </div>

                <textarea
                  id="ph-grade-change-review-remarks"
                  value={reviewRemarks}
                  onChange={(event) => setReviewRemarks(event.target.value)}
                  maxLength={1000}
                  rows={5}
                  disabled={processingRequestId !== null}
                  placeholder={
                    reviewDialog.action === "approve"
                      ? "Optional approval remarks..."
                      : reviewDialog.action === "return"
                        ? "Explain what the Faculty must correct..."
                        : "Explain why this completion request is rejected..."
                  }
                />

                {reviewError && (
                  <div className="ph-grade-change-modal-error" role="alert">
                    <AlertCircle size={15} />
                    {reviewError}
                  </div>
                )}
              </div>

              <footer>
                <button
                  type="button"
                  className="cancel"
                  onClick={closeReviewDialog}
                  disabled={processingRequestId !== null}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className={`confirm ${reviewDialog.action}`}
                  onClick={() => void submitReviewAction()}
                  disabled={processingRequestId !== null}
                >
                  {reviewDialog.action === "approve" ? (
                    <Check size={14} />
                  ) : reviewDialog.action === "return" ? (
                    <Undo2 size={14} />
                  ) : (
                    <XCircle size={14} />
                  )}

                  {processingRequestId !== null
                    ? "Processing..."
                    : reviewDialog.action === "approve"
                      ? "Approve & Send to Registrar"
                      : reviewDialog.action === "return"
                        ? "Return to Faculty"
                        : "Reject Request"}
                </button>
              </footer>
            </section>
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
