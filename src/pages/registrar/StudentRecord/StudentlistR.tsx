import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FileText,
  Filter,
  GraduationCap,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/RegistrarStudentlist.css";

const API_BASE_URL = "http://localhost:3000/api/registrar/students";

interface Student {
  student_id: number;
  student_number: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: string;
  birth_date: string;
  contact_number: string;
  email: string;
  course_id: number;
  course_code: string;
  year_level: number;
  section_id: number;
  section_name: string;
  semester_id: number;
  semester_name: string;
  status: string;
  house_no: string | null;
  street: string | null;
  barangay: string | null;
  city: string | null;
  province: string | null;
  zip_code: string | null;
}

interface StudentResponse {
  success: boolean;
  message?: string;
  error?: string;
  page: number;
  limit: number;
  count: number;
  totalStudents: number;
  totalPages: number;
  students: Student[];
}

interface Statistics {
  total: number;
  regular: number;
  executive: number;
  scholarship: number;
}

const getStudentInitials = (student: Student) => {
  const first = student.first_name?.trim().charAt(0) || "";
  const last = student.last_name?.trim().charAt(0) || "";
  return `${first}${last}`.toUpperCase() || "S";
};

const getStudentName = (student: Student) => {
  const middleInitial = student.middle_name?.trim()
    ? `${student.middle_name.trim().charAt(0)}.`
    : "";

  return [student.first_name, middleInitial, student.last_name]
    .filter(Boolean)
    .join(" ");
};

