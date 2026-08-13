import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/announcementDetailR.css";

const API_BASE_URL = "http://localhost:3000";
const FILE_BASE_URL = "http://localhost:3000";

interface Recipient {
  role_id: number;
  role_name: string;
}

interface Attachment {
  file_id: number;
  original_name: string;
  file_path: string;
}

interface Announcement {
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
}

export default function AnnouncementDetailR() {
  const navigate = useNavigate();

  const { id } = useParams<{ id: string }>();

  const user = authService.getSession();

  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  useEffect(() => {
    async function loadAnnouncement() {
      try {
        if (!user || user.role !== "Registrar") {
          navigate("/login");

          return;
        }

        if (!id) {
          throw new Error("Announcement ID is missing.");
        }

        const response = await fetch(
          `${API_BASE_URL}/api/admin/announcements/${id}`,
        );

        const data = await response.json();

        console.log("DETAIL ANNOUNCEMENT:", data);

        if (!response.ok) {
          throw new Error(data.error || "Failed to load announcement.");
        }

        setAnnouncement(data);
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Something went wrong.");
        }
      } finally {
        setLoading(false);
      }
    }

    loadAnnouncement();
  }, [id, navigate, user]);

  if (!user || user.role !== "Registrar") {
    return null;
  }

  return (
    <DashboardLayout>
      <div className="registrar-announcement-detailR">
        <button className="announcement-btn" onClick={() => navigate(-1)}>
          ← Back
        </button>

        {loading && <p>Loading announcement...</p>}

        {error && <p className="error">{error}</p>}

        {announcement && (
          <div className="announcement-detail-card">
            <h1>{announcement.title}</h1>

            <div className="announcement-meta">
              <p>
                Created by:
                <strong> {announcement.created_by}</strong>
              </p>

              <p>
                Published:{" "}
                {new Date(announcement.publish_date).toLocaleString()}
              </p>

              {announcement.expiry_date && (
                <p>
                  Expiry: {new Date(announcement.expiry_date).toLocaleString()}
                </p>
              )}

              <p>
                Status: {announcement.is_active === 1 ? "Active" : "Inactive"}
              </p>
            </div>

            <hr />

            <div className="announcement-content">{announcement.content}</div>

            <div className="announcement-section">
              <h3>Recipients</h3>

              {announcement.recipients?.length > 0 ? (
                <ul>
                  {announcement.recipients.map((role) => (
                    <li key={role.role_id}>{role.role_name}</li>
                  ))}
                </ul>
              ) : (
                <p>No recipients.</p>
              )}
            </div>

            <div className="announcement-section">
              <h3>Attachments</h3>

              {announcement.attachments?.length > 0 ? (
                <div className="attachment-list">
                  {announcement.attachments.map((file) => (
                    <div key={file.file_id} className="attachment-item">
                      📄{" "}
                      <a
                        href={`${FILE_BASE_URL}/${file.file_path.replace(/\\/g, "/")}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {file.original_name}
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <p>No attachments.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
