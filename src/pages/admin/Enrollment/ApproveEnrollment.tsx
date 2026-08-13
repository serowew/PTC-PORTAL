import { useState } from "react";
import { enrollmentService } from "../../../services/enrollment.service";

interface EnrollmentRequest {
  request_id: number;
  student_id_preview: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  course_code?: string;
  section_name?: string;
  year_level?: number;
  status: string;
  submitted_at: string;
}

interface ApproveEnrollmentProps {
  open: boolean;
  request: EnrollmentRequest | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ApproveEnrollment({
  open,
  request,
  onClose,
  onSuccess,
}: ApproveEnrollmentProps) {
  const [loading, setLoading] = useState(false);

  if (!open || !request) {
    return null;
  }

  async function handleApprove() {
    if (!request) return;

    try {
      setLoading(true);

      await enrollmentService.approveEnrollment(
        request.request_id,
        1
      );

      alert("Enrollment approved successfully.");

      onSuccess();
      onClose();
    } catch (err) {
      console.error(err);

      alert(
        err instanceof Error
          ? err.message
          : "Failed to approve enrollment."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="enrollment-modal-overlay">
      <div className="enrollment-modal">

        <div className="enrollment-modal-header">
          <div>
            <h2>Approve Enrollment</h2>
            <p>
              Review the enrollment information before approving.
            </p>
          </div>

          <button
            type="button"
            className="modal-close-button"
            onClick={onClose}
            disabled={loading}
          >
            ×
          </button>
        </div>

        <div className="enrollment-modal-body">

          <div className="student-summary">
            <div className="student-avatar">
              {request.first_name.charAt(0)}
              {request.last_name.charAt(0)}
            </div>

            <div>
              <h3>
                {request.first_name}{" "}
                {request.middle_name
                  ? `${request.middle_name} `
                  : ""}
                {request.last_name}
              </h3>

              <span>
                Student ID: {request.student_id_preview}
              </span>
            </div>
          </div>

          <div className="enrollment-details">

            <div className="detail-item">
              <label>Student ID</label>
              <strong>
                {request.student_id_preview}
              </strong>
            </div>

            <div className="detail-item">
              <label>Course</label>
              <strong>
                {request.course_code || "—"}
              </strong>
            </div>

            <div className="detail-item">
              <label>Year Level</label>
              <strong>
                {request.year_level
                  ? `${request.year_level}${request.year_level === 1
                      ? "st"
                      : request.year_level === 2
                      ? "nd"
                      : request.year_level === 3
                      ? "rd"
                      : "th"} Year`
                  : "—"}
              </strong>
            </div>

            <div className="detail-item">
              <label>Section</label>
              <strong>
                {request.section_name || "—"}
              </strong>
            </div>

            <div className="detail-item">
              <label>Status</label>
              <strong className="status-pending">
                {request.status}
              </strong>
            </div>

            <div className="detail-item">
              <label>Submitted</label>
              <strong>
                {new Date(
                  request.submitted_at
                ).toLocaleDateString()}
              </strong>
            </div>

          </div>

          <div className="approval-warning">
            <strong>Before approving</strong>

            <p>
              Approving this request will transfer the student
              from Pending Requests to Enrolled Students.
            </p>
          </div>

        </div>

        <div className="enrollment-modal-footer">

          <button
            type="button"
            className="modal-cancel-button"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>

          <button
            type="button"
            className="modal-approve-button"
            onClick={handleApprove}
            disabled={loading}
          >
            {loading ? "Approving..." : "Approve Enrollment"}
          </button>

        </div>

      </div>
    </div>
  );
}