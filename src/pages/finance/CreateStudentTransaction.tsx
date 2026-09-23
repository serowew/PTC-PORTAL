import { useCallback, useEffect, useMemo, useState } from "react";

import type { FormEvent, ReactNode } from "react";

import { useNavigate } from "react-router-dom";

import {
  AlertCircle,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  FileText,
  Loader2,
  ReceiptText,
  Search,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";

import DashboardLayout from "../../components/Layout/DashboardLayout";
import { authService } from "../../services/auth.service";
import "../../styles/FinanceCreateStudentTransaction.css";

const STUDENT_SEARCH_API = "http://localhost:3000/api/finance/tickets/students";

const TRANSACTION_TYPES_API =
  "http://localhost:3000/api/finance/tickets/transaction-types";

const CREATE_TRANSACTION_API =
  "http://localhost:3000/api/finance/tickets/manual";

// ============================================================
// TYPES
// ============================================================

interface FinanceStudent {
  student_id: number;
  student_number: string;
  student_name: string;
}

interface StudentSearchResponse {
  success?: boolean;
  code?: string;
  message?: string;

  query?: string | null;
  count?: number;

  students?: FinanceStudent[];
}

interface FinanceTransactionType {
  transaction_type_id: number;

  transaction_code: string;
  transaction_name: string;

  description: string | null;

  requires_grade_reference: boolean;

  workflow_type:
    | "FINANCE_ONLY"
    | "DOCUMENT_REQUEST"
    | "INCOMPLETE_GRADE"
    | string;

  allow_manual_creation: boolean;

  allow_amount_override: boolean;

  default_amount: number | null;

  is_active: boolean;
}

interface TransactionTypesResponse {
  success?: boolean;
  code?: string;
  message?: string;

  transaction_types?: FinanceTransactionType[];
}

interface CreatedTicket {
  ticket_id: number;

  ticket_number: string;

  source_type: string;

  student: {
    student_id: number;
    student_number: string;
    student_name: string;
  };

  transaction: {
    transaction_type_id: number;
    transaction_code: string;
    transaction_name: string;
    workflow_type: string;
  };

  payment: {
    amount_due: number;
    amount_paid: number;
    payment_status: string;
  };

  registrar: {
    status: string;
  };

  remarks: string | null;
}

interface CreateTransactionResponse {
  success?: boolean;
  code?: string;
  message?: string;

  ticket?: CreatedTicket;
}

// ============================================================
// FORMAT MONEY
// ============================================================

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "Not configured";
  }

  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(Number(value));
}


