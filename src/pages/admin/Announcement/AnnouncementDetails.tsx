import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/announcementdetails.css";

const API_BASE_URL = "http://localhost:3000/api/admin/announcements";
const FILE_BASE_URL = "http://localhost:3000";

type Recipient = {
  role_id: number;
  role_name: string;
};

type Attachment = {
  file_id: number;
  original_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
};

type Announcement = {
  announcement_id: number;
  title: string;
  content: string;
  created_by: string;
  publish_date: string;
  expiry_date: string | null;
  is_active: number;
  created_at: string;

  recipients: Recipient[];
  attachments: Attachment[];
};

export default function AnnouncementDetails() {
  const navigate = useNavigate();
  const { id } = useParams();

  const session = authService.getSession();

  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session || session.role !== "Admin") {
      navigate("/login");
      return;
    }

    loadAnnouncement();
  }, []);

  async function loadAnnouncement() {
    try {
      const response = await fetch(`${API_BASE_URL}/${id}`);

      if (!response.ok) {
        throw new Error("Unable to load announcement.");
      }

      const data = await response.json();

      setAnnouncement(data);
    } catch (err) {
      console.error(err);

      alert("Unable to load announcement.");

      navigate("/admin/announcement/list");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="announcement-loading">Loading announcement...</div>
      </DashboardLayout>
    );
  }

  if (!announcement) {
    return null;
  }
  return (
    <DashboardLayout>
      <div className="announcement-details-page">
        <button
          className="back-btn"
          onClick={() => navigate("/admin/announcement/list")}
        >
          ← Back to Announcements
        </button>

        <div className="announcement-card">
          <div className="announcement-banner">📢 PTC Announcement</div>

          <div className="announcement-header">
            <h1>{announcement.title}</h1>

            <span
              className={`status-badge ${
                announcement.is_active ? "active" : "inactive"
              }`}
            >
              {announcement.is_active ? "ACTIVE" : "INACTIVE"}
            </span>
          </div>

          {/* ========================= */}
          {/* Announcement Information */}
          {/* ========================= */}

          <div className="announcement-meta">
            <div className="meta-box">
              <span className="meta-label">Posted By</span>

              <span>{announcement.created_by}</span>
            </div>

            <div className="meta-box">
              <span className="meta-label">Recipients</span>

              <span>
                {announcement.recipients.length > 0
                  ? announcement.recipients
                      .map((role) => role.role_name)
                      .join(", ")
                  : "None"}
              </span>
            </div>

            <div className="meta-box">
              <span className="meta-label">Published</span>

              <span>
                {new Date(announcement.publish_date).toLocaleDateString()}
              </span>
            </div>

            <div className="meta-box">
              <span className="meta-label">Expires</span>

              <span>
                {announcement.expiry_date
                  ? new Date(announcement.expiry_date).toLocaleDateString()
                  : "No Expiry"}
              </span>
            </div>
          </div>

          {/* ========================= */}
          {/* Announcement Content */}
          {/* ========================= */}

          <div className="announcement-content">
            <h2>Announcement</h2>

            <div className="content-box">{announcement.content}</div>
          </div>

          {/* ========================= */}
          {/* Attachments */}
          {/* ========================= */}

          <div className="announcement-content">
            <h2>Attachments</h2>

            {announcement.attachments.length === 0 ? (
              <div className="content-box">No attachments.</div>
            ) : (
              <div className="attachment-list">
                {announcement.attachments.map((file) => (
                  <div key={file.file_id} className="attachment-item">
                    📄{" "}
                    <a
                      href={`${FILE_BASE_URL}/${file.file_path.replace(
                        /\\/g,
                        "/",
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {file.original_name}
                    </a>
                    <span>
                      {" "}
                      ({(file.file_size / 1024).toFixed(1)}
                      {" KB)"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ========================= */}
          {/* Footer */}
          {/* ========================= */}

          <div className="announcement-footer">
            <button
              className="edit-btn"
              onClick={() =>
                navigate(
                  `/admin/announcement/edit/${announcement.announcement_id}`,
                )
              }
            >
              Edit Announcement
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
