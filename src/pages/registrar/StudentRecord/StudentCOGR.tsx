import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  CircleHelp,
  FileCheck2,
  FileText,
  GraduationCap,
  Hash,
  Info,
  Layers3,
  Printer,
  RefreshCw,
  School,
  ScrollText,
  ShieldCheck,
  UserRound,
  XCircle,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/RegistrarCertificateOfGrades.css";

const API_BASE_URL = "http://localhost:3000/api/registrar/students";

type AcademicClassification = "Passed" | "Incomplete" | "Failed" | "Unknown";

interface Student {
  student_id: number;
  student_number: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender?: string | null;
  birth_date?: string | null;
  contact_number?: string | null;
  email?: string | null;
  course_id?: number | null;
  course_code: string;
  course_name?: string | null;
  year_level: number;
  status: string;
  section_id?: number | null;
  section_name?: string | null;
  semester_id?: number | null;
  semester_name?: string | null;
}

interface AcademicRecord {
  enrollment_id: number;
  academic_year_id: number;
  academic_year: string;
  semester_id: number;
  semester_name: string;
  enrollment_status: string;
  enrollment_subject_id: number;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  units: number;
  lecture_hours?: number | null;
  laboratory_hours?: number | null;
  subject_status: string;
  offering_id?: number | null;
  section_id?: number | null;
  section_subject_id?: number | null;
  section_name?: string | null;
  grade_id: number;
  faculty_id?: number | null;
  prelim_grade: number | null;
  midterm_grade: number | null;
  final_grade: number | null;
  final_rating: number | null;
  academic_result?: "Passed" | "Incomplete" | "Failed" | null;
  remarks: "Passed" | "Incomplete" | "Failed" | null;
  grade_status: "Draft" | "Submitted" | "Returned" | "Approved";
  submitted_at?: string | null;
  reviewed_by?: number | null;
  reviewed_by_username?: string | null;
  reviewed_at?: string | null;
  review_remarks?: string | null;
  grade_created_at?: string | null;
  grade_updated_at?: string | null;
}

interface AcademicResponse {
  success: boolean;
  student?: Student;
  totalSubjects?: number;
  records?: AcademicRecord[];
  message?: string;
  error?: string;
}

interface AcademicTermOption {
  academic_year_id: number;
  academic_year: string;
  semester_id: number;
  semester_name: string;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(
      `Server returned a non-JSON response (${response.status}): ${text.slice(0, 200)}`,
    );
  }

  return response.json() as Promise<T>;
}

function formatGrade(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";

  return numeric.toFixed(2);
}

function formatUnits(value: number): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function classifyFinalRating(
  finalRating: number | null | undefined,
): AcademicClassification {
  if (finalRating === null || finalRating === undefined) return "Unknown";

  const rating = Number(finalRating);
  if (!Number.isFinite(rating)) return "Unknown";

  if (rating >= 1 && rating <= 3) return "Passed";
  if (rating === 4) return "Incomplete";
  if (rating === 5) return "Failed";

  return "Unknown";
}

function getClassification(record: AcademicRecord): AcademicClassification {
  if (
    record.academic_result === "Passed" ||
    record.academic_result === "Incomplete" ||
    record.academic_result === "Failed"
  ) {
    return record.academic_result;
  }

  return classifyFinalRating(record.final_rating);
}

function requiresRetake(record: AcademicRecord): boolean {
  const result = getClassification(record);
  return result === "Incomplete" || result === "Failed";
}

function getStatusClass(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown";
}

function getStudentName(student: Student): string {
  return [student.first_name, student.middle_name, student.last_name]
    .filter(Boolean)
    .join(" ");
}

function getInitials(student: Student): string {
  const first = student.first_name?.trim()?.charAt(0) || "";
  const last = student.last_name?.trim()?.charAt(0) || "";
  return `${first}${last}`.toUpperCase() || "ST";
}

