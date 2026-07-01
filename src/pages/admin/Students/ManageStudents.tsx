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
      <div className="admin-manage-students">
        <h1>Add / Edit Students</h1>
        <p>This page is under construction.</p>
      </div>
    </DashboardLayout>
  );
}
