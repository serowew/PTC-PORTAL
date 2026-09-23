import { useCallback, useEffect, useMemo, useState } from "react";

import type { FormEvent, ReactNode } from "react";

import { useNavigate } from "react-router-dom";

import {
  AlertCircle,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Loader2,
  Plus,
  ReceiptText,
  RefreshCcw,
  Save,
  Settings2,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import DashboardLayout from "../../components/Layout/DashboardLayout";
import { authService } from "../../services/auth.service";
import "../../styles/FinanceTransactionTypes.css";

const TRANSACTION_TYPES_API =
  "http://localhost:3000/api/finance/tickets/transaction-types";

// ============================================================
// TYPES
// ============================================================

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

  created_at: string | null;
  updated_at: string | null;
}

interface TransactionTypesResponse {
  success?: boolean;
  code?: string;
  message?: string;

  transaction_types?: FinanceTransactionType[];
}

interface CreateTransactionTypeResponse {
  success?: boolean;
  code?: string;
  message?: string;

  transaction_type?: FinanceTransactionType;
}

interface AmountUpdateResponse {
  success?: boolean;
  code?: string;
  message?: string;

  transaction_type?: {
    transaction_type_id: number;
    transaction_code: string;
    transaction_name: string;
    default_amount: number;
  };
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

// ============================================================
// WORKFLOW LABEL
// ============================================================

function getWorkflowLabel(workflowType: string) {
  if (workflowType === "FINANCE_ONLY") {
    return "Finance Only";
  }

  if (workflowType === "DOCUMENT_REQUEST") {
    return "Document Request";
  }

  if (workflowType === "INCOMPLETE_GRADE") {
    return "Incomplete Grade";
  }

  return workflowType
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}


export default function FinanceTransactionTypes() {
  const navigate = useNavigate();

  const session = authService.getSession();

  const token = authService.getToken();

  const role = session?.role ?? null;

  const isFinance = role === "Finance" && Boolean(token);

  // ==========================================================
  // DATA
  // ==========================================================

  const [transactionTypes, setTransactionTypes] = useState<
    FinanceTransactionType[]
  >([]);

  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  // ==========================================================
  // CREATE FORM
  // ==========================================================

  const [transactionCode, setTransactionCode] = useState("");

  const [transactionName, setTransactionName] = useState("");

  const [description, setDescription] = useState("");

  const [defaultAmount, setDefaultAmount] = useState("");

  const [allowAmountOverride, setAllowAmountOverride] = useState(true);

  const [creating, setCreating] = useState(false);

  // ==========================================================
  // AMOUNT EDITING
  // ==========================================================

  const [editingCode, setEditingCode] = useState<string | null>(null);

  const [editedAmount, setEditedAmount] = useState("");

  const [savingAmount, setSavingAmount] = useState(false);

  // ==========================================================
  // MESSAGES
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
  // LOAD TYPES
  // ==========================================================

  const loadTransactionTypes = useCallback(
    async (showLoading = true) => {
      if (!isFinance) {
        return;
      }

      if (showLoading) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

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

        setTransactionTypes(
          Array.isArray(data.transaction_types) ? data.transaction_types : [],
        );
      } catch (error) {
        console.error("LOAD TRANSACTION TYPES ERROR:", error);

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to load Finance transaction types.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [isFinance, navigate],
  );

  // ==========================================================
  // INITIAL LOAD
  // ==========================================================

  useEffect(() => {
    if (!isFinance) {
      return;
    }

    void loadTransactionTypes();
  }, [isFinance, loadTransactionTypes]);

  // ==========================================================
  // SUMMARY
  // ==========================================================

  const summary = useMemo(() => {
    return {
      total: transactionTypes.length,

      active: transactionTypes.filter((item) => item.is_active).length,

      manual: transactionTypes.filter(
        (item) =>
          item.is_active &&
          item.workflow_type === "FINANCE_ONLY" &&
          item.allow_manual_creation,
      ).length,

      system_workflow: transactionTypes.filter(
        (item) => item.workflow_type !== "FINANCE_ONLY",
      ).length,
    };
  }, [transactionTypes]);

  // ==========================================================
  // CREATE TRANSACTION TYPE
  // ==========================================================

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (creating) {
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");

    const cleanedCode = transactionCode.trim();

    const cleanedName = transactionName.trim();

    const cleanedDescription = description.trim();

    if (!cleanedCode) {
      setErrorMessage("Transaction code is required.");

      return;
    }

    if (!cleanedName) {
      setErrorMessage("Transaction name is required.");

      return;
    }

    const parsedAmount =
      defaultAmount.trim() === "" ? null : Number(defaultAmount);

    if (
      parsedAmount !== null &&
      (!Number.isFinite(parsedAmount) || parsedAmount <= 0)
    ) {
      setErrorMessage("Default amount must be greater than zero.");

      return;
    }

    try {
      setCreating(true);

      const response = await authService.authFetch(TRANSACTION_TYPES_API, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Accept: "application/json",
        },

        body: JSON.stringify({
          transaction_code: cleanedCode,

          transaction_name: cleanedName,

          description: cleanedDescription || null,

          default_amount: parsedAmount,

          allow_amount_override: allowAmountOverride,
        }),
      });

      if (response.status === 401) {
        authService.logout();

        navigate("/login", {
          replace: true,
        });

        return;
      }

      const data = (await response.json()) as CreateTransactionTypeResponse;

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Unable to create Finance transaction type.",
        );
      }

