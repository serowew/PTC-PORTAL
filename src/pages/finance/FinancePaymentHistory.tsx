import { useCallback, useEffect, useState } from "react";

import type { ReactNode } from "react";

import { useNavigate } from "react-router-dom";

import {
  Banknote,
  CheckCircle2,
  CreditCard,
  FileText,
  Loader2,
  ReceiptText,
  RefreshCcw,
  Search,
  UserRound,
  WalletCards,
} from "lucide-react";

import DashboardLayout from "../../components/Layout/DashboardLayout";
import { authService } from "../../services/auth.service";
import "../../styles/FinancePaymentHistory.css";

// ============================================================
// API
// ============================================================

const PAYMENT_HISTORY_API =
  "http://localhost:3000/api/finance/tickets/payment-history";

const TRANSACTION_TYPES_API =
  "http://localhost:3000/api/finance/tickets/transaction-types";

const REPORT_SUMMARY_API =
  "http://localhost:3000/api/finance/tickets/reports/summary";

const PAGE_SIZE = 25;

// ============================================================
// TYPES
// ============================================================

type PaymentMethod = "All" | "Cash" | "GCash" | "Bank" | "Online";

interface AcademicPeriod {
  academic_year_id: number | null;
  academic_year: string | null;

  semester_id: number | null;
  semester_name: string | null;

  enrollment_status: string | null;
}

interface FinanceTicket {
  ticket_id: number;
  ticket_number: string;

  source_type?: string;

  student: {
    student_id: number;
    student_number: string;
    student_name: string;
  };

  transaction: {
    transaction_type_id: number;
    transaction_code: string;
    transaction_name: string;
    workflow_type?: string;
  };

  document_request: {
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
  } | null;

  grade_id: number | null;

  payment: {
    amount_due: number | null;
    amount_paid: number;

    payment_method: string | null;
    receipt_number: string | null;

    payment_status: string;

    finance_remarks: string | null;

    paid_by: number | null;
    paid_at: string | null;
  };

  registrar: {
    status: string;
    remarks: string | null;

    processed_by: number | null;

    started_at: string | null;
    completed_at: string | null;
  };

  created_at: string | null;
  updated_at: string | null;
}

interface PaymentHistoryResponse {
  success?: boolean;
  code?: string;
  message?: string;

  query?: string | null;

  filters?: {
    payment_method?: string | null;
    transaction_code?: string | null;
  };

  pagination?: {
    page: number;
    limit: number;
    total_records: number;
    total_pages: number;
    has_previous_page: boolean;
    has_next_page: boolean;
  };

  count?: number;

  tickets?: FinanceTicket[];
}

interface FinanceTransactionType {
  transaction_type_id: number;

  transaction_code: string;
  transaction_name: string;

  workflow_type: string;

  is_active: boolean;
}

interface TransactionTypesResponse {
  success?: boolean;
  code?: string;
  message?: string;

  transaction_types?: FinanceTransactionType[];
}

interface FinanceReportResponse {
  success?: boolean;
  code?: string;
  message?: string;

  summary?: {
    total_tickets?: number;
    pending_tickets?: number;
    paid_tickets?: number;
    cancelled_tickets?: number;
    refunded_tickets?: number;

    total_collected?: number;
    collected_today?: number;
    collected_this_month?: number;
  };
}

interface LoadHistoryOptions {
  requestedPage: number;

  query: string;

  paymentMethod: PaymentMethod;

  transactionCode: string;

  showRefresh?: boolean;
}

// ============================================================
// HELPERS
// ============================================================

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }

  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(Number(value));
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

function paymentMethodLabel(value: string | null) {
  return value || "—";
}


