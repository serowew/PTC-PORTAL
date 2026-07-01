import { useState, useMemo, type ChangeEvent, type FormEvent } from "react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import Modal from "../../../components/modal";
import { authService } from "../../../services/auth.service";
import { useNavigate } from "react-router-dom";

type Student = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  course: string;
  yearLevel: string;
  section: string;
};

// --- Reusable option sources -------------------------------------------

const COURSES = ["BSIT", "BSOA", "COA", "CSS"] as const;

const YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year"] as const;

// Maps "1st Year" -> "1", "2nd Year" -> "2", etc.
const yearLevelToDigit = (yearLevel: string): string => {
  const match = yearLevel.match(/^(\d+)/);
  return match ? match[1] : "";
};

// Generates ["BSIT-1A", "BSIT-1B", ..., "BSIT-1Z"] for a given course + year level.
// Returns [] if either course or yearLevel is not yet selected.
const generateSectionOptions = (course: string, yearLevel: string): string[] => {
  const yearDigit = yearLevelToDigit(yearLevel);
  if (!course || !yearDigit) return [];

  return Array.from({ length: 26 }, (_, index) => {
    const letter = String.fromCharCode(65 + index); // A-Z
    return `${course}-${yearDigit}${letter}`;
  });
};

// --- Seed data ------------------------------------------------------------

const initialStudents: Student[] = [
  {
    id: "23BSIT-0001",
    firstName: "LG",
    lastName: "Gabronino",
    email: "lgabronino@ptc.edu.ph",
    course: "BSIT",
    yearLevel: "1st Year",
    section: "BSIT-1A",
  },
  {
    id: "23BSIT-0002",
    firstName: "Andrew",
    lastName: "Emnil",
    email: "abemnil@ptc.edu.ph",
    course: "BSIT",
    yearLevel: "2nd Year",
    section: "BSIT-2A",
  },
  {
    id: "23BSIT-0003",
    firstName: "Ryan Paul",
    lastName: "Echon",
    email: "rpechon@ptc.edu.ph",
    course: "BSIT",
    yearLevel: "3rd Year",
    section: "BSIT-3A",
  },
];

const emptyForm = {
  firstName: "",
  lastName: "",
  email: "",
  course: "",
  yearLevel: "1st Year",
  section: "",
};

