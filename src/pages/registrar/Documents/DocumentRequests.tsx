import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import {
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileText,
  Loader2,
  PlayCircle,
  RefreshCcw,
  Search,
  UserRound,
  WalletCards,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/registrar-document-request.css";

const REGISTRAR_DOCUMENT_REQUESTS_API = apiUrl(
  "/api/registrar/document-requests",
);

type RegistrarStatus =
  | "Pending"
  | "Ready for Processing"
  | "Processing"
  | "Done"
  | "Rejected"
  | "Cancelled"
  | string;

interface RegistrarDocumentRequest {
  ticket_id: number;
  ticket_number: string;

  student: {
    student_id: number;
    student_number: string;
    student_name: string;
  };

  transaction: {
    transaction_code: string;
    transaction_name: string;
  };

  document_request: {
    request_id: number;
    request_number: string;
    document_type: string;
    enrollment_id: number | null;
    academic_period: {
      academic_year_id: number | null;
      academic_year: string | null;
      semester_id: number | null;
      semester_name: string | null;
      enrollment_status: string | null;
    } | null;
    purpose: string | null;
    copies: number;
    requested_at: string | null;
  };

  payment: {
    amount_due: number | string | null;
    amount_paid: number | string | null;
    payment_method: string | null;
    receipt_number: string | null;
    payment_status: string;
    paid_at: string | null;
  };

  registrar: {
    status: RegistrarStatus;
    remarks: string | null;
    processed_by: number | null;
    started_at: string | null;
    completed_at: string | null;
  };

  created_at: string | null;
  updated_at: string | null;
}

interface QueueResponse {
  success?: boolean;
  code?: string;
  message?: string;
  requests?: RegistrarDocumentRequest[];
}

interface ActionResponse {
  success?: boolean;
  code?: string;
  message?: string;

  request?: {
    ticket_id: number;
    ticket_number: string;
    request_number: string;
    document_type: string;
    student_number: string;
    student_name: string;
    payment_status: string;
    registrar_status: string;
    registrar_processed_by: number;
  };
}

type FilterStatus = "All" | "Ready for Processing" | "Processing" | "Done";

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMoney(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return String(value);
  }

  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount);
}

function statusClass(status: string) {
  if (status === "Ready for Processing") {
    return "registrar-doc-request__status--ready";
  }

  if (status === "Processing") {
    return "registrar-doc-request__status--processing";
  }

  if (status === "Done") {
    return "registrar-doc-request__status--done";
  }

  if (status === "Rejected" || status === "Cancelled") {
    return "registrar-doc-request__status--danger";
  }

  return "registrar-doc-request__status--default";
}

function formatAcademicPeriod(request: RegistrarDocumentRequest) {
  const period = request.document_request.academic_period;

  if (!period) {
    return "Legacy request — not recorded";
  }

  return `${period.academic_year ?? "—"} — ${period.semester_name ?? "—"}`;
}

