import { useState } from "react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { useNavigate } from "react-router-dom";
import "../../../styles/studentmanage.css";

// ---------- Types ----------
interface Student {
  id: string;
  name: string;
  studentNumber: string;
}

interface Section {
  id: string;
  label: string;
  students: Student[];
}

interface Course {
  id: string;
  label: string;
  sections: Section[];
}

interface YearFolder {
  id: string;
  label: string;
  courses: Course[];
}

// 🔽 Add new years, courses, or sections here — nothing else needs to change
const YEARS: YearFolder[] = [
  {
    id: "1st-year",
    label: "1st Year Students",
    courses: [
      {
        id: "bsit-1",
        label: "BS Information Technology",
        sections: [
          {
            id: "bsit-1a",
            label: "Section A",
            students: [
              { id: "s1", name: "Juan Dela Cruz", studentNumber: "2026-0001" },
              { id: "s2", name: "Maria Santos", studentNumber: "2026-0002" },
            ],
          },
          {
            id: "bsit-1b",
            label: "Section B",
            students: [
              { id: "s3", name: "Pedro Reyes", studentNumber: "2026-0003" },
            ],
          },
        ],
      },
      {
        id: "bscs-1",
        label: "BS Computer Science",
        sections: [
          {
            id: "bscs-1a",
            label: "Section A",
            students: [
              { id: "s4", name: "Ana Lopez", studentNumber: "2026-0004" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "2nd-year",
    label: "2nd Year Students",
    courses: [
      {
        id: "bsit-2",
        label: "BS Information Technology",
        sections: [
          {
            id: "bsit-2a",
            label: "Section A",
            students: [
              { id: "s5", name: "Carlos Ramos", studentNumber: "2025-0011" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "3rd-year",
    label: "3rd Year Students",
    courses: [
      {
        id: "bsit-3",
        label: "BS Information Technology",
        sections: [
          {
            id: "bsit-3a",
            label: "Section A",
            students: [
              { id: "s6", name: "Liza Cruz", studentNumber: "2024-0021" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "4th-year",
    label: "4th Year Students",
    courses: [
      {
        id: "bsit-4",
        label: "BS Information Technology",
        sections: [
          {
            id: "bsit-4a",
            label: "Section A",
            students: [
              { id: "s7", name: "Mark Villanueva", studentNumber: "2023-0031" },
            ],
          },
        ],
      },
    ],
  },
];

// ---------- Icons ----------
function FolderIcon({ open }: { open?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d={
          open
            ? "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3V7z M3 10h20l-2 9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2l-2-9z"
            : "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
        }
        fill="currentColor"
      />
    </svg>
  );
}

function ChevronIcon({ open }: { open?: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      className={`chevron ${open ? "open" : ""}`}
    >
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SectionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

// ---------- Component ----------
export default function ManageStudents() {
  const navigate = useNavigate();
  const user = authService.getSession();

  // Only ONE year can be open at a time
  const [expandedYearId, setExpandedYearId] = useState<string | null>(null);
  // Only ONE course can be open at a time (across the whole tree)
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  if (!user || user.role !== "admin") {
    navigate("/login");
    return null;
  }

  const toggleYear = (id: string) => {
    setExpandedYearId((prev) => (prev === id ? null : id));
    setExpandedCourseId(null); // collapse any open course when switching years
  };

  const toggleCourse = (id: string) => {
    setExpandedCourseId((prev) => (prev === id ? null : id));
  };

  // Find the active section object (across all years/courses) to display on the right
  const activeSection: Section | null = (() => {
    if (!activeSectionId) return null;
    for (const year of YEARS) {
      for (const course of year.courses) {
        const found = course.sections.find((s) => s.id === activeSectionId);
        if (found) return found;
      }
    }
    return null;
  })();

  return (
    <DashboardLayout>
      <div className="admin-manage-students">
        <h1>Student List</h1>

        <div className="file-explorer">
          {/* LEFT: Year > Course > Section tree */}
          <div className="folder-tree">
            {YEARS.map((year) => {
              const isYearExpanded = expandedYearId === year.id;

              return (
                <div key={year.id} className="folder-group">
                  <button
                    className="folder-row"
                    onClick={() => toggleYear(year.id)}
                    type="button"
                  >
                    <ChevronIcon open={isYearExpanded} />
                    <FolderIcon open={isYearExpanded} />
                    <span className="folder-label">{year.label}</span>
                  </button>

                  {isYearExpanded && (
                    <div className="folder-children">
                      {year.courses.map((course) => {
                        const isCourseExpanded = expandedCourseId === course.id;

                        return (
                          <div key={course.id} className="folder-group">
                            <button
                              className="folder-row sub-row"
                              onClick={() => toggleCourse(course.id)}
                              type="button"
                            >
                              <ChevronIcon open={isCourseExpanded} />
                              <FolderIcon open={isCourseExpanded} />
                              <span className="folder-label">{course.label}</span>
                            </button>

                            {isCourseExpanded && (
                              <div className="folder-children">
                                {course.sections.map((section) => (
                                  <button
                                    key={section.id}
                                    className={`folder-child-row ${
                                      activeSectionId === section.id ? "active" : ""
                                    }`}
                                    onClick={() => setActiveSectionId(section.id)}
                                    type="button"
                                  >
                                    <SectionIcon />
                                    <span>{section.label}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* RIGHT: Students of the selected section */}
          <div className="folder-content">
            {activeSection ? (
              <>
                <h2>{activeSection.label}</h2>
                {activeSection.students.length > 0 ? (
                  <table className="student-table">
                    <thead>
                      <tr>
                        <th>Student Number</th>
                        <th>Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeSection.students.map((student) => (
                        <tr key={student.id}>
                          <td>{student.studentNumber}</td>
                          <td>{student.name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p>No students in this section yet.</p>
                )}
              </>
            ) : (
              <p>Select a year, course, and section to view students.</p>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}