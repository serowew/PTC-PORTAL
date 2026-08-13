import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/RegistrarStudentlist.css";

// =====================================================
// API
// =====================================================

const API_BASE_URL = "http://localhost:3000/api/registrar/students";

// =====================================================
// TYPES
// =====================================================

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

// =====================================================
// COMPONENT
// =====================================================

export default function StudentListR() {
  const navigate = useNavigate();
  const user = authService.getSession();

  // =====================================================
  // STATES
  // =====================================================

  const [students, setStudents] = useState<Student[]>([]);
  const [statistics, setStatistics] = useState<Statistics>({
    total: 0,
    regular: 0,
    executive: 0,
    scholarship: 0,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");

  const [selectedCourse, setSelectedCourse] = useState("All");
  const [selectedYear, setSelectedYear] = useState("All");
  const [selectedSection, setSelectedSection] = useState("All");

  const studentsPerPage = 10;

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // =====================================================
  // FETCH STUDENTS
  // =====================================================

  const fetchStudents = async () => {
    try {
      setLoading(true);
      setError("");

      const params = new URLSearchParams();

      params.append("page", currentPage.toString());
      params.append("limit", studentsPerPage.toString());

      if (search.trim()) {
        params.append("search", search.trim());
      }

      if (selectedCourse !== "All") {
        params.append("course", selectedCourse);
      }

      if (selectedYear !== "All") {
        params.append("year", selectedYear);
      }

      if (selectedSection !== "All") {
        params.append("section", selectedSection);
      }

      const response = await fetch(`${API_BASE_URL}?${params.toString()}`, {
        method: "GET",
      });

      const data: StudentResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to load students.");
      }

      setStudents(data.students);
      setTotalPages(data.totalPages);

      // =====================================================
      // COMPUTE STATISTICS
      // =====================================================

      let regular = 0;
      let executive = 0;
      let scholarship = 0;

      data.students.forEach((student) => {
        const course = student.course_code.toLowerCase();

        if (course.includes("executive")) {
          executive++;
        } else if (course.includes("scholar")) {
          scholarship++;
        } else {
          regular++;
        }
      });

      setStatistics({
        total: data.totalStudents,
        regular,
        executive,
        scholarship,
      });
    } catch (err) {
      console.error(err);

      setError("Unable to load student records.");
    } finally {
      setLoading(false);
    }
  };

  // =====================================================
  // LOAD DATA
  // =====================================================

  useEffect(() => {
    fetchStudents();
  }, [currentPage, search, selectedCourse, selectedYear, selectedSection]);

  // =====================================================
  // FILTER OPTIONS
  // =====================================================

  const courseOptions = useMemo(() => {
    return [
      "All",
      ...new Set(
        students.map((student) => student.course_code).filter(Boolean),
      ),
    ];
  }, [students]);

  const yearOptions = useMemo(() => {
    return [
      "All",
      ...new Set(students.map((student) => student.year_level.toString())),
    ];
  }, [students]);

  const sectionOptions = useMemo(() => {
    return [
      "All",
      ...new Set(
        students.map((student) => student.section_name).filter(Boolean),
      ),
    ];
  }, [students]);
  // =====================================================
  // SEARCH HANDLER
  // =====================================================

  const handleSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value);
    setCurrentPage(1);
  };

  // =====================================================
  // FILTER HANDLERS
  // =====================================================

  const handleCourseChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedCourse(event.target.value);
    setCurrentPage(1);
  };

  const handleYearChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedYear(event.target.value);
    setCurrentPage(1);
  };

  const handleSectionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedSection(event.target.value);
    setCurrentPage(1);
  };

  // =====================================================
  // PAGINATION
  // =====================================================

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage((prev) => prev - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage((prev) => prev + 1);
    }
  };

  // =====================================================
  // RENDER
  // =====================================================

  // Redirect AFTER all hooks are declared
  useEffect(() => {
    if (!user || user.role !== "Registrar") {
      navigate("/login");
    }
  }, [user, navigate]);

  if (!user || user.role !== "Registrar") {
    return null;
  }

  return (
    <DashboardLayout>
      <div className="registrar-listR-container">
        <div className="registrar-listR-header">
          <div>
            <h1>Student Records</h1>

            <p>
              Manage and view all registered students and their academic
              information.
            </p>
          </div>
        </div>

        <div className="registrar-listR-statistics">
          <div className="registrar-listR-card">
            <span>Total Students</span>
            <h2>{statistics.total}</h2>
          </div>

          <div className="registrar-listR-card">
            <span>Regular</span>
            <h2>{statistics.regular}</h2>
          </div>

          <div className="registrar-listR-card">
            <span>Executive</span>
            <h2>{statistics.executive}</h2>
          </div>

          <div className="registrar-listR-card">
            <span>Scholarship</span>
            <h2>{statistics.scholarship}</h2>
          </div>
        </div>

        <div className="registrar-listR-toolbar">
          <div className="registrar-listR-search">
            <input
              type="text"
              placeholder="Search student number or name..."
              value={search}
              onChange={handleSearch}
            />
          </div>

          <div className="registrar-listR-filters">
            {/* COURSE */}

            <select value={selectedCourse} onChange={handleCourseChange}>
              {courseOptions.map((course) => (
                <option key={course} value={course}>
                  {course}
                </option>
              ))}
            </select>

            {/* YEAR */}

            <select value={selectedYear} onChange={handleYearChange}>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year === "All" ? "All Years" : `Year ${year}`}
                </option>
              ))}
            </select>

            {/* SECTION */}

            <select value={selectedSection} onChange={handleSectionChange}>
              {sectionOptions.map((section) => (
                <option key={section} value={section}>
                  {section === "All" ? "All Sections" : section}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="registrar-listR-table-wrapper">
          <div className="student-table-container">
            <table className="student-table">
              <thead>
                <tr>
                  <th>ID</th>

                  <th>Student Name</th>

                  <th>Student No.</th>

                  <th>Course</th>

                  <th>Year</th>

                  <th>Section</th>

                  <th>Status</th>

                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8} className="table-message">
                      Loading student records...
                    </td>
                  </tr>
                )}

                {!loading && error && (
                  <tr>
                    <td colSpan={8} className="table-message error">
                      {error}
                    </td>
                  </tr>
                )}

                {!loading && !error && students.length === 0 && (
                  <tr>
                    <td colSpan={8} className="table-message">
                      No student records found.
                    </td>
                  </tr>
                )}
                {!loading &&
                  !error &&
                  students.map((student) => (
                    <tr key={student.student_id}>
                      <td>{student.student_id}</td>

                      <td>
                        <div className="student-info">
                          <div className="student-avatar">
                            {student.first_name.charAt(0)}
                          </div>

                          <div>
                            <strong>
                              {student.first_name}{" "}
                              {student.middle_name
                                ? `${student.middle_name.charAt(0)}. `
                                : ""}
                              {student.last_name}
                            </strong>

                            <small>{student.email}</small>
                          </div>
                        </div>
                      </td>

                      <td>{student.student_number}</td>

                      <td>{student.course_code}</td>

                      <td>Year {student.year_level}</td>

                      <td>{student.section_name}</td>

                      <td>
                        <span
                          className={`status ${student.status
                            .toLowerCase()
                            .replace(/\s+/g, "-")}`}
                        >
                          {student.status}
                        </span>
                      </td>

                      <td>
                        <div className="action-buttons">
                          {/* Student Profile */}

                          <button
                            className="view-btn"
                            onClick={() =>
                              navigate(
                                `/registrar/student/DetailsR/${student.student_id}`,
                              )
                            }
                          >
                            View
                          </button>

                          {/* Academic Records */}

                          <button
                            className="record-btn"
                            onClick={() =>
                              navigate(
                                `/registrar/student/${student.student_id}/AcadRecR`,
                              )
                            }
                          >
                            Records
                          </button>

                          {/* Documents */}

                          <button
                            className="document-btn"
                            onClick={() =>
                              navigate(
                                `/registrar/student/${student.student_id}/DocumentsR`,
                              )
                            }
                          >
                            Documents
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="registrar-listR-pagination">
          <button
            className="pagination-btn"
            disabled={currentPage === 1}
            onClick={handlePreviousPage}
          >
            Previous
          </button>

          <div className="page-numbers">
            {Array.from({ length: totalPages }, (_, index) => index + 1).map(
              (page) => (
                <button
                  key={page}
                  className={
                    currentPage === page
                      ? "pagination-btn active-page"
                      : "pagination-btn"
                  }
                  onClick={() => setCurrentPage(page)}
                >
                  {page}
                </button>
              ),
            )}
          </div>

          <button
            className="pagination-btn"
            disabled={currentPage === totalPages}
            onClick={handleNextPage}
          >
            Next
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}
