import { useCallback, useEffect, useState } from "react";

import type { CSSProperties } from "react";

import {
  ArrowLeft,
  FileText,
  Loader2,
  Printer,
  RefreshCcw,
} from "lucide-react";

import { useNavigate, useParams } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";

const API_BASE_URL = apiUrl("/api/registrar/students");

// ============================================================
// TYPES
// ============================================================

interface AvailableEnrollment {
  enrollment_id: number;
  academic_year_id: number;
  academic_year: string;
  semester_id: number;
  semester_name: string;
  enrollment_status: string;
  approved_at: string | null;
}

interface CORSubject {
  enrollment_subject_id: number;
  subject_id: number;
  subject_code: string;
  subject_title: string;
  units: number;
  lecture_hours: number | null;
  laboratory_hours: number | null;
  computer_hours: number | null;
  enrollment_subject_status: string;

  section: {
    section_id: number | null;
    section_name: string | null;
    year_level: number | null;
  };

  schedule: {
    days: string | null;
    time: string | null;
  };

  faculty: {
    faculty_id: number | null;
    faculty_name: string | null;
  };

  room: {
    room_id: number | null;
    room_name: string | null;
  };
}

interface FeeItem {
  fee_id: number;
  category_id: number;
  category_name: string;
  fee_name: string;
  amount: number;
  course_id: number | null;
  year_level: number | null;
}

interface Payment {
  payment_id: number;
  receipt_number: string | null;
  amount_paid: number;
  payment_method: string | null;
  payment_date: string | null;
  received_by: number | null;
  received_by_username: string | null;
  remarks: string | null;
}

interface CORResponse {
  success?: boolean;
  code?: string;
  message?: string;

  student?: {
    student_id: number;
    student_number: string;

    first_name: string;
    middle_name: string | null;
    last_name: string;

    student_name: string;

    email: string | null;
    contact_number: string | null;

    course: {
      course_id: number | null;
      course_code: string | null;
      course_name: string | null;
    };

    status: string | null;

    address: {
      house_no: string | null;
      street: string | null;
      barangay: string | null;
      city: string | null;
      province: string | null;
      zip_code: string | null;
      complete_address: string | null;
    };
  };

  available_enrollments?: AvailableEnrollment[];

  cor?: {
    enrollment_id: number;
    enrollment_status: string;

    academic_period: {
      academic_year_id: number;
      academic_year: string;
      semester_id: number;
      semester_name: string;
    };

    program: {
      course_id: number | null;
      course_code: string | null;
      course_name: string | null;
    };

    year_level: number | null;
    section_name: string | null;

    subjects: CORSubject[];

    subject_summary: {
      total_subjects: number;
      total_units: number;
      total_lecture_hours: number;
      total_laboratory_hours: number;
      total_computer_hours: number | null;
    };

    assessment: {
      billing: {
        billing_id: number;
        total_fees: number | null;
        scholarship_amount: number;
        discount_amount: number;
        total_due: number | null;
        total_paid: number;
        balance: number | null;
        billing_date: string | null;
        billing_status: string;
        installment_breakdown: null;
      } | null;

      configured_fee_items: FeeItem[];
      configured_fee_total: number;
      payments: Payment[];
    };

    certification: {
      approved_by: number | null;
      approved_by_username: string | null;
      approved_at: string | null;
    };

    generated_at: string;
  } | null;
}

// ============================================================
// FORMATTERS
// ============================================================

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }

  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(value);
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
    month: "long",
    day: "numeric",
  });
}

function yearLevelLabel(value: number | null) {
  if (!value) {
    return "—";
  }

  if (value === 1) {
    return "1ST YEAR";
  }

  if (value === 2) {
    return "2ND YEAR";
  }

  if (value === 3) {
    return "3RD YEAR";
  }

  if (value === 4) {
    return "4TH YEAR";
  }

  return `${value}TH YEAR`;
}

function semesterLabel(value: string) {
  const normalized = value.toLowerCase();

  if (normalized.includes("first")) {
    return "1ST SEM";
  }

  if (normalized.includes("second")) {
    return "2ND SEM";
  }

  if (normalized.includes("summer")) {
    return "SUMMER";
  }

  return value.toUpperCase();
}

