import { useMemo, useState } from "react";
import "../../../styles/enrollmentExplorer.css";

interface Student {
  student_id: number;
  student_number: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  gender: string;
  birth_date: string;
  contact_number: string;
  year_level: number;
  course_code: string;
  course_name: string;
  section_name: string;
  academic_year: string;
  admission_date: string;
}

interface Props {
  students: Student[];
  onStudentClick: (student: Student) => void;
}

type GroupedData = Record<string, Record<number, Record<string, Student[]>>>;

export default function EnrollmentExplorer({
  students,
  onStudentClick,
}: Props) {
  const [expandedCourses, setExpandedCourses] = useState<Record<string, boolean>>({});
  const [expandedYears, setExpandedYears] = useState<Record<string, boolean>>({});
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const groupedData = useMemo<GroupedData>(() => {
    return students.reduce<GroupedData>((courses, student) => {
      if (!courses[student.course_code]) {
        courses[student.course_code] = {};
      }

      if (!courses[student.course_code][student.year_level]) {
        courses[student.course_code][student.year_level] = {};
      }

      if (!courses[student.course_code][student.year_level][student.section_name]) {
        courses[student.course_code][student.year_level][student.section_name] = [];
      }

      courses[student.course_code][student.year_level][student.section_name].push(student);
      return courses;
    }, {});
  }, [students]);

  function toggleCourse(course: string) {
    setExpandedCourses((prev) => ({
      ...prev,
      [course]: !prev[course],
    }));
  }

  function toggleYear(key: string) {
    setExpandedYears((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }

  function toggleSection(key: string) {
    setExpandedSections((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }

  return (
    <div className="explorer">
      {Object.entries(groupedData).map(([course, yearMap]) => {
        const courseKey = `course-${course}`;
        const isCourseExpanded = expandedCourses[courseKey] ?? false;

        return (
          <div key={courseKey} className="explorer-folder">
            <button
              type="button"
              className="folder-item folder-title"
              onClick={() => toggleCourse(courseKey)}
            >
              <span className="tree-arrow">{isCourseExpanded ? "▾" : "▸"}</span>
              <span>📁 {course}</span>
            </button>

            {isCourseExpanded && (
              <div className="folder-content">
                {Object.entries(yearMap).map(([year, sectionMap]) => {
                  const yearKey = `${courseKey}-year-${year}`;
                  const isYearExpanded = expandedYears[yearKey] ?? false;

                  return (
                    <div key={yearKey} className="explorer-year">
                      <button
                        type="button"
                        className="folder-item folder-subtitle"
                        onClick={() => toggleYear(yearKey)}
                      >
                        <span className="tree-arrow">{isYearExpanded ? "▾" : "▸"}</span>
                        <span>📂 Year {year}</span>
                      </button>

                      {isYearExpanded && (
                        <div className="folder-content">
                          {Object.entries(sectionMap).map(([section, sectionStudents]) => {
                            const sectionKey = `${yearKey}-section-${section}`;
                            const isSectionExpanded = expandedSections[sectionKey] ?? false;

                            return (
                              <div key={sectionKey} className="explorer-section">
                                <button
                                  type="button"
                                  className="folder-item folder-subtitle"
                                  onClick={() => toggleSection(sectionKey)}
                                >
                                  <span className="tree-arrow">{isSectionExpanded ? "▾" : "▸"}</span>
                                  <span>📍 {section}</span>
                                </button>

                                {isSectionExpanded && (
                                  <div className="folder-content">
                                    {sectionStudents.map((student) => (
                                      <button
                                        key={student.student_id}
                                        type="button"
                                        className="folder-item explorer-student"
                                        onClick={() => onStudentClick(student)}
                                      >
                                        <span className="tree-arrow">•</span>
                                        <span>
                                          {student.student_number} - {student.first_name} {student.last_name}
                                        </span>
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
            )}
          </div>
        );
      })}
    </div>
  );
}