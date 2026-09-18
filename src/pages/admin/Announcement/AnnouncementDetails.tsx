import { useEffect, useState } from "react";

import { useNavigate, useParams } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";

import { authService } from "../../../services/auth.service";

import "../../../styles/announcementdetails.css";

// =====================================================
// API
// =====================================================

const API_BASE_URL = "http://localhost:3000/api/announcement-management";

const FILE_BASE_URL = "http://localhost:3000";

// =====================================================
// TYPES
// =====================================================

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

interface AnnouncementResponse {
  success?: boolean;

  data?: Announcement;

  announcement?: Announcement;

  message?: string;

  error?: string;
}

// =====================================================
// COMPONENT
// =====================================================

export default function AnnouncementDetails() {
  const navigate = useNavigate();

  const { id } = useParams<{
    id: string;
  }>();

  // =====================================================
  // AUTHENTICATION
  // =====================================================

  const session = authService.getSession();

  const token = authService.getToken();

  const userRole = session?.role;

  const authenticated = Boolean(session && token);

  // =====================================================
  // STATE
  // =====================================================

  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  // =====================================================
  // AUTHORIZATION
  // =====================================================

  useEffect(() => {
    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (userRole !== "Admin") {
      if (userRole) {
        navigate(authService.getDashboardRoute(userRole), {
          replace: true,
        });
      } else {
        navigate("/login", {
          replace: true,
        });
      }
    }
  }, [authenticated, userRole, navigate]);

  // =====================================================
  // LOAD ANNOUNCEMENT
  // =====================================================

  useEffect(() => {
    if (!authenticated || userRole !== "Admin") {
      return;
    }

    const announcementId = Number(id);

    if (!Number.isInteger(announcementId) || announcementId <= 0) {
      setError("Invalid announcement ID.");

      setLoading(false);

      return;
    }

    const controller = new AbortController();

    const loadAnnouncement = async () => {
      try {
        setLoading(true);

        setError("");

        const response = await authService.authFetch(
          `${API_BASE_URL}/${announcementId}`,
          {
            method: "GET",

            signal: controller.signal,

            headers: {
              Accept: "application/json",
            },
          },
        );

        const contentType = response.headers.get("content-type") || "";

        let data: Announcement | AnnouncementResponse | null = null;

        if (contentType.includes("application/json")) {
          data = await response.json();
        } else {
          const text = await response.text();

          throw new Error(
            `Server returned a non-JSON response (${response.status}): ${text.slice(
              0,
              200,
            )}`,
          );
        }

        // =================================================
        // 401
        // =================================================

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        // =================================================
        // 403
        // =================================================

        if (response.status === 403) {
          const responseObject =
            data && !("announcement_id" in data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              "You are not authorized to view this announcement.",
          );
        }

        // =================================================
        // HTTP ERROR
        // =================================================

        if (!response.ok) {
          const responseObject =
            data && !("announcement_id" in data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              `Unable to load announcement (${response.status}).`,
          );
        }

        // =================================================
        // NORMALIZE RESPONSE
        // =================================================

        let loadedAnnouncement: Announcement | null = null;

        if (data && "announcement_id" in data) {
          loadedAnnouncement = data as Announcement;
        } else if (data && data.announcement) {
          loadedAnnouncement = data.announcement;
        } else if (data && data.data) {
          loadedAnnouncement = data.data;
        }

        if (!loadedAnnouncement) {
          throw new Error("Announcement data was not returned by the server.");
        }

        const normalizedAnnouncement: Announcement = {
          ...loadedAnnouncement,

          recipients: Array.isArray(loadedAnnouncement.recipients)
            ? loadedAnnouncement.recipients
            : [],

          attachments: Array.isArray(loadedAnnouncement.attachments)
            ? loadedAnnouncement.attachments
            : [],
        };

        setAnnouncement(normalizedAnnouncement);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        console.error("LOAD ADMIN ANNOUNCEMENT DETAIL ERROR:", err);

        setAnnouncement(null);

        if (err instanceof TypeError) {
          setError(
            "Unable to connect to the announcement server. Make sure the backend is running on port 3000.",
          );

          return;
        }

        setError(
          err instanceof Error ? err.message : "Unable to load announcement.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadAnnouncement();

    return () => {
      controller.abort();
    };
  }, [id, authenticated, userRole, navigate]);

  // =====================================================
  // AUTH GUARD
  // =====================================================

  if (!authenticated || !session || userRole !== "Admin") {
    return null;
  }

  // =====================================================
  // LOADING
  // =====================================================

  if (loading) {
    return (
      <DashboardLayout>
        <div className="announcement-loading">Loading announcement...</div>
      </DashboardLayout>
    );
  }

  // =====================================================
  // ERROR
  // =====================================================

  if (error || !announcement) {
    return (
      <DashboardLayout>
        <div className="announcement-details-page">
          <button
            type="button"
            className="back-btn"
            onClick={() => navigate("/admin/announcement/list")}
          >
            ← Back to Announcements
          </button>

          <div className="announcement-card">
            <p className="error-message">
              {error || "Announcement not found."}
            </p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <DashboardLayout>
      <div className="announcement-details-page">
        {/* =================================================
            BACK
        ================================================= */}

        <button
          type="button"
          className="back-btn"
          onClick={() => navigate("/admin/announcement/list")}
        >
          ← Back to Announcements
        </button>

        <div className="announcement-card">
          {/* =================================================
              BANNER
          ================================================= */}

          <div className="announcement-banner">📢 PTC Announcement</div>

          {/* =================================================
              HEADER
          ================================================= */}

          <div className="announcement-header">
            <h1>{announcement.title}</h1>

            <span
              className={`status-badge ${
                Number(announcement.is_active) === 1 ? "active" : "inactive"
              }`}
            >
              {Number(announcement.is_active) === 1 ? "ACTIVE" : "INACTIVE"}
            </span>
          </div>

          {/* =================================================
              ANNOUNCEMENT INFORMATION
          ================================================= */}

          <div className="announcement-meta">
            <div className="meta-box">
              <span className="meta-label">Posted By</span>

              <span>{announcement.created_by || "Unknown"}</span>
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
                {announcement.publish_date
                  ? new Date(announcement.publish_date).toLocaleDateString()
                  : "No publish date"}
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

          {/* =================================================
              CONTENT
          ================================================= */}

          <div className="announcement-content">
            <h2>Announcement</h2>

            <div className="content-box">{announcement.content}</div>
          </div>

          {/* =================================================
              ATTACHMENTS
          ================================================= */}

          <div className="announcement-content">
            <h2>Attachments</h2>

            {announcement.attachments.length === 0 ? (
              <div className="content-box">No attachments.</div>
            ) : (
              <div className="attachment-list">
                {announcement.attachments.map((file) => {
                  const normalizedPath = String(file.file_path || "").replace(
                    /\\/g,
                    "/",
                  );

                  const attachmentUrl = `${FILE_BASE_URL}/${normalizedPath.replace(
                    /^\/+/,
                    "",
                  )}`;

                  return (
                    <div key={file.file_id} className="attachment-item">
                      📄{" "}
                      <a href={attachmentUrl} target="_blank" rel="noreferrer">
                        {file.original_name}
                      </a>
                      {Number(file.file_size) > 0 && (
                        <span>
                          {" "}
                          ({(Number(file.file_size) / 1024).toFixed(1)}
                          {" KB)"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* =================================================
              FOOTER
          ================================================= */}

          <div className="announcement-footer">
            <button
              type="button"
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