export default function FinancePaymentHistory() {
  const navigate = useNavigate();

  const session = authService.getSession();

  const token = authService.getToken();

  const isFinance = session?.role === "Finance" && Boolean(token);

  // ==========================================================
  // HISTORY DATA
  // ==========================================================

  const [tickets, setTickets] = useState<FinanceTicket[]>([]);

  const [transactionTypes, setTransactionTypes] = useState<
    FinanceTransactionType[]
  >([]);

  // ==========================================================
  // REPORT SUMMARY
  // ==========================================================

  const [reportSummary, setReportSummary] = useState({
    paid_tickets: 0,

    total_collected: 0,

    collected_today: 0,

    collected_this_month: 0,
  });

  // ==========================================================
  // FILTERS
  // ==========================================================

  const [search, setSearch] = useState("");

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("All");

  const [transactionFilter, setTransactionFilter] = useState("All");

  // ==========================================================
  // PAGINATION
  // ==========================================================

  const [page, setPage] = useState(1);

  const [totalPages, setTotalPages] = useState(0);

  const [totalRecords, setTotalRecords] = useState(0);

  // ==========================================================
  // UI STATE
  // ==========================================================

  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");

  // ==========================================================
  // AUTH GUARD
  // ==========================================================

  useEffect(() => {
    if (!isFinance) {
      navigate("/login", {
        replace: true,
      });
    }
  }, [isFinance, navigate]);

  // ==========================================================
  // LOAD PAYMENT HISTORY
  // ==========================================================

  const loadPaymentHistory = useCallback(
    async ({
      requestedPage,
      query,
      paymentMethod: requestedPaymentMethod,
      transactionCode,
      showRefresh = false,
    }: LoadHistoryOptions) => {
      if (!isFinance) {
        return;
      }

      if (showRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setErrorMessage("");

      try {
        const params = new URLSearchParams();

        params.set("page", String(requestedPage));

        params.set("limit", String(PAGE_SIZE));

        const cleanedSearch = query.trim();

        if (cleanedSearch) {
          params.set("q", cleanedSearch);
        }

        if (requestedPaymentMethod !== "All") {
          params.set("payment_method", requestedPaymentMethod);
        }

        if (transactionCode !== "All") {
          params.set("transaction_code", transactionCode);
        }

        const response = await authService.authFetch(
          `${PAYMENT_HISTORY_API}?${params.toString()}`,
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
          throw new Error("Finance access is required.");
        }

        const data = (await response.json()) as PaymentHistoryResponse;

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || "Unable to load Finance payment history.",
          );
        }

        setTickets(Array.isArray(data.tickets) ? data.tickets : []);

        const loadedPage = Number(data.pagination?.page ?? requestedPage);

        const loadedTotalPages = Number(data.pagination?.total_pages ?? 0);

        const loadedTotalRecords = Number(data.pagination?.total_records ?? 0);

        setPage(loadedPage);

        setTotalPages(loadedTotalPages);

        setTotalRecords(loadedTotalRecords);
      } catch (error) {
        console.error("LOAD FINANCE PAYMENT HISTORY ERROR:", error);

        setTickets([]);

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to load Finance payment history.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [isFinance, navigate],
  );

  // ==========================================================
  // LOAD TRANSACTION TYPES + ACCURATE REPORT TOTALS
  // ==========================================================

  const loadSupportingData = useCallback(async () => {
    if (!isFinance) {
      return;
    }

    try {
      const [typesResponse, reportResponse] = await Promise.all([
        authService.authFetch(TRANSACTION_TYPES_API, {
          method: "GET",

          headers: {
            Accept: "application/json",
          },
        }),

        authService.authFetch(REPORT_SUMMARY_API, {
          method: "GET",

          headers: {
            Accept: "application/json",
          },
        }),
      ]);

      if (typesResponse.status === 401 || reportResponse.status === 401) {
        authService.logout();

        navigate("/login", {
          replace: true,
        });

        return;
      }

      if (typesResponse.status === 403 || reportResponse.status === 403) {
        throw new Error("Finance access is required.");
      }

      const typesData =
        (await typesResponse.json()) as TransactionTypesResponse;

      const reportData = (await reportResponse.json()) as FinanceReportResponse;

      // ----------------------------------------------------
      // Transaction types
      // ----------------------------------------------------

      if (typesResponse.ok && typesData.success) {
        const activeTypes = Array.isArray(typesData.transaction_types)
          ? typesData.transaction_types
              .filter((item) => item.is_active)
              .sort((first, second) =>
                first.transaction_name.localeCompare(second.transaction_name),
              )
          : [];

        setTransactionTypes(activeTypes);
      }

      // ----------------------------------------------------
      // Accurate Finance totals
      // ----------------------------------------------------

      if (reportResponse.ok && reportData.success) {
        setReportSummary({
          paid_tickets: Number(reportData.summary?.paid_tickets ?? 0),

          total_collected: Number(reportData.summary?.total_collected ?? 0),

          collected_today: Number(reportData.summary?.collected_today ?? 0),

          collected_this_month: Number(
            reportData.summary?.collected_this_month ?? 0,
          ),
        });
      }
    } catch (error) {
      console.error("LOAD PAYMENT HISTORY SUPPORT DATA ERROR:", error);
    }
  }, [isFinance, navigate]);

  // ==========================================================
  // INITIAL LOAD
  // ==========================================================

  useEffect(() => {
    if (!isFinance) {
      return;
    }

    void loadPaymentHistory({
      requestedPage: 1,

      query: "",

      paymentMethod: "All",

      transactionCode: "All",
    });

    void loadSupportingData();
  }, [isFinance, loadPaymentHistory, loadSupportingData]);

  // ==========================================================
  // APPLY FILTERS
  // ==========================================================

  const applyFilters = () => {
    setPage(1);

    void loadPaymentHistory({
      requestedPage: 1,

      query: search,

      paymentMethod,

      transactionCode: transactionFilter,
    });
  };

  // ==========================================================
  // REFRESH
  // ==========================================================

  const refreshHistory = () => {
    void loadPaymentHistory({
      requestedPage: page,

      query: search,

      paymentMethod,

      transactionCode: transactionFilter,

      showRefresh: true,
    });

    void loadSupportingData();
  };

  // ==========================================================
  // PREVIOUS PAGE
  // ==========================================================

  const goToPreviousPage = () => {
    if (loading || refreshing || page <= 1) {
      return;
    }

    const nextPage = page - 1;

    void loadPaymentHistory({
      requestedPage: nextPage,

      query: search,

      paymentMethod,

      transactionCode: transactionFilter,
    });
  };

  // ==========================================================
  // NEXT PAGE
  // ==========================================================

  const goToNextPage = () => {
    if (loading || refreshing || page >= totalPages) {
      return;
    }

    const nextPage = page + 1;

    void loadPaymentHistory({
      requestedPage: nextPage,

      query: search,

      paymentMethod,

      transactionCode: transactionFilter,
    });
  };

  // ==========================================================
  // AUTHORIZED ONLY
  // ==========================================================

  if (!isFinance) {
    return null;
  }


  return (
    <DashboardLayout>
      <main className="finance-payment-history">
        {/* =================================================
            HEADER
        ================================================= */}

        <section className="finance-payment-history__hero">
          <div className="finance-payment-history__hero-copy">
            <div className="finance-payment-history__eyebrow">
              <WalletCards size={16} aria-hidden="true" />
              Finance Records
            </div>

            <h1>Payment History</h1>

            <p>
              Review completed student payments, receipts, payment methods,
              and Finance transaction records.
            </p>
          </div>

          <div
            className="finance-payment-history__hero-icon"
            aria-hidden="true"
          >
            <ReceiptText size={28} strokeWidth={1.9} />
          </div>
        </section>

        {/* =================================================
            SUMMARY
        ================================================= */}

        <section
          className="finance-payment-history__summary-grid"
          aria-label="Payment history summary"
        >
          <SummaryCard
            label="Paid Transactions"
            value={String(reportSummary.paid_tickets)}
            icon={<CheckCircle2 size={20} />}
          />

          <SummaryCard
            label="Total Collected"
            value={formatMoney(reportSummary.total_collected)}
            icon={<Banknote size={20} />}
          />

          <SummaryCard
            label="Collected Today"
            value={formatMoney(reportSummary.collected_today)}
            icon={<WalletCards size={20} />}
          />

          <SummaryCard
            label="This Month"
            value={formatMoney(reportSummary.collected_this_month)}
            icon={<CreditCard size={20} />}
          />
        </section>

        {/* =================================================
            ERROR
        ================================================= */}

        {errorMessage && (
          <section
            className="finance-payment-history__message finance-payment-history__message--error"
            role="alert"
          >
            {errorMessage}
          </section>
        )}

        {/* =================================================
            FILTERS
        ================================================= */}

        <section className="finance-payment-history__panel">
          <div className="finance-payment-history__section-header">
            <div>
              <span className="finance-payment-history__section-kicker">
                Search and Filter
              </span>

              <h2>Payment Records</h2>

              <p>
                Narrow the completed-payment history by student, ticket,
                receipt, payment method, or transaction type.
              </p>
            </div>
          </div>

          <div className="finance-payment-history__filters">
            <label className="finance-payment-history__field">
              <span>Search</span>

              <div className="finance-payment-history__search-field">
                <Search
                  size={17}
                  className="finance-payment-history__search-icon"
                  aria-hidden="true"
                />

                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      applyFilters();
                    }
                  }}
                  placeholder="Ticket, student, request, receipt..."
                  disabled={loading || refreshing}
                />
              </div>
            </label>

            <label className="finance-payment-history__field">
              <span>Payment Method</span>

              <select
                value={paymentMethod}
                onChange={(event) =>
                  setPaymentMethod(event.target.value as PaymentMethod)
                }
                disabled={loading || refreshing}
              >
                <option value="All">All Methods</option>
                <option value="Cash">Cash</option>
                <option value="GCash">GCash</option>
                <option value="Bank">Bank</option>
                <option value="Online">Online</option>
              </select>
            </label>

            <label className="finance-payment-history__field">
              <span>Transaction</span>

              <select
                value={transactionFilter}
                onChange={(event) =>
                  setTransactionFilter(event.target.value)
                }
                disabled={loading || refreshing}
              >
                <option value="All">All Transactions</option>

                {transactionTypes.map((item) => (
                  <option
                    key={item.transaction_type_id}
                    value={item.transaction_code}
                  >
                    {item.transaction_name}
                  </option>
                ))}
              </select>
            </label>

            <div className="finance-payment-history__filter-actions">
              <button
                type="button"
                className="finance-payment-history__button finance-payment-history__button--primary"
                onClick={applyFilters}
                disabled={loading || refreshing}
              >
                <Search size={16} aria-hidden="true" />
                Apply
              </button>

              <button
                type="button"
                className="finance-payment-history__button finance-payment-history__button--secondary"
                onClick={refreshHistory}
                disabled={refreshing}
              >
                {refreshing ? (
                  <Loader2
                    size={16}
                    className="finance-payment-history__spinner"
                    aria-hidden="true"
                  />
                ) : (
                  <RefreshCcw size={16} aria-hidden="true" />
                )}

                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
        </section>

        {/* =================================================
            PAYMENT LIST
        ================================================= */}

        <section className="finance-payment-history__panel">
          <div className="finance-payment-history__list-header">
            <div>
              <span className="finance-payment-history__section-kicker">
                Finance Records
              </span>

              <h2>Completed Payments</h2>

              <p>
                Showing {tickets.length} of {totalRecords} payment record
                {totalRecords === 1 ? "" : "s"}.
              </p>
            </div>

            {totalRecords > 0 && (
              <span className="finance-payment-history__paid-count">
                {totalRecords} Paid
              </span>
            )}
          </div>

          {loading ? (
            <div className="finance-payment-history__state">
              <Loader2
                size={24}
                className="finance-payment-history__spinner"
                aria-hidden="true"
              />

              <strong>Loading payment history...</strong>
              <span>Please wait while payment records are loaded.</span>
            </div>
          ) : tickets.length === 0 ? (
            <div className="finance-payment-history__state finance-payment-history__state--empty">
              <div className="finance-payment-history__state-icon">
                <ReceiptText size={26} aria-hidden="true" />
              </div>

              <strong>No payment records found</strong>
              <span>Try changing the search or filters.</span>
            </div>
          ) : (
            <div className="finance-payment-history__list">
              {tickets.map((ticket) => (
                <PaymentCard key={ticket.ticket_id} ticket={ticket} />
              ))}
            </div>
          )}

          {!loading && totalPages > 0 && (
            <div className="finance-payment-history__pagination">
              <span>
                Page {page} of {totalPages}
                {" · "}
                {totalRecords} total payment
                {totalRecords === 1 ? "" : "s"}
              </span>

              <div>
                <button
                  type="button"
                  className="finance-payment-history__pagination-button"
                  disabled={page <= 1 || loading || refreshing}
                  onClick={goToPreviousPage}
                >
                  Previous
                </button>

                <button
                  type="button"
                  className="finance-payment-history__pagination-button"
                  disabled={page >= totalPages || loading || refreshing}
                  onClick={goToNextPage}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </DashboardLayout>
  );
}

