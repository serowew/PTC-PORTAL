import { useCallback, useEffect, useState } from "react";

import type { FormEvent, ReactNode } from "react";

import { useNavigate } from "react-router-dom";

import {
  CheckCircle2,
  Clock3,
  FileCheck2,
  Loader2,
  ReceiptText,
  RefreshCcw,
  Search,
  UserRound,
  WalletCards,
} from "lucide-react";

import DashboardLayout from "../../components/Layout/DashboardLayout";
import { authService } from "../../services/auth.service";
import "../../styles/FinanceDashboard.css";

import { apiUrl } from "../../services/api";

const FINANCE_TICKETS_API = "http://localhost:3000/api/finance/tickets";

// ============================================================
// TYPES
// ============================================================

interface FinanceDashboardResponse {
  success?: boolean;
  message?: string;

  summary?: {
    pending_tickets?: number;
    completed_today?: number;
    waiting_for_registrar?: number;
  };
}

interface FinanceTicket {
  ticket_id: number;
  ticket_number: string;

  student: {
    student_id: number;
    student_number: string;
    student_name: string;
  };

  transaction: {
    transaction_type_id: number;
    transaction_code: string;
    transaction_name: string;
  };

  document_request: {
    request_id: number;
    request_number: string;
    document_type: string;
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

interface FinanceTicketResponse {
  success?: boolean;
  code?: string;
  message?: string;
  ticket?: FinanceTicket;
}

interface FinancePaymentResponse {
  success?: boolean;
  code?: string;
  message?: string;

  ticket?: {
    ticket_id: number;
    ticket_number: string;

    payment?: {
      amount_due?: number;
      amount_paid?: number;
      payment_method?: string;
      receipt_number?: string;
      payment_status?: string;
      paid_by?: number;
    };

    registrar?: {
      status?: string;
    };
  };
}

type PaymentMethod = "Cash" | "GCash" | "Bank" | "Online";

// ============================================================
// HELPERS
// ============================================================

function formatMoney(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "Not assigned";
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

function getPaymentBadgeClass(status: string) {
  if (status === "Paid") {
    return "finance-dashboard__status-badge--paid";
  }

  if (status === "Pending Payment") {
    return "finance-dashboard__status-badge--pending";
  }

  return "finance-dashboard__status-badge--danger";
}

function getRegistrarBadgeClass(status: string) {
  if (status === "Done") {
    return "finance-dashboard__status-badge--paid";
  }

  if (status === "Processing") {
    return "finance-dashboard__status-badge--processing";
  }

  if (status === "Ready for Processing") {
    return "finance-dashboard__status-badge--ready";
  }

  return "finance-dashboard__status-badge--neutral";
}

// ============================================================
// COMPONENT
// ============================================================

export default function FinanceDashboard() {
  const navigate = useNavigate();

  /*
   * Keep auth dependencies primitive.
   * Do not use the whole session object in useEffect dependencies.
   */
  const session = authService.getSession();
  const token = authService.getToken();

  const role = session?.role ?? null;

  const isFinance = role === "Finance" && Boolean(token);

  // ==========================================================
  // DASHBOARD STATE
  // ==========================================================

  const [summary, setSummary] = useState({
    pending_tickets: 0,
    completed_today: 0,
    waiting_for_registrar: 0,
  });

  const [statusMessage, setStatusMessage] = useState(
    "Loading finance workspace...",
  );

  const [dashboardLoading, setDashboardLoading] = useState(true);

  // ==========================================================
  // TICKET SEARCH STATE
  // ==========================================================

  const [ticketNumber, setTicketNumber] = useState("");

  const [ticket, setTicket] = useState<FinanceTicket | null>(null);

  const [searching, setSearching] = useState(false);

  // ==========================================================
  // PAYMENT STATE
  // ==========================================================

  const [amountDue, setAmountDue] = useState("");

  const [amountPaid, setAmountPaid] = useState("");

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Cash");

  const [receiptNumber, setReceiptNumber] = useState("");

  const [remarks, setRemarks] = useState("");

  const [paying, setPaying] = useState(false);

  // ==========================================================
  // MESSAGE STATE
  // ==========================================================

  const [errorMessage, setErrorMessage] = useState("");

  const [successMessage, setSuccessMessage] = useState("");

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
  // LOAD DASHBOARD
  // ==========================================================

  const loadDashboard = useCallback(async () => {
    if (!isFinance) {
      return;
    }

    try {
      setDashboardLoading(true);

      const response = await authService.authFetch(
        apiUrl("/api/finance/dashboard"),
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

      const data = (await response.json()) as FinanceDashboardResponse;

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Unable to load the Finance dashboard.",
        );
      }

      setSummary({
        pending_tickets: Number(data.summary?.pending_tickets ?? 0),

        completed_today: Number(data.summary?.completed_today ?? 0),

        waiting_for_registrar: Number(data.summary?.waiting_for_registrar ?? 0),
      });

      setStatusMessage(data.message || "Finance workspace is ready.");
    } catch (error) {
      console.error("LOAD FINANCE DASHBOARD ERROR:", error);

      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Unable to load the Finance dashboard.",
      );
    } finally {
      setDashboardLoading(false);
    }
  }, [isFinance, navigate]);

  useEffect(() => {
    if (!isFinance) {
      return;
    }

    void loadDashboard();
  }, [isFinance, loadDashboard]);

  // ==========================================================
  // RESET PAYMENT FORM FROM TICKET
  // ==========================================================

  const preparePaymentForm = (currentTicket: FinanceTicket) => {
    if (currentTicket.payment.amount_due !== null) {
      const due = String(currentTicket.payment.amount_due);

      setAmountDue(due);

      if (currentTicket.payment.payment_status === "Pending Payment") {
        setAmountPaid(due);
      } else {
        setAmountPaid(String(currentTicket.payment.amount_paid));
      }
    } else {
      setAmountDue("");
      setAmountPaid("");
    }

    setPaymentMethod(
      currentTicket.payment.payment_method === "GCash" ||
        currentTicket.payment.payment_method === "Bank" ||
        currentTicket.payment.payment_method === "Online" ||
        currentTicket.payment.payment_method === "Cash"
        ? currentTicket.payment.payment_method
        : "Cash",
    );

    setReceiptNumber(currentTicket.payment.receipt_number ?? "");

    setRemarks(currentTicket.payment.finance_remarks ?? "");
  };

  // ==========================================================
  // LOOKUP TICKET
  // ==========================================================

  const lookupTicket = useCallback(
    async (requestedTicketNumber: string) => {
      if (!isFinance) {
        return;
      }

      const normalized = requestedTicketNumber.trim().toUpperCase();

      if (!normalized) {
        setErrorMessage("Enter a Finance ticket number.");

        return;
      }

      setSearching(true);
      setErrorMessage("");
      setSuccessMessage("");
      setTicket(null);

      try {
        const response = await authService.authFetch(
          `${FINANCE_TICKETS_API}/${encodeURIComponent(normalized)}`,
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

        const data = (await response.json()) as FinanceTicketResponse;

        if (!response.ok || !data.success || !data.ticket) {
          throw new Error(data.message || "Finance ticket was not found.");
        }

        setTicketNumber(data.ticket.ticket_number);

        setTicket(data.ticket);

        preparePaymentForm(data.ticket);
      } catch (error) {
        console.error("FINANCE TICKET LOOKUP ERROR:", error);

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to load Finance ticket.",
        );
      } finally {
        setSearching(false);
      }
    },
    [isFinance, navigate],
  );

  // ==========================================================
  // SEARCH FORM
  // ==========================================================

  const handleTicketSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    void lookupTicket(ticketNumber);
  };

