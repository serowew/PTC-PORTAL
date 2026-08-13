import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/announcementStudent.css";

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
  attachments: string | null;
}

export default function AnnouncementF() {
  const navigate = useNavigate();

  const [user] = useState(() => authService.getSession());

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  useEffect(() => {
    async function loadAnnouncements() {
      try {
        if (!user) {
          throw new Error("User session not found.");
        }

        if (user.role !== "Faculty") {
          navigate("/login");
          return;
        }

        console.log("FACULTY USER:", user);

        const response = await fetch(
          `${API_BASE_URL}/api/announcements?role_id=${user.role_id}`,
        );

        const data = await response.json();

        console.log("FACULTY ANNOUNCEMENTS:", data);

        if (!response.ok) {
          throw new Error(data.error || "Failed loading announcements");
        }

        setAnnouncements(data);
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

    loadAnnouncements();
  }, [user, navigate]);

  return (
    <DashboardLayout>
      <div className="announcement-student">
        <h2>Faculty Announcements</h2>

        {loading && <p>Loading announcements...</p>}

        {error && <p className="error">{error}</p>}

        {!loading && announcements.length === 0 && (
          <p>No announcements available.</p>
        )}

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
                  Posted by:
                  <strong> {item.created_by}</strong>
                </span>

                <span>{new Date(item.publish_date).toLocaleDateString()}</span>
              </div>

              <button
                className="view-details-btn"
                onClick={() =>
                  navigate(`/faculty/announcementDF/${item.announcement_id}`)
                }
              >
                View Details
              </button>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
