import { useState } from "react";
import "./../../../styles/modal.css";

import type { EnrollmentRequest } from "../../../services/enrollment.service";

interface Props {
  open: boolean;
  request: EnrollmentRequest | null;

  onClose: () => void;

  onApprove: () => void;

  onModify: (reason: string) => void;
}

export default function ReviewEnrollmentModal({
  open,
  request,
  onClose,
  onApprove,
  onModify,
}: Props) {
  const [reason, setReason] = useState("");

  if (!open || !request) return null;

  function handleModify() {
    const trimmedReason = reason.trim();

    if (!trimmedReason) {
      alert("Please provide a reason for modification.");
      return;
    }

    onModify(trimmedReason);
    setReason("");
  }

  function handleClose() {
    setReason("");
    onClose();
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">

        {/* HEADER */}
        <div className="modal-header">
          <div>
            <h2>Enrollment Review</h2>
            <p>Review the student's enrollment information.</p>
          </div>

          <button
            type="button"
            className="close-btn"
            onClick={handleClose}
          >
            ✕
          </button>
        </div>

        {/* BODY */}
        <div className="modal-body">

          <table className="review-table">
            <tbody>

              <tr>
                <td>Student ID</td>
                <td>{request.student_id_preview}</td>
              </tr>

              <tr>
                <td>Name</td>
                <td>
                  {request.first_name}{" "}
                  {request.middle_name ?? ""}{" "}
                  {request.last_name}{" "}
                  {request.suffix ?? ""}
                </td>
              </tr>

              <tr>
                <td>Course</td>
                <td>
                  {request.course_code} - {request.course_name}
                </td>
              </tr>

              <tr>
                <td>Section</td>
                <td>
                  {request.section_name}
                </td>
              </tr>

              <tr>
                <td>Academic Year</td>
                <td>
                  {request.academic_year}
                </td>
              </tr>

              <tr>
                <td>Year Level</td>
                <td>
                  {request.year_level}
                </td>
              </tr>

              <tr>
                <td>Sex</td>
                <td>
                  {request.sex}
                </td>
              </tr>

              <tr>
                <td>Birth Date</td>
                <td>
                  {request.birth_date}
                </td>
              </tr>

              <tr>
                <td>Contact</td>
                <td>
                  {request.contact_number}
                </td>
              </tr>

              <tr>
                <td>Address</td>
                <td>
                  {request.address}
                </td>
              </tr>

              <tr>
                <td>Enrollment Type</td>
                <td>
                  {request.enrollment_type}
                </td>
              </tr>

              <tr>
                <td>COR Number</td>
                <td>
                  {request.cor_number}
                </td>
              </tr>

            </tbody>
          </table>

          {/* MODIFY */}
          <div className="modify-section">

            <label htmlFor="modify-reason">
              Modification Reason
            </label>

            <textarea
              id="modify-reason"
              value={reason}
              onChange={(event) =>
                setReason(event.target.value)
              }
              placeholder="Explain what the Registrar needs to modify..."
              rows={4}
            />

          </div>

        </div>

        {/* FOOTER */}
        <div className="modal-footer">

          <button
            type="button"
            className="modal-cancel-btn"
            onClick={handleClose}
          >
            Cancel
          </button>

          <button
            type="button"
            className="modal-modify-btn"
            onClick={handleModify}
          >
            Modify
          </button>

          <button
            type="button"
            className="modal-approve-btn"
            onClick={onApprove}
          >
            Approve
          </button>

        </div>

      </div>
    </div>
  );
}