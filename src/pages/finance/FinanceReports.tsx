import { useCallback, useEffect, useMemo, useState } from "react";

import type { ReactNode } from "react";

import { useNavigate } from "react-router-dom";

import {
  Banknote,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  FileText,
  Loader2,
  ReceiptText,
  RefreshCcw,
} from "lucide-react";

import DashboardLayout from "../../components/Layout/DashboardLayout";
import { authService } from "../../services/auth.service";
import "../../styles/FinanceReports.css";

const FINANCE_REPORT_API =
  "http://localhost:3000/api/finance/tickets/reports/summary";

// ============================================================
// TYPES
// ============================================================

interface FinanceReportSummary {
  total_tickets: number;
  pending_tickets: number;
  paid_tickets: number;
  cancelled_tickets: number;
  refunded_tickets: number;

  total_collected: number;
  collected_today: number;
  collected_this_month: number;
}

interface TransactionReportRow {
  transaction_type_id: number;
  transaction_code: string;
  transaction_name: string;
  workflow_type: string;

  total_tickets: number;
  paid_tickets: number;
  pending_tickets: number;

  total_collected: number;
}

interface PaymentMethodReportRow {
  payment_method: string;
  payment_count: number;
  total_collected: number;
}

interface DailyCollectionRow {
  payment_date: string;
  payment_count: number;
  total_collected: number;
}

interface FinanceReportResponse {
  success?: boolean;
  code?: string;
  message?: string;

  generated_at?: string;

  summary?: FinanceReportSummary;

  by_transaction?: TransactionReportRow[];

  by_payment_method?: PaymentMethodReportRow[];

  daily_collections?: DailyCollectionRow[];
}

// ============================================================
// HELPERS
// ============================================================