export default function ManageStudents() {
  const navigate = useNavigate();
  const user = authService.getSession();
  const [students, setStudents] = useState<Student[]>(initialStudents);
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [formState, setFormState] = useState<Omit<Student, "id">>(emptyForm);

  if (!user || user.role !== "admin") {
    navigate("/login");
    return null;
  }

  // Section options always derive from the currently selected course + year level.
  const sectionOptions = useMemo(
    () => generateSectionOptions(formState.course, formState.yearLevel),
    [formState.course, formState.yearLevel]
  );

  const filteredStudents = students.filter((student) => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return true;

    return (
      student.id.toLowerCase().includes(query) ||
      student.firstName.toLowerCase().includes(query) ||
      student.lastName.toLowerCase().includes(query)
    );
  });

  const openAddStudent = () => {
    setEditingStudent(null);
    setFormState(emptyForm);
    setIsModalOpen(true);
  };

  const openEditStudent = (student: Student) => {
    setEditingStudent(student);
    setFormState({
      firstName: student.firstName,
      lastName: student.lastName,
      email: student.email,
      course: student.course,
      yearLevel: student.yearLevel,
      section: student.section,
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingStudent(null);
    setFormState(emptyForm);
  };

  const handleInputChange = (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = event.target;

    setFormState((current) => {
      const updated = { ...current, [name]: value };

      // Whenever Course or Year Level changes, the list of valid sections
      // changes too, so re-validate the currently selected section.
      if (name === "course" || name === "yearLevel") {
        const validSections = generateSectionOptions(
          updated.course,
          updated.yearLevel
        );
        if (!validSections.includes(updated.section)) {
          updated.section = "";
        }
      }

      return updated;
    });
  };

  const handleSaveStudent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      !formState.firstName.trim() ||
      !formState.lastName.trim() ||
      !formState.email.trim() ||
      !formState.course.trim() ||
      !formState.yearLevel.trim() ||
      !formState.section.trim()
    ) {
      return;
    }

    if (editingStudent) {
      setStudents((current) =>
        current.map((student) =>
          student.id === editingStudent.id
            ? { ...student, ...formState }
            : student
        )
      );
    } else {
      const newStudent: Student = {
        id: `STU-${Math.floor(1000 + Math.random() * 9000)}`,
        ...formState,
      };
      setStudents((current) => [newStudent, ...current]);
    }

    closeModal();
  };

  const confirmDeleteStudent = (student: Student) => {
    setDeleteTarget(student);
  };

  const cancelDelete = () => {
    setDeleteTarget(null);
  };

  const deleteStudent = () => {
    if (!deleteTarget) return;
    setStudents((current) =>
      current.filter((student) => student.id !== deleteTarget.id)
    );
    setDeleteTarget(null);
  };

  return (
    <DashboardLayout>
      <div className="container-fluid py-4">
        <div className="d-flex flex-column flex-md-row justify-content-between align-items-start gap-3 mb-4">
          <div>
            <h1 className="h3 mb-2">Manage Students</h1>
            <p className="text-muted mb-0">
              View, add, edit, and remove student records in the portal.
            </p>
          </div>
          <button className="btn btn-primary px-4" onClick={openAddStudent}>
            Add Student
          </button>
        </div>

        <div className="card shadow-sm border-0 mb-4">
          <div className="card-body">
            <div className="row gy-3 gx-3 align-items-center">
              <div className="col-12 col-md-6">
                <div className="input-group">
                  <span className="input-group-text">Search</span>
                  <input
                    type="search"
                    className="form-control"
                    placeholder="Search by Student ID or Name"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                  />
                </div>
              </div>
              <div className="col-12 col-md-6 text-md-end">
                <small className="text-muted">
                  {filteredStudents.length} student(s) found
                </small>
              </div>
            </div>
          </div>
        </div>

        <div className="card shadow-sm border-0">
          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th scope="col">Student ID</th>
                    <th scope="col">First Name</th>
                    <th scope="col">Last Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Course</th>
                    <th scope="col">Year Level</th>
                    <th scope="col">Section</th>
                    <th scope="col" className="text-end">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.length ? (
                    filteredStudents.map((student) => (
                      <tr key={student.id}>
                        <td>{student.id}</td>
                        <td>{student.firstName}</td>
                        <td>{student.lastName}</td>
                        <td>{student.email}</td>
                        <td>{student.course}</td>
                        <td>{student.yearLevel}</td>
                        <td>{student.section}</td>
                        <td className="text-end">
                          <button
                            className="btn btn-sm btn-outline-primary me-2"
                            onClick={() => openEditStudent(student)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => confirmDeleteStudent(student)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="text-center py-4">
                        No students match your search criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <Modal isOpen={isModalOpen} onClose={closeModal}>
          <div className="p-3">
            <h2 className="h5 mb-3">
              {editingStudent ? "Edit Student" : "Add Student"}
            </h2>
            <form onSubmit={handleSaveStudent}>
              <div className="row g-3">
                <div className="col-12 col-md-6">
                  <label className="form-label">First Name</label>
                  <input
                    name="firstName"
                    value={formState.firstName}
                    onChange={handleInputChange}
                    className="form-control"
                    placeholder="Enter first name"
                  />
                </div>
                <div className="col-12 col-md-6">
                  <label className="form-label">Last Name</label>
                  <input
                    name="lastName"
                    value={formState.lastName}
                    onChange={handleInputChange}
                    className="form-control"
                    placeholder="Enter last name"
                  />
                </div>
                <div className="col-12">
                  <label className="form-label">Email</label>
                  <input
                    name="email"
                    type="email"
                    value={formState.email}
                    onChange={handleInputChange}
                    className="form-control"
                    placeholder="student@example.com"
                  />
                </div>

                <div className="col-12 col-md-4">
                  <label className="form-label">Course</label>
                  <select
                    name="course"
                    value={formState.course}
                    onChange={handleInputChange}
                    className="form-select"
                    required
                  >
                    <option value="">Select course</option>
                    {COURSES.map((course) => (
                      <option key={course} value={course}>
                        {course}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-12 col-md-4">
                  <label className="form-label">Year Level</label>
                  <select
                    name="yearLevel"
                    value={formState.yearLevel}
                    onChange={handleInputChange}
                    className="form-select"
                    required
                  >
                    {YEAR_LEVELS.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-12 col-md-4">
                  <label className="form-label">Section</label>
                  <select
                    name="section"
                    value={formState.section}
                    onChange={handleInputChange}
                    className="form-select"
                    required
                    disabled={sectionOptions.length === 0}
                  >
                    <option value="">
                      {sectionOptions.length === 0
                        ? "Select course & year first"
                        : "Select section"}
                    </option>
                    {sectionOptions.map((section) => (
                      <option key={section} value={section}>
                        {section}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="d-flex justify-content-end gap-2 mt-4">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingStudent ? "Save Changes" : "Add Student"}
                </button>
              </div>
            </form>
          </div>
        </Modal>

        <Modal isOpen={Boolean(deleteTarget)} onClose={cancelDelete}>
          <div className="p-3">
            <h2 className="h5 mb-3">Confirm Delete</h2>
            <p>
              Are you sure you want to delete student{' '}
              <strong>{deleteTarget?.firstName} {deleteTarget?.lastName}</strong>?
              This action cannot be undone.
            </p>
            <div className="d-flex justify-content-end gap-2 mt-4">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={cancelDelete}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={deleteStudent}
              >
                Delete
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </DashboardLayout>
  );
}