function formatStudentName(
  firstName: string,
  middleName: string | null,
  lastName: string,
) {
  const middleInitial = middleName?.trim().charAt(0).toUpperCase();

  return [
    lastName.toUpperCase(),
    ", ",
    firstName.toUpperCase(),
    middleInitial ? ` ${middleInitial}.` : "",
  ].join("");
}

// ============================================================
// COMPONENT
// ============================================================

export default function StudentCORR() {
  const navigate = useNavigate();

  const { id } = useParams<{
    id: string;
  }>();

  const session = authService.getSession();

  const token = authService.getToken();

  const role = session?.role ?? null;

  const isRegistrar = role === "Registrar" && Boolean(token);

  const [data, setData] = useState<CORResponse | null>(null);

  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<
    number | null
  >(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  // ==========================================================
  // AUTH
  // ==========================================================

  useEffect(() => {
    if (!isRegistrar) {
      navigate("/login", {
        replace: true,
      });
    }
  }, [isRegistrar, navigate]);

  // ==========================================================
  // LOAD COR
  // ==========================================================

  const loadCOR = useCallback(
    async (enrollmentId?: number) => {
      if (!isRegistrar || !id) {
        return;
      }

      const studentId = Number(id);

      if (!Number.isInteger(studentId) || studentId <= 0) {
        setError("Invalid student ID.");

        setLoading(false);

        return;
      }

      setLoading(true);
      setError("");

      try {
        const query = enrollmentId
          ? `?enrollment_id=${encodeURIComponent(enrollmentId)}`
          : "";

        const response = await authService.authFetch(
          `${API_BASE_URL}/${studentId}/cor${query}`,
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

        const result = (await response.json()) as CORResponse;

        if (!response.ok || !result.success) {
          throw new Error(
            result.message || "Unable to load Certificate of Registration.",
          );
        }

        setData(result);

        if (result.cor) {
          setSelectedEnrollmentId(result.cor.enrollment_id);
        }
      } catch (requestError) {
        console.error("LOAD COR ERROR:", requestError);

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load Certificate of Registration.",
        );
      } finally {
        setLoading(false);
      }
    },
    [id, isRegistrar, navigate],
  );

  // ==========================================================
  // INITIAL LOAD ONLY
  // ==========================================================

  useEffect(() => {
    if (!isRegistrar) {
      return;
    }

    void loadCOR();
  }, [isRegistrar, loadCOR]);

  // ==========================================================
  // CHANGE ACADEMIC PERIOD
  // ==========================================================

  const handleEnrollmentChange = (value: string) => {
    const enrollmentId = Number(value);

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return;
    }

    setSelectedEnrollmentId(enrollmentId);

    void loadCOR(enrollmentId);
  };

  // ==========================================================
  // PRINT
  // ==========================================================

  const printCOR = () => {
    window.print();
  };

  // ==========================================================
  // GUARD
  // ==========================================================

  if (!isRegistrar) {
    return null;
  }

  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading && !data) {
    return (
      <DashboardLayout>
        <div style={centerStyle}>
          <Loader2 size={28} />

          <span>Loading Certificate of Registration...</span>
        </div>
      </DashboardLayout>
    );
  }

  // ==========================================================
  // ERROR
  // ==========================================================

  if (error && !data) {
    return (
      <DashboardLayout>
        <div
          style={{
            padding: "24px",
          }}
        >
          <div style={errorStyle}>{error}</div>

          <button
            type="button"
            onClick={() => navigate(-1)}
            style={secondaryButton}
          >
            <ArrowLeft size={17} />
            Back
          </button>
        </div>
      </DashboardLayout>
    );
  }

  const student = data?.student;

  const cor = data?.cor;

  const availableEnrollments = data?.available_enrollments ?? [];

  // ==========================================================
  // NO APPROVED ENROLLMENT
  // ==========================================================

  if (student && !cor) {
    return (
      <DashboardLayout>
        <main
          style={{
            padding: "4px",
          }}
        >
          <section style={panelStyle}>
            <FileText size={36} color="#15803d" />

            <h1>Certificate of Registration</h1>

            <p>
              {data?.message ||
                "No approved enrollment is available for this student."}
            </p>

            <button
              type="button"
              onClick={() => navigate(-1)}
              style={secondaryButton}
            >
              <ArrowLeft size={17} />
              Back
            </button>
          </section>
        </main>
      </DashboardLayout>
    );
  }

  if (!student || !cor) {
    return null;
  }

  const billing = cor.assessment.billing;

  const feeItems = cor.assessment.configured_fee_items;

  const payments = cor.assessment.payments;

  return (
    <DashboardLayout>
      {/* =====================================================
          PRINT CSS
      ===================================================== */}

      <style>
        {`
          @page {
            size: A4 portrait;
            margin: 8mm;
          }

          @media print {
            body {
              background: #ffffff !important;
            }

            .cor-no-print {
              display: none !important;
            }

            .cor-print-area {
              width: 100% !important;
              max-width: none !important;
              margin: 0 !important;
              padding: 0 !important;
              border: 0 !important;
              box-shadow: none !important;
            }

            .cor-print-area,
            .cor-print-area * {
              print-color-adjust: exact;
              -webkit-print-color-adjust: exact;
            }

            .cor-table {
              page-break-inside: auto;
            }

            .cor-table tr {
              page-break-inside: avoid;
              page-break-after: auto;
            }
          }
        `}
      </style>

      <main
        style={{
          display: "grid",
          gap: "18px",
          padding: "4px",
        }}
      >
        {/* ===================================================
            TOOLBAR
        =================================================== */}

        <section
          className="cor-no-print"
          style={{
            ...panelStyle,

            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "14px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                color: "#15803d",
                fontSize: "12px",
                fontWeight: 800,
                textTransform: "uppercase",
              }}
            >
              Registrar Office
            </div>

            <h1
              style={{
                margin: "5px 0 0",
              }}
            >
              Certificate of Registration
            </h1>
          </div>

          <div
            style={{
              display: "flex",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={() => navigate(-1)}
              style={secondaryButton}
            >
              <ArrowLeft size={17} />
              Back
            </button>

            <button
              type="button"
              onClick={() => void loadCOR(selectedEnrollmentId ?? undefined)}
              disabled={loading}
              style={secondaryButton}
            >
              {loading ? <Loader2 size={17} /> : <RefreshCcw size={17} />}
              Refresh
            </button>

            <button type="button" onClick={printCOR} style={primaryButton}>
              <Printer size={17} />
              Print COR
            </button>
          </div>
        </section>

        {/* ===================================================
            PERIOD SELECTOR
        =================================================== */}

        <section className="cor-no-print" style={panelStyle}>
          <label
            style={{
              display: "grid",
              gap: "7px",
              maxWidth: "420px",
              color: "#334155",
              fontWeight: 700,
              fontSize: "13px",
            }}
          >
            Academic Period
            <select
              value={selectedEnrollmentId ?? ""}
              onChange={(event) => handleEnrollmentChange(event.target.value)}
              disabled={loading}
              style={inputStyle}
            >
              {availableEnrollments.map((enrollment) => (
                <option
                  key={enrollment.enrollment_id}
                  value={enrollment.enrollment_id}
                >
                  {enrollment.academic_year} — {enrollment.semester_name}
                </option>
              ))}
            </select>
          </label>

          {error && (
            <div
              style={{
                ...errorStyle,
                marginTop: "14px",
              }}
            >
              {error}
            </div>
          )}
        </section>

        {/* ===================================================
            PRINTABLE COR
        =================================================== */}

        <section
          className="cor-print-area"
          style={{
            width: "min(100%, 1100px)",
            margin: "0 auto",
            padding: "18px 20px 24px",
            boxSizing: "border-box",
            border: "1px solid #d1d5db",
            background: "#ffffff",
            color: "#111827",
            fontFamily: '"Times New Roman", Times, serif',
            boxShadow: "0 8px 30px rgba(15, 23, 42, 0.08)",
          }}
        >
          {/* =================================================
              SCHOOL HEADER
          ================================================= */}

          <header
            style={{
              display: "grid",
              gridTemplateColumns: "82px 1fr 220px",
              alignItems: "start",
              gap: "14px",
              borderBottom: "1px solid #111827",
              paddingBottom: "10px",
            }}
          >
            <img
              src="/ptclogo.png"
              alt="Pateros Technological College"
              style={{
                width: "72px",
                height: "72px",
                objectFit: "contain",
              }}
            />

            <div
              style={{
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "18px",
                  letterSpacing: ".03em",
                }}
              >
                PATEROS TECHNOLOGICAL COLLEGE
              </div>

              <div
                style={{
                  marginTop: "3px",
                  fontSize: "10px",
                }}
              >
                College St., Sto. Rosario-Kanluran, Pateros, Metro Manila
              </div>

              <div
                style={{
                  marginTop: "2px",
                  fontSize: "10px",
                }}
              >
                Tel No.: 8424-8370 Loc. 306
              </div>

              <div
                style={{
                  marginTop: "13px",
                  fontWeight: 700,
                  fontSize: "18px",
                }}
              >
                CERTIFICATE OF REGISTRATION
              </div>
            </div>

            {/* ENROLLMENT STAMP */}

            <div
              style={{
                textAlign: "center",
                fontSize: "11px",
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "12px",
                }}
              >
                PATEROS TECHNOLOGICAL COLLEGE
              </div>

              <div
                style={{
                  marginTop: "4px",
                  fontWeight: 700,
                }}
              >
                ENROLLED
              </div>

              <div>
                {semesterLabel(cor.academic_period.semester_name)} S.Y.{" "}
                {cor.academic_period.academic_year}
              </div>

              <div
                style={{
                  marginTop: "5px",
                }}
              >
                SIGNATURE: __________________
              </div>

              <div>DATE: {formatDate(cor.certification.approved_at)}</div>
            </div>
          </header>

          {/* =================================================
              STUDENT INFORMATION
          ================================================= */}

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "1.3fr .7fr 1.8fr",
              columnGap: "14px",
              rowGap: "5px",
              marginTop: "10px",
              fontSize: "11px",
            }}
          >
            <div>
              <strong>NAME:</strong>{" "}
              {formatStudentName(
                student.first_name,
                student.middle_name,
                student.last_name,
              )}
            </div>

            <div>
              <strong>ID NO:</strong> {student.student_number}
            </div>

            <div>
              <strong>PROGRAM:</strong>{" "}
              {cor.program.course_name || cor.program.course_code || "—"}
            </div>

            <div
              style={{
                gridColumn: "1 / 3",
              }}
            >
              <strong>ADDRESS:</strong>{" "}
              {student.address.complete_address || "—"}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "8px",
              }}
            >
              <div>
                <strong>YEAR LEVEL:</strong> {yearLevelLabel(cor.year_level)}
              </div>

              <div>
                <strong>SEM:</strong>{" "}
                {semesterLabel(cor.academic_period.semester_name)}
              </div>

              <div>
                <strong>STATUS:</strong> {(student.status || "—").toUpperCase()}
              </div>
            </div>
          </section>

          {/* =================================================
              SUBJECT TABLE
          ================================================= */}

          <table
            className="cor-table"
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginTop: "14px",
              tableLayout: "fixed",
              fontSize: "9px",
            }}
          >
            <thead>
              <tr>
                <Th width="8%">
                  Subject
                  <br />
                  Code
                </Th>

                <Th width="24%">Subject Title</Th>

                <Th width="5%">Unit</Th>

                <Th width="5%">Lec</Th>

                <Th width="5%">Lab</Th>

                <Th width="5%">Comp</Th>

                <Th width="8%">Section</Th>

                <Th width="8%">Day</Th>

                <Th width="13%">Time</Th>

                <Th width="12%">Professor</Th>

                <Th width="7%">Room</Th>
              </tr>
            </thead>

            <tbody>
              {cor.subjects.map((subject) => (
                <tr key={subject.enrollment_subject_id}>
                  <Td>{subject.subject_code}</Td>

                  <Td align="left">{subject.subject_title}</Td>

                  <Td>{subject.units}</Td>

                  <Td>{subject.lecture_hours ?? "—"}</Td>

                  <Td>{subject.laboratory_hours ?? "—"}</Td>

                  <Td>{subject.computer_hours ?? "—"}</Td>

                  <Td>
                    {subject.section.section_name || cor.section_name || "—"}
                  </Td>

                  <Td>{subject.schedule.days || "—"}</Td>

                  <Td>{subject.schedule.time || "—"}</Td>

                  <Td>{subject.faculty.faculty_name || "—"}</Td>

                  <Td>{subject.room.room_name || "—"}</Td>
                </tr>
              ))}

              <tr>
                <Td colSpan={2} align="right">
                  <strong>TOTAL</strong>
                </Td>

                <Td>
                  <strong>{cor.subject_summary.total_units}</strong>
                </Td>

                <Td>
                  <strong>{cor.subject_summary.total_lecture_hours}</strong>
                </Td>

                <Td>
                  <strong>{cor.subject_summary.total_laboratory_hours}</strong>
                </Td>

                <Td>
                  <strong>
                    {cor.subject_summary.total_computer_hours ?? "—"}
                  </strong>
                </Td>

                <Td colSpan={5}>&nbsp;</Td>
              </tr>
            </tbody>
          </table>

          {/* =================================================
              FINANCE AREA
          ================================================= */}

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "18px",
              marginTop: "22px",
            }}
          >
            {/* FEE BREAKDOWN */}

            <div>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "10px",
                }}
              >
                <tbody>
                  {feeItems.length > 0 ? (
                    feeItems.map((fee) => (
                      <tr key={fee.fee_id}>
                        <FinanceCell>{fee.fee_name}</FinanceCell>

                        <FinanceCell align="right">
                          {formatMoney(fee.amount)}
                        </FinanceCell>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <FinanceCell>Enrollment Assessment</FinanceCell>

                      <FinanceCell align="right">
                        {billing
                          ? formatMoney(billing.total_fees)
                          : "No billing record"}
                      </FinanceCell>
                    </tr>
                  )}

                  {billing && (
                    <>
                      <tr>
                        <FinanceCell>Scholarship</FinanceCell>

                        <FinanceCell align="right">
                          -{formatMoney(billing.scholarship_amount)}
                        </FinanceCell>
                      </tr>

                      <tr>
                        <FinanceCell>Discount</FinanceCell>

                        <FinanceCell align="right">
                          -{formatMoney(billing.discount_amount)}
                        </FinanceCell>
                      </tr>
                    </>
                  )}

                  <tr>
                    <FinanceCell>
                      <strong>Total Fee</strong>
                    </FinanceCell>

                    <FinanceCell align="right">
                      <strong>
                        {billing
                          ? formatMoney(billing.total_due)
                          : feeItems.length > 0
                            ? formatMoney(cor.assessment.configured_fee_total)
                            : "—"}
                      </strong>
                    </FinanceCell>
                  </tr>
                </tbody>
              </table>

              <div
                style={{
                  marginTop: "22px",
                  fontSize: "10px",
                }}
              >
                Assessed by: ______________________________
              </div>
            </div>

            {/* PAYMENT BOXES */}

            <div
              style={{
                display: "grid",
                gap: "7px",
              }}
            >
              <PaymentBox title="Due For Prelim" />

              <PaymentBox title="Due For Midterm" />

              <PaymentBox title="Due For Finals" />

              <div
                style={{
                  border: "1px solid #6b7280",
                  padding: "5px 7px",
                  fontSize: "9px",
                }}
              >
                <strong>Total Balance:</strong>{" "}
                {billing ? formatMoney(billing.balance) : "________________"}
              </div>

              <PaymentBox title="Partial Payment" />
            </div>
          </section>

          {/* =================================================
              RECORDED PAYMENTS
          ================================================= */}

          {payments.length > 0 && (
            <section
              style={{
                marginTop: "16px",
              }}
            >
              <div
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  marginBottom: "4px",
                }}
              >
                RECORDED PAYMENTS
              </div>

              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "9px",
                }}
              >
                <thead>
                  <tr>
                    <Th>OR #</Th>

                    <Th>Amount</Th>

                    <Th>Method</Th>

                    <Th>Date</Th>

                    <Th>Collected By</Th>
                  </tr>
                </thead>

                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.payment_id}>
                      <Td>{payment.receipt_number || "—"}</Td>

                      <Td>{formatMoney(payment.amount_paid)}</Td>

                      <Td>{payment.payment_method || "—"}</Td>

                      <Td>{formatDate(payment.payment_date)}</Td>

                      <Td>{payment.received_by_username || "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* =================================================
              SIGNATURES
          ================================================= */}

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "70px",
              marginTop: "45px",
              textAlign: "center",
              fontSize: "10px",
            }}
          >
            <div>
              <div
                style={{
                  borderTop: "1px solid #111827",
                  paddingTop: "4px",
                }}
              >
                {student.student_name.toUpperCase()}
              </div>

              <div>Student's Signature</div>
            </div>

            <div>
              <div
                style={{
                  borderTop: "1px solid #111827",
                  paddingTop: "4px",
                  fontWeight: 700,
                }}
              >
                COLLEGE REGISTRAR
              </div>

              <div>Authorized Signature</div>
            </div>
          </section>

          {/* =================================================
              SYSTEM CERTIFICATION
          ================================================= */}

          <section
            style={{
              marginTop: "22px",
              borderTop: "1px solid #d1d5db",
              paddingTop: "8px",
              fontSize: "8px",
            }}
          >
            <div>
              Enrollment Approved By:{" "}
              <strong>{cor.certification.approved_by_username || "—"}</strong>
            </div>

            <div>
              Approval Date: {formatDate(cor.certification.approved_at)}
            </div>

            <div
              style={{
                marginTop: "7px",
              }}
            >
              Section Learning Hub: __________________________
            </div>

            <div
              style={{
                marginTop: "4px",
              }}
            >
              Note: This document serves as proof of your enrollment for the{" "}
              {cor.academic_period.semester_name}, A.Y.{" "}
              {cor.academic_period.academic_year}.
            </div>
          </section>
        </section>
      </main>
    </DashboardLayout>
  );
}