function ResultIcon({ result }: { result: AcademicClassification }) {
  if (result === "Passed") return <CheckCircle2 size={14} aria-hidden="true" />;
  if (result === "Incomplete") return <AlertTriangle size={14} aria-hidden="true" />;
  if (result === "Failed") return <XCircle size={14} aria-hidden="true" />;
  return <CircleHelp size={14} aria-hidden="true" />;
}

export default function CertificateOfGradesR() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [student, setStudent] = useState<Student | null>(null);
  const [records, setRecords] = useState<AcademicRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [selectedAcademicYearId, setSelectedAcademicYearId] = useState<
    number | null
  >(null);
  const [selectedSemesterId, setSelectedSemesterId] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Registrar") {
      if (userRole) {
        navigate(authService.getDashboardRoute(userRole), { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [authenticated, userRole, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") return;

    if (!id) {
      setError("Invalid student ID.");
      setLoading(false);
      return;
    }

    const studentId = Number(id);

    if (!Number.isInteger(studentId) || studentId <= 0) {
      setError("Invalid student ID.");
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    const loadCOGData = async () => {
      try {
        setLoading(true);
        setError("");

        const requestUrl = `${API_BASE_URL}/${studentId}/academic-records`;

        const response = await authService.authFetch(requestUrl, {
          method: "GET",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        const data = await readJsonResponse<AcademicResponse>(response);

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          throw new Error(data.message || "Registrar access is required.");
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || data.error || "Unable to load Certificate of Grades.",
          );
        }

        if (!data.student) {
          throw new Error("Student information was not returned by the server.");
        }

        const officialRecords = Array.isArray(data.records)
          ? data.records.filter(
              (record) =>
                record.enrollment_status === "Approved" &&
                record.grade_status === "Approved" &&
                record.final_rating !== null &&
                [1, 2].includes(Number(record.semester_id)),
            )
          : [];

        setStudent(data.student);
        setRecords(officialRecords);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("GET REGISTRAR COG ERROR:", requestError);
        setStudent(null);
        setRecords([]);

        if (requestError instanceof TypeError) {
          setError(
            "Unable to connect to the academic records server. Make sure the backend is running on port 3000.",
          );
          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load Certificate of Grades.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadCOGData();

    return () => controller.abort();
  }, [id, authenticated, userRole, navigate, refreshKey]);

  const availableTerms = useMemo<AcademicTermOption[]>(() => {
    const termMap = new Map<string, AcademicTermOption>();

    records.forEach((record) => {
      const key = `${record.academic_year_id}-${record.semester_id}`;

      if (!termMap.has(key)) {
        termMap.set(key, {
          academic_year_id: record.academic_year_id,
          academic_year: record.academic_year,
          semester_id: record.semester_id,
          semester_name: record.semester_name,
        });
      }
    });

    return Array.from(termMap.values()).sort((a, b) => {
      if (a.academic_year_id !== b.academic_year_id) {
        return b.academic_year_id - a.academic_year_id;
      }
      return b.semester_id - a.semester_id;
    });
  }, [records]);

  useEffect(() => {
    if (availableTerms.length === 0) {
      setSelectedAcademicYearId(null);
      setSelectedSemesterId(null);
      return;
    }

    const selectedStillExists = availableTerms.some(
      (term) =>
        term.academic_year_id === selectedAcademicYearId &&
        term.semester_id === selectedSemesterId,
    );

    if (selectedStillExists) return;

    const latest = availableTerms[0];
    setSelectedAcademicYearId(latest.academic_year_id);
    setSelectedSemesterId(latest.semester_id);
  }, [availableTerms, selectedAcademicYearId, selectedSemesterId]);

  const selectedTerm = useMemo(
    () =>
      availableTerms.find(
        (term) =>
          term.academic_year_id === selectedAcademicYearId &&
          term.semester_id === selectedSemesterId,
      ) || null,
    [availableTerms, selectedAcademicYearId, selectedSemesterId],
  );

  const cogRecords = useMemo(() => {
    if (selectedAcademicYearId === null || selectedSemesterId === null) return [];

    return records
      .filter(
        (record) =>
          record.academic_year_id === selectedAcademicYearId &&
          record.semester_id === selectedSemesterId,
      )
      .sort((a, b) => a.enrollment_subject_id - b.enrollment_subject_id);
  }, [records, selectedAcademicYearId, selectedSemesterId]);

  const selectedSectionName = useMemo(() => {
    const names = Array.from(
      new Set(
        cogRecords
          .map((record) => record.section_name)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    if (names.length === 0) return "Not assigned";
    if (names.length === 1) return names[0];
    return "Multiple Sections";
  }, [cogRecords]);

  const termSummary = useMemo(() => {
    return cogRecords.reduce(
      (summary, record) => {
        const result = getClassification(record);
        const units = Number(record.units);

        summary.totalSubjects += 1;
        if (Number.isFinite(units)) summary.totalUnits += units;
        if (result === "Passed") summary.passed += 1;
        if (result === "Incomplete") summary.incomplete += 1;
        if (result === "Failed") summary.failed += 1;

        return summary;
      },
      {
        totalSubjects: 0,
        totalUnits: 0,
        passed: 0,
        incomplete: 0,
        failed: 0,
      },
    );
  }, [cogRecords]);

  const handleTermChange = (value: string) => {
    const [academicYearId, semesterId] = value.split("-").map(Number);

    if (!Number.isInteger(academicYearId) || !Number.isInteger(semesterId)) {
      return;
    }

    setSelectedAcademicYearId(academicYearId);
    setSelectedSemesterId(semesterId);
  };

  const refresh = () => setRefreshKey((current) => current + 1);
  const printCOG = () => window.print();

  if (!authenticated || !user || userRole !== "Registrar") return null;

  return (
    <DashboardLayout>
      <main className="registrar-cog">
        <section className="registrar-cog__hero registrar-cog__screen-only">
          <div className="registrar-cog__hero-copy">
            <div className="registrar-cog__eyebrow">
              <span className="registrar-cog__eyebrow-icon">
                <FileCheck2 size={16} aria-hidden="true" />
              </span>
              Registrar · Student Documents
            </div>
            <h1>Certificate of Grades</h1>
            <p>
              Review and print an official term-based Certificate of Grades using
              only approved academic results recorded in the PTC Portal.
            </p>
          </div>

          <div className="registrar-cog__hero-actions">
            <button
              type="button"
              className="registrar-cog__button registrar-cog__button--secondary"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              Back
            </button>
            <button
              type="button"
              className="registrar-cog__button registrar-cog__button--primary"
              onClick={refresh}
              disabled={loading}
            >
              <RefreshCw
                size={15}
                className={loading ? "registrar-cog__spin" : ""}
                aria-hidden="true"
              />
              {loading ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </section>

        <section className="registrar-cog__notice registrar-cog__screen-only">
          <div className="registrar-cog__notice-icon">
            <ShieldCheck size={18} aria-hidden="true" />
          </div>
          <div>
            <strong>Official grades only</strong>
            <p>
              Draft, Submitted, and Returned grades are excluded. This certificate
              only uses approved enrollments, Program Head-approved grades, and an
              official final rating from First or Second Semester.
            </p>
          </div>
        </section>

        {error && (
          <section className="registrar-cog__error registrar-cog__screen-only">
            <div className="registrar-cog__error-copy">
              <span className="registrar-cog__error-icon">
                <AlertCircle size={20} aria-hidden="true" />
              </span>
              <div>
                <strong>Certificate of Grades could not be loaded</strong>
                <p>{error}</p>
              </div>
            </div>
            <button type="button" onClick={refresh}>
              <RefreshCw size={14} aria-hidden="true" />
              Try Again
            </button>
          </section>
        )}

        {loading && (
          <section className="registrar-cog__loading registrar-cog__screen-only">
            <div className="registrar-cog__loading-header">
              <div className="registrar-cog__skeleton registrar-cog__skeleton--avatar" />
              <div className="registrar-cog__loading-lines">
                <div className="registrar-cog__skeleton registrar-cog__skeleton--title" />
                <div className="registrar-cog__skeleton registrar-cog__skeleton--text" />
              </div>
            </div>
            <div className="registrar-cog__loading-grid">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  className="registrar-cog__skeleton registrar-cog__skeleton--card"
                  key={index}
                />
              ))}
            </div>
            <div className="registrar-cog__skeleton registrar-cog__skeleton--document" />
          </section>
        )}

        {!loading && !error && student && (
          <>
            <section className="registrar-cog__student-card registrar-cog__screen-only">
              <div className="registrar-cog__identity">
                <div className="registrar-cog__avatar" aria-hidden="true">
                  {getInitials(student)}
                </div>
                <div className="registrar-cog__identity-copy">
                  <span className="registrar-cog__label">Student record</span>
                  <h2>{getStudentName(student)}</h2>
                  <div className="registrar-cog__student-meta">
                    <span>
                      <Hash size={13} aria-hidden="true" />
                      {student.student_number}
                    </span>
                    <span>
                      <GraduationCap size={13} aria-hidden="true" />
                      {student.course_code}
                    </span>
                  </div>
                </div>
              </div>

              <div className="registrar-cog__student-facts">
                <div className="registrar-cog__fact">
                  <span>Program</span>
                  <strong>{student.course_code}</strong>
                  <small>{student.course_name || "Program information"}</small>
                </div>
                <div className="registrar-cog__fact">
                  <span>Current Year</span>
                  <strong>Year {student.year_level}</strong>
                  <small>Current student level</small>
                </div>
                <div className="registrar-cog__fact">
                  <span>Status</span>
                  <strong
                    className={`registrar-cog__student-status registrar-cog__student-status--${getStatusClass(student.status)}`}
                  >
                    {student.status || "Unknown"}
                  </strong>
                  <small>Student standing</small>
                </div>
              </div>
            </section>

            <section className="registrar-cog__controls registrar-cog__screen-only">
              <div className="registrar-cog__controls-heading">
                <div>
                  <span className="registrar-cog__section-icon">
                    <CalendarDays size={17} aria-hidden="true" />
                  </span>
                  <div>
                    <h3>Certificate Period</h3>
                    <p>Select the approved academic term to preview and print.</p>
                  </div>
                </div>
              </div>

              <div className="registrar-cog__control-row">
                <label className="registrar-cog__select-field" htmlFor="cog-term">
                  <span>Academic term</span>
                  <select
                    id="cog-term"
                    value={
                      selectedTerm
                        ? `${selectedTerm.academic_year_id}-${selectedTerm.semester_id}`
                        : ""
                    }
                    onChange={(event) => handleTermChange(event.target.value)}
                    disabled={availableTerms.length === 0}
                  >
                    {availableTerms.length === 0 ? (
                      <option value="">No official terms available</option>
                    ) : (
                      availableTerms.map((term) => (
                        <option
                          key={`${term.academic_year_id}-${term.semester_id}`}
                          value={`${term.academic_year_id}-${term.semester_id}`}
                        >
                          {term.academic_year} — {term.semester_name}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <button
                  type="button"
                  className="registrar-cog__print-button"
                  onClick={printCOG}
                  disabled={cogRecords.length === 0}
                >
                  <Printer size={16} aria-hidden="true" />
                  Print Certificate
                </button>
              </div>
            </section>

            {cogRecords.length > 0 && selectedTerm && (
              <section className="registrar-cog__summary-grid registrar-cog__screen-only">
                <article className="registrar-cog__summary-card">
                  <span className="registrar-cog__summary-icon">
                    <BookOpenCheck size={18} aria-hidden="true" />
                  </span>
                  <div>
                    <span>Subjects</span>
                    <strong>{termSummary.totalSubjects}</strong>
                    <small>Official subjects this term</small>
                  </div>
                </article>

                <article className="registrar-cog__summary-card">
                  <span className="registrar-cog__summary-icon">
                    <Layers3 size={18} aria-hidden="true" />
                  </span>
                  <div>
                    <span>Total Units</span>
                    <strong>{formatUnits(termSummary.totalUnits)}</strong>
                    <small>Units represented on COG</small>
                  </div>
                </article>

                <article className="registrar-cog__summary-card registrar-cog__summary-card--passed">
                  <span className="registrar-cog__summary-icon">
                    <CheckCircle2 size={18} aria-hidden="true" />
                  </span>
                  <div>
                    <span>Passed</span>
                    <strong>{termSummary.passed}</strong>
                    <small>Subjects with passing rating</small>
                  </div>
                </article>

                <article
                  className={`registrar-cog__summary-card ${
                    termSummary.incomplete + termSummary.failed > 0
                      ? "registrar-cog__summary-card--attention"
                      : ""
                  }`}
                >
                  <span className="registrar-cog__summary-icon">
                    <AlertTriangle size={18} aria-hidden="true" />
                  </span>
                  <div>
                    <span>Needs Attention</span>
                    <strong>{termSummary.incomplete + termSummary.failed}</strong>
                    <small>
                      {termSummary.incomplete} incomplete · {termSummary.failed} failed
                    </small>
                  </div>
                </article>
              </section>
            )}

            {cogRecords.length === 0 && (
              <section className="registrar-cog__empty registrar-cog__screen-only">
                <span className="registrar-cog__empty-icon">
                  <FileText size={28} aria-hidden="true" />
                </span>
                <h3>No Certificate of Grades available</h3>
                <p>
                  This student does not yet have approved grades for an official
                  First or Second Semester period. Only official approved records can
                  appear on the certificate.
                </p>
              </section>
            )}

            {cogRecords.length > 0 && selectedTerm && (
              <section className="registrar-cog__preview-wrap">
                <div className="registrar-cog__preview-label registrar-cog__screen-only">
                  <div>
                    <span className="registrar-cog__section-icon">
                      <ScrollText size={17} aria-hidden="true" />
                    </span>
                    <div>
                      <h3>Document Preview</h3>
                      <p>This is the content that will be included when printed.</p>
                    </div>
                  </div>
                  <span className="registrar-cog__ready-badge">
                    <BadgeCheck size={14} aria-hidden="true" />
                    Ready to print
                  </span>
                </div>

                <article className="registrar-cog-document">
                  <header className="registrar-cog-document__header">
                    <div className="registrar-cog-document__seal" aria-hidden="true">
                      <School size={28} />
                    </div>
                    <div>
                      <p>Republic of the Philippines</p>
                      <h1>PATEROS TECHNOLOGICAL COLLEGE</h1>
                      <span>OFFICE OF THE REGISTRAR</span>
                    </div>
                  </header>

                  <div className="registrar-cog-document__title">
                    <span>Official Academic Document</span>
                    <h2>CERTIFICATE OF GRADES</h2>
                    <p>
                      Academic Year {selectedTerm.academic_year} · {selectedTerm.semester_name}
                    </p>
                  </div>

                  <section className="registrar-cog-document__student-grid">
                    <div className="registrar-cog-document__info registrar-cog-document__info--wide">
                      <span>Student Name</span>
                      <strong>{getStudentName(student)}</strong>
                    </div>
                    <div className="registrar-cog-document__info">
                      <span>Student Number</span>
                      <strong>{student.student_number}</strong>
                    </div>
                    <div className="registrar-cog-document__info">
                      <span>Program</span>
                      <strong>{student.course_code}</strong>
                    </div>
                    <div className="registrar-cog-document__info">
                      <span>Year Level</span>
                      <strong>Year {student.year_level}</strong>
                    </div>
                    <div className="registrar-cog-document__info">
                      <span>Section</span>
                      <strong>{selectedSectionName}</strong>
                    </div>
                    <div className="registrar-cog-document__info">
                      <span>Student Status</span>
                      <strong>{student.status || "—"}</strong>
                    </div>
                  </section>

                  <div className="registrar-cog-document__table-wrap">
                    <table className="registrar-cog-document__table">
                      <thead>
                        <tr>
                          <th>Subject Code</th>
                          <th>Subject Description</th>
                          <th>Units</th>
                          <th>Final Rating</th>
                          <th>Result</th>
                          <th>Academic Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cogRecords.map((record) => {
                          const result = getClassification(record);

                          return (
                            <tr key={record.enrollment_subject_id}>
                              <td>
                                <strong>{record.subject_code}</strong>
                              </td>
                              <td>{record.subject_name}</td>
                              <td>{formatUnits(record.units)}</td>
                              <td>
                                <strong className="registrar-cog-document__rating">
                                  {formatGrade(record.final_rating)}
                                </strong>
                              </td>
                              <td>
                                <div className="registrar-cog-document__result-cell">
                                  <span
                                    className={`registrar-cog-document__result registrar-cog-document__result--${result.toLowerCase()}`}
                                  >
                                    <ResultIcon result={result} />
                                    {result}
                                  </span>
                                  {requiresRetake(record) && (
                                    <small>Retake required</small>
                                  )}
                                </div>
                              </td>
                              <td>
                                <span
                                  className={`registrar-cog-document__subject-status registrar-cog-document__subject-status--${getStatusClass(record.subject_status)}`}
                                >
                                  {record.subject_status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={2}>Term Summary</td>
                          <td>{formatUnits(termSummary.totalUnits)}</td>
                          <td colSpan={3}>
                            {termSummary.totalSubjects} official subject
                            {termSummary.totalSubjects === 1 ? "" : "s"}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <section className="registrar-cog-document__guide">
                    <div className="registrar-cog-document__guide-title">
                      <Info size={15} aria-hidden="true" />
                      <strong>Grade Interpretation</strong>
                    </div>
                    <div className="registrar-cog-document__guide-items">
                      <span><b>1.00–3.00</b> Passed</span>
                      <span><b>4.00</b> Incomplete</span>
                      <span><b>5.00</b> Failed</span>
                    </div>
                  </section>

                  <section className="registrar-cog-document__certification">
                    <p>
                      This is to certify that the grades stated above are the official
                      approved academic results recorded in the PTC Student Portal for
                      the indicated academic period.
                    </p>
                    <p>
                      Only grades approved by the Program Head from approved student
                      enrollments are included in this Certificate of Grades.
                    </p>
                  </section>

                  <section className="registrar-cog-document__footer-info">
                    <div>
                      <span>Student Number</span>
                      <strong>{student.student_number}</strong>
                    </div>
                    <div>
                      <span>Date Generated</span>
                      <strong>{formatDate(new Date().toISOString())}</strong>
                    </div>
                  </section>

                  <section className="registrar-cog-document__signature">
                    <div>
                      <span className="registrar-cog-document__signature-line" />
                      <strong>REGISTRAR</strong>
                      <small>Authorized Registrar</small>
                    </div>
                  </section>
                </article>
              </section>
            )}

            <section className="registrar-cog__footer-actions registrar-cog__screen-only">
              <div className="registrar-cog__footer-copy">
                <UserRound size={18} aria-hidden="true" />
                <div>
                  <strong>Continue reviewing this student</strong>
                  <span>Open another Registrar student-record view.</span>
                </div>
              </div>
              <div className="registrar-cog__footer-buttons">
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/registrar/student/DetailsR/${student.student_id}`)
                  }
                >
                  <UserRound size={14} aria-hidden="true" />
                  Student Profile
                </button>
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/registrar/student/${student.student_id}/AcadRecR`)
                  }
                >
                  <BookOpenCheck size={14} aria-hidden="true" />
                  Academic Records
                </button>
                <button
                  type="button"
                  className="registrar-cog__footer-button--primary"
                  onClick={() =>
                    navigate(`/registrar/student/${student.student_id}/transcriptR`)
                  }
                >
                  <ScrollText size={14} aria-hidden="true" />
                  Transcript
                </button>
              </div>
            </section>
          </>
        )}
      </main>
    </DashboardLayout>
  );
}
