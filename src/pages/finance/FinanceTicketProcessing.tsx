import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import {
  CheckCircle2,
  Clock3,
  CreditCard,
  FileText,
  ListFilter,
  Loader2,
  ReceiptText,
  RefreshCcw,
  Search,
  UserRound,
  WalletCards,
} from "lucide-react";

import DashboardLayout from "../../components/Layout/DashboardLayout";
import { authService } from "../../services/auth.service";
import "../../styles/FinanceTicketProcessing.css";

const FINANCE_TICKETS_API = "http://localhost:3000/api/finance/tickets";

type PaymentMethod = "Cash" | "GCash" | "Bank" | "Online";
type PaymentFilter =
  | "All"
  | "Pending Payment"
  | "Paid"
  | "Cancelled"
  | "Refunded";

type TransactionFilter = "All" | "COR" | "COG" | "INCOMPLETE_GRADE";

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

interface TicketListResponse {
  success?: boolean;
  code?: string;
  message?: string;
  query?: string | null;
  count?: number;
  tickets?: FinanceTicket[];
}

interface SingleTicketResponse {
  success?: boolean;
  code?: string;
  message?: string;
  ticket?: FinanceTicket;
}

interface PaymentResponse {
  success?: boolean;
  code?: string;
  message?: string;
  ticket?: FinanceTicket;
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

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "Not assigned yet";
  }

  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatAcademicPeriod(request: FinanceTicket["document_request"]) {
  if (!request?.academic_period) {
    return "Legacy request — not recorded";
  }

  const year = request.academic_period.academic_year || "Unknown academic year";
  const semester = request.academic_period.semester_name || "Unknown semester";

  return `${year} — ${semester}`;
}

function safePositiveMoney(value: string) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return Number(amount.toFixed(2));
}


function getPaymentStatusClass(status: string) {
  if (status === "Paid") {
    return "finance-requests__status--paid";
  }

  if (status === "Pending Payment") {
    return "finance-requests__status--pending";
  }

  if (status === "Cancelled") {
    return "finance-requests__status--cancelled";
  }

  if (status === "Refunded") {
    return "finance-requests__status--refunded";
  }

  return "finance-requests__status--neutral";
}

function getRegistrarStatusClass(status: string) {
  if (status === "Done") {
    return "finance-requests__status--done";
  }

  if (status === "Ready for Processing") {
    return "finance-requests__status--ready";
  }

  if (status === "Processing") {
    return "finance-requests__status--processing";
  }

  if (status === "Cancelled" || status === "Rejected") {
    return "finance-requests__status--cancelled";
  }

  return "finance-requests__status--neutral";
}

