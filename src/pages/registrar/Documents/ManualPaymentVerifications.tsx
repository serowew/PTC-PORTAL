import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Loader2,
  ReceiptText,
  RefreshCcw,
  Search,
  ShieldCheck,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/registrar-manual-payment-verification.css";

const MANUAL_PAYMENT_VERIFICATIONS_API = apiUrl(
  "/api/manual-payment-verifications/registrar",
);

interface ManualPaymentVerification {
  verification_id: number;
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
  amount_due: number | null;
  amount_paid: number;
  payment_status: string;
  payment_method: string | null;
  receipt_number: string | null;
  paid_at: string | null;
  verification_status: string;
  verification_remarks: string | null;
  verified_by: number | null;
  verified_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface VerificationListResponse {
  success?: boolean;
  code?: string;
  message?: string;
  verifications?: ManualPaymentVerification[];
}

interface VerifyResponse {
  success?: boolean;
  code?: string;
  message?: string;
  verification?: {
    ticket_number: string;
    verification_status: string;
    verification_remarks: string | null;
  };
}

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

export default function ManualPaymentVerifications() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();
  const isRegistrar = session?.role === "Registrar" && Boolean(token);

  const [verifications, setVerifications] = useState<
    ManualPaymentVerification[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [selectedVerification, setSelectedVerification] =
    useState<ManualPaymentVerification | null>(null);
  const [remarks, setRemarks] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (!isRegistrar) {
      navigate("/login", { replace: true });
    }
  }, [isRegistrar, navigate]);

  const loadVerifications = useCallback(
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
          MANUAL_PAYMENT_VERIFICATIONS_API,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
          },
        );

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          navigate("/login", { replace: true });
          return;
        }

        const data = (await response.json()) as VerificationListResponse;

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || "Unable to load manual payment verifications.",
          );
        }

        setVerifications(
          Array.isArray(data.verifications) ? data.verifications : [],
        );
      } catch (error) {
        console.error("LOAD MANUAL PAYMENT VERIFICATIONS ERROR:", error);

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to load manual payment verifications.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [isRegistrar, navigate],
  );

  useEffect(() => {
    void loadVerifications();
  }, [loadVerifications]);

  const filteredVerifications = useMemo(() => {
    const query = searchText.trim().toLowerCase();

    if (!query) {
      return verifications;
    }

    return verifications.filter((item) =>
      [
        item.ticket_number,
        item.student.student_number,
        item.student.student_name,
        item.transaction.transaction_code,
        item.transaction.transaction_name,
        item.receipt_number || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [searchText, verifications]);

  const openVerification = (item: ManualPaymentVerification) => {
    setSelectedVerification(item);
    setRemarks("");
    setErrorMessage("");
    setSuccessMessage("");
  };

  const closeVerification = () => {
    if (actionLoading) {
      return;
    }

    setSelectedVerification(null);
    setRemarks("");
  };

  const verifyPayment = async () => {
    if (!selectedVerification || actionLoading) {
      return;
    }

    setActionLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await authService.authFetch(
        `${apiUrl(
          `/api/manual-payment-verifications/${encodeURIComponent(
            selectedVerification.ticket_number,
          )}/verify`,
        )}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            remarks: remarks.trim() || null,
          }),
        },
      );

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }

      if (response.status === 403) {
        navigate("/login", { replace: true });
        return;
      }

      const data = (await response.json()) as VerifyResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to verify this payment.");
      }

      setVerifications((current) =>
        current.filter(
          (item) => item.ticket_number !== selectedVerification.ticket_number,
        ),
      );

      setSelectedVerification(null);
      setRemarks("");
      setSuccessMessage(
        data.message || "Manual payment verified successfully.",
      );
    } catch (error) {
      console.error("VERIFY MANUAL PAYMENT ERROR:", error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to verify this payment.",
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
      <main className="registrar-manual-payment">
        <section className="registrar-manual-payment__hero">
          <div>
            <div className="registrar-manual-payment__eyebrow">
              <WalletCards size={16} aria-hidden="true" />
              Registrar
            </div>

            <h1>Payment Verification</h1>

            <p>
              Review Finance manual payments and verify the payment transaction
              after checking the receipt details.
            </p>
          </div>

          <ShieldCheck
            className="registrar-manual-payment__hero-icon"
            size={34}
            aria-hidden="true"
          />
        </section>

        {errorMessage && (
          <section className="registrar-manual-payment__message registrar-manual-payment__message--error">
            <AlertCircle size={19} aria-hidden="true" />
            <span>{errorMessage}</span>
          </section>
        )}

        {successMessage && (
          <section className="registrar-manual-payment__message registrar-manual-payment__message--success">
            <CheckCircle2 size={19} aria-hidden="true" />
            <span>{successMessage}</span>
          </section>
        )}

        <section className="registrar-manual-payment__summary-grid">
          <div className="registrar-manual-payment__summary-card">
            <div className="registrar-manual-payment__summary-icon">
              <Clock3 size={20} aria-hidden="true" />
            </div>
            <div>
              <span>Pending Verification</span>
              <strong>{verifications.length}</strong>
            </div>
          </div>

          <div className="registrar-manual-payment__summary-card">
            <div className="registrar-manual-payment__summary-icon">
              <ReceiptText size={20} aria-hidden="true" />
            </div>
            <div>
              <span>Showing Results</span>
              <strong>{filteredVerifications.length}</strong>
            </div>
          </div>
        </section>

        <section className="registrar-manual-payment__toolbar-panel">
          <div className="registrar-manual-payment__toolbar">
            <label className="registrar-manual-payment__search">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search ticket, student, transaction, or receipt..."
              />
            </label>

            <button
              type="button"
              className="registrar-manual-payment__refresh-button"
              onClick={() => void loadVerifications(true)}
              disabled={refreshing || loading}
            >
              <RefreshCcw
                size={16}
                className={refreshing ? "is-spinning" : ""}
                aria-hidden="true"
              />
              Refresh
            </button>
          </div>
        </section>

        {selectedVerification && (
          <section className="registrar-manual-payment__verify-panel">
            <div className="registrar-manual-payment__verify-heading">
              <div>
                <span className="registrar-manual-payment__eyebrow">
                  Verify Payment
                </span>
                <h2>{selectedVerification.ticket_number}</h2>
                <p>
                  Confirm that the receipt and payment details have been checked
                  before verifying this transaction.
                </p>
              </div>

              <button
                type="button"
                className="registrar-manual-payment__icon-button"
                onClick={closeVerification}
                aria-label="Close verification panel"
                disabled={actionLoading}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="registrar-manual-payment__verify-details">
              <span>
                <strong>Student:</strong>{" "}
                {selectedVerification.student.student_name} (
                {selectedVerification.student.student_number})
              </span>
              <span>
                <strong>Amount paid:</strong>{" "}
                {formatMoney(selectedVerification.amount_paid)}
              </span>
              <span>
                <strong>Receipt:</strong>{" "}
                {selectedVerification.receipt_number || "—"}
              </span>
            </div>

            <label className="registrar-manual-payment__remarks-field">
              <span>Verification remarks</span>
              <textarea
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
                maxLength={500}
                rows={3}
                disabled={actionLoading}
                placeholder="Optional remarks about the verification..."
              />
              <small>{remarks.length}/500 characters</small>
            </label>

            <div className="registrar-manual-payment__verify-actions">
              <button
                type="button"
                className="registrar-manual-payment__secondary-button"
                onClick={closeVerification}
                disabled={actionLoading}
              >
                Cancel
              </button>

              <button
                type="button"
                className="registrar-manual-payment__primary-button"
                onClick={() => void verifyPayment()}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <>
                    <Loader2 size={16} className="is-spinning" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    Verify Payment
                  </>
                )}
              </button>
            </div>
          </section>
        )}

        <section className="registrar-manual-payment__panel">
          <div className="registrar-manual-payment__panel-heading">
            <div>
              <h2>Paid Manual Payments</h2>
              <p>
                Only Finance manual payments with a Paid status are shown here.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="registrar-manual-payment__loading">
              <Loader2 size={20} className="is-spinning" />
              Loading manual payments...
            </div>
          ) : filteredVerifications.length === 0 ? (
            <div className="registrar-manual-payment__empty">
              <CheckCircle2 size={28} aria-hidden="true" />
              <strong>No pending manual payments</strong>
              <span>
                New Finance manual payments will appear here after they are
                paid.
              </span>
            </div>
          ) : (
            <div className="registrar-manual-payment__table-wrap">
              <table className="registrar-manual-payment__table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Student</th>
                    <th>Transaction</th>
                    <th>Payment</th>
                    <th>Paid At</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredVerifications.map((item) => (
                    <tr key={item.verification_id}>
                      <td>
                        <strong>{item.ticket_number}</strong>
                        <span>Verification #{item.verification_id}</span>
                      </td>
                      <td>
                        <div className="registrar-manual-payment__student-cell">
                          <UserRound size={16} aria-hidden="true" />
                          <div>
                            <strong>{item.student.student_name}</strong>
                            <span>{item.student.student_number}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <strong>{item.transaction.transaction_name}</strong>
                        <span>{item.transaction.transaction_code}</span>
                      </td>
                      <td>
                        <strong>{formatMoney(item.amount_paid)}</strong>
                        <span>
                          {item.payment_method || "Method not recorded"}
                        </span>
                      </td>
                      <td>{formatDate(item.paid_at)}</td>
                      <td>
                        <button
                          type="button"
                          className="registrar-manual-payment__verify-button"
                          onClick={() => openVerification(item)}
                        >
                          <ShieldCheck size={15} aria-hidden="true" />
                          Verify
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </DashboardLayout>
  );
}