function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatDateTime(value: string | null | undefined) {
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

function workflowLabel(value: string) {
  if (value === "FINANCE_ONLY") {
    return "Finance Only";
  }

  if (value === "DOCUMENT_REQUEST") {
    return "Document Request";
  }

  if (value === "INCOMPLETE_GRADE") {
    return "Incomplete Grade";
  }

  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}


export default function FinanceReports() {
  const navigate = useNavigate();

  const session = authService.getSession();

  const token = authService.getToken();

  const isFinance = session?.role === "Finance" && Boolean(token);

  const [summary, setSummary] = useState<FinanceReportSummary>({
    total_tickets: 0,
    pending_tickets: 0,
    paid_tickets: 0,
    cancelled_tickets: 0,
    refunded_tickets: 0,

    total_collected: 0,
    collected_today: 0,
    collected_this_month: 0,
  });

  const [transactions, setTransactions] = useState<TransactionReportRow[]>([]);

  const [paymentMethods, setPaymentMethods] = useState<
    PaymentMethodReportRow[]
  >([]);

  const [dailyCollections, setDailyCollections] = useState<
    DailyCollectionRow[]
  >([]);

  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");

  // ==========================================================
  // AUTH
  // ==========================================================

  useEffect(() => {
    if (!isFinance) {
      navigate("/login", {
        replace: true,
      });
    }
  }, [isFinance, navigate]);

  // ==========================================================
  // LOAD REPORT
  // ==========================================================

  const loadReport = useCallback(
    async (initial = true) => {
      if (!isFinance) {
        return;
      }

      if (initial) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      setErrorMessage("");

      try {
        const response = await authService.authFetch(FINANCE_REPORT_API, {
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

        const data = (await response.json()) as FinanceReportResponse;

        if (!response.ok || !data.success) {
          throw new Error(data.message || "Unable to load Finance reports.");
        }

        setSummary({
          total_tickets: Number(data.summary?.total_tickets ?? 0),

          pending_tickets: Number(data.summary?.pending_tickets ?? 0),

          paid_tickets: Number(data.summary?.paid_tickets ?? 0),

          cancelled_tickets: Number(data.summary?.cancelled_tickets ?? 0),

          refunded_tickets: Number(data.summary?.refunded_tickets ?? 0),

          total_collected: Number(data.summary?.total_collected ?? 0),

          collected_today: Number(data.summary?.collected_today ?? 0),

          collected_this_month: Number(data.summary?.collected_this_month ?? 0),
        });

        setTransactions(
          Array.isArray(data.by_transaction) ? data.by_transaction : [],
        );

        setPaymentMethods(
          Array.isArray(data.by_payment_method) ? data.by_payment_method : [],
        );

        setDailyCollections(
          Array.isArray(data.daily_collections) ? data.daily_collections : [],
        );

        setGeneratedAt(data.generated_at ?? null);
      } catch (error) {
        console.error("LOAD FINANCE REPORT ERROR:", error);

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to load Finance reports.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [isFinance, navigate],
  );

  useEffect(() => {
    if (!isFinance) {
      return;
    }

    void loadReport(true);
  }, [isFinance, loadReport]);

  // ==========================================================
  // MAX VALUES FOR BARS
  // ==========================================================

  const maxTransactionCollection = useMemo(() => {
    return Math.max(
      1,
      ...transactions.map((item) => Number(item.total_collected)),
    );
  }, [transactions]);

  const maxPaymentMethodCollection = useMemo(() => {
    return Math.max(
      1,
      ...paymentMethods.map((item) => Number(item.total_collected)),
    );
  }, [paymentMethods]);

  const maxDailyCollection = useMemo(() => {
    return Math.max(
      1,
      ...dailyCollections.map((item) => Number(item.total_collected)),
    );
  }, [dailyCollections]);

  if (!isFinance) {
    return null;
  }


  return (
    <DashboardLayout>
      <main className="finance-reports">
        {/* =================================================
            HEADER
        ================================================= */}

        <section className="finance-reports__hero">
          <div className="finance-reports__hero-copy">
            <div className="finance-reports__eyebrow">
              <BarChart3 size={16} aria-hidden="true" />
              Finance Analytics
            </div>

            <h1>Finance Reports</h1>

            <p>
              Review Finance ticket activity, collections, transaction
              breakdowns, payment methods, and recent daily collection trends.
            </p>

            {generatedAt && (
              <span className="finance-reports__generated-at">
                Report generated: {formatDateTime(generatedAt)}
              </span>
            )}
          </div>

          <div className="finance-reports__hero-actions">
            <button
              type="button"
              className="finance-reports__button finance-reports__button--secondary"
              onClick={() => void loadReport(false)}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2
                  size={16}
                  className="finance-reports__spinner"
                  aria-hidden="true"
                />
              ) : (
                <RefreshCcw size={16} aria-hidden="true" />
              )}

              {refreshing ? "Refreshing..." : "Refresh Report"}
            </button>

            <div className="finance-reports__hero-icon" aria-hidden="true">
              <BarChart3 size={28} strokeWidth={1.9} />
            </div>
          </div>
        </section>

        {/* =================================================
            ERROR
        ================================================= */}

        {errorMessage && (
          <section
            className="finance-reports__message finance-reports__message--error"
            role="alert"
          >
            {errorMessage}
          </section>
        )}

        {/* =================================================
            LOADING
        ================================================= */}

        {loading ? (
          <section className="finance-reports__panel finance-reports__loading">
            <Loader2
              size={25}
              className="finance-reports__spinner"
              aria-hidden="true"
            />

            <strong>Loading Finance reports...</strong>
            <span>Please wait while the latest report data is prepared.</span>
          </section>
        ) : (
          <>
            {/* ===============================================
                COLLECTION SUMMARY
            =============================================== */}

            <section
              className="finance-reports__summary-grid"
              aria-label="Finance collection summary"
            >
              <SummaryCard
                label="Total Collected"
                value={formatMoney(summary.total_collected)}
                icon={<CircleDollarSign size={20} />}
              />

              <SummaryCard
                label="Collected Today"
                value={formatMoney(summary.collected_today)}
                icon={<Banknote size={20} />}
              />

              <SummaryCard
                label="This Month"
                value={formatMoney(summary.collected_this_month)}
                icon={<CalendarDays size={20} />}
              />

              <SummaryCard
                label="Paid Tickets"
                value={String(summary.paid_tickets)}
                icon={<CheckCircle2 size={20} />}
              />
            </section>

            {/* ===============================================
                TICKET SUMMARY
            =============================================== */}

            <section className="finance-reports__panel">
              <SectionTitle
                icon={<ReceiptText size={19} />}
                kicker="Ticket Overview"
                title="Ticket Summary"
                description="Current Finance ticket status across all transactions."
              />

              <div className="finance-reports__status-grid">
                <StatusBox
                  label="Total"
                  value={summary.total_tickets}
                  variant="neutral"
                />

                <StatusBox
                  label="Pending Payment"
                  value={summary.pending_tickets}
                  variant="pending"
                />

                <StatusBox
                  label="Paid"
                  value={summary.paid_tickets}
                  variant="paid"
                />

                <StatusBox
                  label="Cancelled"
                  value={summary.cancelled_tickets}
                  variant="cancelled"
                />

                <StatusBox
                  label="Refunded"
                  value={summary.refunded_tickets}
                  variant="refunded"
                />
              </div>
            </section>

            {/* ===============================================
                TRANSACTION BREAKDOWN
            =============================================== */}

            <section className="finance-reports__panel">
              <SectionTitle
                icon={<FileText size={19} />}
                kicker="Transaction Performance"
                title="Collections by Transaction"
                description="Ticket volume and collections grouped by transaction type."
              />

              <div className="finance-reports__report-list">
                {transactions.length === 0 ? (
                  <EmptyState text="No transaction report data available." />
                ) : (
                  transactions.map((item) => (
                    <article
                      key={item.transaction_type_id}
                      className="finance-reports__transaction-card"
                    >
                      <div className="finance-reports__transaction-top">
                        <div>
                          <div className="finance-reports__transaction-title">
                            <strong>{item.transaction_name}</strong>

                            <span className="finance-reports__code-badge">
                              {item.transaction_code}
                            </span>
                          </div>

                          <span className="finance-reports__workflow-label">
                            {workflowLabel(item.workflow_type)}
                          </span>
                        </div>

                        <div className="finance-reports__transaction-total">
                          <strong>
                            {formatMoney(item.total_collected)}
                          </strong>
                          <span>collected</span>
                        </div>
                      </div>

                      <progress
                        className="finance-reports__progress"
                        max={maxTransactionCollection}
                        value={Number(item.total_collected)}
                        aria-label={`${item.transaction_name} collection relative to highest transaction collection`}
                      />

                      <div className="finance-reports__mini-grid">
                        <MiniStat
                          label="Total"
                          value={item.total_tickets}
                        />

                        <MiniStat
                          label="Paid"
                          value={item.paid_tickets}
                        />

                        <MiniStat
                          label="Pending"
                          value={item.pending_tickets}
                        />
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>

            {/* ===============================================
                PAYMENT METHODS
            =============================================== */}

            <section className="finance-reports__panel">
              <SectionTitle
                icon={<CreditCard size={19} />}
                kicker="Payment Channels"
                title="Collections by Payment Method"
                description="Completed payments grouped by collection method."
              />

              <div className="finance-reports__report-list">
                {paymentMethods.length === 0 ? (
                  <EmptyState text="No completed payment methods are available yet." />
                ) : (
                  paymentMethods.map((item) => (
                    <article
                      key={item.payment_method}
                      className="finance-reports__payment-method-card"
                    >
                      <div className="finance-reports__payment-method-top">
                        <div>
                          <strong>{item.payment_method}</strong>

                          <span>
                            {item.payment_count} payment
                            {item.payment_count === 1 ? "" : "s"}
                          </span>
                        </div>

                        <strong>
                          {formatMoney(item.total_collected)}
                        </strong>
                      </div>

                      <progress
                        className="finance-reports__progress"
                        max={maxPaymentMethodCollection}
                        value={Number(item.total_collected)}
                        aria-label={`${item.payment_method} collection relative to highest payment method collection`}
                      />
                    </article>
                  ))
                )}
              </div>
            </section>

            {/* ===============================================
                RECENT DAILY COLLECTIONS
            =============================================== */}

            <section className="finance-reports__panel">
              <SectionTitle
                icon={<CalendarDays size={19} />}
                kicker="Collection History"
                title="Recent Daily Collections"
                description="Finance collections recorded during the latest 30 calendar days."
              />

              <div className="finance-reports__daily-list">
                {dailyCollections.length === 0 ? (
                  <EmptyState text="No paid transactions were recorded during the latest 30 days." />
                ) : (
                  dailyCollections.map((item, index) => (
                    <article
                      key={`${item.payment_date}-${index}`}
                      className="finance-reports__daily-row"
                    >
                      <div className="finance-reports__daily-date">
                        <CalendarDays size={15} aria-hidden="true" />
                        <strong>{formatDate(item.payment_date)}</strong>
                      </div>

                      <progress
                        className="finance-reports__progress"
                        max={maxDailyCollection}
                        value={Number(item.total_collected)}
                        aria-label={`${formatDate(item.payment_date)} collection relative to highest recent daily collection`}
                      />

                      <span className="finance-reports__daily-count">
                        {item.payment_count} payment
                        {item.payment_count === 1 ? "" : "s"}
                      </span>

                      <strong className="finance-reports__daily-amount">
                        {formatMoney(item.total_collected)}
                      </strong>
                    </article>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </DashboardLayout>
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
    <article className="finance-reports__summary-card">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>

      <div className="finance-reports__summary-icon">
        {icon}
      </div>
    </article>
  );
}

function SectionTitle({
  icon,
  kicker,
  title,
  description,
}: {
  icon: ReactNode;
  kicker: string;
  title: string;
  description: string;
}) {
  return (
    <div className="finance-reports__section-title">
      <div className="finance-reports__section-icon">
        {icon}
      </div>

      <div>
        <span className="finance-reports__section-kicker">
          {kicker}
        </span>

        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

function StatusBox({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant:
    | "neutral"
    | "pending"
    | "paid"
    | "cancelled"
    | "refunded";
}) {
  return (
    <div
      className={`finance-reports__status-box finance-reports__status-box--${variant}`}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="finance-reports__mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="finance-reports__empty-state">
      <BarChart3 size={25} aria-hidden="true" />
      <strong>No report data</strong>
      <span>{text}</span>
    </div>
  );
}
