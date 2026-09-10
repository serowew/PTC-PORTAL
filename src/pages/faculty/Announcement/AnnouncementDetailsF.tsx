import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  CircleAlert,
  Clock3,
  Download,
  Megaphone,
  Paperclip,
  UserRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/announcementDetailsFaculty.css";

const API_BASE_URL = "http://localhost:3000";
const FILE_BASE_URL = "http://localhost:3000";

interface Attachment {
  file_id: number;
  original_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
}

interface Recipient {
  role_id: number;
  role_name: string;
}

interface Announcement {
  announcement_id: number;
  title: string;
  content: string;
  created_by: string | null;
  publish_date: string;
  expiry_date: string | null;
  is_active: number;
  created_at: string;
  recipients?: Recipient[];
  attachments?: Attachment[];
}

interface AnnouncementDetailResponse {
  success?: boolean;
  announcement?: Announcement;
  data?: Announcement;
  message?: string;
  error?: string;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not available";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAuthor(value: string | null | undefined) {
  return value?.trim() || "PTC Administration";
}

function includesFacultyAudience(
  recipients: Recipient[] | undefined,
) {
  return Array.isArray(recipients) &&
    recipients.some(
      (recipient) =>
        String(recipient.role_name || "")
          .trim()
          .toLowerCase() === "faculty",
    );
}

