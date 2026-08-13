import { useEffect, useState } from "react";
import { enrollmentService } from "../../../services/enrollment.service";
import "../../../styles/modal.css";

interface Request {
  request_id: number;
  student_id_preview: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  modified_reason?: string;
}

interface Props {
  open: boolean;
  request: Request | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditEnrollmentModal({
  open,
  request,
  onClose,
  onSuccess,
}: Props) {

const [form, setForm] = useState({
  first_name: "",
  middle_name: "",
  last_name: "",
});

useEffect(() => {
  if (!open || !request) return;

  // eslint-disable-next-line react-hooks/set-state-in-effect
  setForm({
    first_name: request.first_name,
    middle_name: request.middle_name ?? "",
    last_name: request.last_name,
  });
}, [open, request]);

  if (!open || !request) return null;

async function handleResubmit() {

  if (!request) return;

  try {

    await enrollmentService.resubmitRequest(
      request.request_id,
      form
    );

    onSuccess();
    onClose();

  } catch (err) {

    console.error(err);

    alert("Failed to resubmit.");

  }

}

  return (
    <div className="modal-overlay">

      <div className="modal-content">

        <h2>Edit Enrollment</h2>

        <p>
          <strong>Student Preview:</strong>
          {" "}
          {request.student_id_preview}
        </p>

        {request.modified_reason && (

          <div
            style={{
              background: "#fff3cd",
              padding: 12,
              borderRadius: 6,
              marginBottom: 20,
            }}
          >

            <strong>
              Admin Modification Reason
            </strong>

            <br />

            {request.modified_reason}

          </div>

        )}

        <label>

          First Name

          <input
            value={form.first_name}
            onChange={(e) =>
              setForm({
                ...form,
                first_name: e.target.value,
              })
            }
          />

        </label>

        <label>

          Middle Name

          <input
            value={form.middle_name}
            onChange={(e) =>
              setForm({
                ...form,
                middle_name: e.target.value,
              })
            }
          />

        </label>

        <label>

          Last Name

          <input
            value={form.last_name}
            onChange={(e) =>
              setForm({
                ...form,
                last_name: e.target.value,
              })
            }
          />

        </label>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            marginTop: 20,
          }}
        >

          <button onClick={onClose}>
            Cancel
          </button>

          <button onClick={handleResubmit}>
            Resubmit
          </button>

        </div>

      </div>

    </div>
  );

}