  // ==========================================================
  // PAYMENT
  // ==========================================================

  const handlePayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!ticket || paying) {
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");

    // --------------------------------------------------------
    // Ticket must still be pending.
    // --------------------------------------------------------

    if (ticket.payment.payment_status !== "Pending Payment") {
      setErrorMessage(
        `This ticket is already ${ticket.payment.payment_status}.`,
      );

      return;
    }

    // --------------------------------------------------------
    // Validate amount due.
    // --------------------------------------------------------

    const numericAmountDue = Number(amountDue);

    if (!Number.isFinite(numericAmountDue) || numericAmountDue <= 0) {
      setErrorMessage("Enter a valid amount due greater than zero.");

      return;
    }

    // --------------------------------------------------------
    // Validate amount paid.
    // --------------------------------------------------------

    const numericAmountPaid = Number(amountPaid);

    if (!Number.isFinite(numericAmountPaid) || numericAmountPaid <= 0) {
      setErrorMessage("Enter a valid amount paid greater than zero.");

      return;
    }

    // --------------------------------------------------------
    // Receipt required.
    // --------------------------------------------------------

    if (!receiptNumber.trim()) {
      setErrorMessage("Receipt number is required.");

      return;
    }

    try {
      setPaying(true);

      const response = await authService.authFetch(
        `${FINANCE_TICKETS_API}/${encodeURIComponent(
          ticket.ticket_number,
        )}/pay`,
        {
          method: "PATCH",

          headers: {
            "Content-Type": "application/json",

            Accept: "application/json",
          },

          body: JSON.stringify({
            amount_due: numericAmountDue,

            amount_paid: numericAmountPaid,

            payment_method: paymentMethod,

            receipt_number: receiptNumber.trim(),

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

      const data = (await response.json()) as FinancePaymentResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to complete payment.");
      }

      setSuccessMessage(data.message || "Payment completed successfully.");

      /*
       * Refresh ticket so paid_at,
       * status and other DB fields are
       * reloaded from the server.
       */
      await lookupTicket(ticket.ticket_number);

      /*
       * Refresh dashboard counters:
       *
       * Pending -1
       * Completed Today +1
       * Waiting for Registrar +1
       */
      await loadDashboard();
    } catch (error) {
      console.error("FINANCE PAYMENT ERROR:", error);

      setErrorMessage(
        error instanceof Error ? error.message : "Unable to complete payment.",
      );
    } finally {
      setPaying(false);
    }
  };

  // ==========================================================
  // AUTHORIZED RENDER ONLY
  // ==========================================================

  if (!isFinance) {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="finance-dashboard">
        {/* ===================================================
            HERO
        =================================================== */}

        <section className="finance-dashboard__hero">
          <div className="finance-dashboard__hero-copy">
            <div className="finance-dashboard__eyebrow">
              <WalletCards size={16} aria-hidden="true" />
              Finance Office
            </div>

            <h1>Finance Dashboard</h1>

            <p>
              Search student transaction tickets, receive payments, and forward
              completed transactions to the Registrar.
            </p>
          </div>

          <div className="finance-dashboard__hero-icon" aria-hidden="true">
            <ReceiptText size={28} strokeWidth={1.9} />
          </div>
        </section>

        {/* ===================================================
            DASHBOARD SUMMARY
        =================================================== */}

        <section
          className="finance-dashboard__cards"
          aria-label="Finance summary"
        >
          <article className="finance-dashboard__card finance-dashboard__card--pending">
            <div className="finance-dashboard__card-icon">
              <Clock3 size={21} aria-hidden="true" />
            </div>

            <div className="finance-dashboard__card-copy">
              <span>Pending Tickets</span>

              <strong>
                {dashboardLoading ? "..." : summary.pending_tickets}
              </strong>

              <small>Tickets awaiting payment</small>
            </div>
          </article>

          <article className="finance-dashboard__card finance-dashboard__card--completed">
            <div className="finance-dashboard__card-icon">
              <CheckCircle2 size={21} aria-hidden="true" />
            </div>

            <div className="finance-dashboard__card-copy">
              <span>Completed Today</span>

              <strong>
                {dashboardLoading ? "..." : summary.completed_today}
              </strong>

              <small>Payments completed today</small>
            </div>
          </article>

          <article className="finance-dashboard__card finance-dashboard__card--registrar">
            <div className="finance-dashboard__card-icon">
              <FileCheck2 size={21} aria-hidden="true" />
            </div>

            <div className="finance-dashboard__card-copy">
              <span>Waiting for Registrar</span>

              <strong>
                {dashboardLoading ? "..." : summary.waiting_for_registrar}
              </strong>

              <small>Paid tickets forwarded for action</small>
            </div>
          </article>
        </section>

        {/* ===================================================
            CASHIER TICKET SEARCH
        =================================================== */}

        <section className="finance-dashboard__panel finance-dashboard__panel--lookup">
          <div className="finance-dashboard__panel-header">
            <div>
              <span className="finance-dashboard__section-kicker">
                Ticket Processing
              </span>

              <h2>Cashier Ticket Lookup</h2>

              <p>Enter the Finance ticket number presented by the student.</p>
            </div>

            <button
              type="button"
              className="finance-dashboard__refresh-button"
              onClick={() => void loadDashboard()}
              disabled={dashboardLoading}
            >
              <RefreshCcw
                size={15}
                className={
                  dashboardLoading ? "finance-dashboard__spin" : undefined
                }
              />
              {dashboardLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <form
            className="finance-dashboard__lookup-form"
            onSubmit={handleTicketSearch}
          >
            <div className="finance-dashboard__search-field">
              <Search size={17} aria-hidden="true" />

              <input
                type="text"
                value={ticketNumber}
                onChange={(event) =>
                  setTicketNumber(event.target.value.toUpperCase())
                }
                placeholder="Example: FIN-COR-2026-000001"
                disabled={searching}
                aria-label="Finance ticket number"
              />
            </div>

            <button
              type="submit"
              className="finance-dashboard__primary-button"
              disabled={searching}
            >
              {searching ? (
                <>
                  <Loader2 size={17} className="finance-dashboard__spin" />
                  Searching...
                </>
              ) : (
                <>
                  <Search size={17} />
                  Search Ticket
                </>
              )}
            </button>
          </form>

          {errorMessage && (
            <div
              className="finance-dashboard__message finance-dashboard__message--error"
              role="alert"
            >
              {errorMessage}
            </div>
          )}

          {successMessage && (
            <div
              className="finance-dashboard__message finance-dashboard__message--success"
              role="status"
            >
              {successMessage}
            </div>
          )}
        </section>

        {/* ===================================================
            TICKET DETAILS
        =================================================== */}

        {ticket && (
          <>
            <section className="finance-dashboard__panel finance-dashboard__panel--ticket">
              <div className="finance-dashboard__ticket-header">
                <div>
                  <div className="finance-dashboard__ticket-eyebrow">
                    <ReceiptText size={16} />
                    Finance Ticket
                  </div>

                  <h2>{ticket.ticket_number}</h2>
                </div>

                <div className="finance-dashboard__ticket-badges">
                  <StatusBadge
                    label={ticket.payment.payment_status}
                    variantClass={getPaymentBadgeClass(
                      ticket.payment.payment_status,
                    )}
                  />

                  <StatusBadge
                    label={ticket.registrar.status}
                    variantClass={getRegistrarBadgeClass(
                      ticket.registrar.status,
                    )}
                  />
                </div>
              </div>

              <div className="finance-dashboard__student-card">
                <div
                  className="finance-dashboard__student-avatar"
                  aria-hidden="true"
                >
                  <UserRound size={21} />
                </div>

                <div className="finance-dashboard__student-copy">
                  <span>Student</span>
                  <strong>{ticket.student.student_name}</strong>
                  <small>{ticket.student.student_number}</small>
                </div>
              </div>

              <div className="finance-dashboard__info-grid">
                <InfoBox
                  label="Transaction"
                  value={ticket.transaction.transaction_name}
                />

                <InfoBox
                  label="Transaction Code"
                  value={ticket.transaction.transaction_code}
                />

                <InfoBox
                  label="Request Number"
                  value={ticket.document_request?.request_number ?? "—"}
                />

                <InfoBox
                  label="Copies"
                  value={
                    ticket.document_request?.copies !== undefined
                      ? String(ticket.document_request.copies)
                      : "—"
                  }
                />

                <InfoBox
                  label="Amount Due"
                  value={formatMoney(ticket.payment.amount_due)}
                  emphasized
                />

                <InfoBox
                  label="Amount Paid"
                  value={formatMoney(ticket.payment.amount_paid)}
                  emphasized
                />

                <InfoBox
                  label="Payment Method"
                  value={ticket.payment.payment_method ?? "—"}
                />

                <InfoBox
                  label="Receipt Number"
                  value={ticket.payment.receipt_number ?? "—"}
                />

                <InfoBox
                  label="Paid At"
                  value={formatDate(ticket.payment.paid_at)}
                />

                <InfoBox
                  label="Registrar Status"
                  value={ticket.registrar.status}
                />
              </div>

              {ticket.document_request?.purpose && (
                <div className="finance-dashboard__purpose-box">
                  <span>Purpose</span>
                  <p>{ticket.document_request.purpose}</p>
                </div>
              )}
            </section>

            {/* =================================================
                PAYMENT FORM
            ================================================= */}

            <section className="finance-dashboard__panel finance-dashboard__panel--payment">
              <div className="finance-dashboard__payment-heading">
                <div
                  className="finance-dashboard__payment-heading-icon"
                  aria-hidden="true"
                >
                  <WalletCards size={21} />
                </div>

                <div>
                  <span className="finance-dashboard__section-kicker">
                    Cashier Action
                  </span>
                  <h2>Payment</h2>
                  <p>Record the student's payment for this transaction.</p>
                </div>
              </div>

              {ticket.payment.payment_status === "Pending Payment" ? (
                <form
                  className="finance-dashboard__payment-form"
                  onSubmit={handlePayment}
                >
                  <FieldLabel label="Amount Due">
                    <input
                      className="finance-dashboard__input"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={amountDue}
                      onChange={(event) => {
                        setAmountDue(event.target.value);

                        if (ticket.payment.amount_due === null) {
                          setAmountPaid(event.target.value);
                        }
                      }}
                      disabled={paying || ticket.payment.amount_due !== null}
                    />
                  </FieldLabel>

                  <FieldLabel label="Amount Paid">
                    <input
                      className="finance-dashboard__input"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={amountPaid}
                      onChange={(event) => setAmountPaid(event.target.value)}
                      disabled={paying}
                    />
                  </FieldLabel>

                  <FieldLabel label="Payment Method">
                    <select
                      className="finance-dashboard__input"
                      value={paymentMethod}
                      onChange={(event) =>
                        setPaymentMethod(event.target.value as PaymentMethod)
                      }
                      disabled={paying}
                    >
                      <option value="Cash">Cash</option>
                      <option value="GCash">GCash</option>
                      <option value="Bank">Bank</option>
                      <option value="Online">Online</option>
                    </select>
                  </FieldLabel>

                  <FieldLabel label="Receipt Number">
                    <input
                      className="finance-dashboard__input"
                      type="text"
                      value={receiptNumber}
                      onChange={(event) => setReceiptNumber(event.target.value)}
                      placeholder="Example: OR-000001"
                      disabled={paying}
                    />
                  </FieldLabel>

                  <label className="finance-dashboard__field finance-dashboard__field--full">
                    <span>Finance Remarks</span>

                    <textarea
                      className="finance-dashboard__input finance-dashboard__textarea"
                      rows={3}
                      maxLength={500}
                      value={remarks}
                      onChange={(event) => setRemarks(event.target.value)}
                      placeholder="Optional payment remarks..."
                      disabled={paying}
                    />
                  </label>

                  <div className="finance-dashboard__form-actions">
                    <button
                      type="submit"
                      className="finance-dashboard__primary-button finance-dashboard__primary-button--payment"
                      disabled={paying}
                    >
                      {paying ? (
                        <>
                          <Loader2
                            size={17}
                            className="finance-dashboard__spin"
                          />
                          Processing...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={17} />
                          Mark as Paid
                        </>
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="finance-dashboard__paid-state">
                  <div className="finance-dashboard__paid-state-title">
                    <CheckCircle2 size={22} />
                    <strong>Payment already completed</strong>
                  </div>

                  <p>
                    This transaction has already been paid and is currently{" "}
                    <strong>{ticket.registrar.status}</strong> on the Registrar
                    side.
                  </p>
                </div>
              )}
            </section>
          </>
        )}

        {/* ===================================================
            CONNECTION STATUS
        =================================================== */}

        <section className="finance-dashboard__panel finance-dashboard__panel--connection">
          <div className="finance-dashboard__connection-status">
            <span className="finance-dashboard__connection-dot" />
            <div>
              <span className="finance-dashboard__section-kicker">
                Workflow Status
              </span>
              <h2>Finance role connected</h2>
              <p>{statusMessage}</p>
            </div>
          </div>

          <div className="finance-dashboard__workflow">
            <span>Student / Faculty verification</span>
            <strong>→</strong>
            <span>Finance ticket</span>
            <strong>→</strong>
            <span>Payment completed</span>
            <strong>→</strong>
            <span>Registrar action</span>
          </div>
        </section>
      </main>
    </DashboardLayout>
  );
}

// ============================================================
// SMALL COMPONENTS
// ============================================================

function InfoBox({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={`finance-dashboard__info-box ${
        emphasized ? "finance-dashboard__info-box--emphasized" : ""
      }`}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBadge({
  label,
  variantClass,
}: {
  label: string;
  variantClass: string;
}) {
  return (
    <span className={`finance-dashboard__status-badge ${variantClass}`}>
      {label}
    </span>
  );
}

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="finance-dashboard__field">
      <span>{label}</span>
      {children}
    </label>
  );
}