function PaymentCard({ ticket }: { ticket: FinanceTicket }) {
  return (
    <article className="finance-payment-history__payment-card">
      <div className="finance-payment-history__payment-top">
        <div className="finance-payment-history__payment-main">
          <div
            className="finance-payment-history__payment-icon"
            aria-hidden="true"
          >
            <ReceiptText size={20} />
          </div>

          <div className="finance-payment-history__payment-copy">
            <div className="finance-payment-history__payment-title-row">
              <strong>{ticket.transaction.transaction_name}</strong>

              <span className="finance-payment-history__badge finance-payment-history__badge--paid">
                Paid
              </span>

              {ticket.source_type && (
                <span className="finance-payment-history__badge finance-payment-history__badge--source">
                  {ticket.source_type.replaceAll("_", " ")}
                </span>
              )}
            </div>

            <span className="finance-payment-history__ticket-number">
              {ticket.ticket_number}
            </span>

            <div className="finance-payment-history__student">
              <UserRound size={15} aria-hidden="true" />
              <strong>{ticket.student.student_number}</strong>
              <span>—</span>
              <span>{ticket.student.student_name}</span>
            </div>
          </div>
        </div>

        <div className="finance-payment-history__amount">
          <span>Amount Paid</span>

          <strong>{formatMoney(ticket.payment.amount_paid)}</strong>

          <small>{formatDate(ticket.payment.paid_at)}</small>
        </div>
      </div>

      <div className="finance-payment-history__detail-grid">
        <DetailBox
          label="Receipt Number"
          value={ticket.payment.receipt_number || "—"}
          icon={<ReceiptText size={13} />}
        />

        <DetailBox
          label="Payment Method"
          value={paymentMethodLabel(ticket.payment.payment_method)}
          icon={<CreditCard size={13} />}
        />

        <DetailBox
          label="Amount Due"
          value={formatMoney(ticket.payment.amount_due)}
          icon={<Banknote size={13} />}
        />

        <DetailBox
          label="Transaction Code"
          value={ticket.transaction.transaction_code}
          icon={<FileText size={13} />}
        />
      </div>

      {ticket.document_request && (
        <div className="finance-payment-history__notice finance-payment-history__notice--document">
          <strong>Document Request:</strong>{" "}
          {ticket.document_request.request_number}
          {" · "}
          {ticket.document_request.document_type}

          {ticket.document_request.academic_period && (
            <>
              {" · "}
              {ticket.document_request.academic_period.academic_year}
              {" — "}
              {ticket.document_request.academic_period.semester_name}
            </>
          )}
        </div>
      )}

      {ticket.transaction.workflow_type === "FINANCE_ONLY" && (
        <div className="finance-payment-history__notice finance-payment-history__notice--finance-only">
          Finance-only transaction. Registrar processing is not required.
        </div>
      )}

      {ticket.payment.finance_remarks && (
        <div className="finance-payment-history__remarks">
          <strong>Finance Remarks:</strong>{" "}
          {ticket.payment.finance_remarks}
        </div>
      )}
    </article>
  );
}

function SummaryCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <article className="finance-payment-history__summary-card">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>

      <div className="finance-payment-history__summary-icon">
        {icon}
      </div>
    </article>
  );
}

function DetailBox({
  label,
  value,
  icon,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
}) {
  return (
    <div className="finance-payment-history__detail-box">
      <div className="finance-payment-history__detail-label">
        {icon}
        {label}
      </div>

      <div className="finance-payment-history__detail-value">
        {value}
      </div>
    </div>
  );
}