export default function CreateStudentTransaction() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();

  const role = session?.role ?? null;

  const isFinance = role === "Finance" && Boolean(token);

  // ==========================================================
  // STUDENT SEARCH
  // ==========================================================

  const [studentQuery, setStudentQuery] = useState("");

  const [studentResults, setStudentResults] = useState<FinanceStudent[]>([]);

  const [selectedStudent, setSelectedStudent] = useState<FinanceStudent | null>(
    null,
  );

  const [searchingStudents, setSearchingStudents] = useState(false);

  const [studentSearchMessage, setStudentSearchMessage] = useState("");

  // ==========================================================
  // TRANSACTION TYPES
  // ==========================================================

  const [transactionTypes, setTransactionTypes] = useState<
    FinanceTransactionType[]
  >([]);

  const [selectedTransactionCode, setSelectedTransactionCode] = useState("");

  const [loadingTypes, setLoadingTypes] = useState(true);

  // ==========================================================
  // FORM
  // ==========================================================

  const [amountDue, setAmountDue] = useState("");

  const [remarks, setRemarks] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");

  const [successMessage, setSuccessMessage] = useState("");

  const [createdTicket, setCreatedTicket] = useState<CreatedTicket | null>(
    null,
  );

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
  // SELECTED TRANSACTION TYPE
  // ==========================================================

  const selectedTransactionType = useMemo(() => {
    return (
      transactionTypes.find(
        (item) => item.transaction_code === selectedTransactionCode,
      ) ?? null
    );
  }, [transactionTypes, selectedTransactionCode]);

  // ==========================================================
  // LOAD TRANSACTION TYPES
  // ==========================================================

  const loadTransactionTypes = useCallback(async () => {
    if (!isFinance) {
      return;
    }

    setLoadingTypes(true);
    setErrorMessage("");

    try {
      const response = await authService.authFetch(TRANSACTION_TYPES_API, {
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

      const data = (await response.json()) as TransactionTypesResponse;

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Unable to load Finance transaction types.",
        );
      }

      const loadedTypes = Array.isArray(data.transaction_types)
        ? data.transaction_types
        : [];

      /*
       * Finance manual assignment must ONLY use:
       *
       * - Active types
       * - FINANCE_ONLY workflow
       * - allow_manual_creation = true
       *
       * This matches backend enforcement.
       */
      setTransactionTypes(
        loadedTypes.filter(
          (item) =>
            item.is_active &&
            item.workflow_type === "FINANCE_ONLY" &&
            item.allow_manual_creation,
        ),
      );
    } catch (error) {
      console.error("LOAD FINANCE TRANSACTION TYPES ERROR:", error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load Finance transaction types.",
      );
    } finally {
      setLoadingTypes(false);
    }
  }, [isFinance, navigate]);

  useEffect(() => {
    if (!isFinance) {
      return;
    }

    void loadTransactionTypes();
  }, [isFinance, loadTransactionTypes]);

  // ==========================================================
  // SEARCH STUDENTS
  //
  // Debounced so the backend is not called every keystroke.
  // ==========================================================

  useEffect(() => {
    if (!isFinance || selectedStudent) {
      return;
    }

    const query = studentQuery.trim();

    if (query.length < 2) {
      setStudentResults([]);
      setStudentSearchMessage("");

      return;
    }

    const timer = window.setTimeout(async () => {
      setSearchingStudents(true);

      setStudentSearchMessage("");

      try {
        const response = await authService.authFetch(
          `${STUDENT_SEARCH_API}?q=${encodeURIComponent(query)}`,
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

        const data = (await response.json()) as StudentSearchResponse;

        if (!response.ok || !data.success) {
          throw new Error(data.message || "Unable to search students.");
        }

        const students = Array.isArray(data.students) ? data.students : [];

        setStudentResults(students);

        if (students.length === 0) {
          setStudentSearchMessage("No students matched your search.");
        }
      } catch (error) {
        console.error("FINANCE STUDENT SEARCH ERROR:", error);

        setStudentResults([]);

        setStudentSearchMessage(
          error instanceof Error ? error.message : "Unable to search students.",
        );
      } finally {
        setSearchingStudents(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isFinance, studentQuery, selectedStudent, navigate]);

  // ==========================================================
  // TRANSACTION TYPE CHANGE
  // ==========================================================

  const handleTransactionTypeChange = (transactionCode: string) => {
    setSelectedTransactionCode(transactionCode);

    setErrorMessage("");
    setSuccessMessage("");
    setCreatedTicket(null);

    const selectedType = transactionTypes.find(
      (item) => item.transaction_code === transactionCode,
    );

    if (!selectedType) {
      setAmountDue("");
      return;
    }

    if (
      selectedType.default_amount !== null &&
      selectedType.default_amount !== undefined
    ) {
      setAmountDue(String(selectedType.default_amount));
    } else {
      setAmountDue("");
    }
  };

  // ==========================================================
  // SELECT STUDENT
  // ==========================================================

  const selectStudent = (student: FinanceStudent) => {
    setSelectedStudent(student);

    setStudentQuery(`${student.student_number} — ${student.student_name}`);

    setStudentResults([]);

    setStudentSearchMessage("");

    setErrorMessage("");
    setSuccessMessage("");
    setCreatedTicket(null);
  };

  // ==========================================================
  // CLEAR STUDENT
  // ==========================================================

  const clearStudent = () => {
    setSelectedStudent(null);

    setStudentQuery("");

    setStudentResults([]);

    setStudentSearchMessage("");

    setCreatedTicket(null);

    setSuccessMessage("");
    setErrorMessage("");
  };

  // ==========================================================
  // CREATE STUDENT TRANSACTION
  // ==========================================================

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (submitting) {
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");
    setCreatedTicket(null);

    if (!selectedStudent) {
      setErrorMessage("Please select a student.");

      return;
    }

    if (!selectedTransactionType) {
      setErrorMessage("Please select a Finance transaction type.");

      return;
    }

    const parsedAmount = amountDue.trim() === "" ? null : Number(amountDue);

    if (
      parsedAmount !== null &&
      (!Number.isFinite(parsedAmount) || parsedAmount <= 0)
    ) {
      setErrorMessage("Amount due must be greater than zero.");

      return;
    }

    /*
     * If there is no configured default,
     * Finance MUST enter an amount.
     */
    if (
      selectedTransactionType.default_amount === null &&
      parsedAmount === null
    ) {
      setErrorMessage(
        "This transaction type has no default amount. Enter the amount due.",
      );

      return;
    }

    /*
     * Fixed transaction type:
     * amount must remain exactly the configured default.
     */
    if (
      !selectedTransactionType.allow_amount_override &&
      selectedTransactionType.default_amount !== null &&
      parsedAmount !== selectedTransactionType.default_amount
    ) {
      setErrorMessage(
        `This transaction uses the fixed amount ${formatMoney(
          selectedTransactionType.default_amount,
        )}.`,
      );

      return;
    }

    try {
      setSubmitting(true);

      const body: {
        student_id: number;
        transaction_code: string;
        amount_due?: number;
        remarks?: string;
      } = {
        student_id: selectedStudent.student_id,

        transaction_code: selectedTransactionType.transaction_code,
      };

      /*
       * Send amount_due only when an actual value exists.
       *
       * Backend will otherwise use default_amount.
       */
      if (parsedAmount !== null) {
        body.amount_due = parsedAmount;
      }

      if (remarks.trim()) {
        body.remarks = remarks.trim();
      }

      const response = await authService.authFetch(CREATE_TRANSACTION_API, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Accept: "application/json",
        },

        body: JSON.stringify(body),
      });

      if (response.status === 401) {
        authService.logout();

        navigate("/login", {
          replace: true,
        });

        return;
      }

      if (response.status === 403) {
        const data = (await response.json()) as CreateTransactionResponse;

        throw new Error(
          data.message ||
            "This transaction cannot be manually assigned by Finance.",
        );
      }

      const data = (await response.json()) as CreateTransactionResponse;

      if (!response.ok || !data.success || !data.ticket) {
        throw new Error(
          data.message || "Unable to create the student Finance transaction.",
        );
      }

      setCreatedTicket(data.ticket);

      setSuccessMessage(
        data.message || "Student Finance transaction created successfully.",
      );

      /*
       * Keep student selected so Finance can quickly
       * assign another transaction to the same student.
       */
      setSelectedTransactionCode("");

      setAmountDue("");

      setRemarks("");
    } catch (error) {
      console.error("CREATE STUDENT FINANCE TRANSACTION ERROR:", error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to create the student Finance transaction.",
      );
    } finally {
      setSubmitting(false);
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
      <main className="finance-create-transaction">
        {/* =================================================
            HEADER
        ================================================= */}

        <section className="finance-create-transaction__hero">
          <div className="finance-create-transaction__hero-copy">
            <div className="finance-create-transaction__eyebrow">
              <WalletCards size={16} aria-hidden="true" />
              Finance
            </div>

            <h1>Create Student Transaction</h1>

            <p>
              Assign a Finance-only transaction to a specific student. The
              system automatically generates a Finance ticket for the new
              transaction.
            </p>
          </div>

          <div
            className="finance-create-transaction__hero-icon"
            aria-hidden="true"
          >
            <CreditCard size={28} strokeWidth={1.9} />
          </div>
        </section>

        {/* =================================================
            ERROR
        ================================================= */}

        {errorMessage && (
          <section
            className="finance-create-transaction__message finance-create-transaction__message--error"
            role="alert"
          >
            <AlertCircle size={19} aria-hidden="true" />

            <div>{errorMessage}</div>
          </section>
        )}

        {/* =================================================
            SUCCESS
        ================================================= */}

        {successMessage && createdTicket && (
          <section className="finance-create-transaction__success-card">
            <div className="finance-create-transaction__success-header">
              <div className="finance-create-transaction__success-icon">
                <CheckCircle2 size={22} aria-hidden="true" />
              </div>

              <div>
                <span className="finance-create-transaction__section-kicker">
                  Transaction Complete
                </span>

                <h2>Transaction Created</h2>

                <p>{successMessage}</p>
              </div>
            </div>

            <div className="finance-create-transaction__info-grid">
              <InfoBox
                label="Finance Ticket"
                value={createdTicket.ticket_number}
                icon={<ReceiptText size={13} />}
              />

              <InfoBox
                label="Student"
                value={`${createdTicket.student.student_number} — ${createdTicket.student.student_name}`}
                icon={<UserRound size={13} />}
              />

              <InfoBox
                label="Transaction"
                value={createdTicket.transaction.transaction_name}
              />

              <InfoBox
                label="Amount Due"
                value={formatMoney(createdTicket.payment.amount_due)}
                icon={<CircleDollarSign size={13} />}
              />

              <InfoBox
                label="Payment Status"
                value={
                  <span className="finance-create-transaction__status finance-create-transaction__status--pending">
                    {createdTicket.payment.payment_status}
                  </span>
                }
              />

              <InfoBox
                label="Registrar"
                value={
                  <span className="finance-create-transaction__status finance-create-transaction__status--neutral">
                    {createdTicket.registrar.status}
                  </span>
                }
              />
            </div>

            <div className="finance-create-transaction__success-note">
              The student can now see this ticket in their{" "}
              <strong>My Transactions</strong> page. Payment remains pending
              until Finance receives and records the payment.
            </div>
          </section>
        )}

        {/* =================================================
            CREATE TRANSACTION FORM
        ================================================= */}

        <form
          onSubmit={handleSubmit}
          className="finance-create-transaction__form"
        >
          {/* ===============================================
              STEP 1 — STUDENT
          =============================================== */}

          <section className="finance-create-transaction__panel">
            <StepHeader
              step="1"
              title="Select Student"
              description="Search using the student number or student name."
            />

            {selectedStudent ? (
              <div className="finance-create-transaction__selected-student">
                <div className="finance-create-transaction__selected-student-info">
                  <div className="finance-create-transaction__student-icon">
                    <UserRound size={20} aria-hidden="true" />
                  </div>

                  <div>
                    <strong>{selectedStudent.student_name}</strong>
                    <span>{selectedStudent.student_number}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={clearStudent}
                  className="finance-create-transaction__clear-student"
                  title="Change student"
                  aria-label="Change selected student"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="finance-create-transaction__student-search">
                <div className="finance-create-transaction__search-field">
                  <Search
                    size={17}
                    className="finance-create-transaction__search-icon"
                    aria-hidden="true"
                  />

                  <input
                    type="search"
                    value={studentQuery}
                    onChange={(event) =>
                      setStudentQuery(event.target.value)
                    }
                    placeholder="Search student number or name..."
                    autoComplete="off"
                  />

                  {searchingStudents && (
                    <Loader2
                      size={17}
                      className="finance-create-transaction__search-spinner"
                      aria-hidden="true"
                    />
                  )}
                </div>

                {studentResults.length > 0 && (
                  <div className="finance-create-transaction__student-results">
                    {studentResults.map((student) => (
                      <button
                        key={student.student_id}
                        type="button"
                        onClick={() => selectStudent(student)}
                        className="finance-create-transaction__student-result"
                      >
                        <div className="finance-create-transaction__student-result-icon">
                          <UserRound size={17} aria-hidden="true" />
                        </div>

                        <div>
                          <strong>{student.student_name}</strong>
                          <span>{student.student_number}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {studentSearchMessage && (
                  <div className="finance-create-transaction__search-message">
                    {studentSearchMessage}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ===============================================
              STEP 2 — TRANSACTION
          =============================================== */}

          <section className="finance-create-transaction__panel">
            <StepHeader
              step="2"
              title="Select Transaction"
              description="Only active manual Finance-only transaction types are available."
            />

            <label className="finance-create-transaction__field">
              <span>Transaction Type</span>

              <select
                value={selectedTransactionCode}
                onChange={(event) =>
                  handleTransactionTypeChange(event.target.value)
                }
                disabled={loadingTypes || submitting}
                required
              >
                <option value="">
                  {loadingTypes
                    ? "Loading transaction types..."
                    : transactionTypes.length === 0
                      ? "No manual Finance transaction types available"
                      : "Select transaction type"}
                </option>

                {transactionTypes.map((item) => (
                  <option
                    key={item.transaction_type_id}
                    value={item.transaction_code}
                  >
                    {item.transaction_name} ({item.transaction_code})
                  </option>
                ))}
              </select>
            </label>

            {selectedTransactionType && (
              <div className="finance-create-transaction__type-preview">
                <div className="finance-create-transaction__type-preview-header">
                  <div>
                    <strong>
                      {selectedTransactionType.transaction_name}
                    </strong>

                    <span>
                      {selectedTransactionType.transaction_code}
                    </span>
                  </div>

                  <CreditCard size={19} aria-hidden="true" />
                </div>

                {selectedTransactionType.description && (
                  <p>{selectedTransactionType.description}</p>
                )}

                <div className="finance-create-transaction__type-tags">
                  <span className="finance-create-transaction__tag finance-create-transaction__tag--blue">
                    Finance Only
                  </span>

                  <span className="finance-create-transaction__tag finance-create-transaction__tag--green">
                    {selectedTransactionType.allow_amount_override
                      ? "Amount Can Be Overridden"
                      : "Fixed Amount"}
                  </span>

                  <span className="finance-create-transaction__tag finance-create-transaction__tag--neutral">
                    {selectedTransactionType.default_amount === null
                      ? "No Default Amount"
                      : `Default ${formatMoney(
                          selectedTransactionType.default_amount,
                        )}`}
                  </span>
                </div>
              </div>
            )}
          </section>

          {/* ===============================================
              STEP 3 — AMOUNT / REMARKS
          =============================================== */}

          <section className="finance-create-transaction__panel">
            <StepHeader
              step="3"
              title="Amount and Remarks"
              description="Confirm the amount and add any optional Finance note before assigning the transaction."
            />

            <div className="finance-create-transaction__details-form">
              <label className="finance-create-transaction__field">
                <span>Amount Due</span>

                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amountDue}
                  onChange={(event) => setAmountDue(event.target.value)}
                  disabled={
                    submitting ||
                    !selectedTransactionType ||
                    (selectedTransactionType.default_amount !== null &&
                      !selectedTransactionType.allow_amount_override)
                  }
                  placeholder="Enter amount"
                  className={
                    selectedTransactionType &&
                    selectedTransactionType.default_amount !== null &&
                    !selectedTransactionType.allow_amount_override
                      ? "is-fixed"
                      : ""
                  }
                />

                {selectedTransactionType && (
                  <small>
                    {selectedTransactionType.default_amount === null
                      ? "No default amount is configured. Finance must enter the amount."
                      : selectedTransactionType.allow_amount_override
                        ? `Default amount: ${formatMoney(
                            selectedTransactionType.default_amount,
                          )}. Finance may override it.`
                        : `Fixed configured amount: ${formatMoney(
                            selectedTransactionType.default_amount,
                          )}.`}
                  </small>
                )}
              </label>

              <label className="finance-create-transaction__field">
                <span>Finance Remarks</span>

                <textarea
                  value={remarks}
                  onChange={(event) => setRemarks(event.target.value)}
                  maxLength={500}
                  rows={4}
                  disabled={submitting}
                  placeholder="Optional remarks about this transaction..."
                />

                <small>{remarks.length}/500 characters</small>
              </label>
            </div>
          </section>

          {/* ===============================================
              SUBMIT
          =============================================== */}

          <section className="finance-create-transaction__submit-panel">
            <div className="finance-create-transaction__submit-note">
              <div className="finance-create-transaction__submit-note-icon">
                <FileText size={17} aria-hidden="true" />
              </div>

              <span>
                Creating the transaction generates exactly one Finance ticket.
                Payment starts as <strong>Pending Payment</strong>, while
                Registrar remains <strong>Not Applicable</strong> because
                manually assigned transactions are Finance-only.
              </span>
            </div>

            <button
              type="submit"
              className="finance-create-transaction__submit-button"
              disabled={
                submitting ||
                !selectedStudent ||
                !selectedTransactionType
              }
            >
              {submitting ? (
                <>
                  <Loader2
                    size={17}
                    className="finance-create-transaction__spinner"
                    aria-hidden="true"
                  />
                  Creating...
                </>
              ) : (
                <>
                  <ReceiptText size={17} aria-hidden="true" />
                  Create Transaction
                </>
              )}
            </button>
          </section>
        </form>
      </main>
    </DashboardLayout>
  );
}

function StepHeader({
  step,
  title,
  description,
}: {
  step: string;
  title: string;
  description: string;
}) {
  return (
    <div className="finance-create-transaction__step-header">
      <div className="finance-create-transaction__step-number">
        {step}
      </div>

      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

function InfoBox({
  label,
  value,
  icon,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="finance-create-transaction__info-box">
      <div className="finance-create-transaction__info-label">
        {icon}
        {label}
      </div>

      <div className="finance-create-transaction__info-value">
        {value}
      </div>
    </div>
  );
}
