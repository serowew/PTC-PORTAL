import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  CreditCard,
  FileText,
  GraduationCap,
  ReceiptText,
  RefreshCcw,
  RefreshCw,
  Search,
  WalletCards,
  X,
} from "lucide-react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { api } from "../../../services/api";
import "../../../styles/StudentTransactions.css";
const STUDENT_TRANSACTIONS_API = `${api.baseUrl}/api/student/transactions`;
type PaymentStatus =
  | "Pending Payment"
  | "Paid"
  | "Cancelled"
  | "Refunded"
  | string;
interface StudentSummary {
  student_id: number;
  student_number: string;
  student_name: string;
}
interface TransactionSummary {
  total: number;
  pending_payment: number;
  paid: number;
  cancelled: number;
  refunded: number;
  total_outstanding: number;
  total_paid: number;
}
interface TransactionTypeInfo {
  transaction_type_id: number;
  transaction_code: string;
  transaction_name: string;
  description: string | null;
  workflow_type:
    | "FINANCE_ONLY"
    | "DOCUMENT_REQUEST"
    | "INCOMPLETE_GRADE"
    | string;
}
interface AcademicPeriod {
  academic_year: string | null;
  semester_name: string | null;
  enrollment_status: string | null;
}
interface DocumentRequestInfo {
  request_id: number;
  request_number: string;
  document_type: string;
  enrollment_id: number | null;
  academic_period: AcademicPeriod | null;
  purpose: string | null;
  copies: number;
  requested_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
}
interface PaymentInfo {
  amount_due: number | null;
  amount_paid: number;
  payment_method: string | null;
  receipt_number: string | null;
  payment_status: PaymentStatus;
  paid_at: string | null;
}
interface RegistrarInfo {
  status: string;
  remarks: string | null;
  started_at: string | null;
  completed_at: string | null;
}
interface StudentTransaction {
  ticket_id: number;
  ticket_number: string;
  source_type:
    | "STUDENT_REQUEST"
    | "FINANCE_MANUAL"
    | "FACULTY_VERIFIED"
    | "SYSTEM"
    | string;
  transaction: TransactionTypeInfo;
  document_request: DocumentRequestInfo | null;
  grade_id: number | null;
  payment: PaymentInfo;
  registrar: RegistrarInfo;
  finance_remarks: string | null;
  created_at: string;
  updated_at: string;
}
interface TransactionsResponse {
  success?: boolean;
  code?: string;
  message?: string;
  student?: StudentSummary;
  summary?: TransactionSummary;
  transactions?: StudentTransaction[];
}
type StatusFilter =
  | "All"
  | "Pending Payment"
  | "Paid"
  | "Cancelled"
  | "Refunded";
