import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/StudentAcademicRecord.css";

const API_URL = "http://localhost:3000/api/student/academic-records";

type GradeClassification =
  | "Passed"
  | "Incomplete"
  | "Failed"
  | "Credited"
  | "Unknown";

type AcademicRecordType = "PTC_GRADE" | "TRANSFER_CREDIT";

interface StudentCourse {
  course_id: number;
  course_code: string;
  course_name: string;
}

interface StudentCurriculum {
  student_curriculum_id?: number;
  curriculum_id: number;
  curriculum_name: string;
  effective_year: number | null;
  total_units?: number | null;
  status?: string;
  assigned_date?: string | null;
}

interface AcademicStudent {
  student_id: number;
  student_number: string;

  first_name: string;
  middle_name: string | null;
  last_name: string;

  student_name: string;

  email?: string | null;

  year_level: number;
  status: string;

  course: StudentCourse;

  curriculum: StudentCurriculum | null;
}

interface TransferSource {
  school: string;
  course: string | null;
  student_number: string | null;

  subject_code: string | null;
  subject_name: string;

  units: number | null;
  grade: string | null;
  remarks: string | null;

  academic_year: string | null;
  year_level: number | null;
  semester: string | null;
}

interface CurriculumMapping {
  curriculum_id: number;
  curriculum_name: string | null;
  curriculum_subject_id: number | null;

  year_level: number | null;

  semester_id: number | null;
  semester_name: string | null;

  is_required: boolean | null;
}

interface TransferCompletion {
  evaluation_status: string;

  completed_by: number | null;
  completed_by_username: string | null;

  completed_at: string | null;

  completion_remarks: string | null;
}

interface AcademicRecord {
  record_type: AcademicRecordType;
  academic_source: string;

  official_record: boolean;

  grade_id: number | null;

  enrollment_subject_id: number | null;
  enrollment_id: number | null;

  transfer_evaluation_id: number | null;
  transfer_subject_id: number | null;

  subject_id: number;
  subject_code: string;
  subject_name: string;

  units: number;

  academic_year_id: number | null;
  academic_year: string | null;

  semester_id: number | null;
  semester_name: string | null;

  enrollment_status: string | null;
  subject_status: string;

  prelim_grade: number | null;
  midterm_grade: number | null;
  final_grade: number | null;

  final_rating: number | null;

  source_grade: string | null;

  remarks: string | null;

  grade_status: "Draft" | "Submitted" | "Returned" | "Approved" | null;

  result_code?: string | null;

  classification?: GradeClassification | null;

  passed?: boolean;
  retake?: boolean;

  valid_result?: boolean;
  curriculum_satisfied?: boolean;

  faculty?: {
    faculty_id: number;
    employee_number: string | null;
    faculty_name: string;
  } | null;

  approval?: {
    reviewed_by: number | null;
    reviewed_by_username: string | null;
    reviewed_at: string | null;
    review_remarks?: string | null;
  } | null;

  transfer_source?: TransferSource | null;

  curriculum_mapping?: CurriculumMapping | null;

  transfer_completion?: TransferCompletion | null;

  submitted_at?: string | null;

  created_at?: string | null;
  updated_at?: string | null;
}

interface AcademicRecordSummary {
  total_official_records?: number;

  total_recorded_units?: number;
  earned_units?: number;

  unique_satisfied_subjects?: number;

  total_approved_subjects?: number;

  ptc_grade_records?: number;
  ptc_recorded_units?: number;
  ptc_earned_units?: number;

  passed_subjects?: number;
  incomplete_subjects?: number;
  failed_subjects?: number;
  retake_subjects?: number;

  official_transfer_credit_records?: number;
  unique_transfer_credit_subjects?: number;
  transfer_credited_units?: number;
}

interface AcademicRecordResponse {
  success: boolean;

  code?: string;

  student?: AcademicStudent;

  summary?: AcademicRecordSummary;

  records?: AcademicRecord[];

  ptc_grade_records?: AcademicRecord[];

  transfer_credit_records?: AcademicRecord[];