// ============================================================
// TABLE COMPONENTS
// ============================================================

function Th({
  children,
  width,
}: {
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <th
      style={{
        width,
        border: "1px solid #6b7280",
        padding: "4px 3px",
        background: "#f3f4f6",
        textAlign: "center",
        verticalAlign: "middle",
        fontWeight: 700,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "center",
  colSpan,
}: {
  children: React.ReactNode;
  align?: CSSProperties["textAlign"];
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        border: "1px solid #9ca3af",
        padding: "4px 3px",
        textAlign: align,
        verticalAlign: "middle",
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </td>
  );
}

function FinanceCell({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: CSSProperties["textAlign"];
}) {
  return (
    <td
      style={{
        border: "1px solid #9ca3af",
        padding: "4px 6px",
        textAlign: align,
      }}
    >
      {children}
    </td>
  );
}

function PaymentBox({ title }: { title: string }) {
  return (
    <div
      style={{
        minHeight: "58px",
        border: "1px solid #6b7280",
        padding: "5px 7px",
        boxSizing: "border-box",
        fontSize: "9px",
      }}
    >
      <div
        style={{
          fontWeight: 700,
        }}
      >
        {title}
      </div>

      <div>OR#: ______________________</div>

      <div>Amount Paid: __________________</div>

      <div>Date: ________________________</div>

      <div>Collected by: _________________</div>
    </div>
  );
}

// ============================================================
// STYLES
// ============================================================

const panelStyle: CSSProperties = {
  padding: "20px",
  border: "1px solid #e2e8f0",
  borderRadius: "16px",
  background: "#ffffff",
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: "9px",
  background: "#ffffff",
  color: "#0f172a",
  outline: "none",
};

const primaryButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "7px",
  padding: "10px 14px",
  border: 0,
  borderRadius: "9px",
  background: "#15803d",
  color: "#ffffff",
  fontWeight: 750,
  cursor: "pointer",
};

const secondaryButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "7px",
  padding: "10px 14px",
  border: "1px solid #cbd5e1",
  borderRadius: "9px",
  background: "#ffffff",
  color: "#334155",
  fontWeight: 700,
  cursor: "pointer",
};

const centerStyle: CSSProperties = {
  minHeight: "300px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "10px",
  color: "#64748b",
};

const errorStyle: CSSProperties = {
  padding: "12px 14px",
  border: "1px solid #fecaca",
  borderRadius: "10px",
  background: "#fef2f2",
  color: "#991b1b",
  marginBottom: "14px",
};
