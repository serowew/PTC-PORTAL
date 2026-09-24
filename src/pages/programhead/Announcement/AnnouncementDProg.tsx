import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";

import { authService } from "../../../services/auth.service";
import { API_BASE_URL } from "../../../services/api";

import "../../../styles/announcementStudent.css";

// =====================================================
// FILE BASE URL
// =====================================================

const FILE_BASE_URL = API_BASE_URL;

// =====================================================
// TYPES
// =====================================================

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

// =====================================================
// COMPONENT
// =====================================================

export default function AnnouncementProgD() {
  const navigate = useNavigate();

  const { id } = useParams<{
    id: string;
  }>();

  // =====================================================
  // AUTH SESSION
  // =====================================================

  const [user] = useState(() => authService.getSession());

  const [token] = useState(() => authService.getToken());

  // =====================================================
  // STATE
  // =====================================================

  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  // =====================================================
  // LOAD ANNOUNCEMENT
  // =====================================================

  useEffect(() => {
    const controller = new AbortController();

    async function loadAnnouncement() {
      try {
        setLoading(true);
        setError("");

        // =================================================
        // AUTHENTICATION CHECK
        // =================================================

        if (!user || !token) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        // =================================================
        // ROLE CHECK
        // =================================================

        if (user.role !== "Program Head") {
          navigate(authService.getDashboardRoute(user.role), {
            replace: true,
          });

          return;
        }

        // =================================================
        // ANNOUNCEMENT ID VALIDATION
        // =================================================

        const announcementId = Number(id);

        if (!Number.isInteger(announcementId) || announcementId <= 0) {
          throw new Error("Invalid announcement ID.");
        }

        // =================================================
        // LOAD PROTECTED ANNOUNCEMENT
        //
        // authFetch automatically adds:
        //
        // Authorization: Bearer <JWT>
        //
        // Do NOT send role_id manually.
        // Backend gets the authenticated role from req.user.
        // =================================================

        const response = await authService.authFetch(
          `${API_BASE_URL}/api/announcements/${announcementId}`,
          {
            method: "GET",

            headers: {
              Accept: "application/json",
            },

            signal: controller.signal,
          },
        );

        // =================================================
        // RESPONSE
        // =================================================

        const data = await response.json();

        console.log("PROGRAM HEAD ANNOUNCEMENT DETAIL:", data);

        // =================================================
        // UNAUTHORIZED
        //
        // authFetch already deletes the invalid token
        // when status = 401.
        // =================================================

        if (response.status === 401) {
          navigate("/login", {
            replace: true,
          });

          return;
        }

        // =================================================
        // OTHER API ERROR
        // =================================================

        if (!response.ok) {
          throw new Error(
            data.error || data.message || "Announcement not found.",
          );
        }

        // =================================================
        // SAVE ANNOUNCEMENT
        // =================================================

        setAnnouncement(data as Announcement);
      } catch (err) {
        // =================================================
        // IGNORE ABORT
        // =================================================

        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        console.error("PROGRAM HEAD ANNOUNCEMENT ERROR:", err);

        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Something went wrong while loading the announcement.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadAnnouncement();

    // =====================================================
    // CLEANUP
    // =====================================================

    return () => {
      controller.abort();
    };
  }, [id, user, token, navigate]);

  // =====================================================
  // UI
  // =====================================================

  return (
    <DashboardLayout>
      <div className="announcementD-student">
        {/* ============================================= */}
        {/* BACK BUTTON */}
        {/* ============================================= */}

        <button
          type="button"
          className="back-button"
          onClick={() => navigate(-1)}
        >
          ← Back
        </button>

        {/* ============================================= */}
        {/* LOADING */}
        {/* ============================================= */}

        {loading && <p>Loading announcement...</p>}

        {/* ============================================= */}
        {/* ERROR */}
        {/* ============================================= */}

        {!loading && error && <p className="error">{error}</p>}

        {/* ============================================= */}
        {/* ANNOUNCEMENT */}
        {/* ============================================= */}

        {!loading && !error && announcement && (
          <div className="announcement-details-card">
            {/* ======================================= */}
            {/* TITLE */}
            {/* ======================================= */}

            <h1>{announcement.title}</h1>

            {/* ======================================= */}
            {/* CREATED BY */}
            {/* ======================================= */}

            <p>
              Posted by: <strong>{announcement.created_by}</strong>
            </p>

            {/* ======================================= */}
            {/* PUBLISH DATE */}
            {/* ======================================= */}

            <p>
              Published: {new Date(announcement.publish_date).toLocaleString()}
            </p>

            <hr />

            {/* ======================================= */}
            {/* CONTENT */}
            {/* ======================================= */}

            <div className="announcement-content">{announcement.content}</div>

            {/* ======================================= */}
            {/* ATTACHMENTS */}
            {/* ======================================= */}

            {announcement.attachments &&
              announcement.attachments.length > 0 && (
                <div>
                  <hr />

                  <h3>Attachments</h3>

                  <div className="attachment-list">
                    {announcement.attachments.map((file) => {
                      // Convert:
                      //
                      // uploads\files\example.pdf
                      //
                      // into:
                      //
                      // uploads/files/example.pdf

                      const normalizedPath = file.file_path
                        .replace(/\\/g, "/")
                        .replace(/^\/+/, "");

                      return (
                        <div key={file.file_id} className="attachment-item">
                          📄{" "}
                          <a
                            href={`${FILE_BASE_URL}/${normalizedPath}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {file.original_name}
                          </a>
                          <span>
                            {" "}
                            ({(file.file_size / 1024).toFixed(1)} KB)
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
