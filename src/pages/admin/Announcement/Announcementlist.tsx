import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/announcementlist.css";

type Announcement = {
  announcement_id: number;
  title: string;
  content: string;
  created_by: string;
  publish_date: string;
  expiry_date: string | null;
  is_active: number;
  created_at: string;
  recipients: string | null;
};
const API_BASE_URL = "http://localhost:3000/api/admin/announcements";

export default function AnnouncementList() {
  const navigate = useNavigate();
  const session = authService.getSession();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!session || session.role !== "Admin") {
      navigate("/login");
      return;
    }

    loadAnnouncements();
  }, []);

  async function loadAnnouncements() {
    try {
      setLoading(true);

      const response = await fetch(API_BASE_URL);

      if (!response.ok) {
        throw new Error("Unable to load announcements.");
      }

      const data = await response.json();

      setAnnouncements(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function deleteAnnouncement(id: number) {
    if (!window.confirm("Delete this announcement?")) return;

    try {
      const response = await fetch(`${API_BASE_URL}/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deleted_by: session?.user_id,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to delete announcement.");
      }

      loadAnnouncements();
    } catch (err) {
      console.error(err);
      alert("Unable to delete announcement.");
    }
  }

  const filteredAnnouncements = announcements.filter((announcement) => {
    const q = search.toLowerCase();

    return (
      announcement.title.toLowerCase().includes(q) ||
      announcement.content.toLowerCase().includes(q) ||
      (announcement.recipients ?? "").toLowerCase().includes(q) ||
      announcement.created_by.toLowerCase().includes(q)
    );
  });

  return (
    <DashboardLayout>
      <div className="admin-announcement-list">
        <div className="announcement-header">
          <div>
            <h1>Announcement Management</h1>
            <p>Manage portal announcements.</p>
          </div>
        </div>

        <div className="announcement-toolbar">
          <input
            type="text"
            className="announcement-search"
            placeholder="Search announcements..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="announcement-table-container">
          <table className="announcement-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Audience</th>
                <th>Posted By</th>
                <th>Publish Date</th>
                <th>Expiry Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="coming-soon">
                    Loading announcements...
                  </td>
                </tr>
              ) : filteredAnnouncements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="coming-soon">
                    No announcements found.
                  </td>
                </tr>
              ) : (
                filteredAnnouncements.map((announcement) => (
                  <tr key={announcement.announcement_id}>
                    <td>{announcement.title}</td>

                    <td>{announcement.recipients}</td>

                    <td>{announcement.created_by}</td>

                    <td>
                      {new Date(announcement.publish_date).toLocaleDateString()}
                    </td>

                    <td>
                      {announcement.expiry_date
                        ? new Date(
                            announcement.expiry_date,
                          ).toLocaleDateString()
                        : "-"}
                    </td>

                    <td>
                      <span
                        className={`status ${
                          announcement.is_active ? "published" : "expired"
                        }`}
                      >
                        {announcement.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>

                    <td>
                      <button
                        className="action-btn view"
                        onClick={() =>
                          navigate(
                            `/admin/announcement/details/${announcement.announcement_id}`,
                          )
                        }
                      >
                        View
                      </button>

                      <button
                        className="action-btn edit"
                        onClick={() =>
                          navigate(
                            `/admin/announcement/edit/${announcement.announcement_id}`,
                          )
                        }
                      >
                        Edit
                      </button>

                      <button
                        className="action-btn delete"
                        onClick={() =>
                          deleteAnnouncement(announcement.announcement_id)
                        }
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
