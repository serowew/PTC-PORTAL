import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/RegistrarStudentDocument.css";

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

  email: string;

  course_code: string;
  year_level: number;
  section_name: string;
  semester_name: string;

  status: string;
}

interface StudentDocument {
  document_id: number;

  student_id: number;

  document_type: string;

  file_name: string;

  file_path: string;

  document_url: string | null;

  verification_status: string;

  remarks: string | null;

  verified_by: number | null;

  verified_by_username: string | null;

  verified_at: string | null;

  uploaded_at: string;
}

interface DocumentResponse {
  success: boolean;

  message?: string;

  student: Student;

  totalDocuments: number;

  documents: StudentDocument[];
}

// =====================================================
// COMPONENT
// =====================================================

export default function StudentDocumentsR() {
  const navigate = useNavigate();

  const { id } = useParams();

  const user = authService.getSession();

  // =====================================================
  // STATES
  // =====================================================

  const [student, setStudent] = useState<Student | null>(null);

  const [documents, setDocuments] = useState<StudentDocument[]>([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  // =====================================================
  // FETCH DOCUMENTS
  // =====================================================

  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true);

      setError("");

      const response = await fetch(`${API_BASE_URL}/${id}/documents`);

      const data: DocumentResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to fetch student documents.");
      }

      setStudent(data.student);

      setDocuments(data.documents);
    } catch (error) {
      console.error(error);

      setError("Unable to load student documents.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  // =====================================================
  // VERIFY DOCUMENT
  // =====================================================

  const handleVerifyDocument = async (
    documentId: number,
    status: "Verified" | "Rejected",
  ) => {
    try {
      let remarks = "";

      if (status === "Rejected") {
        remarks = window.prompt("Enter rejection remarks:") || "";

        if (!remarks.trim()) {
          return;
        }
      }

      const response = await fetch(
        `${API_BASE_URL}/documents/${documentId}/verify`,
        {
          method: "PUT",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            verification_status: status,
            remarks,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Verification failed.");
      }

      await fetchDocuments();
    } catch (error) {
      console.error(error);

      alert("Unable to verify document.");
    }
  };

  // =====================================================
  // STATISTICS
  // =====================================================

  const statistics = useMemo(() => {
    let pending = 0;

    let verified = 0;

    let rejected = 0;

    documents.forEach((doc) => {
      switch (doc.verification_status) {
        case "Pending":
          pending++;
          break;

        case "Verified":
          verified++;
          break;

        case "Rejected":
          rejected++;
          break;

        default:
          break;
      }
    });

    return {
      total: documents.length,

      pending,

      verified,

      rejected,
    };
  }, [documents]);

  // =====================================================
  // LOAD DATA
  // =====================================================

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // =====================================================
  // AUTHORIZATION
  // =====================================================

  useEffect(() => {
    if (!user || user.role !== "Registrar") {
      navigate("/login");
    }
  }, [user, navigate]);

  if (!user || user.role !== "Registrar") {
    return null;
  } // =====================================================
  // RENDER
  // =====================================================
  return (
    <DashboardLayout>
      <div className="registrar-documentsR-container">
        {/* ===================================================== */}
        {/* HEADER */}
        {/* ===================================================== */}

        <div className="registrar-documentsR-header">
          <div>
            <h1>Student Documents</h1>

            <p>View, verify, and manage all uploaded student documents.</p>
          </div>

          <button
            className="back-btn"
            onClick={() => navigate(`/registrar/student/listR/${id}`)}
          >
            ← Back to Student list
          </button>
        </div>

        {/* ===================================================== */}
        {/* LOADING */}
        {/* ===================================================== */}

        {loading && (
          <div className="details-message">Loading student documents...</div>
        )}

        {/* ===================================================== */}
        {/* ERROR */}
        {/* ===================================================== */}

        {!loading && error && (
          <div className="details-message error">{error}</div>
        )}

        {/* ===================================================== */}
        {/* CONTENT */}
        {/* ===================================================== */}

        {!loading && !error && student && (
          <>
            {/* ================================================ */}
            {/* STUDENT SUMMARY */}
            {/* ================================================ */}

            <div className="student-summary-card">
              <div className="student-summary-left">
                <div className="student-avatar">
                  {student.first_name.charAt(0)}
                </div>

                <div>
                  <h2>
                    {student.first_name}{" "}
                    {student.middle_name
                      ? `${student.middle_name.charAt(0)}. `
                      : ""}
                    {student.last_name}
                  </h2>

                  <p>{student.student_number}</p>

                  <span
                    className={`status ${student.status
                      .toLowerCase()
                      .replace(/\s+/g, "-")}`}
                  >
                    {student.status}
                  </span>
                </div>
              </div>

              <div className="student-summary-right">
                <div className="summary-item">
                  <span>Course</span>
                  <strong>{student.course_code}</strong>
                </div>

                <div className="summary-item">
                  <span>Year Level</span>
                  <strong>Year {student.year_level}</strong>
                </div>

                <div className="summary-item">
                  <span>Section</span>
                  <strong>{student.section_name}</strong>
                </div>

                <div className="summary-item">
                  <span>Semester</span>
                  <strong>{student.semester_name}</strong>
                </div>
              </div>
            </div>

            {/* ================================================ */}
            {/* DOCUMENT STATISTICS */}
            {/* ================================================ */}

            <div className="document-statistics">
              <div className="document-card">
                <span>Total Documents</span>
                <h2>{statistics.total}</h2>
              </div>

              <div className="document-card">
                <span>Pending</span>
                <h2>{statistics.pending}</h2>
              </div>

              <div className="document-card">
                <span>Verified</span>
                <h2>{statistics.verified}</h2>
              </div>

              <div className="document-card">
                <span>Rejected</span>
                <h2>{statistics.rejected}</h2>
              </div>
            </div>

            {/* ================================================ */}
            {/* DOCUMENTS TABLE */}
            {/* ================================================ */}

            <div className="documents-card">
              <h3>Uploaded Documents</h3>

              <div className="documents-table-wrapper">
                <table className="documents-table">
                  <thead>
                    <tr>
                      <th>Document Type</th>
                      <th>File Name</th>
                      <th>Uploaded</th>
                      <th>Status</th>
                      <th>Verified By</th>
                      <th>Verified At</th>
                      <th>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {documents.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="table-message">
                          No uploaded documents found.
                        </td>
                      </tr>
                    ) : (
                      documents.map((document) => (
                        <tr key={document.document_id}>
                          <td>{document.document_type}</td>

                          <td>{document.file_name}</td>

                          <td>
                            {new Date(
                              document.uploaded_at,
                            ).toLocaleDateString()}
                          </td>

                          <td>
                            <span
                              className={`status ${document.verification_status
                                .toLowerCase()
                                .replace(/\s+/g, "-")}`}
                            >
                              {document.verification_status}
                            </span>
                          </td>

                          <td>{document.verified_by_username ?? "-"}</td>

                          <td>
                            {document.verified_at
                              ? new Date(document.verified_at).toLocaleString()
                              : "-"}
                          </td>

                          <td>
                            <div className="document-actions">
                              {document.document_url && (
                                <>
                                  <a
                                    href={document.document_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="preview-btn"
                                  >
                                    Preview
                                  </a>

                                  <a
                                    href={document.document_url}
                                    download
                                    className="download-btn"
                                  >
                                    Download
                                  </a>
                                </>
                              )}

                              {document.verification_status === "Pending" && (
                                <>
                                  <button
                                    className="approve-btn"
                                    onClick={() =>
                                      handleVerifyDocument(
                                        document.document_id,
                                        "Verified",
                                      )
                                    }
                                  >
                                    Approve
                                  </button>

                                  <button
                                    className="reject-btn"
                                    onClick={() =>
                                      handleVerifyDocument(
                                        document.document_id,
                                        "Rejected",
                                      )
                                    }
                                  >
                                    Reject
                                  </button>
                                </>
                              )}

                              {document.remarks && (
                                <button
                                  className="remarks-btn"
                                  onClick={() => alert(document.remarks)}
                                >
                                  Remarks
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ================================================ */}
            {/* FOOTER ACTIONS */}
            {/* ================================================ */}

            <div className="documents-actions">
              <button
                className="back-btn"
                onClick={() =>
                  navigate(`/registrar/student/DetailsR/${student.student_id}`)
                }
              >
                Student Profile
              </button>

              <button
                className="record-btn"
                onClick={() =>
                  navigate(`/registrar/student/${student.student_id}/AcadRecR`)
                }
              >
                Academic Records
              </button>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
