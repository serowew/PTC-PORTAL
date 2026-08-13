/* eslint-disable @typescript-eslint/no-unused-vars */
import { useEffect, useState } from "react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { enrollmentService } from "../../../services/enrollment.service";
import "../../../styles/newEnrollment.css";

interface Course {
  course_id: number;
  course_code: string;
  course_name: string;
}

interface AcademicYear {
  academic_year_id: number;
  academic_year: string;
}

export default function NewEnrollment() {
  // ==========================
  // Student Information
  // ==========================

  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [suffix, setSuffix] = useState("");

  const [birthDate, setBirthDate] = useState("");
  const [sex, setSex] = useState("");

  const [contactNumber, setContactNumber] = useState("");
  const [address, setAddress] = useState("");

  // ==========================
  // Academic Information
  // ==========================

  const [courses, setCourses] = useState<Course[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);

  const [courseId, setCourseId] = useState("");
  const [academicYearId, setAcademicYearId] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  const [yearLevel, setYearLevel] = useState(1);

  const [enrollmentType, setEnrollmentType] =
    useState("Regular");

  // ==========================
  // Preview
  // ==========================

  const [studentIdPreview, setStudentIdPreview] =
    useState("");

  const [sectionPreview, setSectionPreview] =
    useState("");

  // ==========================
  // COR
  // ==========================

  const [corNumber, setCorNumber] = useState("");

  const [corFile, setCorFile] =
    useState<File | null>(null);

  // ==========================
  // Loading
  // ==========================

  const [loading, setLoading] = useState(true);


useEffect(() => {

  if (!courseId || !academicYear) return;

  async function loadPreview() {

    try {

      const response =
        await enrollmentService.getStudentPreview(
          Number(courseId),
          academicYear
        );

      setStudentIdPreview(response.studentId);
      setSectionPreview(response.section);

    } catch (err) {
      console.error(err);
    }

  }

  loadPreview();

}, [courseId, academicYear]);

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
  try {
    const [courseData, yearData] = await Promise.all([
      enrollmentService.getCourses(),
      enrollmentService.getAcademicYears(),
    ]);

    setCourses(courseData.courses);
    setAcademicYears(yearData.academicYears);

  } catch (err) {
    console.error(err);
  } finally {
    setLoading(false);
  }
}

async function handleSubmit(
  e: React.FormEvent<HTMLFormElement>
) {

  e.preventDefault();

  try {

    await enrollmentService.submitEnrollment({

      student_id_preview: studentIdPreview,

      first_name: firstName,
      middle_name: middleName,
      last_name: lastName,
      suffix,

      birth_date: birthDate,
      sex,

      contact_number: contactNumber,
      address,

      course_id: Number(courseId),
      academic_year_id: Number(academicYearId),
      year_level: yearLevel,

      enrollment_type: enrollmentType,

      cor_number: corNumber,

      submitted_by: 1

    });

    alert("Enrollment request submitted successfully.");

  } catch (err) {

    console.error(err);
    alert("Failed to submit request.");

  }

}

  return (
    <DashboardLayout>

      <div className="enrollment-page">

        <div className="enrollment-title">

          <h1>New Enrollment</h1>

          <p>
            Create a new enrollment request for approval.
          </p>

        </div>

        {loading ? (

          <p>Loading...</p>

        ) : (

<form
  className="enrollment-form"
  onSubmit={handleSubmit}
>

  <div className="form-section">
<h2>Student Information</h2>

  <div className="form-grid">

    <div>
      <label>First Name</label>

      <input
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
      />
    </div>

    <div>
      <label>Middle Name</label>

      <input
        value={middleName}
        onChange={(e) => setMiddleName(e.target.value)}
      />
    </div>

    <div>
      <label>Last Name</label>

      <input
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
      />
    </div>

    <div>
      <label>Suffix</label>

      <input
        value={suffix}
        onChange={(e) => setSuffix(e.target.value)}
      />
    </div>

    <div>
      <label>Birth Date</label>

      <input
        type="date"
        value={birthDate}
        onChange={(e) => setBirthDate(e.target.value)}
      />
    </div>
</div>
    <div>
      <label>Sex</label>

      <select
        value={sex}
        onChange={(e) => setSex(e.target.value)}
      >
        <option value="">Select</option>
        <option value="Male">Male</option>
        <option value="Female">Female</option>
      </select>
    </div>

    <div>
      <label>Contact Number</label>

      <input
        value={contactNumber}
        onChange={(e) => setContactNumber(e.target.value)}
      />
    </div>

    <div style={{ gridColumn: "1 / -1" }}>
      <label>Address</label>

      <textarea
        rows={3}
        value={address}
        onChange={(e) => setAddress(e.target.value)}
      />
    </div>

  </div>

<hr />

<h2>Academic Information</h2>

<div className="form-grid">

  <div>
    <label>Course</label>

    <select
      value={courseId}
      onChange={(e) => {

    setCourseId(e.target.value);

}}
    >
      <option value="">Select Course</option>

      {courses.map(course => (
        <option
          key={course.course_id}
          value={course.course_id}
        >
          {course.course_code} - {course.course_name}
        </option>
      ))}

    </select>
  </div>

  <div>
    <label>Academic Year</label>

<select
  value={academicYearId}
  onChange={(e) => {
    const selected = academicYears.find(
      (year) => String(year.academic_year_id) === e.target.value
    );

    setAcademicYearId(e.target.value);
    setAcademicYear(selected?.academic_year ?? "");
  }}
>
  <option value="">Select Academic Year</option>

  {academicYears.map((year) => (
    <option
      key={year.academic_year_id}
      value={year.academic_year_id}
    >
      {year.academic_year}
    </option>
  ))}
</select>
  </div>

  <div>
    <label>Year Level</label>

    <select
      value={yearLevel}
      onChange={(e) =>
        setYearLevel(Number(e.target.value))
      }
    >
      <option value={1}>1st Year</option>
      <option value={2}>2nd Year</option>
      <option value={3}>3rd Year</option>
      <option value={4}>4th Year</option>
    </select>
  </div>

<div className="preview-card">

    <div className="preview-box">
        <span>Student ID</span>
        <h3>{studentIdPreview || "--"}</h3>
    </div>

    <div className="preview-box">
        <span>Assigned Section</span>
        <h3>{sectionPreview || "--"}</h3>
    </div>

</div>

  <div>
    <label>Enrollment Type</label>

    <select
      value={enrollmentType}
      onChange={(e) =>
        setEnrollmentType(e.target.value)
      }
    >
      <option>Regular</option>
      <option>Returning</option>
      <option>Transferee</option>
      <option>AWOL</option>
      <option>Irregular</option>
    </select>
  </div>

</div>

<hr />

<div className="submit-row">
    <button
        type="submit"
        className="submit-btn"
    >
        Submit Enrollment Request
    </button>
</div>

</form>



        )}

      </div>

    </DashboardLayout>
  );
}