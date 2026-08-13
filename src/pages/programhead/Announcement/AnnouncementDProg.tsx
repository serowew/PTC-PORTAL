import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/announcementStudent.css";

const API_BASE_URL = "http://localhost:3000";
const FILE_BASE_URL = "http://localhost:3000";

interface Attachment {
  file_id: number;
  original_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
}

interface Announcement {
  announcement_id: number;
  title: string;
  content: string;
  created_by: string;
  publish_date: string;
  expiry_date: string | null;
  attachments: Attachment[];
}
export default function AnnouncementProgD() {
  const navigate = useNavigate();

  const { id } = useParams<{ id: string }>();

  const [user] = useState(() => authService.getSession());

  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        if (!user) {
          throw new Error("User session not found.");
        }

        if (user.role !== "Program Head") {
          navigate("/login");

          return;
        }

        const response = await fetch(
          `${API_BASE_URL}/api/announcements/${id}?role_id=${user.role_id}`,
        );

        const data = await response.json();

        console.log("PROGRAM HEAD DETAIL:", data);

        if (!response.ok) {
          throw new Error(data.error || "Announcement not found.");
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

    load();
  }, [id, user, navigate]);

  return (
    <DashboardLayout>
      <div className="announcementD-student">
        <button className="back-button" onClick={() => navigate(-1)}>
          ← Back
        </button>

        {loading && <p>Loading announcement...</p>}

        {error && <p className="error">{error}</p>}

        {announcement && (
          <div className="announcement-details-card">
            <h1>{announcement.title}</h1>

            <p>
              Posted by:
              <strong> {announcement.created_by}</strong>
            </p>

            <p>
              Published: {new Date(announcement.publish_date).toLocaleString()}
            </p>

            <hr />

            <div className="announcement-content">{announcement.content}</div>

            {announcement.attachments?.length > 0 && (
              <div>
                <hr />

                <h3>Attachments</h3>

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
                      <span> ({(file.file_size / 1024).toFixed(1)} KB)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
