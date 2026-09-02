import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { useNavigate, useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  CircleAlert,
  Clock3,
  GraduationCap,
  Layers3,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import CurriculumSubjectModal from "./CurriculumSubjectModal";
import RemoveSubjectModal from "./RemoveSubjectModal";

import "../../../styles/CurriculumDetailR.css";

const API_BASE_URL = "http://localhost:3000/api/registrar/curriculums";

interface Curriculum {
  curriculum_id: number;
  course_id: number;
  course_code: string;
  course_name: string;
  curriculum_name: string;
  effective_year: number;
  total_units: number;
  is_active: number;
}

export interface CurriculumSubject {
  curriculum_subject_id: number;
  curriculum_id: number;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  units: number;
  lecture_hours: number;
  laboratory_hours: number;
  year_level: number;
  semester_id: number;
  semester_name: string;
  is_required: number;
  display_order: number;
}

interface CurriculumResponse {
  success: boolean;
  curriculum?: Curriculum;
  totalSubjects?: number;
  mappedUnits?: number;
  subjects?: CurriculumSubject[];
  message?: string;
  error?: string;
}

type SubjectTypeFilter = "all" | "required" | "elective";
type SemesterFilter = "all" | "1" | "2";

type YearFilter = "all" | string;

const getYearLabel = (year: number) => {
  if (year === 1) return "1st Year";
  if (year === 2) return "2nd Year";
  if (year === 3) return "3rd Year";
  if (year === 4) return "4th Year";
  return `Year ${year}`;
};

const getSemesterLabel = (semester: number, fallback?: string) => {
  if (semester === 1) return "1st Semester";
  if (semester === 2) return "2nd Semester";
  return fallback || `Semester ${semester}`;
};

const formatNumber = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

export default function CurriculumDetailR() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [subjects, setSubjects] = useState<CurriculumSubject[]>([]);
  const [totalSubjects, setTotalSubjects] = useState(0);
  const [mappedUnits, setMappedUnits] = useState(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<SubjectTypeFilter>("all");
  const [yearFilter, setYearFilter] = useState<YearFilter>("all");
  const [semesterFilter, setSemesterFilter] =
    useState<SemesterFilter>("all");

  const [subjectModalOpen, setSubjectModalOpen] = useState(false);
  const [subjectModalMode, setSubjectModalMode] = useState<"add" | "edit">(
    "add",
  );
  const [selectedSubject, setSelectedSubject] =
    useState<CurriculumSubject | null>(null);

  const [removeModalOpen, setRemoveModalOpen] = useState(false);
  const [subjectToRemove, setSubjectToRemove] =
    useState<CurriculumSubject | null>(null);

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

  const loadCurriculum = useCallback(
    async (showMainLoading = true) => {
      if (!authenticated || userRole !== "Registrar") return;

      if (!id) {
        setError("Invalid curriculum ID.");
        setLoading(false);
        return;
      }

      const curriculumId = Number(id);

      if (!Number.isInteger(curriculumId) || curriculumId <= 0) {
        setError("Invalid curriculum ID.");
        setLoading(false);
        return;
      }

      try {
        if (showMainLoading) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }

        setError("");

        const response = await authService.authFetch(
          `${API_BASE_URL}/${curriculumId}`,
          {
            method: "GET",
            headers: { Accept: "application/json" },
          },
        );

        const contentType = response.headers.get("content-type") || "";
        let data: CurriculumResponse | null = null;

        if (contentType.includes("application/json")) {
          data = await response.json();
        } else {
          const text = await response.text();
          throw new Error(
            `Server returned a non-JSON response (${response.status}): ${text.slice(
              0,
              200,
            )}`,
          );
        }

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          throw new Error(
            data?.message ||
              data?.error ||
              "You are not authorized to view this curriculum.",
          );
        }

        if (!response.ok) {
          throw new Error(
            data?.message ||
              data?.error ||
              `Failed to load curriculum details (${response.status}).`,
          );
        }

        if (!data?.success) {
          throw new Error(
            data?.message || "Failed to load curriculum details.",
          );
        }

        if (!data.curriculum) {
          setCurriculum(null);
          setSubjects([]);
          setTotalSubjects(0);
          setMappedUnits(0);
          return;
        }

        const loadedSubjects = Array.isArray(data.subjects)
          ? data.subjects
          : [];

        setCurriculum(data.curriculum);
        setSubjects(loadedSubjects);
        setTotalSubjects(Number(data.totalSubjects ?? loadedSubjects.length));
        setMappedUnits(Number(data.mappedUnits ?? 0));
      } catch (err) {
        console.error("LOAD CURRICULUM DETAILS ERROR:", err);

        if (err instanceof TypeError) {
          setError(
            "Unable to connect to the curriculum server. Make sure the backend is running on port 3000.",
          );
          return;
        }

        setError(
          err instanceof Error
            ? err.message
            : "Failed to load curriculum details.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id, authenticated, userRole, navigate],
  );

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") return;
    void loadCurriculum(true);
  }, [authenticated, userRole, loadCurriculum]);

  const metrics = useMemo(() => {
    const plannedUnits = Number(curriculum?.total_units ?? 0);
    const mapped = Number(mappedUnits || 0);
    const requiredCount = subjects.filter(
      (subject) => Number(subject.is_required) === 1,
    ).length;
    const electiveCount = subjects.length - requiredCount;
    const lectureHours = subjects.reduce(
      (sum, subject) => sum + Number(subject.lecture_hours || 0),
      0,
    );
    const laboratoryHours = subjects.reduce(
      (sum, subject) => sum + Number(subject.laboratory_hours || 0),
      0,
    );
    const mappingPercent =
      plannedUnits > 0 ? Math.round((mapped / plannedUnits) * 100) : 0;

    return {
      plannedUnits,
      mapped,
      requiredCount,
      electiveCount,
      lectureHours,
      laboratoryHours,
      mappingPercent,
      unitDifference: plannedUnits - mapped,
    };
  }, [curriculum, mappedUnits, subjects]);

  const availableYears = useMemo(
    () =>
      Array.from(
        new Set(subjects.map((subject) => Number(subject.year_level))),
      )
        .filter((year) => Number.isFinite(year) && year > 0)
        .sort((a, b) => a - b),
    [subjects],
  );

  const filteredSubjects = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return subjects.filter((subject) => {
      const matchesSearch =
        !query ||
        subject.subject_code.toLowerCase().includes(query) ||
        subject.subject_name.toLowerCase().includes(query);

      const matchesType =
        typeFilter === "all" ||
        (typeFilter === "required" && Number(subject.is_required) === 1) ||
        (typeFilter === "elective" && Number(subject.is_required) !== 1);

      const matchesYear =
        yearFilter === "all" ||
        Number(subject.year_level) === Number(yearFilter);

      const matchesSemester =
        semesterFilter === "all" ||
        Number(subject.semester_id) === Number(semesterFilter);

      return matchesSearch && matchesType && matchesYear && matchesSemester;
    });
  }, [subjects, searchTerm, typeFilter, yearFilter, semesterFilter]);

  const hasFilters =
    searchTerm.trim() !== "" ||
    typeFilter !== "all" ||
    yearFilter !== "all" ||
    semesterFilter !== "all";

  const clearFilters = () => {
    setSearchTerm("");
    setTypeFilter("all");
    setYearFilter("all");
    setSemesterFilter("all");
  };

  const handleAddSubject = () => {
    setSubjectModalMode("add");
    setSelectedSubject(null);
    setSubjectModalOpen(true);
  };

  const handleEditSubject = (subject: CurriculumSubject) => {
    setSubjectModalMode("edit");
    setSelectedSubject(subject);
    setSubjectModalOpen(true);
  };

  const handleCloseSubjectModal = () => {
    setSubjectModalOpen(false);
    setSelectedSubject(null);
  };

  const handleSubjectSuccess = async () => {
    setSubjectModalOpen(false);
    setSelectedSubject(null);
    await loadCurriculum(false);
  };

  const handleRemoveSubject = (subject: CurriculumSubject) => {
    setSubjectToRemove(subject);
    setRemoveModalOpen(true);
  };

  const handleCloseRemoveModal = () => {
    setRemoveModalOpen(false);
    setSubjectToRemove(null);
  };

  const handleRemoveSuccess = async () => {
    setRemoveModalOpen(false);
    setSubjectToRemove(null);
    await loadCurriculum(false);
  };

  if (!authenticated || !user || userRole !== "Registrar") return null;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="registrar-curriculum-details">
          <div className="registrar-curriculum-details__loading-shell">
            <div className="registrar-curriculum-details__skeleton registrar-curriculum-details__skeleton--hero" />
            <div className="registrar-curriculum-details__skeleton-grid">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  className="registrar-curriculum-details__skeleton registrar-curriculum-details__skeleton--card"
                  key={index}
                />
              ))}
            </div>
            <div className="registrar-curriculum-details__skeleton registrar-curriculum-details__skeleton--table" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="registrar-curriculum-details">
          <div className="registrar-curriculum-details__state-card registrar-curriculum-details__state-card--error">
            <div className="registrar-curriculum-details__state-icon">
              <CircleAlert size={24} />
            </div>
            <h2>Unable to load curriculum</h2>
            <p>{error}</p>
            <div className="registrar-curriculum-details__state-actions">
              <button
                type="button"
                className="registrar-curriculum-details__button registrar-curriculum-details__button--secondary"
                onClick={() => navigate("/registrar/curriculum/management")}
              >
                <ArrowLeft size={16} />
                Back to Curriculums
              </button>
              <button
                type="button"
                className="registrar-curriculum-details__button registrar-curriculum-details__button--primary"
                onClick={() => void loadCurriculum(true)}
              >
                <RefreshCw size={16} />
                Try Again
              </button>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!curriculum) {
    return (
      <DashboardLayout>
        <div className="registrar-curriculum-details">
          <div className="registrar-curriculum-details__state-card">
            <div className="registrar-curriculum-details__state-icon">
              <BookOpen size={24} />
            </div>
            <h2>Curriculum not found</h2>
            <p>The requested curriculum could not be found.</p>
            <button
              type="button"
              className="registrar-curriculum-details__button registrar-curriculum-details__button--primary"
              onClick={() => navigate("/registrar/curriculum/management")}
            >
              <ArrowLeft size={16} />
              Back to Curriculums
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const mappingTone =
    metrics.unitDifference === 0
      ? "complete"
      : metrics.unitDifference > 0
        ? "pending"
        : "over";

  return (
    <DashboardLayout>
      <div className="registrar-curriculum-details">
        <section className="registrar-curriculum-details__hero">
          <div className="registrar-curriculum-details__hero-copy">
            <button
              type="button"
              className="registrar-curriculum-details__back"
              onClick={() => navigate("/registrar/curriculum/management")}
            >
              <ArrowLeft size={16} />
              Curriculum Management
            </button>

            <div className="registrar-curriculum-details__eyebrow">
              <GraduationCap size={15} />
              Registrar · Curriculum Details
            </div>

            <div className="registrar-curriculum-details__title-row">
              <div>
                <h1>{curriculum.curriculum_name}</h1>
                <p>
                  <strong>{curriculum.course_code}</strong>
                  <span aria-hidden="true">·</span>
                  {curriculum.course_name}
                </p>
              </div>

              <span
                className={`registrar-curriculum-details__status ${
                  curriculum.is_active === 1
                    ? "registrar-curriculum-details__status--active"
                    : "registrar-curriculum-details__status--inactive"
                }`}
              >
                <span className="registrar-curriculum-details__status-dot" />
                {curriculum.is_active === 1 ? "Active" : "Inactive"}
              </span>
            </div>
          </div>

          <div className="registrar-curriculum-details__hero-actions">
            <button
              type="button"
              className="registrar-curriculum-details__button registrar-curriculum-details__button--secondary"
              onClick={() => void loadCurriculum(false)}
              disabled={refreshing}
            >
              <RefreshCw
                size={16}
                className={refreshing ? "is-spinning" : undefined}
              />
              {refreshing ? "Refreshing" : "Refresh"}
            </button>

            <button
              type="button"
              className="registrar-curriculum-details__button registrar-curriculum-details__button--primary"
              onClick={handleAddSubject}
            >
              <Plus size={17} />
              Add Subject
            </button>
          </div>
        </section>

        <section className="registrar-curriculum-details__summary-grid">
          <article className="registrar-curriculum-details__summary-card">
            <div className="registrar-curriculum-details__summary-icon">
              <Layers3 size={19} />
            </div>
            <div>
              <span>Planned Units</span>
              <strong>{formatNumber(metrics.plannedUnits)}</strong>
              <small>Curriculum target</small>
            </div>
          </article>

          <article className="registrar-curriculum-details__summary-card">
            <div className="registrar-curriculum-details__summary-icon">
              <CheckCircle2 size={19} />
            </div>
            <div>
              <span>Mapped Units</span>
              <strong>{formatNumber(metrics.mapped)}</strong>
              <small>{metrics.mappingPercent}% of planned units</small>
            </div>
          </article>

          <article className="registrar-curriculum-details__summary-card">
            <div className="registrar-curriculum-details__summary-icon">
              <BookOpen size={19} />
            </div>
            <div>
              <span>Mapped Subjects</span>
              <strong>{totalSubjects}</strong>
              <small>Subjects in this curriculum</small>
            </div>
          </article>

          <article className="registrar-curriculum-details__summary-card">
            <div className="registrar-curriculum-details__summary-icon">
              <Clock3 size={19} />
            </div>
            <div>
              <span>Subject Mix</span>
              <strong>
                {metrics.requiredCount} / {metrics.electiveCount}
              </strong>
              <small>Required / elective</small>
            </div>
          </article>
        </section>

        <section className="registrar-curriculum-details__audit-card">
          <div className="registrar-curriculum-details__audit-heading">
            <div>
              <span className="registrar-curriculum-details__section-kicker">
                Curriculum audit
              </span>
              <h2>Mapping overview</h2>
              <p>
                Review unit alignment and workload before using this curriculum
                for student enrollment and class preparation.
              </p>
            </div>

            <span
              className={`registrar-curriculum-details__mapping-badge registrar-curriculum-details__mapping-badge--${mappingTone}`}
            >
              {metrics.unitDifference === 0
                ? "Units aligned"
                : metrics.unitDifference > 0
                  ? `${formatNumber(metrics.unitDifference)} units remaining`
                  : `${formatNumber(Math.abs(metrics.unitDifference))} units over target`}
            </span>
          </div>

          <div className="registrar-curriculum-details__audit-grid">
            <div className="registrar-curriculum-details__audit-item">
              <span>Effective Year</span>
              <strong>{curriculum.effective_year}</strong>
            </div>
            <div className="registrar-curriculum-details__audit-item">
              <span>Lecture Hours</span>
              <strong>{formatNumber(metrics.lectureHours)}</strong>
            </div>
            <div className="registrar-curriculum-details__audit-item">
              <span>Laboratory Hours</span>
              <strong>{formatNumber(metrics.laboratoryHours)}</strong>
            </div>
            <div className="registrar-curriculum-details__audit-item">
              <span>Years Represented</span>
              <strong>{availableYears.length}</strong>
            </div>
          </div>

          <div className="registrar-curriculum-details__progress-track">
            <div
              className={`registrar-curriculum-details__progress-fill registrar-curriculum-details__progress-fill--${mappingTone}`}
              style={{ width: `${Math.min(Math.max(metrics.mappingPercent, 0), 100)}%` }}
            />
          </div>
        </section>

        <section className="registrar-curriculum-details__subjects-card">
          <div className="registrar-curriculum-details__subjects-header">
            <div>
              <span className="registrar-curriculum-details__section-kicker">
                Curriculum subjects
              </span>
              <h2>Subject plan</h2>
              <p>
                Review the subjects mapped to each year and semester, then edit
                placement or workload details when needed.
              </p>
            </div>

            <div className="registrar-curriculum-details__subjects-count">
              {hasFilters ? `${filteredSubjects.length} matching` : `${totalSubjects} total`}
            </div>
          </div>

          {subjects.length > 0 && (
            <div className="registrar-curriculum-details__toolbar">
              <div className="registrar-curriculum-details__search-wrap">
                <Search size={17} />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search subject code or name"
                  aria-label="Search curriculum subjects"
                />
                {searchTerm && (
                  <button
                    type="button"
                    className="registrar-curriculum-details__search-clear"
                    onClick={() => setSearchTerm("")}
                    aria-label="Clear subject search"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>

              <select
                value={yearFilter}
                onChange={(event) => setYearFilter(event.target.value)}
                aria-label="Filter by year level"
              >
                <option value="all">All year levels</option>
                {availableYears.map((year) => (
                  <option value={year} key={year}>
                    {getYearLabel(year)}
                  </option>
                ))}
              </select>

              <select
                value={semesterFilter}
                onChange={(event) =>
                  setSemesterFilter(event.target.value as SemesterFilter)
                }
                aria-label="Filter by semester"
              >
                <option value="all">All semesters</option>
                <option value="1">1st Semester</option>
                <option value="2">2nd Semester</option>
              </select>

              <select
                value={typeFilter}
                onChange={(event) =>
                  setTypeFilter(event.target.value as SubjectTypeFilter)
                }
                aria-label="Filter by subject type"
              >
                <option value="all">All subject types</option>
                <option value="required">Required</option>
                <option value="elective">Elective</option>
              </select>

              {hasFilters && (
                <button
                  type="button"
                  className="registrar-curriculum-details__clear-filters"
                  onClick={clearFilters}
                >
                  <X size={15} />
                  Clear Filters
                </button>
              )}
            </div>
          )}

          {refreshing && (
            <div className="registrar-curriculum-details__refresh-strip">
              <RefreshCw size={14} className="is-spinning" />
              Updating curriculum data…
            </div>
          )}

          {subjects.length === 0 ? (
            <div className="registrar-curriculum-details__empty">
              <div className="registrar-curriculum-details__empty-icon">
                <BookOpen size={25} />
              </div>
              <h3>No subjects mapped yet</h3>
              <p>
                Start building this curriculum by assigning the first subject to
                a year level and semester.
              </p>
              <button
                type="button"
                className="registrar-curriculum-details__button registrar-curriculum-details__button--primary"
                onClick={handleAddSubject}
              >
                <Plus size={17} />
                Add First Subject
              </button>
            </div>
          ) : filteredSubjects.length === 0 ? (
            <div className="registrar-curriculum-details__empty registrar-curriculum-details__empty--compact">
              <div className="registrar-curriculum-details__empty-icon">
                <Search size={24} />
              </div>
              <h3>No matching subjects</h3>
              <p>Try changing your search or curriculum filters.</p>
              <button
                type="button"
                className="registrar-curriculum-details__button registrar-curriculum-details__button--secondary"
                onClick={clearFilters}
              >
                <X size={16} />
                Clear Filters
              </button>
            </div>
          ) : (
            <div className="registrar-curriculum-details__years">
              {availableYears.map((year) => {
                const yearSubjects = filteredSubjects.filter(
                  (subject) => Number(subject.year_level) === year,
                );

                if (yearSubjects.length === 0) return null;

                const yearUnits = yearSubjects.reduce(
                  (sum, subject) => sum + Number(subject.units || 0),
                  0,
                );

                return (
                  <article
                    className="registrar-curriculum-details__year-card"
                    key={year}
                  >
                    <div className="registrar-curriculum-details__year-header">
                      <div>
                        <span>Academic level</span>
                        <h3>{getYearLabel(year)}</h3>
                      </div>
                      <div className="registrar-curriculum-details__year-meta">
                        <span>{yearSubjects.length} subjects</span>
                        <span>{formatNumber(yearUnits)} units</span>
                      </div>
                    </div>

                    {[1, 2].map((semester) => {
                      const semesterSubjects = yearSubjects
                        .filter(
                          (subject) =>
                            Number(subject.semester_id) === semester,
                        )
                        .sort(
                          (a, b) =>
                            Number(a.display_order) - Number(b.display_order),
                        );

                      if (semesterSubjects.length === 0) return null;

                      const semesterUnits = semesterSubjects.reduce(
                        (sum, subject) => sum + Number(subject.units || 0),
                        0,
                      );

                      return (
                        <div
                          className="registrar-curriculum-details__semester"
                          key={`${year}-${semester}`}
                        >
                          <div className="registrar-curriculum-details__semester-header">
                            <div>
                              <h4>
                                {getSemesterLabel(
                                  semester,
                                  semesterSubjects[0]?.semester_name,
                                )}
                              </h4>
                              <span>
                                {semesterSubjects.length}{" "}
                                {semesterSubjects.length === 1
                                  ? "subject"
                                  : "subjects"}
                              </span>
                            </div>
                            <strong>{formatNumber(semesterUnits)} units</strong>
                          </div>

                          <div className="registrar-curriculum-details__table-wrap">
                            <table className="registrar-curriculum-details__table">
                              <thead>
                                <tr>
                                  <th>Order</th>
                                  <th>Subject</th>
                                  <th>Units</th>
                                  <th>Contact Hours</th>
                                  <th>Type</th>
                                  <th>Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {semesterSubjects.map((subject) => (
                                  <tr key={subject.curriculum_subject_id}>
                                    <td>
                                      <span className="registrar-curriculum-details__order-badge">
                                        {subject.display_order}
                                      </span>
                                    </td>
                                    <td>
                                      <div className="registrar-curriculum-details__subject-cell">
                                        <strong>{subject.subject_code}</strong>
                                        <span>{subject.subject_name}</span>
                                      </div>
                                    </td>
                                    <td>
                                      <strong className="registrar-curriculum-details__units-value">
                                        {formatNumber(Number(subject.units || 0))}
                                      </strong>
                                    </td>
                                    <td>
                                      <div className="registrar-curriculum-details__hours-cell">
                                        <span>
                                          <strong>
                                            {formatNumber(
                                              Number(subject.lecture_hours || 0),
                                            )}
                                          </strong>{" "}
                                          Lec
                                        </span>
                                        <span>
                                          <strong>
                                            {formatNumber(
                                              Number(subject.laboratory_hours || 0),
                                            )}
                                          </strong>{" "}
                                          Lab
                                        </span>
                                      </div>
                                    </td>
                                    <td>
                                      <span
                                        className={`registrar-curriculum-details__type-badge ${
                                          Number(subject.is_required) === 1
                                            ? "registrar-curriculum-details__type-badge--required"
                                            : "registrar-curriculum-details__type-badge--elective"
                                        }`}
                                      >
                                        {Number(subject.is_required) === 1
                                          ? "Required"
                                          : "Elective"}
                                      </span>
                                    </td>
                                    <td>
                                      <div className="registrar-curriculum-details__row-actions">
                                        <button
                                          type="button"
                                          className="registrar-curriculum-details__icon-button registrar-curriculum-details__icon-button--edit"
                                          onClick={() =>
                                            handleEditSubject(subject)
                                          }
                                          aria-label={`Edit ${subject.subject_code}`}
                                          title="Edit curriculum mapping"
                                        >
                                          <Pencil size={15} />
                                          <span>Edit</span>
                                        </button>
                                        <button
                                          type="button"
                                          className="registrar-curriculum-details__icon-button registrar-curriculum-details__icon-button--remove"
                                          onClick={() =>
                                            handleRemoveSubject(subject)
                                          }
                                          aria-label={`Remove ${subject.subject_code}`}
                                          title="Remove from curriculum"
                                        >
                                          <Trash2 size={15} />
                                          <span>Remove</span>
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <CurriculumSubjectModal
        isOpen={subjectModalOpen}
        mode={subjectModalMode}
        curriculumId={curriculum.curriculum_id}
        subject={selectedSubject}
        onClose={handleCloseSubjectModal}
        onSuccess={handleSubjectSuccess}
      />

      <RemoveSubjectModal
        isOpen={removeModalOpen}
        curriculumId={curriculum.curriculum_id}
        subject={subjectToRemove}
        onClose={handleCloseRemoveModal}
        onSuccess={handleRemoveSuccess}
      />
    </DashboardLayout>
  );
}
