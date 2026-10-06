import { useCallback, useEffect, useState } from "react";
import { RefreshCcw, Search, ShieldCheck } from "lucide-react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/registrar-manual-payment-verification.css";

type Transaction = {
  ticket_id: number;
  ticket_number: string;

  student: {
    student_number: string;
    student_name: string;
  };

  transaction: {
    transaction_code: string;
    transaction_name: string;
  };

  payment: {
    amount_paid: number;
    payment_method: string | null;
    payment_status: string;
    paid_at: string | null;
  };
};

const API = apiUrl("/api/registrar/finance-history");

export default function ManualPaymentVerifications() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (pageNumber: number, query: string) => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        page: String(pageNumber),
        q: query.trim(),
      });

      const response = await authService.authFetch(
        `${API}?${params.toString()}`,
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load Finance history.");
      }

      setTransactions(
        Array.isArray(data.transactions) ? data.transactions : [],
      );

      setTotalPages(Number(data.pagination?.total_pages || 0));
      setTotalRecords(Number(data.pagination?.total_records || 0));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load Finance history.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(page, search);
  }, [load, page, search]);

  return (
    <DashboardLayout>
      <main className="registrar-manual-payment">
        <header className="registrar-manual-payment__header">
          <div>
            <span>
              <ShieldCheck size={16} />
              Registrar
            </span>

            <h1>Finance Payment History</h1>

            <p>View paid Finance transactions. This page is read-only.</p>
          </div>

          <button
            type="button"
            onClick={() => void load(page, search)}
            disabled={loading}
          >
            <RefreshCcw size={16} />
            Refresh
          </button>
        </header>

        {error && <p className="registrar-manual-payment__error">{error}</p>}

        <section className="registrar-manual-payment__toolbar">
          <Search size={17} />

          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search student name, student number, ticket, or transaction"
          />
        </section>

        <section className="registrar-manual-payment__panel">
          <h2>Paid Transactions ({totalRecords})</h2>

          {loading ? (
            <p>Loading Finance history...</p>
          ) : transactions.length === 0 ? (
            <p>No paid transactions found.</p>
          ) : (
            <div className="registrar-manual-payment__table">
              <table>
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Student</th>
                    <th>Transaction</th>
                    <th>Payment</th>
                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>
                  {transactions.map((item) => (
                    <tr key={item.ticket_id}>
                      <td>{item.ticket_number}</td>

                      <td>
                        {item.student.student_name}
                        <small>{item.student.student_number}</small>
                      </td>

                      <td>
                        {item.transaction.transaction_name}
                        <small>{item.transaction.transaction_code}</small>
                      </td>

                      <td>
                        PHP {Number(item.payment.amount_paid).toFixed(2)}
                        <small>
                          {item.payment.payment_method || "Not specified"}
                        </small>
                      </td>

                      <td>
                        <strong>{item.payment.payment_status}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="registrar-manual-payment__pagination">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={loading || page <= 1}
                >
                  Previous
                </button>

                <span>
                  Page {page} of {totalPages || 1}
                </span>

                <button
                  type="button"
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                  disabled={loading || totalPages === 0 || page >= totalPages}
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
