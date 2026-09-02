import { useEffect, useState } from "react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";

import Modal from "../../../components/modal";

import { authService } from "../../../services/auth.service";

import { useNavigate } from "react-router-dom";

import "../../../styles/addeditdrop.css";

// =====================================================
// API
// =====================================================

const API_BASE_URL = "http://localhost:3000/api/students";

// =====================================================
// TYPES
// =====================================================

type Student = {
  id: string;

  firstName: string;

  middleName: string;

  lastName: string;

  email: string;

  gender: string;

  birthDate: string;

  contactNumber: string;

  course: string;

  yearLevel: string;

  section: string;

  semesterId: string;
};

interface StudentListResponse {
  success?: boolean;

  data?: Student[];

  students?: Student[];

  message?: string;

  error?: string;
}

interface DeleteStudentResponse {
  success?: boolean;

  message?: string;

  error?: string;
}

// =====================================================
// COMPONENT
// =====================================================

export default function AddEditDrop() {
  const navigate = useNavigate();

  // =====================================================
  // AUTHENTICATION
  // =====================================================

  const user = authService.getSession();

  const token = authService.getToken();

  const userRole = user?.role;

  const authenticated = Boolean(user && token);

  // =====================================================
  // STATE
  // =====================================================

  const [students, setStudents] = useState<Student[]>([]);

  const [isLoading, setIsLoading] = useState(true);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);

  const [deletingStudentId, setDeletingStudentId] = useState<string | null>(
    null,
  );

  // =====================================================
  // AUTHORIZATION
  // =====================================================

  useEffect(() => {
    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (userRole !== "Admin") {
      if (userRole) {
        navigate(authService.getDashboardRoute(userRole), {
          replace: true,
        });
      } else {
        navigate("/login", {
          replace: true,
        });
      }
    }
  }, [authenticated, userRole, navigate]);

  // =====================================================
  // LOAD STUDENTS
  // =====================================================

  useEffect(() => {
    if (!authenticated || userRole !== "Admin") {
      return;
    }

    const controller = new AbortController();

    const loadStudents = async () => {
      try {
        setIsLoading(true);

        setErrorMessage(null);

        // =================================================
        // JWT AUTHENTICATED GET
        // =================================================

        const response = await authService.authFetch(API_BASE_URL, {
          method: "GET",

          signal: controller.signal,

          headers: {
            Accept: "application/json",
          },
        });

        // =================================================
        // SAFE RESPONSE
        // =================================================

        const contentType = response.headers.get("content-type") || "";

        let data: Student[] | StudentListResponse | null = null;

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

        // =================================================
        // 401
        // =================================================

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        // =================================================
        // 403
        // =================================================

        if (response.status === 403) {
          const responseObject = !Array.isArray(data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              "You are not authorized to manage students.",
          );
        }

        // =================================================
        // HTTP ERROR
        // =================================================

        if (!response.ok) {
          const responseObject = !Array.isArray(data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              `Failed to load students (${response.status}).`,
          );
        }

        // =================================================
        // NORMALIZE RESPONSE
        //
        // Supports:
        //
        // [...]
        //
        // { students: [...] }
        //
        // { data: [...] }
        // =================================================

        let loadedStudents: Student[] = [];

        if (Array.isArray(data)) {
          loadedStudents = data;
        } else if (data && Array.isArray(data.students)) {
          loadedStudents = data.students;
        } else if (data && Array.isArray(data.data)) {
          loadedStudents = data.data;
        }

        setStudents(loadedStudents);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        console.error("LOAD ADMIN STUDENTS ERROR:", error);

        setStudents([]);

        if (error instanceof TypeError) {
          setErrorMessage(
            "Unable to connect to the student server. Make sure the backend is running on port 3000.",
          );

          return;
        }

        setErrorMessage(
          error instanceof Error ? error.message : "Failed to load students.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void loadStudents();

    return () => {
      controller.abort();
    };
  }, [authenticated, userRole, navigate]);

  // =====================================================
  // FILTER STUDENTS
  // =====================================================

  const filteredStudents = students.filter((student) => {
    const query = searchTerm.trim().toLowerCase();

    if (!query) {
      return true;
    }

    return (
      String(student.id || "")
        .toLowerCase()
        .includes(query) ||
      String(student.firstName || "")
        .toLowerCase()
        .includes(query) ||
      String(student.lastName || "")
        .toLowerCase()
        .includes(query)
    );
  });

  // =====================================================
  // NAVIGATION
  // =====================================================

  const goToAddStudent = () => {
    navigate("/admin/students/createstudents");
  };

  const goToEditStudent = (student: Student) => {
    navigate(`/admin/students/editstudents/${encodeURIComponent(student.id)}`);
  };

  // =====================================================
  // DELETE CONFIRMATION
  // =====================================================

  const confirmDeleteStudent = (student: Student) => {
    setDeleteTarget(student);

    setErrorMessage(null);
  };

  const cancelDelete = () => {
    if (deletingStudentId) {
      return;
    }

    setDeleteTarget(null);
  };

  // =====================================================
  // DELETE STUDENT
  // =====================================================

  const deleteStudent = async () => {
    if (!deleteTarget) {
      return;
    }

    if (!authenticated || userRole !== "Admin") {
      setErrorMessage(
        "Your session has expired or you are not authorized to delete students.",
      );

      return;
    }

    const studentNumber = String(deleteTarget.id).trim();

    if (!studentNumber) {
      setErrorMessage("Invalid student ID.");

      return;
    }

    setErrorMessage(null);

    try {
      setDeletingStudentId(studentNumber);

      // =================================================
      // JWT AUTHENTICATED DELETE
      //
      // No Admin user_id / role_id is sent.
      // Backend authorization comes from req.user.
      // =================================================

      const response = await authService.authFetch(
        `${API_BASE_URL}/${encodeURIComponent(studentNumber)}`,
        {
          method: "DELETE",

          headers: {
            Accept: "application/json",
          },
        },
      );

      // =================================================
      // SAFE RESPONSE
      // =================================================

      const contentType = response.headers.get("content-type") || "";

      let data: DeleteStudentResponse | null = null;

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

      // =================================================
      // 401
      // =================================================

      if (response.status === 401) {
        authService.logout();

        navigate("/login", {
          replace: true,
        });

        return;
      }

      // =================================================
      // 403
      // =================================================

      if (response.status === 403) {
        throw new Error(
          data?.message ||
            data?.error ||
            "You are not authorized to delete students.",
        );
      }

      // =================================================
      // HTTP ERROR
      // =================================================

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to delete student (${response.status}).`,
        );
      }

      // =================================================
      // SUCCESS
      // =================================================

      setStudents((current) =>
        current.filter((student) => student.id !== studentNumber),
      );

      setDeleteTarget(null);
    } catch (error) {
      console.error("DELETE ADMIN STUDENT ERROR:", error);

      if (error instanceof TypeError) {
        setErrorMessage(
          "Unable to connect to the student server. Make sure the backend is running on port 3000.",
        );

        return;
      }

      setErrorMessage(
        error instanceof Error ? error.message : "Failed to delete student.",
      );
    } finally {
      setDeletingStudentId(null);
    }
  };

  // =====================================================
  // AUTH GUARD
  // =====================================================

  if (!authenticated || !user || userRole !== "Admin") {
    return null;
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <DashboardLayout>
      <div className="admin-addeditdrop-students">
        {/* =================================================
            HEADER
        ================================================= */}

        <div className="admin-manage-students__header">
          <h1>Add / Edit Students</h1>

          <button
            type="button"
            className="btn btn-primary"
            onClick={goToAddStudent}
          >
            + Add Student
          </button>
        </div>

        {/* =================================================
            ERROR
        ================================================= */}

        {errorMessage && (
          <p className="admin-manage-students__error">{errorMessage}</p>
        )}

        {/* =================================================
            SEARCH
        ================================================= */}

        <input
          type="text"
          placeholder="Search by ID or name..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          className="admin-manage-students__search"
        />

        {/* =================================================
            TABLE
        ================================================= */}

        <table className="admin-manage-students__table">
          <thead>
            <tr>
              <th>ID</th>

              <th>First Name</th>

              <th>Last Name</th>

              <th>Email</th>

              <th>Contact Number</th>

              <th>Course</th>

              <th>Year Level</th>

              <th>Section</th>

              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {/* =================================================
                LOADING
            ================================================= */}

            {isLoading ? (
              <tr>
                <td
                  colSpan={9}
                  style={{
                    textAlign: "center",
                  }}
                >
                  Loading students...
                </td>
              </tr>
            ) : filteredStudents.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  style={{
                    textAlign: "center",
                  }}
                >
                  No students found.
                </td>
              </tr>
            ) : (
              filteredStudents.map((student) => (
                <tr key={student.id}>
                  <td>{student.id}</td>

                  <td>{student.firstName}</td>

                  <td>{student.lastName}</td>

                  <td>{student.email}</td>

                  <td>{student.contactNumber || "—"}</td>

                  <td>{student.course}</td>

                  <td>{student.yearLevel}</td>

                  <td>{student.section}</td>

                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => goToEditStudent(student)}
                      disabled={deletingStudentId === student.id}
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => confirmDeleteStudent(student)}
                      disabled={deletingStudentId === student.id}
                    >
                      {deletingStudentId === student.id
                        ? "Deleting..."
                        : "Delete"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* =================================================
            DELETE CONFIRMATION MODAL
        ================================================= */}

        {deleteTarget && (
          <Modal isOpen={Boolean(deleteTarget)} onClose={cancelDelete}>
            <h2>Delete Student</h2>

            <p>
              Are you sure you want to delete{" "}
              <strong>
                {deleteTarget.firstName} {deleteTarget.lastName}
              </strong>
              ? This action cannot be undone.
            </p>

            <div className="admin-student-form__actions">
              <button
                type="button"
                className="btn"
                onClick={cancelDelete}
                disabled={Boolean(deletingStudentId)}
              >
                Cancel
              </button>

              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void deleteStudent()}
                disabled={Boolean(deletingStudentId)}
              >
                {deletingStudentId ? "Deleting..." : "Delete"}
              </button>
            </div>
          </Modal>
        )}
      </div>
    </DashboardLayout>
  );
}
