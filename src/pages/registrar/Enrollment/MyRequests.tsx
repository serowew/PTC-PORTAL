import { useEffect, useState } from "react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { enrollmentService } from "../../../services/enrollment.service";
import EditEnrollmentModal from "./EditEnrollmentModal";
import "../../../styles/myRequests.css";
interface Request {
    request_id: number;
    student_id_preview: string;
    first_name: string;
    middle_name?: string;
    last_name: string;

    course_code?: string;
    section_name?: string;
    year_level?: number;

    status: string;
    modified_reason?: string;
    submitted_at: string;
}

export default function MyRequests() {

  const [search, setSearch] = useState("");
const [filter, setFilter] = useState("All");

const [requests, setRequests] = useState<Request[]>([]);

const [loading, setLoading] = useState(true);

const [selectedRequest, setSelectedRequest] =
  useState<Request | null>(null);

const [modalOpen, setModalOpen] =
  useState(false);

    function openRequest(request: Request) {
    setSelectedRequest(request);
    setModalOpen(true);
}

  useEffect(() => {
    loadRequests();
  }, []);

  async function loadRequests() {

    try {

      // Replace later with logged in registrar ID
      const response =
        await enrollmentService.getMyRequests(1);

      setRequests(response.requests);

    } catch (err) {

      console.error(err);

    } finally {

      setLoading(false);

    }

  }

const filteredRequests = requests.filter((request) => {

  const matchesSearch =
    request.student_id_preview
      .toLowerCase()
      .includes(search.toLowerCase()) ||

    `${request.first_name} ${request.last_name}`
      .toLowerCase()
      .includes(search.toLowerCase());

  const matchesFilter =
    filter === "All" || request.status === filter;

  return matchesSearch && matchesFilter;

});

const pendingCount =
  requests.filter(r => r.status === "Pending").length;

const modifiedCount =
  requests.filter(r => r.status === "Modified").length;

const approvedCount =
  requests.filter(r => r.status === "Approved").length;

const draftCount =
  requests.filter(r => r.status === "Draft").length;

return (
  <>
    <DashboardLayout>
      <div className="pending-page">

       <div className="page-header">

    <h1>My Enrollment Requests</h1>

    <p>
        Track all enrollment requests submitted to the Admin.
    </p>

</div>

<div className="stats-grid">

    <div className="stat-card">
        <h2>{pendingCount}</h2>
        <span>Pending</span>
    </div>

    <div className="stat-card">
        <h2>{modifiedCount}</h2>
        <span>Modified</span>
    </div>

    <div className="stat-card">
        <h2>{approvedCount}</h2>
        <span>Approved</span>
    </div>

    <div className="stat-card">
        <h2>{draftCount}</h2>
        <span>Draft</span>
    </div>

</div>

<div className="toolbar">

    <input
        type="text"
        placeholder="Search student..."
        value={search}
        onChange={(e)=>setSearch(e.target.value)}
    />

    <select
        value={filter}
        onChange={(e)=>setFilter(e.target.value)}
    >
        <option>All</option>
        <option>Pending</option>
        <option>Modified</option>
        <option>Approved</option>
        <option>Draft</option>
    </select>

</div>

        {loading ? (

          <p>Loading...</p>

        ) : requests.length === 0 ? (

          <p>No requests found.</p>

        ) : (

          <table className="pending-table">

            <thead>

              <tr>
                <th>Student ID</th>
                <th>Name</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Action</th>
              </tr>

            </thead>

            <tbody>

              {filteredRequests.map((request) => (

<tr key={request.request_id}>

                  <td>{request.student_id_preview}</td>

                  <td>
                    {request.first_name}{" "}
                    {request.middle_name ?? ""}{" "}
                    {request.last_name}
                  </td>

                 <td>

<span className={`status ${request.status.toLowerCase()}`}>

{request.status === "Modified"
    ? "Needs Modification"
    : request.status}

</span>

</td>

                  <td>
                    {new Date(request.submitted_at).toLocaleDateString()}
                  </td>

<td>

<button
    className="view-btn"
    onClick={() => openRequest(request)}
>

View

</button>

</td>

                </tr>

              ))}

            </tbody>

          </table>

        )}

      </div>
    </DashboardLayout>

    <EditEnrollmentModal
      open={modalOpen}
      request={selectedRequest}
      onClose={() => setModalOpen(false)}
      onSuccess={loadRequests}
    />
  </>
);

}