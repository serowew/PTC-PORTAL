import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileText,
  GraduationCap,
  Loader2,
  ReceiptText,
  RefreshCw,
  Send,
  WalletCards,
  X,
} from "lucide-react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/StudentRequestDocument.css";
const DOCUMENT_REQUEST_API =
  "http://localhost:3000/api/student/document-requests";
type DocumentType = "COR" | "COG";
interface AcademicPeriod {
  academic_year_id: number | null;
  academic_year: string | null;
  semester_id: number | null;
  semester_name: string | null;
  enrollment_status: string | null;
}
interface AvailableEnrollment {
  enrollment_id: number;
  academic_year_id: number;
  academic_year: string;
  semester_id: number;
  semester_name: string;
  enrollment_status: string;
  approved_at: string | null;
}
interface StudentSummary {
  student_id: number;
  student_number: string;
  student_name: string;
}
interface DocumentRequest {
  request_id: number;
  request_number: string;
  student_id: number;
  enrollment_id: number | null;
  academic_period: AcademicPeriod | null;
  document_type: DocumentType;
  purpose: string | null;
  copies: number;
  requested_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  ticket_id: number | null;
  ticket_number: string | null;
  amount_due: number | string | null;
  amount_paid: number | string | null;
  payment_method: string | null;
  receipt_number: string | null;
  payment_status: string;
  registrar_status: string;
  paid_at: string | null;
  registrar_started_at: string | null;
  registrar_completed_at: string | null;
  ticket_created_at: string | null;
}
interface RequestsResponse {
  success?: boolean;
  code?: string;
  message?: string;
  student?: StudentSummary;
  available_enrollments?: AvailableEnrollment[];
  requests?: DocumentRequest[];
}
interface CreateRequestResponse {
  success?: boolean;
  code?: string;
  message?: string;
  request?: {
    request_id: number;
    request_number: string;
    document_type: DocumentType;
    enrollment_id: number;
    academic_period: {
      academic_year_id: number;
      academic_year: string;
      semester_id: number;
      semester_name: string;
      enrollment_status: string;
    };
    purpose: string | null;
    copies: number;
  };
  ticket?: {
    ticket_id: number;
    ticket_number: string;
    transaction_type: string;
    amount_due: number | null;
    amount_paid: number;
    payment_status: string;
    registrar_status: string;
  };
  student?: StudentSummary;
}
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
    return "Not assigned yet";
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
function formatAcademicPeriod(
  period:
    | Pick<AvailableEnrollment, "academic_year" | "semester_name">
    | AcademicPeriod
    | null
    | undefined,
) {
  if (!period?.academic_year || !period?.semester_name) {
    return "Not recorded (legacy request)";
  }
  return `${period.academic_year} — ${period.semester_name}`;
}
function paymentStatusClass(status: string) {
  if (status === "Paid") {
    return "document-status document-status--success";
  }
  if (status === "Pending Payment") {
    return "document-status document-status--warning";
  }
  if (status === "Cancelled" || status === "Refunded") {
    return "document-status document-status--danger";
  }
  return "document-status document-status--neutral";
}
function registrarStatusClass(status: string) {
  if (status === "Done") {
    return "document-status document-status--success";
  }
  if (status === "Processing") {
    return "document-status document-status--info";
  }
  if (status === "Ready for Processing") {
    return "document-status document-status--purple";
  }
  if (status === "Rejected" || status === "Cancelled") {
    return "document-status document-status--danger";
  }
  return "document-status document-status--neutral";
}
export default function RequestDocument() {
  const navigate = useNavigate();
  const session = authService.getSession();
  const token = authService.getToken();
  const role = session?.role ?? null;
  const isStudent = role === "Student" && Boolean(token);
  const [documentType, setDocumentType] = useState<DocumentType>("COR");
  const [availableEnrollments, setAvailableEnrollments] = useState<
    AvailableEnrollment[]
  >([]);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<
    number | null
  >(null);
  const [purpose, setPurpose] = useState("");
  const [copies, setCopies] = useState(1);
  const [requests, setRequests] = useState<DocumentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [createdRequest, setCreatedRequest] =
    useState<CreateRequestResponse | null>(null);
  const [selectedRequest, setSelectedRequest] =
    useState<DocumentRequest | null>(null);
  useEffect(() => {
    if (!isStudent) {
      navigate("/login", {
        replace: true,
      });
    }
  }, [isStudent, navigate]);
  const loadRequests = useCallback(async () => {
    if (!isStudent) {
      return;
    }
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await authService.authFetch(DOCUMENT_REQUEST_API, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
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
      const data = (await response.json()) as RequestsResponse;
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load document requests.");
      }
      const loadedEnrollments = Array.isArray(data.available_enrollments)
        ? data.available_enrollments
        : [];
      setAvailableEnrollments(loadedEnrollments);
      setSelectedEnrollmentId((currentEnrollmentId) => {
        if (
          currentEnrollmentId &&
          loadedEnrollments.some(
            (enrollment) =>
              Number(enrollment.enrollment_id) === Number(currentEnrollmentId),
          )
        ) {
          return currentEnrollmentId;
        }
        return null;
      });
      setRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch (error) {
      console.error("LOAD DOCUMENT REQUESTS ERROR:", error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load document requests.",
      );
    } finally {
      setLoading(false);
    }
  }, [isStudent, navigate]);
  useEffect(() => {
    if (!isStudent) {
      return;
    }
    void loadRequests();
  }, [isStudent, loadRequests]);
  useEffect(() => {
    if (!selectedRequest) {
      document.body.style.overflow = "";
      return;
    }
    document.body.style.overflow = "hidden";
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedRequest(null);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleEscape);
    };
  }, [selectedRequest]);
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setErrorMessage("");
    setSuccessMessage("");
    setCreatedRequest(null);
    if (!selectedEnrollmentId) {
      setErrorMessage(
        "Please select the academic year and semester for this document request.",
      );
      return;
    }
    const selectedEnrollmentExists = availableEnrollments.some(
      (enrollment) =>
        Number(enrollment.enrollment_id) === Number(selectedEnrollmentId),
    );
    if (!selectedEnrollmentExists) {
      setErrorMessage(
        "The selected academic period is no longer available. Refresh the page and choose again.",
      );
      return;
    }
    if (!Number.isInteger(copies) || copies < 1) {
      setErrorMessage("Copies must be at least 1.");
      return;
    }
    try {
      setSubmitting(true);
      const response = await authService.authFetch(DOCUMENT_REQUEST_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          document_type: documentType,
          enrollment_id: selectedEnrollmentId,
          purpose: purpose.trim(),
          copies,
        }),
      });
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
      const data = (await response.json()) as CreateRequestResponse;
      if (!response.ok || !data.success) {
        if (data.code === "ACTIVE_DOCUMENT_REQUEST_EXISTS") {
          throw new Error(
            data.message ||
              `You already have an active ${documentType} request.`,
          );
        }
        throw new Error(data.message || "Unable to create document request.");
      }
      setCreatedRequest(data);
      setSuccessMessage(
        data.message || `${documentType} request created successfully.`,
      );
      setSelectedEnrollmentId(null);
      setPurpose("");
      setCopies(1);
      await loadRequests();
    } catch (error) {
      console.error("CREATE DOCUMENT REQUEST ERROR:", error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to create document request.",
      );
    } finally {
      setSubmitting(false);
    }
  };
  const handleRefresh = () => {
    void loadRequests();
  };
  if (!isStudent) {
    return null;
  }
  return (
    <DashboardLayout>
      <main className="request-document-page">
        <section className="request-document-hero">
          <div className="request-document-hero__content">
            <div className="request-document-kicker">
              <span className="request-document-kicker__icon">
                <FileText size={16} aria-hidden="true" />
              </span>
              <span>Student · Documents</span>
            </div>
            <h1>Request Document</h1>
            <p>
              Request your Certificate of Registration or Certificate of Grades,
              then track payment and Registrar processing from one place.
            </p>
          </div>
          <button
            type="button"
            className="request-document-refresh"
            onClick={handleRefresh}
          >
            <RefreshCw size={16} />
            <span>Refresh</span>
          </button>
        </section>
        <section className="request-document-panel request-document-panel--form">
          <header className="request-document-section-header">
            <div>
              <span className="request-document-section-eyebrow">
                New Request
              </span>
              <h2>Choose a Document</h2>
              <p>
                Select the document and approved academic period you need. A
                Finance ticket is created automatically after submission.
              </p>
            </div>
          </header>
          {errorMessage && (
            <div className="request-document-alert request-document-alert--error">
              {errorMessage}
            </div>
          )}
          {successMessage && (
            <div className="request-document-alert request-document-alert--success">
              {successMessage}
            </div>
          )}
          {!loading && availableEnrollments.length === 0 && (
            <div className="request-document-alert request-document-alert--warning">
              No approved enrollment period is available for document requests.
              A COR or COG request can only be created from an approved
              enrollment.
            </div>
          )}
          <form className="request-document-form" onSubmit={handleSubmit}>
            <div className="request-document-field request-document-field--documents">
              <span className="request-document-field__label">
                Available Documents
              </span>
              <div
                className="request-document-type-options"
                role="radiogroup"
                aria-label="Available documents"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={documentType === "COR"}
                  className={`request-document-type-option ${
                    documentType === "COR"
                      ? "request-document-type-option--selected"
                      : ""
                  }`}
                  onClick={() => setDocumentType("COR")}
                  disabled={submitting}
                >
                  <span className="request-document-type-option__icon">
                    <ClipboardList size={18} aria-hidden="true" />
                  </span>
                  <span className="request-document-type-option__copy">
                    <strong>Certificate of Registration</strong>
                    <small>COR · Official enrollment and registered subjects</small>
                  </span>
                  {documentType === "COR" && (
                    <CheckCircle2
                      size={17}
                      className="request-document-type-option__check"
                      aria-hidden="true"
                    />
                  )}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={documentType === "COG"}
                  className={`request-document-type-option ${
                    documentType === "COG"
                      ? "request-document-type-option--selected"
                      : ""
                  }`}
                  onClick={() => setDocumentType("COG")}
                  disabled={submitting}
                >
                  <span className="request-document-type-option__icon">
                    <GraduationCap size={18} aria-hidden="true" />
                  </span>
                  <span className="request-document-type-option__copy">
                    <strong>Certificate of Grades</strong>
                    <small>COG · Official grades for the selected period</small>
                  </span>
                  {documentType === "COG" && (
                    <CheckCircle2
                      size={17}
                      className="request-document-type-option__check"
                      aria-hidden="true"
                    />
                  )}
                </button>
              </div>
            </div>
            <label className="request-document-field">
              <span className="request-document-field__label">
                Academic Period
              </span>
              <select
                value={selectedEnrollmentId ?? ""}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setSelectedEnrollmentId(
                    Number.isInteger(value) && value > 0 ? value : null,
                  );
                  setErrorMessage("");
                }}
                disabled={
                  submitting || loading || availableEnrollments.length === 0
                }
                required
              >
                <option value="">
                  {loading
                    ? "Loading approved academic periods..."
                    : availableEnrollments.length === 0
                      ? "No approved academic periods available"
                      : "Select academic year and semester"}
                </option>
                {availableEnrollments.map((enrollment) => (
                  <option
                    key={enrollment.enrollment_id}
                    value={enrollment.enrollment_id}
                  >
                    {enrollment.academic_year} — {enrollment.semester_name}
                  </option>
                ))}
              </select>
              <span className="request-document-field__hint">
                The selected period will be locked to this request and used by
                the Registrar when generating your COR or COG.
              </span>
            </label>
            <label className="request-document-field">
              <span className="request-document-field__label">
                Number of Copies
              </span>
              <input
                type="number"
                min={1}
                step={1}
                value={copies}
                disabled={submitting}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setCopies(
                    Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1,
                  );
                }}
              />
            </label>
            <label className="request-document-field request-document-field--full">
              <span className="request-document-field__label">Purpose</span>
              <textarea
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                maxLength={255}
                rows={4}
                placeholder="Example: Scholarship requirement, employment, personal copy..."
                disabled={submitting}
              />
              <span className="request-document-field__counter">
                {purpose.length}/255
              </span>
            </label>
            <div className="request-document-form__actions">
              <button
                type="submit"
                className="request-document-submit"
                disabled={
                  submitting ||
                  loading ||
                  availableEnrollments.length === 0 ||
                  !selectedEnrollmentId
                }
              >
                {submitting ? (
                  <>
                    <Loader2
                      size={17}
                      className="request-document-spin"
                      aria-hidden="true"
                    />
                    Creating...
                  </>
                ) : (
                  <>
                    <Send size={17} aria-hidden="true" />
                    Submit Request
                  </>
                )}
              </button>
            </div>
          </form>
        </section>
        {createdRequest?.request && createdRequest.ticket && (
          <section className="request-document-created">
            <div className="request-document-created__heading">
              <span className="request-document-created__icon">
                <CheckCircle2 size={22} aria-hidden="true" />
              </span>
              <div>
                <h2>Request Successfully Created</h2>
                <p>Present the Finance ticket number to the Cashier.</p>
              </div>
            </div>
            <div className="request-document-info-grid">
              <InfoBox
                label="Request Number"
                value={createdRequest.request.request_number}
              />
              <InfoBox
                label="Academic Period"
                value={formatAcademicPeriod(
                  createdRequest.request.academic_period,
                )}
              />
              <InfoBox
                label="Finance Ticket"
                value={createdRequest.ticket.ticket_number}
              />
              <InfoBox
                label="Payment Status"
                value={createdRequest.ticket.payment_status}
              />
              <InfoBox
                label="Registrar Status"
                value={createdRequest.ticket.registrar_status}
              />
            </div>
          </section>
        )}
        <section className="request-document-panel request-document-panel--history">
          <header className="request-document-history-header">
            <div>
              <span className="request-document-section-eyebrow">
                Request History
              </span>
              <h2>My Document Requests</h2>
              <p>Track payment and Registrar processing here.</p>
            </div>
          </header>
          {loading ? (
            <div className="request-document-loading">
              <Loader2
                size={22}
                className="request-document-spin"
                aria-hidden="true"
              />
              <span>Loading document requests...</span>
            </div>
          ) : requests.length === 0 ? (
            <div className="request-document-empty">
              <span className="request-document-empty__icon">
                <FileText size={30} aria-hidden="true" />
              </span>
              <strong>No document requests yet.</strong>
              <p>Submit your first COR or COG request above.</p>
            </div>
          ) : (
            <div className="request-document-history-list">
              {requests.map((request) => (
                <button
                  type="button"
                  key={request.request_id}
                  className="request-document-history-card request-document-history-card--clickable"
                  onClick={() => setSelectedRequest(request)}
                >
                  <div className="request-document-history-card__header">
                    <div className="request-document-history-card__title-wrap">
                      <span className="request-document-history-card__icon">
                        <FileText size={18} aria-hidden="true" />
                      </span>
                      <div>
                        <h3>
                          {request.document_type === "COR"
                            ? "Certificate of Registration"
                            : "Certificate of Grades"}
                        </h3>
                        <p>{request.request_number}</p>
                      </div>
                    </div>
                    <div className="request-document-statuses">
                      <StatusBadge
                        label={request.payment_status}
                        className={paymentStatusClass(request.payment_status)}
                      />
                      <StatusBadge
                        label={request.registrar_status}
                        className={registrarStatusClass(
                          request.registrar_status,
                        )}
                      />
                    </div>
                  </div>
                  <div className="request-document-history-card__details">
                    <div>
                      <span>Academic Period</span>
                      <strong>
                        {formatAcademicPeriod(request.academic_period)}
                      </strong>
                    </div>
                    <div>
                      <span>Finance Ticket</span>
                      <strong>{request.ticket_number || "Not generated"}</strong>
                    </div>
                    <div>
                      <span>Requested</span>
                      <strong>{formatDate(request.requested_at)}</strong>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
        {selectedRequest && (
          <div
            className="request-document-modal-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setSelectedRequest(null);
              }
            }}
          >
            <div
              className="request-document-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="request-document-modal-title"
            >
              <div className="request-document-modal__header">
                <div className="request-document-modal__title-wrap">
                  <span className="request-document-modal__icon">
                    <FileText size={22} aria-hidden="true" />
                  </span>
                  <div>
                    <h2 id="request-document-modal-title">
                      {selectedRequest.document_type === "COR"
                        ? "Certificate of Registration"
                        : "Certificate of Grades"}
                    </h2>
                    <p>
                      Requested {formatDate(selectedRequest.requested_at)}
                    </p>
                  </div>
                </div>
                <div className="request-document-modal__actions">
                  <StatusBadge
                    label={selectedRequest.payment_status}
                    className={paymentStatusClass(
                      selectedRequest.payment_status,
                    )}
                  />
                  <StatusBadge
                    label={selectedRequest.registrar_status}
                    className={registrarStatusClass(
                      selectedRequest.registrar_status,
                    )}
                  />
                  <button
                    type="button"
                    className="request-document-modal__close"
                    onClick={() => setSelectedRequest(null)}
                    aria-label="Close request details"
                  >
                    <X size={20} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="request-document-modal__body">
                <section className="request-document-modal__section">
                  <div className="request-document-modal__section-title">
                    <ReceiptText size={18} aria-hidden="true" />
                    <h3>Request Information</h3>
                  </div>
                  <div className="request-document-info-grid request-document-info-grid--modal">
                    <InfoBox
                      label="Request Number"
                      value={selectedRequest.request_number}
                    />
                    <InfoBox
                      label="Finance Ticket"
                      value={selectedRequest.ticket_number || "Not generated"}
                    />
                    <InfoBox
                      label="Academic Period"
                      value={formatAcademicPeriod(
                        selectedRequest.academic_period,
                      )}
                    />
                    <InfoBox
                      label="Copies"
                      value={String(selectedRequest.copies)}
                    />
                    <InfoBox
                      label="Amount Due"
                      value={formatMoney(selectedRequest.amount_due)}
                    />
                    <InfoBox
                      label="Amount Paid"
                      value={formatMoney(selectedRequest.amount_paid)}
                    />
                    <InfoBox
                      label="Payment Method"
                      value={selectedRequest.payment_method || "—"}
                    />
                    <InfoBox
                      label="Receipt Number"
                      value={selectedRequest.receipt_number || "—"}
                    />
                  </div>
                  <div className="request-document-purpose request-document-purpose--modal">
                    <span>Purpose</span>
                    <p>{selectedRequest.purpose || "—"}</p>
                  </div>
                </section>
                <section className="request-document-modal__section">
                  <div className="request-document-modal__section-title">
                    <WalletCards size={18} aria-hidden="true" />
                    <h3>Payment & Registrar Status</h3>
                  </div>
                  <div className="request-document-info-grid request-document-info-grid--modal">
                    <InfoBox
                      label="Payment Status"
                      value={selectedRequest.payment_status}
                    />
                    <InfoBox
                      label="Paid At"
                      value={formatDate(selectedRequest.paid_at)}
                    />
                    <InfoBox
                      label="Registrar Status"
                      value={selectedRequest.registrar_status}
                    />
                    <InfoBox
                      label="Processing Started"
                      value={formatDate(selectedRequest.registrar_started_at)}
                    />
                    <InfoBox
                      label="Completed At"
                      value={formatDate(selectedRequest.registrar_completed_at)}
                    />
                  </div>
                  {selectedRequest.cancellation_reason && (
                    <div className="request-document-cancellation-note">
                      <strong>Cancellation:</strong>{" "}
                      {selectedRequest.cancellation_reason}
                    </div>
                  )}
                  <RequestProgress
                    paymentStatus={selectedRequest.payment_status}
                    registrarStatus={selectedRequest.registrar_status}
                  />
                </section>
              </div>
              <div className="request-document-modal__footer">
                <button
                  type="button"
                  className="request-document-modal__done"
                  onClick={() => setSelectedRequest(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="request-document-info-box">
      <span>{label}</span>
      <strong>{value}</strong>
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
  return <span className={className}>{label}</span>;
}
function RequestProgress({
  paymentStatus,
  registrarStatus,
}: {
  paymentStatus: string;
  registrarStatus: string;
}) {
  const paymentComplete = paymentStatus === "Paid";
  const ready =
    registrarStatus === "Ready for Processing" ||
    registrarStatus === "Processing" ||
    registrarStatus === "Done";
  const processing =
    registrarStatus === "Processing" || registrarStatus === "Done";
  const done = registrarStatus === "Done";
  const steps = [
    {
      title: "Request Submitted",
      complete: true,
      icon: FileText,
    },
    {
      title: "Payment Completed",
      complete: paymentComplete,
      icon: WalletCards,
    },
    {
      title: "Ready for Registrar",
      complete: ready,
      icon: ReceiptText,
    },
    {
      title: "Processing",
      complete: processing,
      icon: Clock3,
    },
    {
      title: "Done",
      complete: done,
      icon: CheckCircle2,
    },
  ];
  return (
    <div className="request-document-progress">
      {steps.map((step) => {
        const Icon = step.icon;
        return (
          <div
            key={step.title}
            className={`request-document-progress__step ${
              step.complete ? "request-document-progress__step--complete" : ""
            }`}
          >
            <span className="request-document-progress__icon">
              <Icon size={14} aria-hidden="true" />
            </span>
            <span>{step.title}</span>
          </div>
        );
      })}
    </div>
  );
}
