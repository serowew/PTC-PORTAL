import { useEffect, useState } from "react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { useNavigate } from "react-router-dom";
import "../../../styles/announcementRegistrar.css";

const API_BASE_URL = "http://localhost:3000";

interface Announcement {
  announcement_id: number;

  title: string;

  content: string;

  created_by: string;

  publish_date: string;

  expiry_date: string | null;

  is_active: number;

  created_at: string;

  recipients: string | null;

  attachments: string | null;
}

export default function AnnouncementListR() {
  const navigate = useNavigate();

  const user = authService.getSession();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  useEffect(() => {
    async function loadAnnouncements() {
      try {
        if (!user || user.role !== "Registrar") {
          navigate("/login");

          return;
        }

        const response = await fetch(`${API_BASE_URL}/api/admin/announcements`);

        const data = await response.json();

        console.log("REGISTRAR ANNOUNCEMENTS:", data);

        if (!response.ok) {
          throw new Error(data.error || "Failed to load announcements.");
        }

        setAnnouncements(data);
      } catch (error) {
        console.error(error);

        if (error instanceof Error) {
          setError(error.message);
        } else {
          setError("Something went wrong.");
        }
      } finally {
        setLoading(false);
      }
    }

    loadAnnouncements();
  }, [navigate, user]);

  if (!user || user.role !== "Registrar") {
    return null;
  }

  return (
    <DashboardLayout>
      <div className="registrar-announcement-listR">
        <div className="announcement-header">
          <h2>Announcement Management</h2>

          <button
            className="announcement-btn"
            onClick={() => navigate("/registrar/announcement/createR")}
          >
            + Create Announcement
          </button>
        </div>

        {loading && <p>Loading announcements...</p>}

        {error && <p className="error">{error}</p>}

        <div className="announcement-list">
          {announcements.map((item) => (
            <div key={item.announcement_id} className="announcement-card">
              <h3>{item.title}</h3>

              <p>
                {item.content.length > 150
                  ? item.content.substring(0, 150) + "..."
                  : item.content}
              </p>

              <div className="announcement-footer">
                <span>
                  Created by:
                  <strong> {item.created_by}</strong>
                </span>

                <span>{new Date(item.publish_date).toLocaleDateString()}</span>
              </div>

              <div className="announcement-actions">
                <button
                  className="announcement-btn"
                  onClick={() =>
                    navigate(
                      `/registrar/announcement/DetailR/${item.announcement_id}`,
                    )
                  }
                >
                  View Details
                </button>

                <button
                  className="announcement-btn"
                  onClick={() =>
                    navigate(
                      `/registrar/announcement/editR/${item.announcement_id}`,
                    )
                  }
                >
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
