const API_URL = "http://localhost:3000/api/enrollment";

export interface EnrollmentRequest {
  request_id: number;
  student_id_preview: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  suffix?: string;
  birth_date: string;
  sex: string;
  contact_number?: string;
  address?: string;
  course_code: string;
  course_name: string;
  section_name: string;
  academic_year: string;
  year_level: number;
  enrollment_type: string;
  cor_number?: string;
  cor_json?: unknown;
  submitted_at: string;
  status: string;
}

export interface PendingRequest {
  request_id: number;
  student_id_preview: string;
  first_name: string;
  last_name: string;
  course_code: string;
  section_name: string;
  year_level: number;
  status: string;
  submitted_at: string;
}

export interface ResubmitRequest {
  first_name: string;
  middle_name: string;
  last_name: string;
}

class EnrollmentService {

  // ==========================
  // Pending Requests
  // ==========================

  async getPendingRequests(): Promise<{ requests: PendingRequest[] }> {
    const response = await fetch(`${API_URL}/requests`);

    if (!response.ok) {
      throw new Error("Failed to fetch pending requests.");
    }

    return response.json();
  }

// ==========================
// Return Request to Registrar
// ==========================

async modifyEnrollmentRequest(
  id: number,
  reason: string
) {
  const response = await fetch(
    `${API_URL}/modify/${id}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reason,
      }),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to return request.");
  }

  return response.json();
}

  async getEnrollmentRequest(id: number): Promise<{ data: EnrollmentRequest }> {
    const response = await fetch(`${API_URL}/requests/${id}`);

    if (!response.ok) {
      throw new Error("Failed to fetch request.");
    }

    return response.json();
  }

  async getEnrolledStudents() {
  const response = await fetch(`${API_URL}/students`);

  if (!response.ok) {
    throw new Error("Failed to fetch enrolled students.");
  }

  return response.json();
}

async getCourses() {
  const response = await fetch(`${API_URL}/courses`);

  if (!response.ok) {
    throw new Error("Failed to fetch courses.");
  }

  return response.json();
}

async getAcademicYears() {
  const response = await fetch(`${API_URL}/academic-years`);

  if (!response.ok) {
    throw new Error("Failed to fetch academic years.");
  }

  return response.json();
}

async getMyRequests(registrarId: number) {
  const response = await fetch(
    `${API_URL}/my-requests/${registrarId}`
  );

  if (!response.ok) {
    throw new Error("Failed to fetch requests.");
  }

  return response.json();
}

async resubmitRequest(
  id: number,
  data: ResubmitRequest
){

const response=await fetch(

`${API_URL}/resubmit/${id}`,

{

method:"PATCH",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify(data)

}

);

if(!response.ok){

throw new Error("Failed to resubmit.");

}

return response.json();

}

async getStudentPreview(
  courseId: number,
  academicYear: string
) {
  const response = await fetch(
    `${API_URL}/preview?courseId=${courseId}&academicYear=${academicYear}`
  );

  if (!response.ok) {
    throw new Error("Failed to generate preview.");
  }

  return response.json();
}


async submitEnrollment(data: {

    student_id_preview: string;

    first_name: string;
    middle_name: string;
    last_name: string;
    suffix: string;

    birth_date: string;
    sex: string;

    contact_number: string;
    address: string;

    course_id: number;
    academic_year_id: number;
    year_level: number;

    enrollment_type: string;

    cor_number: string;

    submitted_by: number;

}) {

    const response = await fetch(
        `${API_URL}/request`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        }
    );

    if (!response.ok) {
        throw new Error("Failed to submit enrollment.");
    }

    return response.json();

}

async approveEnrollment(
  requestId: number,
  approvedBy: number
) {
  const response = await fetch(
    `${API_URL}/approve/${requestId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        approved_by: approvedBy
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.message || "Failed to approve enrollment."
    );
  }

  return data;
}

}

export const enrollmentService = new EnrollmentService();