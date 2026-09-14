import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleOff,
  Clock3,
  ExternalLink,
  FileText,
  Hash,
  Megaphone,
  Paperclip,
  Pencil,
  UserRound,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/announcementDetailR.css";

// =====================================================
// API
// =====================================================

const API_BASE_URL = "http://localhost:3000";
const FILE_BASE_URL = "http://localhost:3000";

// =====================================================
// TYPES
// =====================================================

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

interface AnnouncementDetailResponse {
  success?: boolean;
  data?: Announcement;
  announcement?: Announcement;
  message?: string;
  error?: string;
}

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "Not set";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Not set";

  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

// =====================================================
// COMPONENT
// =====================================================

export default function AnnouncementDetailR() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  // =====================================================
  // AUTHENTICATION
  // =====================================================

  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

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
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Registrar") {
      if (userRole) {
        navigate(authService.getDashboardRoute(userRole), { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [authenticated, userRole, navigate]);

  // =====================================================
  // LOAD ANNOUNCEMENT
  // =====================================================

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") {
      return;
    }

    const controller = new AbortController();

    const loadAnnouncement = async () => {
      try {
        setLoading(true);
        setError("");

        if (!id) {
          throw new Error("Announcement ID is missing.");
        }

        const announcementId = Number(id);

        if (!Number.isInteger(announcementId) || announcementId <= 0) {
          throw new Error("Invalid announcement ID.");
        }

        const url = `${API_BASE_URL}/api/announcement-management/${announcementId}`;

        console.log("GET REGISTRAR ANNOUNCEMENT DETAIL:", url);

        const response = await authService.authFetch(url, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

        const contentType = response.headers.get("content-type") || "";
        let data: Announcement | AnnouncementDetailResponse | null = null;

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
              "You are not authorized to manage this announcement.",
          );
        }

        if (!response.ok) {
          const responseObject =
            data && !("announcement_id" in data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              `Failed to load announcement (${response.status}).`,
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

        const normalizedAnnouncement: Announcement = {
          ...loadedAnnouncement,
          recipients: Array.isArray(loadedAnnouncement.recipients)
            ? loadedAnnouncement.recipients
            : [],
          attachments: Array.isArray(loadedAnnouncement.attachments)
            ? loadedAnnouncement.attachments
            : [],
        };

        console.log("REGISTRAR ANNOUNCEMENT DETAIL:", normalizedAnnouncement);
        setAnnouncement(normalizedAnnouncement);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        console.error("LOAD ANNOUNCEMENT DETAIL ERROR:", err);
        setAnnouncement(null);

        if (err instanceof TypeError) {
          setError(
            "Unable to connect to the announcement server. Make sure the backend is running on port 3000.",
          );
          return;
        }

        setError(err instanceof Error ? err.message : "Something went wrong.");
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

  if (!authenticated || !user || userRole !== "Registrar") {
    return null;
  }

  const isActive = Number(announcement?.is_active) === 1;

  return (
    <DashboardLayout>
      <main className="registrar-announcement-detail">
        <header className="registrar-announcement-detail__hero">
          <div className="registrar-announcement-detail__hero-copy">
            <div className="registrar-announcement-detail__eyebrow">
              <span className="registrar-announcement-detail__eyebrow-icon">
                <Megaphone size={16} strokeWidth={2.2} />
              </span>
              Registrar · Announcements
            </div>
            <h1>Announcement Details</h1>
            <p>
              Review the announcement content, audience, publication status, and
              attached files before making changes.
            </p>
          </div>

          <div className="registrar-announcement-detail__hero-actions">
            <button
              type="button"
              className="registrar-announcement-detail__button registrar-announcement-detail__button--secondary"
              onClick={() => navigate("/registrar/announcement/listR")}
            >
              <ArrowLeft size={17} />
              Announcements
            </button>

            {announcement && !loading && !error && (
              <button
                type="button"
                className="registrar-announcement-detail__button registrar-announcement-detail__button--primary"
                onClick={() =>
                  navigate(
                    `/registrar/announcement/editR/${announcement.announcement_id}`,
                  )
                }
              >
                <Pencil size={16} />
                Edit Announcement
              </button>
            )}
          </div>
        </header>

        {loading && (
          <div className="registrar-announcement-detail__loading" aria-live="polite">
            <div className="registrar-announcement-detail__skeleton-grid">
              {[1, 2, 3, 4].map((item) => (
                <div
                  key={item}
                  className="registrar-announcement-detail__skeleton-card"
                />
              ))}
            </div>
            <div className="registrar-announcement-detail__skeleton-workspace">
              <div className="registrar-announcement-detail__skeleton-main" />
              <div className="registrar-announcement-detail__skeleton-side" />
            </div>
          </div>
        )}

        {!loading && error && (
          <section className="registrar-announcement-detail__error" role="alert">
            <div className="registrar-announcement-detail__error-icon">
              <CircleOff size={24} />
            </div>
            <div>
              <span>Announcement unavailable</span>
              <h2>Unable to load announcement details</h2>
              <p>{error}</p>
            </div>
            <button
              type="button"
              className="registrar-announcement-detail__button registrar-announcement-detail__button--secondary"
              onClick={() => navigate("/registrar/announcement/listR")}
            >
              <ArrowLeft size={16} />
              Back to Announcements
            </button>
          </section>
        )}

        {!loading && !error && announcement && (
          <>
            <section className="registrar-announcement-detail__summary-grid">
              <article className="registrar-announcement-detail__summary-card">
                <span className="registrar-announcement-detail__summary-icon registrar-announcement-detail__summary-icon--primary">
                  {isActive ? <CheckCircle2 /> : <CircleOff />}
                </span>
                <div>
                  <span>Status</span>
                  <strong>{isActive ? "Active" : "Inactive"}</strong>
                  <small>
                    {isActive
                      ? "Visible according to publication rules"
                      : "Currently disabled for recipients"}
                  </small>
                </div>
              </article>

              <article className="registrar-announcement-detail__summary-card">
                <span className="registrar-announcement-detail__summary-icon">
                  <CalendarDays />
                </span>
                <div>
                  <span>Published</span>
                  <strong>{formatDateTime(announcement.publish_date)}</strong>
                  <small>Announcement publication date</small>
                </div>
              </article>

              <article className="registrar-announcement-detail__summary-card">
                <span className="registrar-announcement-detail__summary-icon">
                  <CalendarClock />
                </span>
                <div>
                  <span>Expiry</span>
                  <strong>{formatDateTime(announcement.expiry_date)}</strong>
                  <small>
                    {announcement.expiry_date
                      ? "Configured expiration date"
                      : "No expiration configured"}
                  </small>
                </div>
              </article>

              <article className="registrar-announcement-detail__summary-card">
                <span className="registrar-announcement-detail__summary-icon">
                  <UsersRound />
                </span>
                <div>
                  <span>Audience Groups</span>
                  <strong>{announcement.recipients.length}</strong>
                  <small>Recipient roles assigned</small>
                </div>
              </article>
            </section>

            <div className="registrar-announcement-detail__workspace-grid">
              <article className="registrar-announcement-detail__content-panel">
                <div className="registrar-announcement-detail__content-header">
                  <div className="registrar-announcement-detail__content-heading">
                    <span className="registrar-announcement-detail__section-kicker">
                      <FileText size={14} /> Announcement Content
                    </span>
                    <h2>{announcement.title}</h2>
                    <div className="registrar-announcement-detail__byline">
                      <UserRound size={15} />
                      Created by <strong>{announcement.created_by || "Unknown"}</strong>
                    </div>
                  </div>

                  <span
                    className={`registrar-announcement-detail__status-pill ${
                      isActive
                        ? "registrar-announcement-detail__status-pill--active"
                        : "registrar-announcement-detail__status-pill--inactive"
                    }`}
                  >
                    <span />
                    {isActive ? "Active" : "Inactive"}
                  </span>
                </div>

                <div className="registrar-announcement-detail__body">
                  {announcement.content}
                </div>
              </article>

              <aside className="registrar-announcement-detail__sidebar">
                <section className="registrar-announcement-detail__side-panel">
                  <div className="registrar-announcement-detail__side-header">
                    <span className="registrar-announcement-detail__side-icon">
                      <UsersRound size={18} />
                    </span>
                    <div>
                      <h3>Recipients</h3>
                      <p>Audience groups for this announcement</p>
                    </div>
                  </div>

                  {announcement.recipients.length > 0 ? (
                    <div className="registrar-announcement-detail__recipient-list">
                      {announcement.recipients.map((role) => (
                        <span
                          key={role.role_id}
                          className="registrar-announcement-detail__recipient-chip"
                        >
                          <UserRound size={14} />
                          {role.role_name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="registrar-announcement-detail__side-empty">
                      No recipients assigned.
                    </p>
                  )}
                </section>

                <section className="registrar-announcement-detail__side-panel">
                  <div className="registrar-announcement-detail__side-header">
                    <span className="registrar-announcement-detail__side-icon">
                      <Paperclip size={18} />
                    </span>
                    <div>
                      <h3>Attachments</h3>
                      <p>{announcement.attachments.length} file(s) attached</p>
                    </div>
                  </div>

                  {announcement.attachments.length > 0 ? (
                    <div className="registrar-announcement-detail__attachment-list">
                      {announcement.attachments.map((file) => {
                        const normalizedPath = file.file_path.replace(/\\/g, "/");
                        const attachmentUrl = `${FILE_BASE_URL}/${normalizedPath.replace(
                          /^\/+/,
                          "",
                        )}`;

                        return (
                          <a
                            key={file.file_id}
                            className="registrar-announcement-detail__attachment"
                            href={attachmentUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <span className="registrar-announcement-detail__attachment-icon">
                              <FileText size={17} />
                            </span>
                            <span>
                              <strong>{file.original_name}</strong>
                              <small>Open attachment</small>
                            </span>
                            <ExternalLink size={15} />
                          </a>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="registrar-announcement-detail__side-empty">
                      No attachments included.
                    </p>
                  )}
                </section>

                <section className="registrar-announcement-detail__side-panel">
                  <div className="registrar-announcement-detail__side-header">
                    <span className="registrar-announcement-detail__side-icon">
                      <Clock3 size={18} />
                    </span>
                    <div>
                      <h3>Record Information</h3>
                      <p>Announcement audit details</p>
                    </div>
                  </div>

                  <dl className="registrar-announcement-detail__record-list">
                    <div>
                      <dt>
                        <Hash size={14} /> Record ID
                      </dt>
                      <dd>#{announcement.announcement_id}</dd>
                    </div>
                    <div>
                      <dt>
                        <Clock3 size={14} /> Created At
                      </dt>
                      <dd>{formatDateTime(announcement.created_at)}</dd>
                    </div>
                    <div>
                      <dt>
                        <UserRound size={14} /> Created By
                      </dt>
                      <dd>{announcement.created_by || "Unknown"}</dd>
                    </div>
                  </dl>
                </section>
              </aside>
            </div>
          </>
        )}
      </main>
    </DashboardLayout>
  );
}
