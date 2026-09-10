import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileText,
  Megaphone,
  Paperclip,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/announcementDetailsStudent.css";

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
  if (!value) {
    return "Not available";
  }

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

function includesStudentAudience(recipients: Recipient[] | undefined) {
  return (
    Array.isArray(recipients) &&
    recipients.some(
      (recipient) =>
        String(recipient.role_name || "").trim().toLowerCase() === "student",
    )
  );
}

function formatAudience(recipients: Recipient[] | undefined) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return "Student";
  }

  const names = Array.from(
    new Set(
      recipients
        .map((recipient) => String(recipient.role_name || "").trim())
        .filter(Boolean),
    ),
  );

  return names.length > 0 ? names.join(", ") : "Student";
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

function formatFileType(mimeType: string) {
  const value = String(mimeType || "").trim().toLowerCase();

  if (!value) {
    return "File";
  }

  if (value.includes("pdf")) {
    return "PDF";
  }

  if (value.includes("word")) {
    return "Word document";
  }

  if (value.includes("sheet") || value.includes("excel")) {
    return "Spreadsheet";
  }

  if (value.includes("presentation") || value.includes("powerpoint")) {
    return "Presentation";
  }

  if (value.startsWith("image/")) {
    return "Image";
  }

  return mimeType;
}

function buildFileUrl(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");

  return `${FILE_BASE_URL}/${normalized}`;
}

