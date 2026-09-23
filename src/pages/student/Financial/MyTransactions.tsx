import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Clock3,
  CreditCard,
  FileText,
  GraduationCap,
  ReceiptText,
  RefreshCcw,
  Search,
  WalletCards,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/StudentTransactions.css";

const STUDENT_TRANSACTIONS_API = apiUrl("/api/student/transactions");

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

function getWorkflowLabel(workflowType: string) {
  if (workflowType === "FINANCE_ONLY") return "Finance Transaction";
  if (workflowType === "DOCUMENT_REQUEST") return "Document Request";
  if (workflowType === "INCOMPLETE_GRADE") return "Incomplete Grade";
  return workflowType;
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
  const [expandedTicketNumber, setExpandedTicketNumber] = useState<
    string | null
  >(null);

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

  const toggleDetails = (ticketNumber: string) => {
    setExpandedTicketNumber((current) =>
      current === ticketNumber ? null : ticketNumber,
    );
  };

  if (!isStudent) return null;

  return (
    <DashboardLayout>
      <main className="my-transactions">
        <section className="my-transactions__hero">
          <div className="my-transactions__hero-content">
            <div className="my-transactions__hero-copy">
              <div className="my-transactions__eyebrow">
                <WalletCards size={16} aria-hidden="true" />
                <span>Student Finance</span>
              </div>

              <h1>My Transactions</h1>
              <p>
                View your school transactions, payment status, receipts,
                document request payments, and other charges assigned to your
                account.
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

            <div className="my-transactions__hero-icon" aria-hidden="true">
              <ReceiptText size={31} />
            </div>
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
                {filteredTransactions.length} transaction
                {filteredTransactions.length === 1 ? "" : "s"} shown
              </p>
            </div>

            <button
              type="button"
              className="my-transactions__refresh-button"
              onClick={() => void loadTransactions(false)}
              disabled={refreshing}
            >
              <RefreshCcw
                size={16}
                className={refreshing ? "is-spinning" : ""}
                aria-hidden="true"
              />
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
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
              const isExpanded = expandedTicketNumber === item.ticket_number;
              const isFinanceOnly =
                item.transaction.workflow_type === "FINANCE_ONLY";
              const documentRequest = item.document_request;
              const academicPeriod = documentRequest?.academic_period;

              return (
                <article
                  className="my-transactions__ticket"
                  key={item.ticket_id}
                >
                  <div className="my-transactions__ticket-main">
                    <div className="my-transactions__ticket-toprow">
                      <div className="my-transactions__ticket-identity">
                        <div
                          className={`my-transactions__ticket-icon ${
                            isFinanceOnly ? "is-finance" : "is-document"
                          }`}
                          aria-hidden="true"
                        >
                          {isFinanceOnly ? (
                            <CreditCard size={22} />
                          ) : (
                            <FileText size={22} />
                          )}
                        </div>

                        <div className="my-transactions__ticket-copy">
                          <div className="my-transactions__ticket-title-row">
                            <h3>{item.transaction.transaction_name}</h3>
                            <span className="my-transactions__workflow-badge">
                              {getWorkflowLabel(item.transaction.workflow_type)}
                            </span>
                          </div>

                          <p className="my-transactions__ticket-number">
                            Ticket: <strong>{item.ticket_number}</strong>
                          </p>
                          <p className="my-transactions__ticket-source">
                            {getSourceLabel(item.source_type)}
                          </p>
                        </div>
                      </div>

                      <span
                        className={`my-transactions__status-badge ${getPaymentStatusClass(
                          item.payment.payment_status,
                        )}`}
                      >
                        {item.payment.payment_status}
                      </span>
                    </div>

                    <div className="my-transactions__main-details">
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
                        label="Created"
                        value={formatDate(item.created_at)}
                      />
                    </div>

                    {documentRequest && academicPeriod && (
                      <div className="my-transactions__academic-period">
                        <CalendarDays size={15} aria-hidden="true" />
                        <span>
                          {academicPeriod.academic_year || "—"} •{" "}
                          {academicPeriod.semester_name || "—"}
                        </span>
                      </div>
                    )}

                    {isFinanceOnly && (
                      <div className="my-transactions__finance-note">
                        <CreditCard size={16} aria-hidden="true" />
                        <span>
                          This is a Finance-only transaction. Registrar
                          processing is not required.
                        </span>
                      </div>
                    )}

                    <button
                      type="button"
                      className="my-transactions__details-toggle"
                      onClick={() => toggleDetails(item.ticket_number)}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp size={16} aria-hidden="true" />
                          Hide Details
                        </>
                      ) : (
                        <>
                          <ChevronDown size={16} aria-hidden="true" />
                          View Details
                        </>
                      )}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="my-transactions__expanded">
                      <div className="my-transactions__expanded-stack">
                        <section className="my-transactions__detail-section">
                          <div className="my-transactions__detail-heading">
                            <ReceiptText size={17} aria-hidden="true" />
                            <strong>Payment Details</strong>
                          </div>

                          <div className="my-transactions__detail-grid">
                            <DetailItem
                              label="Ticket Number"
                              value={item.ticket_number}
                            />
                            <DetailItem
                              label="Transaction Code"
                              value={item.transaction.transaction_code}
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
                              label="Receipt Number"
                              value={item.payment.receipt_number || "—"}
                            />
                            <DetailItem
                              label="Payment Method"
                              value={item.payment.payment_method || "—"}
                            />
                            <DetailItem
                              label="Paid At"
                              value={formatDate(item.payment.paid_at)}
                            />
                          </div>
                        </section>

                        {documentRequest && (
                          <section className="my-transactions__detail-section my-transactions__detail-section--divided">
                            <div className="my-transactions__detail-heading">
                              <FileText size={17} aria-hidden="true" />
                              <strong>Document Request</strong>
                            </div>

                            <div className="my-transactions__detail-grid">
                              <DetailItem
                                label="Request Number"
                                value={documentRequest.request_number}
                              />
                              <DetailItem
                                label="Document"
                                value={documentRequest.document_type}
                              />
                              <DetailItem
                                label="Copies"
                                value={documentRequest.copies}
                              />
                              <DetailItem
                                label="Purpose"
                                value={documentRequest.purpose || "—"}
                              />
                              <DetailItem
                                label="Academic Year"
                                value={academicPeriod?.academic_year || "—"}
                              />
                              <DetailItem
                                label="Semester"
                                value={academicPeriod?.semester_name || "—"}
                              />
                              <DetailItem
                                label="Requested At"
                                value={formatDate(documentRequest.requested_at)}
                              />
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
                          <section className="my-transactions__detail-section my-transactions__detail-section--divided">
                            <div className="my-transactions__detail-heading">
                              <GraduationCap size={18} aria-hidden="true" />
                              <strong>Registrar Processing</strong>
                            </div>

                            <div className="my-transactions__detail-grid">
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
                              <DetailItem
                                label="Started"
                                value={formatDate(item.registrar.started_at)}
                              />
                              <DetailItem
                                label="Completed"
                                value={formatDate(item.registrar.completed_at)}
                              />
                            </div>

                            {item.registrar.remarks && (
                              <div className="my-transactions__remarks-note">
                                <strong>Registrar remarks:</strong>{" "}
                                {item.registrar.remarks}
                              </div>
                            )}
                          </section>
                        )}

                        {item.finance_remarks && (
                          <section className="my-transactions__detail-section my-transactions__detail-section--divided">
                            <DetailItem
                              label="Finance Remarks"
                              value={item.finance_remarks}
                            />
                          </section>
                        )}
                      </div>
                    </div>
                  )}
                </article>
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
                Pending Payment means payment has not yet been completed. Paid
                means Finance has confirmed the payment. Document-related
                transactions may continue to Registrar processing after payment.
                Finance-only transactions do not require Registrar processing.
              </p>
            </div>
          </section>
        )}
      </main>
    </DashboardLayout>
  );
}