export default function FinanceTicketProcessing() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();

  const isFinance = session?.role === "Finance" && Boolean(token);

  const [tickets, setTickets] = useState<FinanceTicket[]>([]);
  const [selectedTicketNumber, setSelectedTicketNumber] = useState<
    string | null
  >(null);

  const [searchText, setSearchText] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [paymentFilter, setPaymentFilter] =
    useState<PaymentFilter>("Pending Payment");
  const [transactionFilter, setTransactionFilter] =
    useState<TransactionFilter>("All");

  const [loadingQueue, setLoadingQueue] = useState(false);
  const [paying, setPaying] = useState(false);

  const [amountDue, setAmountDue] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Cash");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [remarks, setRemarks] = useState("");

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (!isFinance) {
      navigate("/login", {
        replace: true,
      });
    }
  }, [isFinance, navigate]);

  const selectedTicket = useMemo(() => {
    if (!selectedTicketNumber) {
      return null;
    }

    return (
      tickets.find((item) => item.ticket_number === selectedTicketNumber) ??
      null
    );
  }, [tickets, selectedTicketNumber]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((item) => {
      if (
        paymentFilter !== "All" &&
        item.payment.payment_status !== paymentFilter
      ) {
        return false;
      }

      if (
        transactionFilter !== "All" &&
        item.transaction.transaction_code !== transactionFilter
      ) {
        return false;
      }

      return true;
    });
  }, [tickets, paymentFilter, transactionFilter]);

  const summary = useMemo(() => {
    let pending = 0;
    let paid = 0;
    let waitingForRegistrar = 0;

    for (const item of tickets) {
      if (item.payment.payment_status === "Pending Payment") {
        pending += 1;
      }

      if (item.payment.payment_status === "Paid") {
        paid += 1;
      }

      if (
        item.payment.payment_status === "Paid" &&
        item.registrar.status !== "Done" &&
        item.registrar.status !== "Cancelled" &&
        item.registrar.status !== "Rejected"
      ) {
        waitingForRegistrar += 1;
      }
    }

    return {
      total: tickets.length,
      pending,
      paid,
      waitingForRegistrar,
    };
  }, [tickets]);

  const paymentLocked = useMemo(() => {
    if (!selectedTicket) {
      return true;
    }

    return (
      selectedTicket.payment.payment_status !== "Pending Payment" ||
      selectedTicket.registrar.status !== "Pending" ||
      Boolean(selectedTicket.document_request?.cancelled_at)
    );
  }, [selectedTicket]);

  const resetPaymentForm = (loadedTicket: FinanceTicket) => {
    const due = loadedTicket.payment.amount_due;

    setAmountDue(due === null ? "" : String(due));
    setAmountPaid(due === null ? "" : String(due));
    setPaymentMethod("Cash");
    setReceiptNumber("");
    setRemarks(loadedTicket.payment.finance_remarks || "");
  };

  const selectTicket = (loadedTicket: FinanceTicket) => {
    setSelectedTicketNumber(loadedTicket.ticket_number);
    resetPaymentForm(loadedTicket);
    setErrorMessage("");
    setSuccessMessage("");
  };

  const loadQueue = async (query = activeSearch, preserveSelection = true) => {
    if (!isFinance || loadingQueue) {
      return;
    }

    setLoadingQueue(true);
    setErrorMessage("");

    try {
      const cleanedQuery = query.trim();

      const url = cleanedQuery
        ? `${FINANCE_TICKETS_API}?q=${encodeURIComponent(cleanedQuery)}`
        : FINANCE_TICKETS_API;

      const response = await authService.authFetch(url, {
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
        throw new Error("Finance access is required.");
      }

      const data = (await response.json()) as TicketListResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load Finance transactions.");
      }

      const loadedTickets = Array.isArray(data.tickets) ? data.tickets : [];

      setTickets(loadedTickets);
      setActiveSearch(cleanedQuery);

      if (!preserveSelection) {
        setSelectedTicketNumber(null);
      } else if (selectedTicketNumber) {
        const stillExists = loadedTickets.some(
          (item) => item.ticket_number === selectedTicketNumber,
        );

        if (!stillExists) {
          setSelectedTicketNumber(null);
        }
      }

      if (cleanedQuery && loadedTickets.length === 0) {
        setErrorMessage("No Finance transaction matched your search.");
      }
    } catch (error) {
      console.error("LOAD FINANCE QUEUE ERROR:", error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load Finance transactions.",
      );
    } finally {
      setLoadingQueue(false);
    }
  };

  const refreshSelectedTicket = async (ticketNumber: string) => {
    const response = await authService.authFetch(
      `${FINANCE_TICKETS_API}/${encodeURIComponent(ticketNumber)}`,
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

      return null;
    }

    const data = (await response.json()) as SingleTicketResponse;

    if (!response.ok || !data.success || !data.ticket) {
      throw new Error(
        data.message || "Unable to refresh the Finance transaction.",
      );
    }

    const updatedTicket = data.ticket;

    setTickets((current) =>
      current.map((item) =>
        item.ticket_number === updatedTicket.ticket_number
          ? updatedTicket
          : item,
      ),
    );

    setSelectedTicketNumber(updatedTicket.ticket_number);
    resetPaymentForm(updatedTicket);

    return updatedTicket;
  };

  useEffect(() => {
    if (!isFinance) {
      return;
    }

    void loadQueue("", false);
    // Load once after authenticated Finance page mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFinance]);

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (loadingQueue || paying) {
      return;
    }

    // A search should show every matching result regardless of its
    // current payment or transaction filter.
    setPaymentFilter("All");
    setTransactionFilter("All");

    await loadQueue(searchText, false);
  };

  const handleShowAll = async () => {
    if (loadingQueue || paying) {
      return;
    }

    setSearchText("");
    setActiveSearch("");
    setPaymentFilter("Pending Payment");
    setTransactionFilter("All");
    setSelectedTicketNumber(null);

    await loadQueue("", false);
  };

  const handlePayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedTicket || paying || paymentLocked) {
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");

    const paid = safePositiveMoney(amountPaid);

    if (paid === null) {
      setErrorMessage("Amount paid must be greater than zero.");
      return;
    }

    const existingAmountDue = selectedTicket.payment.amount_due;
    let newAmountDue: number | null = null;

    if (existingAmountDue === null) {
      newAmountDue = safePositiveMoney(amountDue);

      if (newAmountDue === null) {
        setErrorMessage(
          "This ticket does not have an amount due yet. Enter the official amount due.",
        );
        return;
      }

      if (Math.abs(newAmountDue - paid) >= 0.005) {
        setErrorMessage(
          "Amount paid must exactly match the amount due for this workflow.",
        );
        return;
      }
    } else if (Math.abs(existingAmountDue - paid) >= 0.005) {
      setErrorMessage(
        `Amount paid must exactly match ${formatMoney(existingAmountDue)}.`,
      );
      return;
    }

    const cleanedReceipt = receiptNumber.trim();

    if (!cleanedReceipt) {
      setErrorMessage("Receipt number is required.");
      return;
    }

    setPaying(true);

    try {
      const body: {
        amount_paid: number;
        payment_method: PaymentMethod;
        receipt_number: string;
        remarks?: string;
        amount_due?: number;
      } = {
        amount_paid: paid,
        payment_method: paymentMethod,
        receipt_number: cleanedReceipt,
      };

      if (existingAmountDue === null && newAmountDue !== null) {
        body.amount_due = newAmountDue;
      }

      const cleanedRemarks = remarks.trim();

      if (cleanedRemarks) {
        body.remarks = cleanedRemarks;
      }

      const response = await authService.authFetch(
        `${FINANCE_TICKETS_API}/${encodeURIComponent(
          selectedTicket.ticket_number,
        )}/pay`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        },
      );

      if (response.status === 401) {
        authService.logout();

        navigate("/login", {
          replace: true,
        });

        return;
      }

      const data = (await response.json()) as PaymentResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to complete payment.");
      }

      await refreshSelectedTicket(selectedTicket.ticket_number);

      setSuccessMessage(
        data.message ||
          "Payment completed. The request is now ready for Registrar processing.",
      );
    } catch (error) {
      console.error("FINANCE PAYMENT ERROR:", error);

      setErrorMessage(
        error instanceof Error ? error.message : "Unable to complete payment.",
      );
    } finally {
      setPaying(false);
    }
  };

  if (!isFinance) {
    return null;
  }


  return (
    <DashboardLayout>
      <main className="finance-requests">
        {/* ===================================================
            HEADER
        =================================================== */}

        <section className="finance-requests__hero">
          <div className="finance-requests__hero-copy">
            <div className="finance-requests__eyebrow">
              <WalletCards size={16} aria-hidden="true" />
              Finance Office
            </div>

            <h1>Finance Requests</h1>

            <p>
              Review student transaction requests, search Finance tickets, record
              payments, and move completed requests forward for Registrar
              processing.
            </p>
          </div>

          <div className="finance-requests__hero-icon" aria-hidden="true">
            <ReceiptText size={29} strokeWidth={1.9} />
          </div>
        </section>

        {/* ===================================================
            SUMMARY
        =================================================== */}

        <section
          className="finance-requests__summary-grid"
          aria-label="Finance request summary"
        >
          <SummaryCard
            icon={<ReceiptText size={21} />}
            label="Current View"
            value={summary.total}
          />

          <SummaryCard
            icon={<Clock3 size={21} />}
            label="Pending Payment"
            value={summary.pending}
          />

          <SummaryCard
            icon={<CheckCircle2 size={21} />}
            label="Paid"
            value={summary.paid}
          />

          <SummaryCard
            icon={<FileText size={21} />}
            label="Waiting for Registrar"
            value={summary.waitingForRegistrar}
          />
        </section>

        {/* ===================================================
            REQUEST QUEUE
        =================================================== */}

        <section className="finance-requests__panel">
          <div className="finance-requests__section-header">
            <div>
              <span className="finance-requests__section-kicker">
                Request Management
              </span>

              <h2>Transaction Queue</h2>

              <p>
                Pending requests are shown by default. Search can also locate
                paid and historical Finance tickets.
              </p>
            </div>

            <button
              type="button"
              className="finance-requests__button finance-requests__button--secondary"
              onClick={() => void loadQueue(activeSearch)}
              disabled={loadingQueue || paying}
            >
              {loadingQueue ? (
                <Loader2
                  size={16}
                  className="finance-requests__spinner"
                  aria-hidden="true"
                />
              ) : (
                <RefreshCcw size={16} aria-hidden="true" />
              )}

              Refresh
            </button>
          </div>

          <form
            onSubmit={handleSearch}
            className="finance-requests__filters"
          >
            <div className="finance-requests__search">
              <Search
                size={17}
                className="finance-requests__search-icon"
                aria-hidden="true"
              />

              <input
                type="text"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Ticket, request, student number, or student name"
                disabled={loadingQueue || paying}
              />
            </div>

            <select
              value={paymentFilter}
              onChange={(event) =>
                setPaymentFilter(event.target.value as PaymentFilter)
              }
              disabled={loadingQueue || paying}
              aria-label="Filter by payment status"
            >
              <option value="All">All Payment Statuses</option>
              <option value="Pending Payment">Pending Payment</option>
              <option value="Paid">Paid</option>
              <option value="Cancelled">Cancelled</option>
              <option value="Refunded">Refunded</option>
            </select>

            <select
              value={transactionFilter}
              onChange={(event) =>
                setTransactionFilter(event.target.value as TransactionFilter)
              }
              disabled={loadingQueue || paying}
              aria-label="Filter by transaction type"
            >
              <option value="All">All Transactions</option>
              <option value="COR">COR</option>
              <option value="COG">COG</option>
              <option value="INCOMPLETE_GRADE">Incomplete / Grade 4</option>
            </select>

            <button
              type="submit"
              className="finance-requests__button finance-requests__button--primary"
              disabled={loadingQueue || paying || !searchText.trim()}
            >
              {loadingQueue ? (
                <Loader2
                  size={17}
                  className="finance-requests__spinner"
                  aria-hidden="true"
                />
              ) : (
                <Search size={17} aria-hidden="true" />
              )}

              Search
            </button>

            <button
              type="button"
              className="finance-requests__button finance-requests__button--secondary"
              onClick={() => void handleShowAll()}
              disabled={loadingQueue || paying}
            >
              <ListFilter size={16} aria-hidden="true" />
              Show All
            </button>
          </form>

          {activeSearch && (
            <div className="finance-requests__search-note">
              Search results for <strong>{activeSearch}</strong>
            </div>
          )}

          {errorMessage && (
            <div
              className="finance-requests__message finance-requests__message--error"
              role="alert"
            >
              {errorMessage}
            </div>
          )}

          {successMessage && (
            <div
              className="finance-requests__message finance-requests__message--success"
              role="status"
            >
              {successMessage}
            </div>
          )}

          {loadingQueue ? (
            <div className="finance-requests__state">
              <Loader2
                size={23}
                className="finance-requests__spinner"
                aria-hidden="true"
              />
              <strong>Loading Finance requests...</strong>
              <span>Please wait while the request queue is refreshed.</span>
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="finance-requests__state finance-requests__state--empty">
              <div className="finance-requests__state-icon">
                <ReceiptText size={27} aria-hidden="true" />
              </div>

              <strong>No transactions found</strong>

              <span>
                Change the filters, search another student, or show all
                transactions.
              </span>
            </div>
          ) : (
            <div className="finance-requests__queue">
              {filteredTickets.map((item) => {
                const selected =
                  selectedTicketNumber === item.ticket_number;

                return (
                  <button
                    key={item.ticket_id}
                    type="button"
                    className={`finance-requests__queue-card ${
                      selected ? "is-selected" : ""
                    }`}
                    onClick={() => selectTicket(item)}
                    aria-pressed={selected}
                  >
                    <div className="finance-requests__queue-top">
                      <div className="finance-requests__queue-heading">
                        <span className="finance-requests__ticket-number">
                          {item.ticket_number}
                        </span>

                        <strong>{item.transaction.transaction_name}</strong>
                      </div>

                      <div className="finance-requests__status-group">
                        <StatusPill
                          value={item.payment.payment_status}
                          statusClass={getPaymentStatusClass(
                            item.payment.payment_status,
                          )}
                        />

                        <StatusPill
                          value={item.registrar.status}
                          statusClass={getRegistrarStatusClass(
                            item.registrar.status,
                          )}
                        />
                      </div>
                    </div>

                    <div className="finance-requests__queue-grid">
                      <QueueInfo
                        label="Student"
                        value={item.student.student_name}
                      />

                      <QueueInfo
                        label="Student No."
                        value={item.student.student_number}
                      />

                      <QueueInfo
                        label="Request"
                        value={
                          item.document_request?.request_number ??
                          (item.grade_id
                            ? `Grade ID ${item.grade_id}`
                            : "—")
                        }
                      />

                      <QueueInfo
                        label="Period"
                        value={formatAcademicPeriod(item.document_request)}
                      />

                      <QueueInfo
                        label="Amount Due"
                        value={formatMoney(item.payment.amount_due)}
                      />

                      <QueueInfo
                        label="Created"
                        value={formatDate(item.created_at)}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* ===================================================
            SELECTED REQUEST
        =================================================== */}

        {selectedTicket && (
          <>
            <section className="finance-requests__panel finance-requests__selected-panel">
              <div className="finance-requests__section-header">
                <div>
                  <div className="finance-requests__eyebrow">
                    <ReceiptText size={16} aria-hidden="true" />
                    Selected Transaction
                  </div>

                  <h2 className="finance-requests__selected-title">
                    {selectedTicket.ticket_number}
                  </h2>

                  <p>{selectedTicket.transaction.transaction_name}</p>
                </div>

                <div className="finance-requests__status-group">
                  <StatusPill
                    value={selectedTicket.payment.payment_status}
                    statusClass={getPaymentStatusClass(
                      selectedTicket.payment.payment_status,
                    )}
                  />

                  <StatusPill
                    value={selectedTicket.registrar.status}
                    statusClass={getRegistrarStatusClass(
                      selectedTicket.registrar.status,
                    )}
                  />
                </div>
              </div>

              <div className="finance-requests__student-card">
                <div className="finance-requests__student-icon">
                  <UserRound size={21} aria-hidden="true" />
                </div>

                <div>
                  <strong>{selectedTicket.student.student_name}</strong>
                  <span>{selectedTicket.student.student_number}</span>
                </div>
              </div>

              <div className="finance-requests__details-grid">
                <InfoBox
                  label="Transaction"
                  value={selectedTicket.transaction.transaction_code}
                />

                <InfoBox
                  label="Request Number"
                  value={
                    selectedTicket.document_request?.request_number ??
                    "Not a document request"
                  }
                />

                <InfoBox
                  label="Document Type"
                  value={
                    selectedTicket.document_request?.document_type ??
                    selectedTicket.transaction.transaction_name
                  }
                />

                <InfoBox
                  label="Academic Period"
                  value={formatAcademicPeriod(
                    selectedTicket.document_request,
                  )}
                />

                <InfoBox
                  label="Enrollment ID"
                  value={
                    selectedTicket.document_request?.enrollment_id
                      ? String(
                          selectedTicket.document_request.enrollment_id,
                        )
                      : "Not recorded"
                  }
                />

                <InfoBox
                  label="Copies"
                  value={
                    selectedTicket.document_request
                      ? String(selectedTicket.document_request.copies)
                      : "—"
                  }
                />

                <InfoBox
                  label="Amount Due"
                  value={formatMoney(selectedTicket.payment.amount_due)}
                />

                <InfoBox
                  label="Amount Paid"
                  value={formatMoney(selectedTicket.payment.amount_paid)}
                />

                <InfoBox
                  label="Receipt"
                  value={selectedTicket.payment.receipt_number || "—"}
                />

                <InfoBox
                  label="Payment Method"
                  value={selectedTicket.payment.payment_method || "—"}
                />

                <InfoBox
                  label="Paid At"
                  value={formatDate(selectedTicket.payment.paid_at)}
                />

                <InfoBox
                  label="Registrar Status"
                  value={selectedTicket.registrar.status}
                />
              </div>

              {selectedTicket.document_request?.purpose && (
                <div className="finance-requests__purpose">
                  <span>Purpose</span>
                  <p>{selectedTicket.document_request.purpose}</p>
                </div>
              )}

              {selectedTicket.document_request?.cancelled_at && (
                <div className="finance-requests__message finance-requests__message--error">
                  This document request was cancelled
                  {selectedTicket.document_request.cancellation_reason
                    ? `: ${selectedTicket.document_request.cancellation_reason}`
                    : "."}
                </div>
              )}
            </section>

            {/* =================================================
                PAYMENT
            ================================================= */}

            <section className="finance-requests__panel">
              <div className="finance-requests__payment-header">
                <div className="finance-requests__payment-icon">
                  <CreditCard size={20} aria-hidden="true" />
                </div>

                <div>
                  <span className="finance-requests__section-kicker">
                    Cashier Action
                  </span>
                  <h2>Record Payment</h2>
                  <p>
                    Finance records payment only. Registrar processing remains
                    separate.
                  </p>
                </div>
              </div>

              {selectedTicket.payment.payment_status === "Paid" ? (
                <div className="finance-requests__paid-card">
                  <div className="finance-requests__paid-heading">
                    <CheckCircle2 size={20} aria-hidden="true" />
                    Payment Completed
                  </div>

                  <div className="finance-requests__details-grid">
                    <InfoBox
                      label="Amount Paid"
                      value={formatMoney(
                        selectedTicket.payment.amount_paid,
                      )}
                    />

                    <InfoBox
                      label="Payment Method"
                      value={
                        selectedTicket.payment.payment_method || "—"
                      }
                    />

                    <InfoBox
                      label="Receipt Number"
                      value={
                        selectedTicket.payment.receipt_number || "—"
                      }
                    />

                    <InfoBox
                      label="Paid At"
                      value={formatDate(selectedTicket.payment.paid_at)}
                    />

                    <InfoBox
                      label="Registrar Status"
                      value={selectedTicket.registrar.status}
                    />
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={handlePayment}
                  className="finance-requests__payment-form"
                >
                  <FieldLabel label="Amount Due">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={amountDue}
                      onChange={(event) =>
                        setAmountDue(event.target.value)
                      }
                      disabled={
                        paying ||
                        paymentLocked ||
                        selectedTicket.payment.amount_due !== null
                      }
                      placeholder="Enter official amount due"
                    />
                  </FieldLabel>

                  <FieldLabel label="Amount Paid">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={amountPaid}
                      onChange={(event) =>
                        setAmountPaid(event.target.value)
                      }
                      disabled={paying || paymentLocked}
                      placeholder="Enter amount paid"
                    />
                  </FieldLabel>

                  <FieldLabel label="Payment Method">
                    <select
                      value={paymentMethod}
                      onChange={(event) =>
                        setPaymentMethod(
                          event.target.value as PaymentMethod,
                        )
                      }
                      disabled={paying || paymentLocked}
                    >
                      <option value="Cash">Cash</option>
                      <option value="GCash">GCash</option>
                      <option value="Bank">Bank</option>
                      <option value="Online">Online</option>
                    </select>
                  </FieldLabel>

                  <FieldLabel label="Receipt Number">
                    <input
                      type="text"
                      value={receiptNumber}
                      onChange={(event) =>
                        setReceiptNumber(event.target.value)
                      }
                      disabled={paying || paymentLocked}
                      placeholder="Official receipt number"
                      maxLength={50}
                    />
                  </FieldLabel>

                  <label className="finance-requests__field finance-requests__field--full">
                    <span>Finance Remarks</span>

                    <textarea
                      value={remarks}
                      onChange={(event) =>
                        setRemarks(event.target.value)
                      }
                      disabled={paying || paymentLocked}
                      placeholder="Optional Finance remarks"
                      maxLength={500}
                      rows={3}
                    />
                  </label>

                  <div className="finance-requests__payment-actions">
                    <button
                      type="submit"
                      className="finance-requests__button finance-requests__button--primary finance-requests__button--pay"
                      disabled={paying || paymentLocked}
                    >
                      {paying ? (
                        <Loader2
                          size={17}
                          className="finance-requests__spinner"
                          aria-hidden="true"
                        />
                      ) : (
                        <WalletCards size={17} aria-hidden="true" />
                      )}

                      {paying
                        ? "Processing..."
                        : "Confirm Payment"}
                    </button>
                  </div>
                </form>
              )}

              {paymentLocked &&
                selectedTicket.payment.payment_status !== "Paid" && (
                  <div className="finance-requests__message finance-requests__message--warning">
                    This transaction is not currently payable. Payment must be
                    Pending Payment, Registrar must still be Pending, and the
                    linked request must not be cancelled.
                  </div>
                )}
            </section>
          </>
        )}
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
    <article className="finance-requests__summary-card">
      <div className="finance-requests__summary-icon">{icon}</div>

      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function QueueInfo({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="finance-requests__queue-info">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InfoBox({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="finance-requests__info-box">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusPill({
  value,
  statusClass,
}: {
  value: string;
  statusClass: string;
}) {
  return (
    <span
      className={`finance-requests__status ${statusClass}`}
    >
      {value}
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
    <label className="finance-requests__field">
      <span>{label}</span>
      {children}
    </label>
  );
}