const getStatusClass = (status: string) =>
  (status || "unknown")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export default function StudentListR() {
  const navigate = useNavigate();

  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [students, setStudents] = useState<Student[]>([]);
  const [statistics, setStatistics] = useState<Statistics>({
    total: 0,
    regular: 0,
    executive: 0,
    scholarship: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedCourse, setSelectedCourse] = useState("All");
  const [selectedYear, setSelectedYear] = useState("All");
  const [selectedSection, setSelectedSection] = useState("All");

  const studentsPerPage = 10;
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Registrar") {
      if (user) {
        navigate(authService.getDashboardRoute(user.role), { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [authenticated, userRole, navigate, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setCurrentPage(1);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") {
      return;
    }

    const controller = new AbortController();

    const fetchStudents = async () => {
      try {
        setLoading(true);
        setError("");

        const params = new URLSearchParams();
        params.append("page", currentPage.toString());
        params.append("limit", studentsPerPage.toString());

        if (search) params.append("search", search);
        if (selectedCourse !== "All") params.append("course", selectedCourse);
        if (selectedYear !== "All") params.append("year", selectedYear);
        if (selectedSection !== "All") {
          params.append("section", selectedSection);
        }

        const response = await authService.authFetch(
          `${API_BASE_URL}?${params.toString()}`,
          {
            method: "GET",
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
        );

        let data: StudentResponse | null = null;
        const contentType = response.headers.get("content-type") || "";

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
              "You are not authorized to access student records.",
          );
        }

        if (!response.ok) {
          throw new Error(
            data?.message ||
              data?.error ||
              `Failed to load students (${response.status}).`,
          );
        }

        if (!data?.success) {
          throw new Error(data?.message || "Failed to load students.");
        }

        const studentData = Array.isArray(data.students) ? data.students : [];

        setStudents(studentData);
        setTotalPages(Math.max(data.totalPages || 1, 1));

        let regular = 0;
        let executive = 0;
        let scholarship = 0;

        studentData.forEach((student) => {
          const course = (student.course_code || "").toLowerCase();

          if (course.includes("executive")) {
            executive += 1;
          } else if (course.includes("scholar")) {
            scholarship += 1;
          } else {
            regular += 1;
          }
        });

        setStatistics({
          total: data.totalStudents || 0,
          regular,
          executive,
          scholarship,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;

        console.error("GET REGISTRAR STUDENTS ERROR:", err);
        setStudents([]);
        setStatistics({ total: 0, regular: 0, executive: 0, scholarship: 0 });

        if (err instanceof TypeError) {
          setError(
            "Unable to connect to the student records server. Make sure the backend is running on port 3000.",
          );
          return;
        }

        setError(
          err instanceof Error ? err.message : "Unable to load student records.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void fetchStudents();

    return () => controller.abort();
  }, [
    authenticated,
    userRole,
    currentPage,
    search,
    selectedCourse,
    selectedYear,
    selectedSection,
    navigate,
  ]);

  const courseOptions = useMemo(
    () => [
      "All",
      ...new Set(students.map((student) => student.course_code).filter(Boolean)),
    ],
    [students],
  );

  const yearOptions = useMemo(
    () => [
      "All",
      ...new Set(
        students
          .map((student) => student.year_level?.toString())
          .filter(Boolean) as string[],
      ),
    ],
    [students],
  );

  const sectionOptions = useMemo(
    () => [
      "All",
      ...new Set(
        students.map((student) => student.section_name).filter(Boolean),
      ),
    ],
    [students],
  );

  const hasActiveFilters =
    Boolean(searchInput.trim()) ||
    selectedCourse !== "All" ||
    selectedYear !== "All" ||
    selectedSection !== "All";

  const startRecord = students.length
    ? (currentPage - 1) * studentsPerPage + 1
    : 0;
  const endRecord = students.length
    ? startRecord + students.length - 1
    : 0;

  const visiblePages = useMemo(() => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
    return Array.from({ length: 5 }, (_, index) => start + index);
  }, [currentPage, totalPages]);

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setSelectedCourse("All");
    setSelectedYear("All");
    setSelectedSection("All");
    setCurrentPage(1);
  };

  if (!authenticated || !user || userRole !== "Registrar") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="registrar-student-list">
        <section className="registrar-student-list__hero">
          <div className="registrar-student-list__hero-copy">
            <div className="registrar-student-list__eyebrow">
              <span className="registrar-student-list__eyebrow-icon">
                <UsersRound size={16} strokeWidth={2.2} />
              </span>
              Registrar · Student Records
            </div>

            <h1>Student List</h1>
            <p>
              View registered students, review their profiles, and access
              academic records and documents from one organized workspace.
            </p>
          </div>

          <div className="registrar-student-list__hero-badge">
            <span className="registrar-student-list__hero-badge-icon">
              <ShieldCheck size={18} />
            </span>
            <span>
              <small>Access</small>
              <strong>Registrar Records</strong>
            </span>
          </div>
        </section>

        <section className="registrar-student-list__stats" aria-label="Student statistics">
          <article className="registrar-student-list__stat-card">
            <div className="registrar-student-list__stat-icon registrar-student-list__stat-icon--primary">
              <UsersRound size={21} />
            </div>
            <div>
              <span>Total Students</span>
              <strong>{statistics.total.toLocaleString()}</strong>
              <small>All registered records</small>
            </div>
          </article>

          <article className="registrar-student-list__stat-card">
            <div className="registrar-student-list__stat-icon">
              <UserRound size={21} />
            </div>
            <div>
              <span>Regular</span>
              <strong>{statistics.regular.toLocaleString()}</strong>
              <small>On this result page</small>
            </div>
          </article>

          <article className="registrar-student-list__stat-card">
            <div className="registrar-student-list__stat-icon">
              <BookOpen size={21} />
            </div>
            <div>
              <span>Executive</span>
              <strong>{statistics.executive.toLocaleString()}</strong>
              <small>On this result page</small>
            </div>
          </article>

          <article className="registrar-student-list__stat-card">
            <div className="registrar-student-list__stat-icon">
              <GraduationCap size={21} />
            </div>
            <div>
              <span>Scholarship</span>
              <strong>{statistics.scholarship.toLocaleString()}</strong>
              <small>On this result page</small>
            </div>
          </article>
        </section>

        <section className="registrar-student-list__panel">
          <div className="registrar-student-list__panel-heading">
            <div>
              <h2>Student Directory</h2>
              <p>Search and filter student records before opening a profile.</p>
            </div>

            <div className="registrar-student-list__record-count">
              {loading ? "Loading records..." : `${statistics.total.toLocaleString()} total records`}
            </div>
          </div>

          <div className="registrar-student-list__toolbar">
            <label className="registrar-student-list__search">
              <Search size={19} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search by student number or name..."
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                aria-label="Search students"
              />
              {searchInput && (
                <button
                  type="button"
                  className="registrar-student-list__search-clear"
                  onClick={() => setSearchInput("")}
                  aria-label="Clear search"
                >
                  <X size={16} />
                </button>
              )}
            </label>

            <div className="registrar-student-list__filters">
              <span className="registrar-student-list__filter-label">
                <Filter size={16} />
                Filters
              </span>

              <select
                value={selectedCourse}
                onChange={(event) => {
                  setSelectedCourse(event.target.value);
                  setCurrentPage(1);
                }}
                aria-label="Filter by course"
              >
                {courseOptions.map((course) => (
                  <option key={course} value={course}>
                    {course === "All" ? "All Courses" : course}
                  </option>
                ))}
              </select>

              <select
                value={selectedYear}
                onChange={(event) => {
                  setSelectedYear(event.target.value);
                  setCurrentPage(1);
                }}
                aria-label="Filter by year"
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year === "All" ? "All Years" : `Year ${year}`}
                  </option>
                ))}
              </select>

              <select
                value={selectedSection}
                onChange={(event) => {
                  setSelectedSection(event.target.value);
                  setCurrentPage(1);
                }}
                aria-label="Filter by section"
              >
                {sectionOptions.map((section) => (
                  <option key={section} value={section}>
                    {section === "All" ? "All Sections" : section}
                  </option>
                ))}
              </select>

              {hasActiveFilters && (
                <button
                  type="button"
                  className="registrar-student-list__clear-filters"
                  onClick={clearFilters}
                >
                  <X size={15} />
                  Clear
                </button>
              )}
            </div>
          </div>

          {hasActiveFilters && !loading && !error && (
            <div className="registrar-student-list__filter-summary">
              Showing filtered student records
              {search && (
                <span>
                  Search: <strong>“{search}”</strong>
                </span>
              )}
              {selectedCourse !== "All" && <span>Course: {selectedCourse}</span>}
              {selectedYear !== "All" && <span>Year: {selectedYear}</span>}
              {selectedSection !== "All" && <span>Section: {selectedSection}</span>}
            </div>
          )}

          <div className="registrar-student-list__table-shell">
            <div className="registrar-student-list__table-scroll">
              <table className="registrar-student-list__table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Student No.</th>
                    <th>Course</th>
                    <th>Year</th>
                    <th>Section</th>
                    <th>Status</th>
                    <th className="registrar-student-list__actions-heading">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {loading &&
                    Array.from({ length: 5 }, (_, index) => (
                      <tr key={`student-skeleton-${index}`} className="registrar-student-list__skeleton-row">
                        <td>
                          <div className="registrar-student-list__student-cell">
                            <span className="registrar-student-list__skeleton registrar-student-list__skeleton--avatar" />
                            <div>
                              <span className="registrar-student-list__skeleton registrar-student-list__skeleton--name" />
                              <span className="registrar-student-list__skeleton registrar-student-list__skeleton--email" />
                            </div>
                          </div>
                        </td>
                        <td><span className="registrar-student-list__skeleton registrar-student-list__skeleton--text" /></td>
                        <td><span className="registrar-student-list__skeleton registrar-student-list__skeleton--short" /></td>
                        <td><span className="registrar-student-list__skeleton registrar-student-list__skeleton--short" /></td>
                        <td><span className="registrar-student-list__skeleton registrar-student-list__skeleton--text" /></td>
                        <td><span className="registrar-student-list__skeleton registrar-student-list__skeleton--badge" /></td>
                        <td><span className="registrar-student-list__skeleton registrar-student-list__skeleton--actions" /></td>
                      </tr>
                    ))}

                  {!loading && error && (
                    <tr>
                      <td colSpan={7}>
                        <div className="registrar-student-list__state registrar-student-list__state--error">
                          <div className="registrar-student-list__state-icon">!</div>
                          <h3>Student records could not be loaded</h3>
                          <p>{error}</p>
                        </div>
                      </td>
                    </tr>
                  )}

                  {!loading && !error && students.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <div className="registrar-student-list__state">
                          <div className="registrar-student-list__state-icon">
                            <Search size={24} />
                          </div>
                          <h3>No student records found</h3>
                          <p>
                            {hasActiveFilters
                              ? "Try changing your search or clearing one of the filters."
                              : "There are currently no student records available."}
                          </p>
                          {hasActiveFilters && (
                            <button type="button" onClick={clearFilters}>
                              Clear filters
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    !error &&
                    students.map((student) => (
                      <tr key={student.student_id}>
                        <td>
                          <div className="registrar-student-list__student-cell">
                            <div className="registrar-student-list__avatar" aria-hidden="true">
                              {getStudentInitials(student)}
                            </div>
                            <div className="registrar-student-list__student-copy">
                              <strong>{getStudentName(student)}</strong>
                              <span title={student.email}>{student.email || "No email address"}</span>
                            </div>
                          </div>
                        </td>

                        <td>
                          <span className="registrar-student-list__student-number">
                            {student.student_number}
                          </span>
                        </td>

                        <td>
                          <span className="registrar-student-list__course-chip">
                            {student.course_code || "—"}
                          </span>
                        </td>

                        <td>Year {student.year_level || "—"}</td>
                        <td>{student.section_name || "Not Assigned"}</td>

                        <td>
                          <span
                            className={`registrar-student-list__status registrar-student-list__status--${getStatusClass(
                              student.status,
                            )}`}
                          >
                            <span className="registrar-student-list__status-dot" />
                            {student.status || "Unknown"}
                          </span>
                        </td>

                        <td>
                          <div className="registrar-student-list__actions">
                            <button
                              type="button"
                              className="registrar-student-list__action registrar-student-list__action--primary"
                              onClick={() =>
                                navigate(
                                  `/registrar/student/DetailsR/${student.student_id}`,
                                )
                              }
                              title="View student profile"
                            >
                              <UserRound size={15} />
                              View
                            </button>

                            <button
                              type="button"
                              className="registrar-student-list__action"
                              onClick={() =>
                                navigate(
                                  `/registrar/student/${student.student_id}/AcadRecR`,
                                )
                              }
                              title="Open academic records"
                            >
                              <BookOpen size={15} />
                              Records
                            </button>

                            <button
                              type="button"
                              className="registrar-student-list__action"
                              onClick={() =>
                                navigate(
                                  `/registrar/student/${student.student_id}/DocumentsR`,
                                )
                              }
                              title="Open student documents"
                            >
                              <FileText size={15} />
                              Documents
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {!loading && !error && students.length > 0 && (
              <div className="registrar-student-list__pagination-bar">
                <p>
                  Showing <strong>{startRecord}</strong>–<strong>{endRecord}</strong> of{" "}
                  <strong>{statistics.total.toLocaleString()}</strong> students
                </p>

                <nav className="registrar-student-list__pagination" aria-label="Student list pagination">
                  <button
                    type="button"
                    className="registrar-student-list__page-btn registrar-student-list__page-btn--nav"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={17} />
                    <span>Previous</span>
                  </button>

                  <div className="registrar-student-list__page-numbers">
                    {visiblePages.map((page) => (
                      <button
                        type="button"
                        key={page}
                        className={`registrar-student-list__page-btn${
                          currentPage === page
                            ? " registrar-student-list__page-btn--active"
                            : ""
                        }`}
                        onClick={() => setCurrentPage(page)}
                        aria-current={currentPage === page ? "page" : undefined}
                      >
                        {page}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="registrar-student-list__page-btn registrar-student-list__page-btn--nav"
                    disabled={currentPage === totalPages}
                    onClick={() =>
                      setCurrentPage((page) => Math.min(totalPages, page + 1))
                    }
                    aria-label="Next page"
                  >
                    <span>Next</span>
                    <ChevronRight size={17} />
                  </button>
                </nav>
              </div>
            )}
          </div>
        </section>
      </main>
    </DashboardLayout>
  );
}