  academic_rule?: {
    official_ptc_grade?: string;
    official_transfer_credit?: string;
    transfer_grade_stored_as_ptc_grade?: boolean;
    earned_units_deduplicated_by_ptc_subject?: boolean;
  };

  message?: string;
  error?: string;
}

interface SemesterGroup {
  key: string;

  semesterName: string;
  sortOrder: number;

  records: AcademicRecord[];
}

interface AcademicYearGroup {
  key: string;

  academicYear: string;
  sortOrder: number;

  semesters: SemesterGroup[];
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();

    throw new Error(
      `Server returned a non-JSON response (${response.status}): ${text.slice(
        0,
        200,
      )}`,
    );
  }

  return response.json() as Promise<T>;
}

function isTransferCredit(record: AcademicRecord): boolean {
  return record.record_type === "TRANSFER_CREDIT";
}

function isPtcGrade(record: AcademicRecord): boolean {
  return record.record_type === "PTC_GRADE";
}

function formatGrade(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return String(value);
  }

  return numeric.toFixed(2);
}

function classifyFinalRating(value: number | null): GradeClassification {
  if (value === null || value === undefined) {
    return "Unknown";
  }

  const rating = Number(value);

  if (!Number.isFinite(rating)) {
    return "Unknown";
  }

  if (rating >= 1 && rating <= 3) {
    return "Passed";
  }

  if (rating === 4) {
    return "Incomplete";
  }

  if (rating === 5) {
    return "Failed";
  }

  return "Unknown";
}

function getClassification(record: AcademicRecord): GradeClassification {
  if (isTransferCredit(record)) {
    return "Credited";
  }

  if (
    record.classification === "Passed" ||
    record.classification === "Incomplete" ||
    record.classification === "Failed" ||
    record.classification === "Credited"
  ) {
    return record.classification;
  }

  return classifyFinalRating(record.final_rating);
}

