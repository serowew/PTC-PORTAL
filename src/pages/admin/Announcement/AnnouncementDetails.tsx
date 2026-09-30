import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  CircleAlert,
  Clock3,
  Download,
  FileText,
  LoaderCircle,
  Megaphone,
  Paperclip,
  Pencil,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import { fileService } from "../../../services/file.service";
import "../../../styles/AdminAnnouncementDetails.css";

const API_BASE_URL = apiUrl("/api/announcement-management");

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

function formatDate(value: string | null, fallback: string) {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return date.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFileSize(value: number) {
  const bytes = Number(value);

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AnnouncementDetails() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const session = authService.getSession();
  const token = authService.getToken();
  const userRole = session?.role;
  const authenticated = Boolean(session && token);

  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Admin") {
      if (userRole) {
        navigate(authService.getDashboardRoute(userRole), { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [authenticated, userRole, navigate]);

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

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          const responseObject =
            data && !("announcement_id" in data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              "You are not authorized to view this announcement.",
          );
        }

        if (!response.ok) {
          const responseObject =
            data && !("announcement_id" in data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              `Unable to load announcement (${response.status}).`,
          );
        }

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

        setAnnouncement({
          ...loadedAnnouncement,
          recipients: Array.isArray(loadedAnnouncement.recipients)
            ? loadedAnnouncement.recipients
            : [],
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

        console.error("LOAD ADMIN ANNOUNCEMENT DETAIL ERROR:", requestError);
        setAnnouncement(null);

        if (requestError instanceof TypeError) {
          setError(
            "Unable to connect to the announcement server. Please make sure the backend server is running.",
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

  if (!authenticated || !session || userRole !== "Admin") {
    return null;
  }

  if (loading) {
    return (
      <DashboardLayout>
        <main className="admin-announcement-details-view">
          <section className="admin-announcement-details-view__state">
            <span className="admin-announcement-details-view__state-icon">
              <LoaderCircle
                size={24}
                className="admin-announcement-details-view__spinner"
                aria-hidden="true"
              />
            </span>
            <strong>Loading announcement...</strong>
            <p>Please wait while the announcement record is retrieved.</p>
          </section>
        </main>
      </DashboardLayout>
    );
  }

  if (error || !announcement) {
    return (
      <DashboardLayout>
        <main className="admin-announcement-details-view">
          <section className="admin-announcement-details-view__state admin-announcement-details-view__state--error">
            <span className="admin-announcement-details-view__state-icon">
              <CircleAlert size={24} aria-hidden="true" />
            </span>
            <strong>Unable to open announcement</strong>
            <p>{error || "Announcement not found."}</p>
            <button
              type="button"
              className="admin-announcement-details-view__back"
              onClick={() => navigate("/admin/announcement/list")}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Back to Announcements
            </button>
          </section>
        </main>
      </DashboardLayout>
    );
  }

  const isActive = Number(announcement.is_active) === 1;

  return (
    <DashboardLayout>
      <main className="admin-announcement-details-view">
        <div className="admin-announcement-details-view__toolbar">
          <button
            type="button"
            className="admin-announcement-details-view__back"
            onClick={() => navigate("/admin/announcement/list")}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to Announcements
          </button>

          <button
            type="button"
            className="admin-announcement-details-view__edit"
            onClick={() =>
              navigate(
                `/admin/announcement/edit/${announcement.announcement_id}`,
              )
            }
          >
            <Pencil size={15} aria-hidden="true" />
            Edit Announcement
          </button>
        </div>

        <section className="admin-announcement-details-view__hero">
          <div className="admin-announcement-details-view__hero-copy">
            <div className="admin-announcement-details-view__eyebrow">
              <span>
                <Megaphone size={16} aria-hidden="true" />
              </span>
              Admin · Announcement Management
            </div>

            <h1>{announcement.title}</h1>

            <p>
              Review the announcement content, publication information,
              recipients, and attached files.
            </p>
          </div>

          <span
            className={
              isActive
                ? "admin-announcement-details-view__status admin-announcement-details-view__status--active"
                : "admin-announcement-details-view__status admin-announcement-details-view__status--inactive"
            }
          >
            {isActive ? "Active" : "Inactive"}
          </span>
        </section>

        <section className="admin-announcement-details-view__summary">
          <article>
            <span className="admin-announcement-details-view__summary-icon">
              <UserRound size={18} aria-hidden="true" />
            </span>
            <div>
              <small>Posted By</small>
              <strong>{announcement.created_by || "Unknown"}</strong>
            </div>
          </article>

          <article>
            <span className="admin-announcement-details-view__summary-icon">
              <UsersRound size={18} aria-hidden="true" />
            </span>
            <div>
              <small>Recipients</small>
              <strong>
                {announcement.recipients.length > 0
                  ? announcement.recipients
                      .map((role) => role.role_name)
                      .join(", ")
                  : "None"}
              </strong>
            </div>
          </article>

          <article>
            <span className="admin-announcement-details-view__summary-icon">
              <CalendarDays size={18} aria-hidden="true" />
            </span>
            <div>
              <small>Published</small>
              <strong>
                {formatDate(announcement.publish_date, "No publish date")}
              </strong>
            </div>
          </article>

          <article>
            <span className="admin-announcement-details-view__summary-icon">
              <Clock3 size={18} aria-hidden="true" />
            </span>
            <div>
              <small>Expires</small>
              <strong>
                {formatDate(announcement.expiry_date, "No Expiry")}
              </strong>
            </div>
          </article>
        </section>

        <div className="admin-announcement-details-view__grid">
          <section className="admin-announcement-details-view__card">
            <header className="admin-announcement-details-view__card-header">
              <span className="admin-announcement-details-view__section-icon">
                <FileText size={17} aria-hidden="true" />
              </span>
              <div>
                <span>Announcement</span>
                <h2>Content</h2>
              </div>
            </header>

            <div className="admin-announcement-details-view__content">
              {announcement.content}
            </div>
          </section>

          <section className="admin-announcement-details-view__card">
            <header className="admin-announcement-details-view__card-header">
              <span className="admin-announcement-details-view__section-icon">
                <ShieldCheck size={17} aria-hidden="true" />
              </span>
              <div>
                <span>Record</span>
                <h2>Announcement Information</h2>
              </div>
            </header>

            <div className="admin-announcement-details-view__info-list">
              <div>
                <span>Announcement ID</span>
                <strong>{announcement.announcement_id}</strong>
              </div>
              <div>
                <span>Created</span>
                <strong>{formatDateTime(announcement.created_at)}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{isActive ? "Active" : "Inactive"}</strong>
              </div>
            </div>
          </section>

          <section className="admin-announcement-details-view__card admin-announcement-details-view__card--wide">
            <header className="admin-announcement-details-view__card-header">
              <span className="admin-announcement-details-view__section-icon">
                <Paperclip size={17} aria-hidden="true" />
              </span>
              <div>
                <span>Files</span>
                <h2>Attachments</h2>
              </div>
            </header>

            {announcement.attachments.length === 0 ? (
              <div className="admin-announcement-details-view__empty">
                <Paperclip size={19} aria-hidden="true" />
                <span>No attachments.</span>
              </div>
            ) : (
              <div className="admin-announcement-details-view__attachments">
                {announcement.attachments.map((file) => {
                  const fileSize = formatFileSize(file.file_size);

                  return (
                    <button
                      key={file.file_id}
                      type="button"
                      className="admin-announcement-details-view__attachment"
                      onClick={async () => {
                        try {
                          await fileService.openFile(file.file_id);
                        } catch (fileError) {
                          console.error(
                            "OPEN ADMIN ANNOUNCEMENT ATTACHMENT ERROR:",
                            fileError,
                          );

                          window.alert(
                            fileError instanceof Error
                              ? fileError.message
                              : "Unable to open attachment.",
                          );
                        }
                      }}
                    >
                      <span className="admin-announcement-details-view__attachment-icon">
                        <FileText size={17} aria-hidden="true" />
                      </span>

                      <span className="admin-announcement-details-view__attachment-copy">
                        <strong>{file.original_name}</strong>
                        <small>
                          {[file.mime_type, fileSize]
                            .filter(Boolean)
                            .join(" · ") || "Attachment"}
                        </small>
                      </span>

                      <Download size={16} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </DashboardLayout>
  );
}