      setSuccessMessage(
        data.message || "Finance transaction type created successfully.",
      );

      setTransactionCode("");

      setTransactionName("");

      setDescription("");

      setDefaultAmount("");

      setAllowAmountOverride(true);

      await loadTransactionTypes(false);
    } catch (error) {
      console.error("CREATE TRANSACTION TYPE ERROR:", error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to create Finance transaction type.",
      );
    } finally {
      setCreating(false);
    }
  };

  // ==========================================================
  // START AMOUNT EDIT
  // ==========================================================

  const beginAmountEdit = (item: FinanceTransactionType) => {
    setEditingCode(item.transaction_code);

    setEditedAmount(
      item.default_amount === null ? "" : String(item.default_amount),
    );

    setErrorMessage("");
    setSuccessMessage("");
  };

  // ==========================================================
  // SAVE AMOUNT
  // ==========================================================

  const saveAmount = async (item: FinanceTransactionType) => {
    if (savingAmount) {
      return;
    }

    const parsedAmount = Number(editedAmount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setErrorMessage("Default amount must be greater than zero.");

      return;
    }

    try {
      setSavingAmount(true);

      setErrorMessage("");
      setSuccessMessage("");

      const response = await authService.authFetch(
        `${TRANSACTION_TYPES_API}/${encodeURIComponent(
          item.transaction_code,
        )}/amount`,
        {
          method: "PATCH",

          headers: {
            "Content-Type": "application/json",

            Accept: "application/json",
          },

          body: JSON.stringify({
            default_amount: parsedAmount,
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

      const data = (await response.json()) as AmountUpdateResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to update default amount.");
      }

      setSuccessMessage(data.message || "Default amount updated successfully.");

      setEditingCode(null);

      setEditedAmount("");

      await loadTransactionTypes(false);
    } catch (error) {
      console.error("UPDATE DEFAULT AMOUNT ERROR:", error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to update default amount.",
      );
    } finally {
      setSavingAmount(false);
    }
  };

  // ==========================================================
  // AUTHORIZED ONLY
  // ==========================================================

  if (!isFinance) {
    return null;
  }


  return (
    <DashboardLayout>
      <main className="finance-transaction-types">
        {/* =================================================
            HEADER
        ================================================= */}

        <section className="finance-transaction-types__hero">
          <div className="finance-transaction-types__hero-copy">
            <div className="finance-transaction-types__eyebrow">
              <Settings2 size={16} aria-hidden="true" />
              Finance Configuration
            </div>

            <h1>Transaction Types</h1>

            <p>
              Configure reusable Finance transaction types and default amounts
              used when creating student Finance tickets.
            </p>
          </div>

          <div
            className="finance-transaction-types__hero-icon"
            aria-hidden="true"
          >
            <WalletCards size={28} strokeWidth={1.9} />
          </div>
        </section>

        {/* =================================================
            SUMMARY
        ================================================= */}

        <section
          className="finance-transaction-types__summary-grid"
          aria-label="Transaction type summary"
        >
          <SummaryCard
            label="Total Types"
            value={summary.total}
            icon={<ReceiptText size={20} />}
          />

          <SummaryCard
            label="Active Types"
            value={summary.active}
            icon={<CheckCircle2 size={20} />}
          />

          <SummaryCard
            label="Manual Finance Types"
            value={summary.manual}
            icon={<CircleDollarSign size={20} />}
          />

          <SummaryCard
            label="System Workflows"
            value={summary.system_workflow}
            icon={<ShieldCheck size={20} />}
          />
        </section>

        {/* =================================================
            MESSAGES
        ================================================= */}

        {errorMessage && (
          <section
            className="finance-transaction-types__message finance-transaction-types__message--error"
            role="alert"
          >
            <AlertCircle size={18} aria-hidden="true" />
            <span>{errorMessage}</span>
          </section>
        )}

        {successMessage && (
          <section
            className="finance-transaction-types__message finance-transaction-types__message--success"
            role="status"
          >
            <CheckCircle2 size={18} aria-hidden="true" />
            <span>{successMessage}</span>
          </section>
        )}

        {/* =================================================
            CREATE NEW TYPE
        ================================================= */}

        <section className="finance-transaction-types__panel">
          <div className="finance-transaction-types__section-header">
            <div className="finance-transaction-types__section-icon">
              <Plus size={19} aria-hidden="true" />
            </div>

            <div>
              <span className="finance-transaction-types__section-kicker">
                Manual Finance Setup
              </span>

              <h2>Create Transaction Type</h2>

              <p>
                New transaction types created here are Finance-only and can be
                manually assigned to students.
              </p>
            </div>
          </div>

          <form
            onSubmit={handleCreate}
            className="finance-transaction-types__create-form"
          >
            <FieldLabel label="Transaction Code">
              <input
                value={transactionCode}
                onChange={(event) =>
                  setTransactionCode(event.target.value)
                }
                placeholder="Example: ID_REPLACEMENT"
                disabled={creating}
              />
            </FieldLabel>

            <FieldLabel label="Transaction Name">
              <input
                value={transactionName}
                onChange={(event) =>
                  setTransactionName(event.target.value)
                }
                placeholder="Example: ID Replacement"
                disabled={creating}
              />
            </FieldLabel>

            <FieldLabel label="Default Amount">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={defaultAmount}
                onChange={(event) =>
                  setDefaultAmount(event.target.value)
                }
                placeholder="Optional"
                disabled={creating}
              />
            </FieldLabel>

            <label className="finance-transaction-types__checkbox-field">
              <input
                type="checkbox"
                checked={allowAmountOverride}
                onChange={(event) =>
                  setAllowAmountOverride(event.target.checked)
                }
                disabled={creating}
              />

              <span>
                <strong>Allow amount override</strong>
                <small>
                  Finance can change the configured amount when assigning
                  this transaction.
                </small>
              </span>
            </label>

            <label className="finance-transaction-types__field finance-transaction-types__field--full">
              <span>Description</span>

              <textarea
                value={description}
                onChange={(event) =>
                  setDescription(event.target.value)
                }
                rows={3}
                maxLength={255}
                disabled={creating}
                placeholder="Optional description..."
              />

              <small>{description.length}/255 characters</small>
            </label>

            <div className="finance-transaction-types__create-actions">
              <button
                type="submit"
                className="finance-transaction-types__button finance-transaction-types__button--primary"
                disabled={creating}
              >
                {creating ? (
                  <>
                    <Loader2
                      size={17}
                      className="finance-transaction-types__spinner"
                      aria-hidden="true"
                    />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus size={17} aria-hidden="true" />
                    Create Type
                  </>
                )}
              </button>
            </div>
          </form>
        </section>

        {/* =================================================
            CONFIGURED TYPES
        ================================================= */}

        <section className="finance-transaction-types__panel">
          <div className="finance-transaction-types__list-header">
            <div>
              <span className="finance-transaction-types__section-kicker">
                Finance Configuration
              </span>

              <h2>Configured Transaction Types</h2>

              <p>
                System workflows and Finance-created transaction types available
                in the portal.
              </p>
            </div>

            <button
              type="button"
              className="finance-transaction-types__button finance-transaction-types__button--secondary"
              onClick={() => void loadTransactionTypes(false)}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2
                  size={15}
                  className="finance-transaction-types__spinner"
                  aria-hidden="true"
                />
              ) : (
                <RefreshCcw size={15} aria-hidden="true" />
              )}

              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {loading ? (
            <div className="finance-transaction-types__state">
              <Loader2
                size={24}
                className="finance-transaction-types__spinner"
                aria-hidden="true"
              />

              <strong>Loading transaction types...</strong>
              <span>Please wait while Finance configuration is loaded.</span>
            </div>
          ) : transactionTypes.length === 0 ? (
            <div className="finance-transaction-types__state finance-transaction-types__state--empty">
              <div className="finance-transaction-types__state-icon">
                <ReceiptText size={26} aria-hidden="true" />
              </div>

              <strong>No transaction types configured</strong>

              <span>
                Create a Finance transaction type above to get started.
              </span>
            </div>
          ) : (
            <div className="finance-transaction-types__list">
              {transactionTypes.map((item) => {
                const isEditing =
                  editingCode === item.transaction_code;

                const isFinanceOnly =
                  item.workflow_type === "FINANCE_ONLY";

                return (
                  <article
                    key={item.transaction_type_id}
                    className="finance-transaction-types__card"
                  >
                    <div className="finance-transaction-types__card-main">
                      <div
                        className={`finance-transaction-types__type-icon ${
                          isFinanceOnly
                            ? "finance-transaction-types__type-icon--finance"
                            : "finance-transaction-types__type-icon--system"
                        }`}
                      >
                        {isFinanceOnly ? (
                          <CircleDollarSign
                            size={20}
                            aria-hidden="true"
                          />
                        ) : (
                          <FileText
                            size={20}
                            aria-hidden="true"
                          />
                        )}
                      </div>

                      <div className="finance-transaction-types__card-copy">
                        <div className="finance-transaction-types__card-title-row">
                          <strong>{item.transaction_name}</strong>

                          <span className="finance-transaction-types__code-badge">
                            {item.transaction_code}
                          </span>

                          <span
                            className={`finance-transaction-types__status-badge ${
                              item.is_active
                                ? "finance-transaction-types__status-badge--active"
                                : "finance-transaction-types__status-badge--inactive"
                            }`}
                          >
                            {item.is_active ? "Active" : "Inactive"}
                          </span>
                        </div>

                        <p>
                          {item.description ||
                            "No description provided."}
                        </p>

                        <div className="finance-transaction-types__badges">
                          <Badge>
                            {getWorkflowLabel(item.workflow_type)}
                          </Badge>

                          {item.allow_manual_creation && (
                            <Badge>Manual Creation</Badge>
                          )}

                          <Badge>
                            {item.allow_amount_override
                              ? "Amount Override Allowed"
                              : "Fixed Amount"}
                          </Badge>

                          {item.requires_grade_reference && (
                            <Badge>Grade Reference Required</Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="finance-transaction-types__amount-panel">
                      <span className="finance-transaction-types__amount-label">
                        Default Amount
                      </span>

                      {isEditing ? (
                        <div className="finance-transaction-types__amount-editor">
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={editedAmount}
                            onChange={(event) =>
                              setEditedAmount(event.target.value)
                            }
                            autoFocus
                          />

                          <button
                            type="button"
                            className="finance-transaction-types__save-button"
                            onClick={() => void saveAmount(item)}
                            disabled={savingAmount}
                            title="Save amount"
                            aria-label={`Save amount for ${item.transaction_name}`}
                          >
                            {savingAmount ? (
                              <Loader2
                                size={16}
                                className="finance-transaction-types__spinner"
                                aria-hidden="true"
                              />
                            ) : (
                              <Save size={16} aria-hidden="true" />
                            )}
                          </button>

                          <button
                            type="button"
                            className="finance-transaction-types__cancel-edit"
                            onClick={() => {
                              setEditingCode(null);
                              setEditedAmount("");
                            }}
                            disabled={savingAmount}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div>
                          <strong className="finance-transaction-types__amount-value">
                            {formatMoney(item.default_amount)}
                          </strong>

                          {item.is_active && (
                            <button
                              type="button"
                              className="finance-transaction-types__edit-amount"
                              onClick={() => beginAmountEdit(item)}
                            >
                              Edit Amount
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
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
  value: number;
  icon: ReactNode;
}) {
  return (
    <article className="finance-transaction-types__summary-card">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>

      <div className="finance-transaction-types__summary-icon">
        {icon}
      </div>
    </article>
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
    <label className="finance-transaction-types__field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="finance-transaction-types__badge">
      {children}
    </span>
  );
}
