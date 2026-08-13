import { useEffect, useState } from "react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { enrollmentService } from "../../../services/enrollment.service";
import StudentDetailsModal from "./StudentDetailsModal";
import EnrollmentExplorer from "./EnrollmentExplorer";

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

export default function EnrolledStudents() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  useEffect(() => {
    loadStudents();
  }, []);

  

  async function loadStudents() {
    try {
      const data = await enrollmentService.getEnrolledStudents();
      setStudents(data.students ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    } 
  }

 function handleView(student: Student) {
  setSelectedStudent(student);
  setModalOpen(true);
}
  

return (
  <>
    <DashboardLayout>
      <div className="pending-page">
        <div className="page-header">
          <h1>Enrolled Students</h1>

          <p>
            View all officially enrolled students.
          </p>
        </div>

        {loading ? (
          <p>Loading...</p>
        ) : students.length === 0 ? (
          <p>No enrolled students found.</p>
        ) : (
          <EnrollmentExplorer
            students={students}
            onStudentClick={handleView}
          />    
        )}
      </div>
    </DashboardLayout>

    <StudentDetailsModal
      open={modalOpen}
      student={selectedStudent}
      onClose={() => setModalOpen(false)}
    />
  </>
);
}