function requiresRetake(record: AcademicRecord): boolean {
  if (isTransferCredit(record)) {
    return false;
  }

  if (typeof record.retake === "boolean") {
    return record.retake;
  }

  const result = getClassification(record);

  return result === "Failed" || result === "Incomplete";
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function getAcademicYearLabel(record: AcademicRecord): string {
  if (record.academic_year) {
    return record.academic_year;
  }

  if (record.transfer_source?.academic_year) {
    return record.transfer_source.academic_year;
  }

  return "Transfer Credit";
}

function getSemesterLabel(record: AcademicRecord): string {
  if (record.semester_name) {
    return record.semester_name;
  }

  if (record.transfer_source?.semester) {
    return record.transfer_source.semester;
  }

  return "Transfer Credit";
}

function getAcademicYearSortOrder(value: string): number {
  const match = value.match(/^(\d{4})/);

  if (!match) {
    return 0;
  }

  const year = Number(match[1]);

  return Number.isFinite(year) ? year : 0;
}

function getSemesterSortOrder(value: string): number {
  const normalized = value.trim().toLowerCase();

  if (normalized.includes("first")) {
    return 1;
  }

  if (normalized.includes("second")) {
    return 2;
  }

  if (normalized.includes("summer")) {
    return 3;
  }

  return 99;
}

function getResultClass(classification: GradeClassification): string {
  if (classification === "Credited") {
    return "passed";
  }

  return classification.toLowerCase();
}

function getSubjectStatusClass(status: string): string {
  if (status.toLowerCase() === "credited") {
    return "completed";
  }

  return status.toLowerCase().replace(/\s+/g, "-");
}

function getRecordKey(record: AcademicRecord): string {
  if (isTransferCredit(record) && record.transfer_subject_id !== null) {
    return `transfer-${record.transfer_subject_id}`;
  }

  if (record.grade_id !== null) {
    return `grade-${record.grade_id}`;
  }

  if (record.enrollment_subject_id !== null) {
    return `es-${record.enrollment_subject_id}`;
  }

  return `${record.record_type}-${record.subject_id}-${record.subject_code}`;
}

export default function StudentRecord() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();

  const authenticated = Boolean(session && token);

  const userRole = session?.role;

  const [student, setStudent] = useState<AcademicStudent | null>(null);

  const [records, setRecords] = useState<AcademicRecord[]>([]);

  const [apiSummary, setApiSummary] = useState<AcademicRecordSummary | null>(
    null,
  );

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  const [refreshKey, setRefreshKey] = useState(0);

  const [search, setSearch] = useState("");

  const [academicYearFilter, setAcademicYearFilter] = useState("All");

  const [semesterFilter, setSemesterFilter] = useState("All");

  const [resultFilter, setResultFilter] = useState("All");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (userRole !== "Student") {
      if (session) {
        navigate(authService.getDashboardRoute(session.role), {
          replace: true,
        });
      } else {
        navigate("/login", {
          replace: true,
        });
      }
    }
  }, [authenticated, userRole, session, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Student") {
      return;
    }

    const controller = new AbortController();

    const loadAcademicRecord = async () => {
      try {
        setLoading(true);
        setError("");

        const response = await authService.authFetch(API_URL, {
          method: "GET",
          signal: controller.signal,
        });

        const data = await readJsonResponse<AcademicRecordResponse>(response);

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        if (response.status === 403) {
          throw new Error(data.message || "Student access is required.");
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || data.error || "Unable to load academic record.",
          );
        }

        const officialRecords = Array.isArray(data.records)
          ? data.records.filter((record) => {
              if (record.official_record !== true) {
                return false;
              }

              if (isTransferCredit(record)) {
                return (
                  record.subject_status === "Credited" &&
                  record.transfer_evaluation_id !== null &&
                  record.transfer_subject_id !== null
                );
              }

              return (
                record.grade_status === "Approved" &&
                record.enrollment_status === "Approved" &&
                [1, 2].includes(Number(record.semester_id))
              );
            })
          : [];

        setStudent(data.student || null);

        setApiSummary(data.summary || null);

        setRecords(officialRecords);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD STUDENT ACADEMIC RECORD ERROR:", requestError);

        setStudent(null);
        setApiSummary(null);
        setRecords([]);

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load academic record.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadAcademicRecord();

    return () => {
      controller.abort();
    };
  }, [authenticated, userRole, navigate, refreshKey]);

  const academicYears = useMemo(() => {
    const values = new Set<string>();

    records.forEach((record) => {
      values.add(getAcademicYearLabel(record));
    });

    return Array.from(values).sort(
      (a, b) => getAcademicYearSortOrder(b) - getAcademicYearSortOrder(a),
    );
  }, [records]);

  const semesters = useMemo(() => {
    const values = new Set<string>();

    records.forEach((record) => {
      values.add(getSemesterLabel(record));
    });

    return Array.from(values).sort(
      (a, b) => getSemesterSortOrder(a) - getSemesterSortOrder(b),
    );
  }, [records]);

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();

    return records.filter((record) => {
      const classification = getClassification(record);

      const transferSource = record.transfer_source;

      const matchesSearch =
        !query ||
        record.subject_code.toLowerCase().includes(query) ||
        record.subject_name.toLowerCase().includes(query) ||
        record.academic_source.toLowerCase().includes(query) ||
        (transferSource?.school || "").toLowerCase().includes(query) ||
        (transferSource?.subject_code || "").toLowerCase().includes(query) ||
        (transferSource?.subject_name || "").toLowerCase().includes(query);

      const matchesAY =
        academicYearFilter === "All" ||
        getAcademicYearLabel(record) === academicYearFilter;

      const matchesSemester =
        semesterFilter === "All" || getSemesterLabel(record) === semesterFilter;

      const matchesResult =
        resultFilter === "All" || classification === resultFilter;

      return matchesSearch && matchesAY && matchesSemester && matchesResult;
    });
  }, [records, search, academicYearFilter, semesterFilter, resultFilter]);

  const summary = useMemo(() => {
    const ptcRecords = records.filter(isPtcGrade);

    const transferRecords = records.filter(isTransferCredit);

    const passed = ptcRecords.filter(
      (record) => getClassification(record) === "Passed",
    );

    const incomplete = ptcRecords.filter(
      (record) => getClassification(record) === "Incomplete",
    );

    const failed = ptcRecords.filter(
      (record) => getClassification(record) === "Failed",
    );

    const retakes = ptcRecords.filter(requiresRetake);

    const satisfiedSubjects = new Map<number, number>();

    passed.forEach((record) => {
      if (!satisfiedSubjects.has(record.subject_id)) {
        satisfiedSubjects.set(record.subject_id, Number(record.units || 0));
      }
    });

    transferRecords.forEach((record) => {
      if (!satisfiedSubjects.has(record.subject_id)) {
        satisfiedSubjects.set(record.subject_id, Number(record.units || 0));
      }
    });

    const fallbackEarnedUnits = Array.from(satisfiedSubjects.values()).reduce(
      (total, units) => total + units,
      0,
    );

    const fallbackRecordedUnits = records.reduce(
      (total, record) => total + Number(record.units || 0),
      0,
    );

    return {
      total: apiSummary?.total_official_records ?? records.length,

      earnedUnits: apiSummary?.earned_units ?? fallbackEarnedUnits,

      passed: apiSummary?.passed_subjects ?? passed.length,

      transferCredits:
        apiSummary?.official_transfer_credit_records ?? transferRecords.length,

      incomplete: apiSummary?.incomplete_subjects ?? incomplete.length,

      failed: apiSummary?.failed_subjects ?? failed.length,

      retakes: apiSummary?.retake_subjects ?? retakes.length,

      totalRecordedUnits:
        apiSummary?.total_recorded_units ?? fallbackRecordedUnits,

      transferCreditedUnits:
        apiSummary?.transfer_credited_units ??
        transferRecords.reduce(
          (total, record) => total + Number(record.units || 0),
          0,
        ),
    };
  }, [records, apiSummary]);

  const groupedRecords = useMemo<AcademicYearGroup[]>(() => {
    const yearMap = new Map<string, AcademicYearGroup>();

    filteredRecords.forEach((record) => {
      const academicYear = getAcademicYearLabel(record);

      let yearGroup = yearMap.get(academicYear);

      if (!yearGroup) {
        yearGroup = {
          key: academicYear,

          academicYear,

          sortOrder: getAcademicYearSortOrder(academicYear),

          semesters: [],
        };

        yearMap.set(academicYear, yearGroup);
      }

      const semesterName = getSemesterLabel(record);

      const semesterKey = `${academicYear}-${semesterName}`;

      let semesterGroup = yearGroup.semesters.find(
        (semester) => semester.key === semesterKey,
      );

      if (!semesterGroup) {
        semesterGroup = {
          key: semesterKey,

          semesterName,

          sortOrder: getSemesterSortOrder(semesterName),

          records: [],
        };

        yearGroup.semesters.push(semesterGroup);
      }

      semesterGroup.records.push(record);
    });

    const result = Array.from(yearMap.values());

    result.sort((a, b) => b.sortOrder - a.sortOrder);

    result.forEach((year) => {
      year.semesters.sort((a, b) => a.sortOrder - b.sortOrder);
    });

    return result;
  }, [filteredRecords]);

  const clearFilters = () => {
    setSearch("");
    setAcademicYearFilter("All");
    setSemesterFilter("All");
    setResultFilter("All");
  };

  const refresh = () => {
    setRefreshKey((current) => current + 1);
  };

  if (!authenticated || userRole !== "Student") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="student-academic-record-page">
        <section className="student-record-header">
          <div>
            <span className="student-record-eyebrow">
              Student Academic Records
            </span>

            <h1>Official Academic Record</h1>

            <p>
              View your official academic history from approved PTC grades and
              officially credited previous-school subjects.
            </p>
          </div>

          <button
            type="button"
            className="student-record-refresh"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh Record"}
          </button>
        </section>

        <section className="student-record-official-notice">
          <div className="student-record-official-icon">✓</div>

          <div>
            <strong>Official Academic Sources</strong>

            <p>
              This record combines Program Head-approved PTC grades and
              completed, officially credited transfer subjects. Previous-school
              grades remain external source grades and are never converted into
              PTC Final Rating values.
            </p>
          </div>
        </section>

        {student && (
          <section className="student-record-profile">
            <div className="student-record-profile-primary">
              <span>Student</span>

              <strong>{student.student_name}</strong>

              <small>{student.student_number}</small>
            </div>

            <div>
              <span>Program</span>

              <strong>{student.course.course_code}</strong>

              <small>{student.course.course_name}</small>
            </div>

            <div>
              <span>Current Year Level</span>

              <strong>Year {student.year_level}</strong>
            </div>

            <div>
              <span>Student Status</span>

              <strong>{student.status}</strong>
            </div>

            <div>
              <span>Curriculum</span>

              <strong>{student.curriculum?.curriculum_name || "—"}</strong>

              {student.curriculum?.effective_year !== null &&
                student.curriculum?.effective_year !== undefined && (
                  <small>Effective {student.curriculum.effective_year}</small>
                )}
            </div>
          </section>
        )}

        <section className="student-record-summary">
          <div>
            <span>Official Records</span>
            <strong>{summary.total}</strong>
          </div>

          <div>
            <span>Earned Units</span>
            <strong>{summary.earnedUnits}</strong>
          </div>

          <div>
            <span>PTC Passed</span>
            <strong>{summary.passed}</strong>
          </div>

          <div>
            <span>Transfer Credits</span>
            <strong>{summary.transferCredits}</strong>
          </div>

          <div>
            <span>Incomplete</span>
            <strong>{summary.incomplete}</strong>
          </div>

          <div>
            <span>Failed</span>
            <strong>{summary.failed}</strong>
          </div>

          <div>
            <span>Retake Required</span>
            <strong>{summary.retakes}</strong>
          </div>
        </section>

        {error && (
          <section className="student-record-error">
            <div>
              <strong>Academic record could not be loaded</strong>

              <p>{error}</p>
            </div>

            <button type="button" onClick={refresh}>
              Try Again
            </button>
          </section>
        )}

        {loading && (
          <section className="student-record-loading">
            <div className="student-record-spinner" />

            <div>
              <strong>Loading official academic record</strong>

              <span>
                Retrieving approved PTC grades and official transfer credits...
              </span>
            </div>
          </section>
        )}

        {!loading && !error && (
          <section className="student-record-filters">
            <div className="student-record-search">
              <label htmlFor="academic-record-search">Search Subject</label>

              <input
                id="academic-record-search"
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="PTC subject, previous subject, school..."
              />
            </div>

            <div>
              <label>Academic Year</label>

              <select
                value={academicYearFilter}
                onChange={(event) => setAcademicYearFilter(event.target.value)}
              >
                <option value="All">All Academic Years</option>

                {academicYears.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label>Semester</label>

              <select
                value={semesterFilter}
                onChange={(event) => setSemesterFilter(event.target.value)}
              >
                <option value="All">All Semesters</option>

                {semesters.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label>Academic Result</label>

              <select
                value={resultFilter}
                onChange={(event) => setResultFilter(event.target.value)}
              >
                <option value="All">All Results</option>

                <option value="Passed">Passed</option>

                <option value="Credited">Credited</option>

                <option value="Incomplete">Incomplete</option>

                <option value="Failed">Failed</option>
              </select>
            </div>

            <button
              type="button"
              className="student-record-clear-filter"
              onClick={clearFilters}
            >
              Clear
            </button>
          </section>
        )}

        {!loading && !error && records.length === 0 && (
          <section className="student-record-empty">
            <div className="student-record-empty-icon">✓</div>

            <strong>No official academic records yet</strong>

            <p>
              Approved PTC grades and completed transfer credits will appear
              here when they become official.
            </p>
          </section>
        )}

        {!loading &&
          !error &&
          records.length > 0 &&
          filteredRecords.length === 0 && (
            <section className="student-record-empty">
              <strong>No matching academic records</strong>

              <p>
                No official PTC grade or transfer-credit record matches the
                current filters.
              </p>

              <button type="button" onClick={clearFilters}>
                Clear Filters
              </button>
            </section>
          )}

        {!loading && !error && groupedRecords.length > 0 && (
          <section className="student-record-history">
            <div className="student-record-history-header">
              <div>
                <h2>Academic History</h2>

                <p>
                  Official PTC grades and credited previous-school subjects
                  grouped by academic year and semester.
                </p>
              </div>

              <span>
                {filteredRecords.length} record
                {filteredRecords.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="student-record-years">
              {groupedRecords.map((year) => (
                <article className="student-record-year" key={year.key}>
                  <header className="student-record-year-header">
                    <div>
                      <span>Academic Year</span>

                      <h3>{year.academicYear}</h3>
                    </div>

                    <strong>
                      {year.semesters.reduce(
                        (total, semester) => total + semester.records.length,
                        0,
                      )}{" "}
                      record
                      {year.semesters.reduce(
                        (total, semester) => total + semester.records.length,
                        0,
                      ) === 1
                        ? ""
                        : "s"}
                    </strong>
                  </header>

                  {year.semesters.map((semester) => {
                    const semesterUnits = semester.records.reduce(
                      (total, record) => total + Number(record.units || 0),
                      0,
                    );

                    const satisfiedCount = semester.records.filter(
                      (record) =>
                        record.curriculum_satisfied === true ||
                        getClassification(record) === "Passed" ||
                        getClassification(record) === "Credited",
                    ).length;

                    return (
                      <section
                        className="student-record-semester"
                        key={semester.key}
                      >
                        <div className="student-record-semester-header">
                          <div>
                            <h4>{semester.semesterName}</h4>

                            <span>
                              {semester.records.length} record
                              {semester.records.length === 1 ? "" : "s"}
                            </span>
                          </div>

                          <div className="student-record-semester-stats">
                            <span>
                              Recorded Units <strong>{semesterUnits}</strong>
                            </span>

                            <span>
                              Satisfied <strong>{satisfiedCount}</strong>
                            </span>
                          </div>
                        </div>

                        <div className="student-record-table-wrapper">
                          <table className="student-record-table">
                            <thead>
                              <tr>
                                <th>Subject</th>

                                <th>Academic Source</th>

                                <th>Units</th>

                                <th>Prelim</th>

                                <th>Midterm</th>

                                <th>Final</th>

                                <th>Rating / Source Grade</th>

                                <th>Result</th>

                                <th>Academic Status</th>

                                <th>Review</th>
                              </tr>
                            </thead>

                            <tbody>
                              {semester.records.map((record) => {
                                const classification =
                                  getClassification(record);

                                const transfer = isTransferCredit(record);

                                return (
                                  <tr key={getRecordKey(record)}>
                                    <td>
                                      <div className="student-record-subject">
                                        <strong>{record.subject_code}</strong>

                                        <span>{record.subject_name}</span>

                                        {transfer ? (
                                          <small>PTC equivalent subject</small>
                                        ) : record.enrollment_subject_id !==
                                          null ? (
                                          <small>
                                            ES #{record.enrollment_subject_id}
                                          </small>
                                        ) : null}
                                      </div>

                                      {transfer && record.transfer_source && (
                                        <div className="student-record-subject">
                                          <small>
                                            Previous subject:{" "}
                                            {record.transfer_source.subject_code
                                              ? `${record.transfer_source.subject_code} — `
                                              : ""}
                                            {
                                              record.transfer_source
                                                .subject_name
                                            }
                                          </small>
                                        </div>
                                      )}
                                    </td>

                                    <td>
                                      {transfer ? (
                                        <div className="student-record-subject">
                                          <strong>Transfer Credit</strong>

                                          <span>
                                            {record.transfer_source?.school ||
                                              "Previous School"}
                                          </span>

                                          {record.transfer_source?.course && (
                                            <small>
                                              {record.transfer_source.course}
                                            </small>
                                          )}
                                        </div>
                                      ) : (
                                        <div className="student-record-subject">
                                          <strong>PTC Grade</strong>

                                          {record.faculty?.faculty_name && (
                                            <small>
                                              {record.faculty.faculty_name}
                                            </small>
                                          )}
                                        </div>
                                      )}
                                    </td>

                                    <td>
                                      <strong className="student-record-units">
                                        {record.units}
                                      </strong>
                                    </td>

                                    <td>
                                      {transfer
                                        ? "—"
                                        : formatGrade(record.prelim_grade)}
                                    </td>

                                    <td>
                                      {transfer
                                        ? "—"
                                        : formatGrade(record.midterm_grade)}
                                    </td>

                                    <td>
                                      {transfer
                                        ? "—"
                                        : formatGrade(record.final_grade)}
                                    </td>

                                    <td>
                                      {transfer ? (
                                        <div className="student-record-subject">
                                          <strong className="student-record-final-rating">
                                            {formatGrade(record.source_grade)}
                                          </strong>

                                          <small>External source grade</small>
                                        </div>
                                      ) : (
                                        <strong className="student-record-final-rating">
                                          {formatGrade(record.final_rating)}
                                        </strong>
                                      )}
                                    </td>

                                    <td>
                                      <span
                                        className={`student-record-result ${getResultClass(
                                          classification,
                                        )}`}
                                      >
                                        {classification}
                                      </span>

                                      {requiresRetake(record) && (
                                        <small className="student-record-retake">
                                          Retake required
                                        </small>
                                      )}
                                    </td>

                                    <td>
                                      <span
                                        className={`student-record-subject-status ${getSubjectStatusClass(
                                          record.subject_status,
                                        )}`}
                                      >
                                        {record.subject_status}
                                      </span>
                                    </td>

                                    <td>
                                      <div className="student-record-approval">
                                        <span className="student-record-approved-badge">
                                          {transfer ? "Credited" : "Approved"}
                                        </span>

                                        {record.approval
                                          ?.reviewed_by_username && (
                                          <small>
                                            Reviewed by{" "}
                                            {
                                              record.approval
                                                .reviewed_by_username
                                            }
                                          </small>
                                        )}

                                        {record.approval?.reviewed_at && (
                                          <small>
                                            {formatDateTime(
                                              record.approval.reviewed_at,
                                            )}
                                          </small>
                                        )}

                                        {transfer &&
                                          record.transfer_completion
                                            ?.completed_at && (
                                            <small>
                                              Completed{" "}
                                              {formatDateTime(
                                                record.transfer_completion
                                                  .completed_at,
                                              )}
                                            </small>
                                          )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    );
                  })}
                </article>
              ))}
            </div>
          </section>
        )}

        {!loading && !error && (
          <section className="student-record-legend">
            <div className="student-record-legend-header">
              <span>Academic Result Guide</span>

              <strong>Official Academic Sources</strong>
            </div>

            <div className="student-record-legend-items">
              <div>
                <span className="student-record-legend-rating passed">
                  1.00–3.00
                </span>

                <div>
                  <strong>PTC Passed</strong>

                  <p>
                    Approved PTC Final Rating successfully completes the
                    subject.
                  </p>
                </div>
              </div>

              <div>
                <span className="student-record-legend-rating passed">
                  Credit
                </span>

                <div>
                  <strong>Transfer Credit</strong>

                  <p>
                    Completed and Credited transfer evaluation satisfies the
                    mapped PTC curriculum subject.
                  </p>
                </div>
              </div>

              <div>
                <span className="student-record-legend-rating incomplete">
                  4.00
                </span>

                <div>
                  <strong>Incomplete</strong>

                  <p>Subject remains a retake candidate.</p>
                </div>
              </div>

              <div>
                <span className="student-record-legend-rating failed">
                  5.00
                </span>

                <div>
                  <strong>Failed</strong>

                  <p>
                    Subject must be retaken according to enrollment eligibility
                    rules.
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        {!loading && !error && records.length > 0 && (
          <section className="student-record-footer">
            <div>
              <strong>Official Academic History</strong>

              <p>
                This page combines official PTC grades and official transfer
                credits. Transfer source grades remain external and are not
                stored as PTC Final Ratings. Both sources may satisfy curriculum
                and future enrollment requirements when officially completed.
              </p>
            </div>

            <div className="student-record-footer-stat">
              <span>Total Recorded Units</span>

              <strong>{summary.totalRecordedUnits}</strong>

              {summary.transferCreditedUnits > 0 && (
                <small>
                  {summary.transferCreditedUnits} transfer-credit unit
                  {summary.transferCreditedUnits === 1 ? "" : "s"}
                </small>
              )}
            </div>
          </section>
        )}
      </main>
    </DashboardLayout>
  );
}