function formatMoney(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "Not set";
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "—";
  }
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(numericValue);
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
function getPaymentStatusClass(status: string) {
  if (status === "Paid") return "is-paid";
  if (status === "Pending Payment") return "is-pending";
  if (status === "Cancelled") return "is-cancelled";
  if (status === "Refunded") return "is-refunded";
  return "is-default";
}
function getRegistrarStatusClass(status: string) {
  if (status === "Done") return "is-done";
  if (status === "Ready for Processing" || status === "Processing") {
    return "is-processing";
  }
  if (status === "Pending") return "is-pending";
  if (status === "Cancelled" || status === "Rejected") {
    return "is-cancelled";
  }
  return "is-default";
}
function getSourceLabel(source: string) {
  if (source === "FINANCE_MANUAL") return "Assigned by Finance";
  if (source === "STUDENT_REQUEST") return "Student Request";
  if (source === "FACULTY_VERIFIED") return "Faculty Verified";
  if (source === "SYSTEM") return "System";
  return source
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
interface SummaryCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: ReactNode;
}
function SummaryCard({ title, value, subtitle, icon }: SummaryCardProps) {
  return (
    <article className="my-transactions__summary-card">
      <div className="my-transactions__summary-copy">
        <p className="my-transactions__summary-title">{title}</p>
        <div className="my-transactions__summary-value">{value}</div>
        <p className="my-transactions__summary-subtitle">{subtitle}</p>
      </div>
      <div className="my-transactions__summary-icon">{icon}</div>
    </article>
  );
}
interface DetailItemProps {
  label: string;
  value: ReactNode;
}
function DetailItem({ label, value }: DetailItemProps) {
  return (
    <div className="my-transactions__detail-item">
      <div className="my-transactions__detail-label">{label}</div>
      <div className="my-transactions__detail-value">{value}</div>
    </div>
  );
}
export default function MyTransactions() {
  const navigate = useNavigate();
  const session = authService.getSession();
  const token = authService.getToken();
  const role = session?.role ?? null;
  const isStudent = role === "Student" && Boolean(token);
  const [student, setStudent] = useState<StudentSummary | null>(null);
  const [summary, setSummary] = useState<TransactionSummary>({
    total: 0,
    pending_payment: 0,
    paid: 0,
    cancelled: 0,
    refunded: 0,
    total_outstanding: 0,
    total_paid: 0,
  });
  const [transactions, setTransactions] = useState<StudentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [selectedTransaction, setSelectedTransaction] =
    useState<StudentTransaction | null>(null);
  useEffect(() => {
    if (!isStudent) {
      navigate("/login", { replace: true });
    }
  }, [isStudent, navigate]);
  const loadTransactions = useCallback(
    async (showMainLoading = true) => {
      if (!isStudent) return;
      if (showMainLoading) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setErrorMessage("");
      try {
        const response = await authService.authFetch(STUDENT_TRANSACTIONS_API, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }
        if (response.status === 403) {
          navigate("/login", { replace: true });
          return;
        }
        const data = (await response.json()) as TransactionsResponse;
        if (!response.ok || !data.success) {
          throw new Error(data.message || "Unable to load your transactions.");
        }
        setStudent(data.student ?? null);
        setSummary({
          total: Number(data.summary?.total ?? 0),
          pending_payment: Number(data.summary?.pending_payment ?? 0),
          paid: Number(data.summary?.paid ?? 0),
          cancelled: Number(data.summary?.cancelled ?? 0),
          refunded: Number(data.summary?.refunded ?? 0),
          total_outstanding: Number(data.summary?.total_outstanding ?? 0),
          total_paid: Number(data.summary?.total_paid ?? 0),
        });
        setTransactions(
          Array.isArray(data.transactions) ? data.transactions : [],
        );
      } catch (error) {
        console.error("LOAD STUDENT TRANSACTIONS ERROR:", error);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to load your transactions.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [isStudent, navigate],
  );
  useEffect(() => {
    if (!isStudent) return;
    void loadTransactions();
  }, [isStudent, loadTransactions]);
  useEffect(() => {
    if (!selectedTransaction) {
      document.body.style.overflow = "";
      return;
    }
    document.body.style.overflow = "hidden";
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedTransaction(null);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleEscape);
    };
  }, [selectedTransaction]);
  const filteredTransactions = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    return transactions.filter((item) => {
      if (
        statusFilter !== "All" &&
        item.payment.payment_status !== statusFilter
      ) {
        return false;
      }
      if (!normalizedSearch) return true;
      const academicPeriod = item.document_request?.academic_period;
      const searchableText = [
        item.ticket_number,
        item.transaction.transaction_code,
        item.transaction.transaction_name,
        item.transaction.description ?? "",
        item.payment.receipt_number ?? "",
        item.payment.payment_method ?? "",
        item.payment.payment_status,
        item.document_request?.request_number ?? "",
        item.document_request?.document_type ?? "",
        academicPeriod?.academic_year ?? "",
        academicPeriod?.semester_name ?? "",
        getSourceLabel(item.source_type),
      ]
        .join(" ")
        .toLowerCase();
      return searchableText.includes(normalizedSearch);
    });
  }, [transactions, searchText, statusFilter]);
  if (!isStudent) return null;
  return (
    <DashboardLayout>
      <main className="my-transactions">
        <section className="my-transactions__hero">
          <div className="my-transactions__hero-content">
            <div className="my-transactions__hero-copy">
              <div className="my-transactions__eyebrow">
                <span className="my-transactions__eyebrow-icon">
                  <WalletCards size={16} aria-hidden="true" />
                </span>
                <span>Student · Transactions</span>
              </div>
              <h1>My Transactions</h1>
              <p>
                Review your payment records, Finance tickets, receipts, document
                requests, and Registrar processing status in one place.
              </p>
              {student && (
                <div className="my-transactions__student-meta">
                  <span className="my-transactions__student-number">
                    {student.student_number}
                  </span>
                  <span className="my-transactions__student-name">
                    {student.student_name}
                  </span>
                </div>
              )}
            </div>
            <button
              type="button"
              className="my-transactions__hero-refresh"
              onClick={() => void loadTransactions(false)}
              disabled={refreshing}
            >
              <RefreshCw size={16} className={refreshing ? "is-spinning" : ""} />
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </section>
        <section className="my-transactions__summary-grid">
          <SummaryCard
            title="Total Transactions"
            value={summary.total}
            subtitle="All transactions linked to your student account"
            icon={<ReceiptText size={21} />}
          />
          <SummaryCard
            title="Pending Payment"
            value={summary.pending_payment}
            subtitle="Transactions currently waiting for payment"
            icon={<Clock3 size={21} />}
          />
          <SummaryCard
            title="Paid"
            value={summary.paid}
            subtitle={`Total paid: ${formatMoney(summary.total_paid)}`}
            icon={<CheckCircle2 size={21} />}
          />
          <SummaryCard
            title="Outstanding"
            value={formatMoney(summary.total_outstanding)}
            subtitle="Known unpaid amounts currently assigned"
            icon={<CircleDollarSign size={21} />}
          />
        </section>
        {errorMessage && (
          <section className="my-transactions__alert my-transactions__alert--error">
            <AlertCircle size={19} aria-hidden="true" />
            <div>{errorMessage}</div>
          </section>
        )}
        <section className="my-transactions__history-card">
          <div className="my-transactions__history-heading">
            <div>
              <span className="my-transactions__section-kicker">
                Student Transactions
              </span>
              <h2>Transaction History</h2>
              <p>
                Search and review {filteredTransactions.length} transaction
                {filteredTransactions.length === 1 ? "" : "s"} currently shown.
              </p>
            </div>
          </div>
          <div className="my-transactions__filters">
            <label className="my-transactions__search">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search ticket, transaction, receipt..."
                aria-label="Search transactions"
              />
            </label>
            <select
              className="my-transactions__status-select"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
              aria-label="Filter transactions by payment status"
            >
              <option value="All">All Statuses</option>
              <option value="Pending Payment">Pending Payment</option>
              <option value="Paid">Paid</option>
              <option value="Cancelled">Cancelled</option>
              <option value="Refunded">Refunded</option>
            </select>
          </div>
        </section>
        {loading && (
          <section className="my-transactions__state-card" aria-live="polite">
            <div className="my-transactions__state-content">
              <RefreshCcw
                className="is-spinning"
                size={28}
                aria-hidden="true"
              />
              <strong>Loading your transactions...</strong>
              <span>Please wait while we retrieve your finance records.</span>
            </div>
          </section>
        )}
        {!loading && filteredTransactions.length === 0 && (
          <section className="my-transactions__state-card">
            <div className="my-transactions__empty-icon" aria-hidden="true">
              <ReceiptText size={27} />
            </div>
            <h3>No transactions found</h3>
            <p>
              There are no transactions matching your current search or status
              filter.
            </p>
          </section>
        )}
        {!loading && filteredTransactions.length > 0 && (
          <section className="my-transactions__list">
            {filteredTransactions.map((item) => {
              const isFinanceOnly =
                item.transaction.workflow_type === "FINANCE_ONLY";
              return (
                <button
                  type="button"
                  className="my-transactions__transaction-card"
                  key={item.ticket_id}
                  onClick={() => setSelectedTransaction(item)}
                  aria-label={`View ${item.transaction.transaction_name} transaction details`}
                >
                  <div
                    className={`my-transactions__transaction-card-icon ${
                      isFinanceOnly ? "is-finance" : "is-document"
                    }`}
                    aria-hidden="true"
                  >
                    {isFinanceOnly ? (
                      <CreditCard size={23} />
                    ) : (
                      <FileText size={23} />
                    )}
                  </div>
                  <div className="my-transactions__transaction-card-content">
                    <div className="my-transactions__transaction-card-heading">
                      <div>
                        <span className="my-transactions__transaction-code">
                          {item.transaction.transaction_code}
                        </span>
                        <h3>{item.transaction.transaction_name}</h3>
                      </div>
                      <span className="my-transactions__ticket-number">
                        {item.ticket_number}
                      </span>
                    </div>
                    <p>
                      {item.document_request?.requested_at
                        ? `Requested ${formatDate(
                            item.document_request.requested_at,
                          )}`
                        : `Created ${formatDate(item.created_at)}`}
                    </p>
                    <div className="my-transactions__transaction-meta">
                      <span>
                        <CircleDollarSign size={13} aria-hidden="true" />
                        Due {formatMoney(item.payment.amount_due)}
                      </span>
                      <span>
                        <WalletCards size={13} aria-hidden="true" />
                        Paid {formatMoney(item.payment.amount_paid)}
                      </span>
                      <span>
                        <ReceiptText size={13} aria-hidden="true" />
                        {getSourceLabel(item.source_type)}
                      </span>
                    </div>
                  </div>
                  <div className="my-transactions__transaction-card-status">
                    <span
                      className={`my-transactions__status-badge ${getPaymentStatusClass(
                        item.payment.payment_status,
                      )}`}
                    >
                      {item.payment.payment_status}
                    </span>
                    {!isFinanceOnly && (
                      <span
                        className={`my-transactions__registrar-badge ${getRegistrarStatusClass(
                          item.registrar.status,
                        )}`}
                      >
                        {item.registrar.status}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </section>
        )}
        {!loading && (
          <section className="my-transactions__guide">
            <div className="my-transactions__guide-icon" aria-hidden="true">
              <WalletCards size={20} />
            </div>
            <div>
              <strong>Transaction Status Guide</strong>
              <p>
                Pending Payment means the transaction still needs payment. Paid
                means Finance has confirmed it. Document requests may continue
                to Registrar processing after payment, while Finance-only
                transactions finish with Finance.
              </p>
            </div>
          </section>
        )}
        {selectedTransaction && (() => {
          const item = selectedTransaction;
          const isFinanceOnly =
            item.transaction.workflow_type === "FINANCE_ONLY";
          const documentRequest = item.document_request;
          const academicPeriod = documentRequest?.academic_period;
          return (
            <div
              className="my-transactions__modal-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setSelectedTransaction(null);
                }
              }}
            >
              <div
                className="my-transactions__modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="transaction-modal-title"
              >
                <div className="my-transactions__modal-header">
                  <div className="my-transactions__modal-header-left">
                    <div
                      className={`my-transactions__modal-icon ${
                        isFinanceOnly ? "is-finance" : "is-document"
                      }`}
                      aria-hidden="true"
                    >
                      {isFinanceOnly ? (
                        <CreditCard size={23} />
                      ) : (
                        <FileText size={23} />
                      )}
                    </div>
                    <div>
                      <h2 id="transaction-modal-title">
                        {item.transaction.transaction_name}
                      </h2>
                      <p>
                        {documentRequest?.requested_at
                          ? `Requested ${formatDate(documentRequest.requested_at)}`
                          : `Created ${formatDate(item.created_at)}`}
                      </p>
                    </div>
                  </div>
                  <div className="my-transactions__modal-header-actions">
                    <span
                      className={`my-transactions__status-badge ${getPaymentStatusClass(
                        item.payment.payment_status,
                      )}`}
                    >
                      {item.payment.payment_status}
                    </span>
                    {!isFinanceOnly && (
                      <span
                        className={`my-transactions__registrar-badge ${getRegistrarStatusClass(
                          item.registrar.status,
                        )}`}
                      >
                        {item.registrar.status}
                      </span>
                    )}
                    <button
                      type="button"
                      className="my-transactions__modal-close"
                      onClick={() => setSelectedTransaction(null)}
                      aria-label="Close transaction details"
                    >
                      <X size={20} />
                    </button>
                  </div>
                </div>
                <div className="my-transactions__modal-body">
                  <section className="my-transactions__modal-section">
                    <div className="my-transactions__modal-section-title">
                      <ReceiptText size={18} aria-hidden="true" />
                      <h3>Transaction Information</h3>
                    </div>
                    <div className="my-transactions__modal-grid">
                      {documentRequest && (
                        <DetailItem
                          label="Request Number"
                          value={documentRequest.request_number}
                        />
                      )}
                      <DetailItem
                        label="Finance Ticket"
                        value={item.ticket_number}
                      />
                      {academicPeriod && (
                        <DetailItem
                          label="Academic Period"
                          value={`${academicPeriod.academic_year || "—"} — ${
                            academicPeriod.semester_name || "—"
                          }`}
                        />
                      )}
                      {documentRequest && (
                        <DetailItem
                          label="Copies"
                          value={documentRequest.copies}
                        />
                      )}
                      <DetailItem
                        label="Amount Due"
                        value={formatMoney(item.payment.amount_due)}
                      />
                      <DetailItem
                        label="Amount Paid"
                        value={formatMoney(item.payment.amount_paid)}
                      />
                      <DetailItem
                        label="Payment Method"
                        value={item.payment.payment_method || "—"}
                      />
                      <DetailItem
                        label="Receipt Number"
                        value={item.payment.receipt_number || "—"}
                      />
                      <DetailItem
                        label="Payment Status"
                        value={
                          <span
                            className={`my-transactions__status-badge my-transactions__status-badge--compact ${getPaymentStatusClass(
                              item.payment.payment_status,
                            )}`}
                          >
                            {item.payment.payment_status}
                          </span>
                        }
                      />
                      <DetailItem
                        label="Paid At"
                        value={formatDate(item.payment.paid_at)}
                      />
                      <DetailItem
                        label="Source"
                        value={getSourceLabel(item.source_type)}
                      />
                      {!isFinanceOnly && (
                        <DetailItem
                          label="Registrar Status"
                          value={
                            <span
                              className={`my-transactions__registrar-badge ${getRegistrarStatusClass(
                                item.registrar.status,
                              )}`}
                            >
                              {item.registrar.status}
                            </span>
                          }
                        />
                      )}
                    </div>
                  </section>
                  {documentRequest && (
                    <section className="my-transactions__modal-section">
                      <div className="my-transactions__modal-section-title">
                        <FileText size={18} aria-hidden="true" />
                        <h3>Document Request</h3>
                      </div>
                      <div className="my-transactions__modal-grid">
                        <DetailItem
                          label="Document"
                          value={documentRequest.document_type}
                        />
                        <DetailItem
                          label="Requested At"
                          value={formatDate(documentRequest.requested_at)}
                        />
                      </div>
                      <div className="my-transactions__modal-purpose">
                        <span>Purpose</span>
                        <p>{documentRequest.purpose || "—"}</p>
                      </div>
                      {documentRequest.cancellation_reason && (
                        <div className="my-transactions__cancellation-note">
                          <strong>Cancellation:</strong>{" "}
                          {documentRequest.cancellation_reason}
                        </div>
                      )}
                    </section>
                  )}
                  {!isFinanceOnly && (
                    <section className="my-transactions__modal-section">
                      <div className="my-transactions__modal-section-title">
                        <GraduationCap size={18} aria-hidden="true" />
                        <h3>Registrar Processing</h3>
                      </div>
                      <div className="my-transactions__modal-grid">
                        <DetailItem
                          label="Status"
                          value={
                            <span
                              className={`my-transactions__registrar-badge ${getRegistrarStatusClass(
                                item.registrar.status,
                              )}`}
                            >
                              {item.registrar.status}
                            </span>
                          }
                        />
                        <DetailItem
                          label="Processing Started"
                          value={formatDate(item.registrar.started_at)}
                        />
                        <DetailItem
                          label="Completed"
                          value={formatDate(item.registrar.completed_at)}
                        />
                      </div>
                      {item.registrar.remarks && (
                        <div className="my-transactions__remarks-note">
                          <strong>Registrar Remarks:</strong>{" "}
                          {item.registrar.remarks}
                        </div>
                      )}
                    </section>
                  )}
                  {item.finance_remarks && (
                    <section className="my-transactions__modal-section">
                      <div className="my-transactions__modal-section-title">
                        <CreditCard size={18} aria-hidden="true" />
                        <h3>Finance Remarks</h3>
                      </div>
                      <div className="my-transactions__remarks-note">
                        {item.finance_remarks}
                      </div>
                    </section>
                  )}
                </div>
                <div className="my-transactions__modal-footer">
                  <button
                    type="button"
                    className="my-transactions__modal-done"
                    onClick={() => setSelectedTransaction(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </main>
    </DashboardLayout>
  );
}