function formatFileSize(bytes: number) {
  const size = Number(bytes);

  if (!Number.isFinite(size) || size <= 0) {
    return "Size unavailable";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function buildFileUrl(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");

  return `${FILE_BASE_URL}/${normalized}`;
}

export default function AnnouncementDF() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const user = authService.getSession();
  const token = authService.getToken();
  const authenticated = Boolean(user && token);
  const userRole = user?.role;

  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Faculty") {
      if (userRole) {
        navigate(authService.getDashboardRoute(userRole), { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [authenticated, userRole, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Faculty") {
      return;
    }

    const controller = new AbortController();

    const loadAnnouncement = async () => {
      try {
        setLoading(true);
        setError("");

        const announcementId = Number(id);

        if (!Number.isInteger(announcementId) || announcementId <= 0) {
          throw new Error("Invalid announcement ID.");
        }

        const response = await authService.authFetch(
          `${API_BASE_URL}/api/announcements/${announcementId}`,
          {
            method: "GET",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          },
        );

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        const contentType = response.headers.get("content-type") || "";

        if (!contentType.includes("application/json")) {
          const text = await response.text();

          throw new Error(
            `Server returned a non-JSON response (${response.status}): ${text.slice(
              0,
              180,
            )}`,
          );
        }

        const data = (await response.json()) as
          | Announcement
          | AnnouncementDetailResponse;

        if (response.status === 403) {
          const message =
            "announcement_id" in data
              ? undefined
              : data.message || data.error;

          throw new Error(message || "Faculty access is required.");
        }

        if (!response.ok) {
          const message =
            "announcement_id" in data
              ? undefined
              : data.message || data.error;

          throw new Error(message || "Announcement could not be loaded.");
        }

        let loadedAnnouncement: Announcement | null = null;

        if ("announcement_id" in data) {
          loadedAnnouncement = data;
        } else if (data.announcement) {
          loadedAnnouncement = data.announcement;
        } else if (data.data) {
          loadedAnnouncement = data.data;
        }

        if (!loadedAnnouncement) {
          throw new Error("Announcement data was not returned by the server.");
        }

        const normalizedRecipients = Array.isArray(
          loadedAnnouncement.recipients,
        )
          ? loadedAnnouncement.recipients
          : [];
        if (!includesFacultyAudience(normalizedRecipients)) {
          throw new Error(
            "This announcement is not available for the Faculty audience.",
          );
        }

        setAnnouncement({
          ...loadedAnnouncement,
          recipients: normalizedRecipients,
          attachments: Array.isArray(loadedAnnouncement.attachments)
            ? loadedAnnouncement.attachments
            : [],
        });
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD FACULTY ANNOUNCEMENT DETAIL ERROR:", requestError);
        setAnnouncement(null);

        if (requestError instanceof TypeError) {
          setError(
            "Unable to connect to the announcement server. Make sure the backend is running on port 3000.",
          );
          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load announcement.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadAnnouncement();

    return () => controller.abort();
  }, [id, authenticated, userRole, navigate]);

  if (!authenticated || !user || userRole !== "Faculty") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="faculty-announcement-detail">
        <section className="faculty-announcement-detail__hero">
          <div>
            <div className="faculty-announcement-detail__eyebrow">
              <span className="faculty-announcement-detail__eyebrow-icon">
                <Megaphone size={16} strokeWidth={2.2} />
              </span>
              Faculty · Announcements
            </div>

            <h1>Announcement Details</h1>

            <p>
              Read the full official announcement and review any available
              attachments.
            </p>
          </div>

          <button
            type="button"
            className="faculty-announcement-detail__back"
            onClick={() => navigate("/faculty/announcementF")}
          >
            <ArrowLeft size={16} />
            Announcements
          </button>
        </section>

        {loading && (
          <section
            className="faculty-announcement-detail__loading"
            aria-live="polite"
          >
            <div className="faculty-announcement-detail__skeleton faculty-announcement-detail__skeleton--title" />
            <div className="faculty-announcement-detail__skeleton-grid">
              <div className="faculty-announcement-detail__skeleton" />
              <div className="faculty-announcement-detail__skeleton" />
              <div className="faculty-announcement-detail__skeleton" />
            </div>
            <div className="faculty-announcement-detail__skeleton faculty-announcement-detail__skeleton--content" />
          </section>
        )}

        {!loading && error && (
          <section
            className="faculty-announcement-detail__state faculty-announcement-detail__state--error"
            role="alert"
          >
            <span className="faculty-announcement-detail__state-icon">
              <CircleAlert size={24} />
            </span>

            <div>
              <strong>Announcement could not be loaded</strong>
              <p>{error}</p>
            </div>

            <button
              type="button"
              onClick={() => navigate("/faculty/announcementF")}
            >
              Back to Announcements
            </button>
          </section>
        )}

        {!loading && !error && announcement && (
          <article className="faculty-announcement-detail__card">
            <header className="faculty-announcement-detail__card-header">
              <span className="faculty-announcement-detail__label">
                Official Faculty Notice
              </span>

              <h2>{announcement.title}</h2>

              <div className="faculty-announcement-detail__meta">
                <div>
                  <span className="faculty-announcement-detail__meta-icon">
                    <UserRound size={15} />
                  </span>
                  <div>
                    <span>Posted By</span>
                    <strong>{formatAuthor(announcement.created_by)}</strong>
                  </div>
                </div>

                <div>
                  <span className="faculty-announcement-detail__meta-icon">
                    <CalendarDays size={15} />
                  </span>
                  <div>
                    <span>Published</span>
                    <strong>{formatDateTime(announcement.publish_date)}</strong>
                  </div>
                </div>

                <div>
                  <span className="faculty-announcement-detail__meta-icon">
                    <Clock3 size={15} />
                  </span>
                  <div>
                    <span>Available Until</span>
                    <strong>
                      {announcement.expiry_date
                        ? formatDateTime(announcement.expiry_date)
                        : "No expiry date"}
                    </strong>
                  </div>
                </div>
              </div>
            </header>

            <section className="faculty-announcement-detail__content">
              <span className="faculty-announcement-detail__section-kicker">
                Announcement
              </span>

              <div className="faculty-announcement-detail__message">
                {announcement.content}
              </div>
            </section>

            {announcement.attachments &&
              announcement.attachments.length > 0 && (
                <section className="faculty-announcement-detail__attachments">
                  <header>
                    <div>
                      <span className="faculty-announcement-detail__attachment-icon">
                        <Paperclip size={17} />
                      </span>

                      <div>
                        <span className="faculty-announcement-detail__section-kicker">
                          Files
                        </span>
                        <h3>Attachments</h3>
                      </div>
                    </div>

                    <span className="faculty-announcement-detail__attachment-count">
                      {announcement.attachments.length}
                    </span>
                  </header>

                  <div className="faculty-announcement-detail__attachment-list">
                    {announcement.attachments.map((file) => (
                      <a
                        key={file.file_id}
                        href={buildFileUrl(file.file_path)}
                        target="_blank"
                        rel="noreferrer"
                        className="faculty-announcement-detail__attachment"
                      >
                        <span className="faculty-announcement-detail__file-icon">
                          <Paperclip size={16} />
                        </span>

                        <div>
                          <strong>{file.original_name}</strong>
                          <small>
                            {formatFileSize(file.file_size)}
                            {file.mime_type ? ` · ${file.mime_type}` : ""}
                          </small>
                        </div>

                        <Download size={16} />
                      </a>
                    ))}
                  </div>
                </section>
              )}
          </article>
        )}
      </main>
    </DashboardLayout>
  );
}
