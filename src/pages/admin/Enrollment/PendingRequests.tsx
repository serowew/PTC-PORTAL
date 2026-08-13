import { useEffect, useState } from "react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { enrollmentService } from "../../../services/enrollment.service";

import type {
  EnrollmentRequest,
  PendingRequest,
} from "../../../services/enrollment.service";

import ReviewEnrollmentModal from "./ReviewEnrollmentModal";

import "../../../styles/pendingRequests.css";

export default function PendingRequests() {
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);

  const [selectedRequest, setSelectedRequest] =
    useState<EnrollmentRequest | null>(null);

  useEffect(() => {
    loadRequests();
  }, []);

  async function loadRequests() {
    try {
      setLoading(true);

      const data =
        await enrollmentService.getPendingRequests();

      setRequests(data.requests);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleReview(requestId: number) {
    try {
      const response =
        await enrollmentService.getEnrollmentRequest(
          requestId
        );

      setSelectedRequest(response.data);
      setModalOpen(true);
    } catch (err) {
      console.error(err);

      alert(
        err instanceof Error
          ? err.message
          : "Failed to load enrollment request."
      );
    }
  }

  async function handleModify(reason: string) {
    if (!selectedRequest) return;

    try {
      await enrollmentService.modifyEnrollmentRequest(
        selectedRequest.request_id,
        reason
      );

      alert("Enrollment returned to Registrar.");

      setModalOpen(false);
      setSelectedRequest(null);

      await loadRequests();
    } catch (err) {
      console.error(err);

      alert(
        err instanceof Error
          ? err.message
          : "Failed to return enrollment request."
      );
    }
  }

  async function handleApprove() {
    if (!selectedRequest) return;

    try {
      await enrollmentService.approveEnrollment(
        selectedRequest.request_id,
        1
      );

      alert("Enrollment approved successfully.");

      setModalOpen(false);
      setSelectedRequest(null);

      await loadRequests();
    } catch (err) {
      console.error(err);

      alert(
        err instanceof Error
          ? err.message
          : "Failed to approve enrollment."
      );
    }
  }

  return (
    <DashboardLayout>
      <div className="pending-page">

        <div className="page-header">
          <h1>Pending Requests</h1>

          <p>
            Review enrollment requests submitted by the Registrar.
          </p>
        </div>

        {loading ? (
          <p>Loading...</p>
        ) : requests.length === 0 ? (
          <div className="empty-state">
            <h3>No Pending Requests</h3>
            <p>
              There are currently no enrollment requests
              waiting for approval.
            </p>
          </div>
        ) : (
          <table className="pending-table">

            <thead>
              <tr>
                <th>Student ID</th>
                <th>Name</th>
                <th>Course</th>
                <th>Section</th>
                <th>Year</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {requests.map((request) => (
                <tr key={request.request_id}>

                  <td>
                    {request.student_id_preview}
                  </td>

                  <td>
                    {request.first_name}{" "}
                    {request.last_name}
                  </td>

                  <td>
                    {request.course_code}
                  </td>

                  <td>
                    {request.section_name}
                  </td>

                  <td>
                    {request.year_level}
                  </td>

                  <td>
                    <span className="status-badge">
                      {request.status}
                    </span>
                  </td>

                  <td>
                    {new Date(
                      request.submitted_at
                    ).toLocaleDateString()}
                  </td>

                  <td>

                    <button
                      type="button"
                      className="review-button"
                      onClick={() =>
                        handleReview(
                          request.request_id
                        )
                      }
                    >
                      Review
                    </button>

                  </td>

                </tr>
              ))}
            </tbody>

          </table>
        )}

        <ReviewEnrollmentModal
          open={modalOpen}
          request={selectedRequest}
          onClose={() => {
            setModalOpen(false);
            setSelectedRequest(null);
          }}
          onApprove={handleApprove}
          onModify={handleModify}
        />

      </div>
    </DashboardLayout>
  );
}