export default function AnnouncementDetailsS() {
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

    if (userRole !== "Student") {
      if (userRole) {
        navigate(authService.getDashboardRoute(userRole), { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [authenticated, userRole, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Student") {
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

          throw new Error(message || "Student access is required.");
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

        if (!includesStudentAudience(normalizedRecipients)) {
          throw new Error(
            "This announcement is not available for the Student audience.",
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

        console.error("LOAD STUDENT ANNOUNCEMENT DETAIL ERROR:", requestError);
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

  if (!authenticated || !user || userRole !== "Student") {
    return null;
  }

  const attachmentCount = announcement?.attachments?.length || 0;

  return (
    <DashboardLayout>
      <main className="student-announcement-detail">
        <section className="student-announcement-detail__hero">
          <div className="student-announcement-detail__hero-copy">
            <div className="student-announcement-detail__eyebrow">
              <span className="student-announcement-detail__eyebrow-icon">
                <Megaphone size={16} strokeWidth={2.2} />
              </span>
              Student · Announcements
            </div>

            <h1>Announcement Details</h1>

            <p>
              Read the complete notice, review its publication information, and
              open any files shared with students.
            </p>
          </div>

          <button
            type="button"
            className="student-announcement-detail__back"
            onClick={() => navigate("/student/announcement")}
          >
            <ArrowLeft size={16} strokeWidth={2.1} />
            Back to Announcements
          </button>
        </section>

        {loading && (
          <section
            className="student-announcement-detail__loading"
            aria-live="polite"
          >
            <div className="student-announcement-detail__skeleton student-announcement-detail__skeleton--badge" />
            <div className="student-announcement-detail__skeleton student-announcement-detail__skeleton--title" />

            <div className="student-announcement-detail__skeleton-grid">
              <div className="student-announcement-detail__skeleton" />
              <div className="student-announcement-detail__skeleton" />
              <div className="student-announcement-detail__skeleton" />
            </div>

            <div className="student-announcement-detail__skeleton student-announcement-detail__skeleton--content" />
          </section>
        )}

        {!loading && error && (
          <section
            className="student-announcement-detail__state student-announcement-detail__state--error"
            role="alert"
          >
            <span className="student-announcement-detail__state-icon">
              <CircleAlert size={22} strokeWidth={2} />
            </span>

            <div>
              <strong>Announcement could not be loaded</strong>
              <p>{error}</p>
            </div>

            <button
              type="button"
              onClick={() => navigate("/student/announcement")}
            >
              <ArrowLeft size={14} />
              Back to Announcements
            </button>
          </section>
        )}

        {!loading && !error && announcement && (
          <div className="student-announcement-detail__workspace">
            <article className="student-announcement-detail__notice">
              <header className="student-announcement-detail__notice-header">
                <div className="student-announcement-detail__notice-tags">
                  <span className="student-announcement-detail__official-badge">
                    <ShieldCheck size={14} />
                    Official Student Notice
                  </span>

                  <span className="student-announcement-detail__audience-badge">
                    <UsersRound size={14} />
                    Student Audience
                  </span>
                </div>

                <h2>{announcement.title}</h2>

                <div className="student-announcement-detail__byline">
                  <span className="student-announcement-detail__byline-avatar">
                    <UserRound size={16} />
                  </span>

                  <div>
                    <span>Posted by</span>
                    <strong>{formatAuthor(announcement.created_by)}</strong>
                  </div>

                  <span className="student-announcement-detail__byline-divider" />

                  <div>
                    <span>Published</span>
                    <strong>{formatDateTime(announcement.publish_date)}</strong>
                  </div>
                </div>
              </header>

              <section className="student-announcement-detail__content">
                <div className="student-announcement-detail__section-heading">
                  <span className="student-announcement-detail__section-icon">
                    <FileText size={17} />
                  </span>

                  <div>
                    <span>Announcement</span>
                    <h3>Message</h3>
                  </div>
                </div>

                <div className="student-announcement-detail__message">
                  {announcement.content}
                </div>
              </section>
            </article>

            <aside className="student-announcement-detail__sidebar">
              <section className="student-announcement-detail__info-card">
                <header>
                  <span>Notice Information</span>
                  <h3>Details</h3>
                </header>

                <div className="student-announcement-detail__info-list">
                  <div>
                    <span className="student-announcement-detail__info-icon">
                      <UsersRound size={15} />
                    </span>

                    <div>
                      <small>Audience</small>
                      <strong>
                        {formatAudience(announcement.recipients)}
                      </strong>
                    </div>
                  </div>

                  <div>
                    <span className="student-announcement-detail__info-icon">
                      <CalendarDays size={15} />
                    </span>

                    <div>
                      <small>Published</small>
                      <strong>
                        {formatDateTime(announcement.publish_date)}
                      </strong>
                    </div>
                  </div>

                  <div>
                    <span className="student-announcement-detail__info-icon">
                      <Clock3 size={15} />
                    </span>

                    <div>
                      <small>Available Until</small>
                      <strong>
                        {announcement.expiry_date
                          ? formatDateTime(announcement.expiry_date)
                          : "No expiry date"}
                      </strong>
                    </div>
                  </div>

                  <div>
                    <span className="student-announcement-detail__info-icon">
                      <Paperclip size={15} />
                    </span>

                    <div>
                      <small>Attachments</small>
                      <strong>
                        {attachmentCount} file
                        {attachmentCount === 1 ? "" : "s"}
                      </strong>
                    </div>
                  </div>
                </div>
              </section>

              <div className="student-announcement-detail__notice-note">
                <ShieldCheck size={17} />

                <div>
                  <strong>Official portal notice</strong>
                  <p>
                    This announcement was published for the Student audience in
                    the PTC Portal.
                  </p>
                </div>
              </div>
            </aside>

            {attachmentCount > 0 && (
              <section className="student-announcement-detail__attachments">
                <header className="student-announcement-detail__attachments-header">
                  <div>
                    <span className="student-announcement-detail__attachment-heading-icon">
                      <Paperclip size={17} />
                    </span>

                    <div>
                      <span>Shared Files</span>
                      <h3>Attachments</h3>
                      <p>
                        Open the files included with this announcement in a new
                        browser tab.
                      </p>
                    </div>
                  </div>

                  <span className="student-announcement-detail__attachment-count">
                    {attachmentCount}
                  </span>
                </header>

                <div className="student-announcement-detail__attachment-list">
                  {announcement.attachments?.map((file) => (
                    <a
                      key={file.file_id}
                      href={buildFileUrl(file.file_path)}
                      target="_blank"
                      rel="noreferrer"
                      className="student-announcement-detail__attachment"
                    >
                      <span className="student-announcement-detail__file-icon">
                        <FileText size={17} />
                      </span>

                      <div className="student-announcement-detail__file-copy">
                        <strong title={file.original_name}>
                          {file.original_name}
                        </strong>

                        <small>
                          {formatFileType(file.mime_type)} ·{" "}
                          {formatFileSize(file.file_size)}
                        </small>
                      </div>

                      <span className="student-announcement-detail__file-action">
                        Open
                        <ExternalLink size={14} />
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