export default function DocumentRequest() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();

  const role = session?.role ?? null;
  const isRegistrar = role === "Registrar" && Boolean(token);

  const [requests, setRequests] = useState<RegistrarDocumentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("All");

  const [selectedTicketNumber, setSelectedTicketNumber] = useState<
    string | null
  >(null);

  const [remarks, setRemarks] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (!isRegistrar) {
      navigate("/login", {
        replace: true,
      });
    }
  }, [isRegistrar, navigate]);

  const loadRequests = useCallback(
    async (showRefreshLoader = false) => {
      if (!isRegistrar) {
        return;
      }

      if (showRefreshLoader) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setErrorMessage("");

      try {
        const response = await authService.authFetch(
          REGISTRAR_DOCUMENT_REQUESTS_API,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
          },
        );

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        if (response.status === 403) {
          navigate("/login", {
            replace: true,
          });

          return;
        }

        const data = (await response.json()) as QueueResponse;

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || "Unable to load Registrar document requests.",
          );
        }

        setRequests(Array.isArray(data.requests) ? data.requests : []);
      } catch (error) {
        console.error("LOAD REGISTRAR REQUESTS ERROR:", error);

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to load Registrar document requests.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [isRegistrar, navigate],
  );

  useEffect(() => {
    if (!isRegistrar) {
      return;
    }

    void loadRequests();
  }, [isRegistrar, loadRequests]);

  const summary = useMemo(() => {
    let ready = 0;
    let processing = 0;
    let done = 0;

    for (const request of requests) {
      if (request.registrar.status === "Ready for Processing") {
        ready += 1;
      }

      if (request.registrar.status === "Processing") {
        processing += 1;
      }

      if (request.registrar.status === "Done") {
        done += 1;
      }
    }

    return {
      total: requests.length,
      ready,
      processing,
      done,
    };
  }, [requests]);

  const filteredRequests = useMemo(() => {
    const search = searchText.trim().toLowerCase();

    return requests.filter((request) => {
      if (statusFilter !== "All" && request.registrar.status !== statusFilter) {
        return false;
      }

      if (!search) {
        return true;
      }

      const searchable = [
        request.ticket_number,
        request.student.student_number,
        request.student.student_name,
        request.document_request.request_number,
        request.document_request.document_type,
        request.document_request.academic_period?.academic_year ?? "",
        request.document_request.academic_period?.semester_name ?? "",
        request.transaction.transaction_name,
        request.payment.receipt_number ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(search);
    });
  }, [requests, searchText, statusFilter]);

  const selectedRequest = useMemo(() => {
    if (!selectedTicketNumber) {
      return null;
    }

    return (
      requests.find(
        (request) => request.ticket_number === selectedTicketNumber,
      ) ?? null
    );
  }, [requests, selectedTicketNumber]);

  const selectRequest = (request: RegistrarDocumentRequest) => {
    setSelectedTicketNumber(request.ticket_number);
    setRemarks(request.registrar.remarks ?? "");
    setErrorMessage("");
    setSuccessMessage("");
  };

  const handleViewCOR = () => {
    if (!selectedRequest) {
      return;
    }

    if (selectedRequest.document_request.document_type !== "COR") {
      return;
    }

    if (selectedRequest.payment.payment_status !== "Paid") {
      setErrorMessage(
        "The COR cannot be opened until payment has been completed.",
      );
      return;
    }

    if (
      selectedRequest.registrar.status !== "Processing" &&
      selectedRequest.registrar.status !== "Done"
    ) {
      setErrorMessage(
        "Start Registrar processing before opening the official COR.",
      );
      return;
    }

    const enrollmentId = selectedRequest.document_request.enrollment_id;

    if (!enrollmentId) {
      setErrorMessage(
        "This COR request does not have a recorded academic period. It is a legacy request and cannot be opened as an exact requested COR.",
      );
      return;
    }

    setErrorMessage("");

    navigate(
      `/registrar/student/${selectedRequest.student.student_id}/CORR?enrollment_id=${encodeURIComponent(
        String(enrollmentId),
      )}&ticket_number=${encodeURIComponent(selectedRequest.ticket_number)}`,
    );
  };

  const handleStartProcessing = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedRequest || actionLoading) {
      return;
    }

    if (selectedRequest.payment.payment_status !== "Paid") {
      setErrorMessage(
        "This request cannot be processed because payment is not complete.",
      );
      return;
    }

    if (selectedRequest.registrar.status !== "Ready for Processing") {
      setErrorMessage(
        "Only requests that are Ready for Processing can be started.",
      );
      return;
    }

    if (selectedRequest.document_request.document_type === "COR") {
      const enrollmentId = selectedRequest.document_request.enrollment_id;

      if (!enrollmentId) {
        setErrorMessage(
          "This COR request does not have a recorded academic period. The exact COR cannot be opened for this legacy request.",
        );
        return;
      }
    }

    setActionLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await authService.authFetch(
        `${REGISTRAR_DOCUMENT_REQUESTS_API}/${encodeURIComponent(
          selectedRequest.ticket_number,
        )}/start`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            remarks: remarks.trim(),
          }),
        },
      );

      if (response.status === 401) {
        authService.logout();

        navigate("/login", {
          replace: true,
        });

        return;
      }

      const data = (await response.json()) as ActionResponse;

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Unable to start Registrar processing.",
        );
      }

      if (selectedRequest.document_request.document_type === "COR") {
        const enrollmentId = selectedRequest.document_request.enrollment_id;

        navigate(
          `/registrar/student/${selectedRequest.student.student_id}/CORR?enrollment_id=${encodeURIComponent(
            String(enrollmentId),
          )}&ticket_number=${encodeURIComponent(
            selectedRequest.ticket_number,
          )}`,
        );

        return;
      }

      setSuccessMessage(data.message || "Registrar processing has started.");

      await loadRequests(true);
    } catch (error) {
      console.error("START REGISTRAR PROCESSING ERROR:", error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to start Registrar processing.",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleComplete = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedRequest || actionLoading) {
      return;
    }

    if (selectedRequest.payment.payment_status !== "Paid") {
      setErrorMessage(
        "This request cannot be completed because payment is not complete.",
      );
      return;
    }

    if (selectedRequest.registrar.status !== "Processing") {
      setErrorMessage(
        "The request must be Processing before it can be marked Done.",
      );
      return;
    }

    setActionLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await authService.authFetch(
        `${REGISTRAR_DOCUMENT_REQUESTS_API}/${encodeURIComponent(
          selectedRequest.ticket_number,
        )}/complete`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            remarks: remarks.trim(),
          }),
        },
      );

      if (response.status === 401) {
        authService.logout();

        navigate("/login", {
          replace: true,
        });

        return;
      }

      const data = (await response.json()) as ActionResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to complete document request.");
      }

      setSuccessMessage(
        data.message || "Document request completed successfully.",
      );

      await loadRequests(true);
    } catch (error) {
      console.error("COMPLETE REGISTRAR REQUEST ERROR:", error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to complete document request.",
      );
    } finally {
      setActionLoading(false);
    }
  };

  if (!isRegistrar) {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="registrar-doc-request">
        <section className="registrar-doc-request__hero">
          <div className="registrar-doc-request__hero-inner">
            <div>
              <div className="registrar-doc-request__eyebrow">
                <FileCheck2 size={16} />
                Registrar Office
              </div>

              <h1>Document Requests</h1>

              <p>
                Process paid COR and COG requests forwarded by the Finance
                Office.
              </p>
            </div>

            <FileText
              className="registrar-doc-request__hero-icon"
              size={42}
              aria-hidden="true"
            />
          </div>
        </section>

        <section className="registrar-doc-request__summary-grid">
          <SummaryCard
            icon={<FileText size={23} />}
            label="Total Requests"
            value={summary.total}
          />

          <SummaryCard
            icon={<Clock3 size={23} />}
            label="Ready for Processing"
            value={summary.ready}
          />

          <SummaryCard
            icon={<PlayCircle size={23} />}
            label="Processing"
            value={summary.processing}
          />

          <SummaryCard
            icon={<CheckCircle2 size={23} />}
            label="Completed"
            value={summary.done}
          />
        </section>

        <section className="registrar-doc-request__toolbar-panel">
          <div className="registrar-doc-request__toolbar">
            <div className="registrar-doc-request__search">
              <Search size={17} aria-hidden="true" />

              <input
                type="text"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search ticket, student, request number..."
                className="registrar-doc-request__input registrar-doc-request__search-input"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as FilterStatus)
              }
              className="registrar-doc-request__input"
            >
              <option value="All">All Statuses</option>
              <option value="Ready for Processing">Ready for Processing</option>
              <option value="Processing">Processing</option>
              <option value="Done">Done</option>
            </select>

            <button
              type="button"
              onClick={() => void loadRequests(true)}
              disabled={refreshing}
              className="registrar-doc-request__refresh-button"
            >
              {refreshing ? (
                <Loader2 className="registrar-doc-request__spinner" size={16} />
              ) : (
                <RefreshCcw size={16} />
              )}
              Refresh
            </button>
          </div>
        </section>

        {errorMessage && (
          <div className="registrar-doc-request__message registrar-doc-request__message--error">
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div className="registrar-doc-request__message registrar-doc-request__message--success">
            {successMessage}
          </div>
        )}

        <section className="registrar-doc-request__panel">
          <div className="registrar-doc-request__panel-heading">
            <h2>Registrar Queue</h2>
            <p>
              {filteredRequests.length} request
              {filteredRequests.length === 1 ? "" : "s"} shown
            </p>
          </div>

          {loading ? (
            <div className="registrar-doc-request__loading-state">
              <Loader2 className="registrar-doc-request__spinner" size={20} />
              Loading Registrar requests...
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="registrar-doc-request__empty-state">
              <FileText size={34} />
              <p>No document requests found.</p>
            </div>
          ) : (
            <div className="registrar-doc-request__request-list">
              {filteredRequests.map((request) => {
                const isSelected =
                  selectedTicketNumber === request.ticket_number;

                return (
                  <article
                    key={request.ticket_id}
                    onClick={() => selectRequest(request)}
                    className={`registrar-doc-request__request-card${
                      isSelected
                        ? " registrar-doc-request__request-card--selected"
                        : ""
                    }`}
                  >
                    <div className="registrar-doc-request__request-top">
                      <div>
                        <div className="registrar-doc-request__request-title">
                          <FileText size={17} />
                          {request.transaction.transaction_name}
                        </div>

                        <div className="registrar-doc-request__request-meta">
                          {request.ticket_number} •{" "}
                          {request.document_request.request_number}
                        </div>
                      </div>

                      <StatusBadge
                        label={request.registrar.status}
                        className={statusClass(request.registrar.status)}
                      />
                    </div>

                    <div className="registrar-doc-request__info-grid">
                      <InfoBox
                        label="Student"
                        value={request.student.student_name}
                      />

                      <InfoBox
                        label="Student Number"
                        value={request.student.student_number}
                      />

                      <InfoBox
                        label="Academic Period"
                        value={formatAcademicPeriod(request)}
                      />

                      <InfoBox
                        label="Payment"
                        value={request.payment.payment_status}
                      />

                      <InfoBox
                        label="Paid Amount"
                        value={formatMoney(request.payment.amount_paid)}
                      />

                      <InfoBox
                        label="Paid At"
                        value={formatDate(request.payment.paid_at)}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {selectedRequest && (
          <section className="registrar-doc-request__panel registrar-doc-request__details">
            <div className="registrar-doc-request__details-header">
              <div>
                <p className="registrar-doc-request__section-label">
                  Selected Request
                </p>

                <h2>{selectedRequest.ticket_number}</h2>
              </div>

              <StatusBadge
                label={selectedRequest.registrar.status}
                className={statusClass(selectedRequest.registrar.status)}
              />
            </div>

            <div className="registrar-doc-request__student-card">
              <div className="registrar-doc-request__student-icon">
                <UserRound size={21} />
              </div>

              <div>
                <strong>{selectedRequest.student.student_name}</strong>
                <span>{selectedRequest.student.student_number}</span>
              </div>
            </div>

            <div className="registrar-doc-request__info-grid registrar-doc-request__info-grid--details">
              <InfoBox
                label="Document"
                value={selectedRequest.transaction.transaction_name}
              />

              <InfoBox
                label="Request Number"
                value={selectedRequest.document_request.request_number}
              />

              <InfoBox
                label="Academic Period"
                value={formatAcademicPeriod(selectedRequest)}
              />

              <InfoBox
                label="Copies"
                value={String(selectedRequest.document_request.copies)}
              />

              <InfoBox
                label="Payment Status"
                value={selectedRequest.payment.payment_status}
              />

              <InfoBox
                label="Amount Paid"
                value={formatMoney(selectedRequest.payment.amount_paid)}
              />

              <InfoBox
                label="Payment Method"
                value={selectedRequest.payment.payment_method ?? "—"}
              />

              <InfoBox
                label="Receipt Number"
                value={selectedRequest.payment.receipt_number ?? "—"}
              />

              <InfoBox
                label="Paid At"
                value={formatDate(selectedRequest.payment.paid_at)}
              />

              <InfoBox
                label="Started At"
                value={formatDate(selectedRequest.registrar.started_at)}
              />

              <InfoBox
                label="Completed At"
                value={formatDate(selectedRequest.registrar.completed_at)}
              />
            </div>

            {selectedRequest.document_request.purpose && (
              <div className="registrar-doc-request__purpose">
                <div>Purpose</div>
                <p>{selectedRequest.document_request.purpose}</p>
              </div>
            )}

            {selectedRequest.registrar.status === "Ready for Processing" && (
              <form
                onSubmit={handleStartProcessing}
                className="registrar-doc-request__workflow-card registrar-doc-request__workflow-card--ready"
              >
                <div className="registrar-doc-request__workflow-heading registrar-doc-request__workflow-heading--ready">
                  <PlayCircle size={21} />
                  <strong>Start Registrar Processing</strong>
                </div>

                <label className="registrar-doc-request__field-label">
                  Registrar Remarks
                  <textarea
                    value={remarks}
                    onChange={(event) => setRemarks(event.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder="Optional processing remarks."
                    disabled={actionLoading}
                    className="registrar-doc-request__input registrar-doc-request__textarea"
                  />
                </label>

                <div className="registrar-doc-request__workflow-actions">
                  <ActionButton
                    loading={actionLoading}
                    label={
                      selectedRequest.document_request.document_type === "COR"
                        ? "Process & View COR"
                        : "Start Processing"
                    }
                    loadingLabel={
                      selectedRequest.document_request.document_type === "COR"
                        ? "Opening COR..."
                        : "Starting..."
                    }
                    icon={<PlayCircle size={17} />}
                  />
                </div>
              </form>
            )}

            {selectedRequest.registrar.status === "Processing" && (
              <form
                onSubmit={handleComplete}
                className="registrar-doc-request__workflow-card registrar-doc-request__workflow-card--processing"
              >
                <div className="registrar-doc-request__workflow-heading registrar-doc-request__workflow-heading--processing">
                  <FileCheck2 size={21} />
                  <strong>Complete Document Request</strong>
                </div>

                <label className="registrar-doc-request__field-label">
                  Completion Remarks
                  <textarea
                    value={remarks}
                    onChange={(event) => setRemarks(event.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder="Example: COR prepared and released to student."
                    disabled={actionLoading}
                    className="registrar-doc-request__input registrar-doc-request__textarea"
                  />
                </label>

                <div className="registrar-doc-request__workflow-actions registrar-doc-request__workflow-actions--multiple">
                  {selectedRequest.document_request.document_type === "COR" && (
                    <button
                      type="button"
                      onClick={handleViewCOR}
                      disabled={actionLoading}
                      className="registrar-doc-request__secondary-button"
                    >
                      <FileText size={17} />
                      View / Print COR
                    </button>
                  )}

                  <ActionButton
                    loading={actionLoading}
                    label="Mark as Done"
                    loadingLabel="Completing..."
                    icon={<CheckCircle2 size={17} />}
                  />
                </div>
              </form>
            )}

            {selectedRequest.registrar.status === "Done" && (
              <div className="registrar-doc-request__completed-card">
                <div className="registrar-doc-request__completed-heading">
                  <CheckCircle2 size={21} />
                  <strong>Request Completed</strong>
                </div>

                <p>
                  This document request has already been completed by the
                  Registrar.
                </p>

                {selectedRequest.registrar.remarks && (
                  <p>Remarks: {selectedRequest.registrar.remarks}</p>
                )}

                {selectedRequest.document_request.document_type === "COR" && (
                  <div className="registrar-doc-request__completed-actions">
                    <button
                      type="button"
                      onClick={handleViewCOR}
                      className="registrar-doc-request__secondary-button registrar-doc-request__secondary-button--compact"
                    >
                      <FileText size={17} />
                      View / Print COR
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <section className="registrar-doc-request__workflow-info">
          <WalletCards size={21} />

          <div>
            <strong>Registrar Workflow</strong>

            <p>
              Only Finance-paid requests appear in this queue. Registrar can
              move a request from Ready for Processing to Processing, then from
              Processing to Done. Registrar does not change the student's
              payment status.
            </p>
          </div>
        </section>
      </main>
    </DashboardLayout>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <article className="registrar-doc-request__summary-card">
      <div className="registrar-doc-request__summary-icon">{icon}</div>

      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="registrar-doc-request__info-box">
      <div className="registrar-doc-request__info-label">{label}</div>
      <div className="registrar-doc-request__info-value">{value}</div>
    </div>
  );
}

function StatusBadge({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span className={`registrar-doc-request__status ${className}`}>
      {label}
    </span>
  );
}

function ActionButton({
  loading,
  label,
  loadingLabel,
  icon,
}: {
  loading: boolean;
  label: string;
  loadingLabel: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="registrar-doc-request__primary-button"
    >
      {loading ? (
        <>
          <Loader2 className="registrar-doc-request__spinner" size={17} />
          {loadingLabel}
        </>
      ) : (
        <>
          {icon}
          {label}
        </>
      )}
    </button>
  );
}
