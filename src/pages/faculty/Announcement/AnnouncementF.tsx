import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  CircleAlert,
  Megaphone,
  RefreshCw,
  Search,
  UserRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/announcementFaculty.css";

const API_BASE_URL = "http://localhost:3000";

interface Announcement {
  announcement_id: number;
  title: string;
  content: string;
  created_by: string | null;
  publish_date: string;
  expiry_date: string | null;
  is_active: number;
  created_at: string;
  recipients?:
    | string
    | string[]
    | {
        role_id?: number;
        role_name?: string;
      }[]
    | null;
  attachments?: string | null;
}

type AnnouncementListResponse =
  | Announcement[]
  | {
      success?: boolean;
      announcements?: Announcement[];
      data?: Announcement[];
      message?: string;
      error?: string;
    };

function formatDate(value: string | null | undefined) {
  if (!value) return "Date unavailable";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatAuthor(value: string | null | undefined) {
  return value?.trim() || "PTC Administration";
}

function isFacultyAudience(
  recipients: Announcement["recipients"],
) {
  if (typeof recipients === "string") {
    return recipients
      .split(",")
      .map((role) => role.trim().toLowerCase())
      .includes("faculty");
  }

  if (Array.isArray(recipients)) {
    return recipients.some((recipient) => {
      if (typeof recipient === "string") {
        return recipient.trim().toLowerCase() === "faculty";
      }

      return (
        String(recipient.role_name || "")
          .trim()
          .toLowerCase() === "faculty"
      );
    });
  }

  return false;
}

function getPreview(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= 190) {
    return normalized;
  }

  return `${normalized.slice(0, 190).trimEnd()}…`;
}

function isRecent(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  return Date.now() - date.getTime() <= sevenDays;
}

export default function AnnouncementF() {
  const navigate = useNavigate();

  const user = authService.getSession();
  const token = authService.getToken();
  const authenticated = Boolean(user && token);
  const userRole = user?.role;

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

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

    const loadAnnouncements = async () => {
      try {
        if (refreshKey === 0) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }

        setError("");

        const response = await authService.authFetch(
          `${API_BASE_URL}/api/announcements`,
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

        const data = (await response.json()) as AnnouncementListResponse;

        if (response.status === 403) {
          const message =
            !Array.isArray(data) && data
              ? data.message || data.error
              : undefined;

          throw new Error(message || "Faculty access is required.");
        }

        if (!response.ok) {
          const message =
            !Array.isArray(data) && data
              ? data.message || data.error
              : undefined;

          throw new Error(message || "Unable to load announcements.");
        }

        let rows: Announcement[] = [];

        if (Array.isArray(data)) {
          rows = data;
        } else if (Array.isArray(data.announcements)) {
          rows = data.announcements;
        } else if (Array.isArray(data.data)) {
          rows = data.data;
        }
        const facultyAnnouncements = rows.filter((announcement) =>
          isFacultyAudience(announcement.recipients),
        );

        setAnnouncements(facultyAnnouncements);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD FACULTY ANNOUNCEMENTS ERROR:", requestError);
        setAnnouncements([]);

        if (requestError instanceof TypeError) {
          setError(
            "Unable to connect to the announcement server. Make sure the backend is running on port 3000.",
          );
          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load announcements.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void loadAnnouncements();

    return () => controller.abort();
  }, [authenticated, userRole, navigate, refreshKey]);

  const filteredAnnouncements = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return announcements;
    }

    return announcements.filter((announcement) => {
      const searchableText = [
        announcement.title,
        announcement.content,
        announcement.created_by || "",
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(query);
    });
  }, [announcements, search]);

  const recentCount = useMemo(
    () =>
      announcements.filter((announcement) =>
        isRecent(announcement.publish_date),
      ).length,
    [announcements],
  );

  const latestAnnouncement = announcements[0] || null;

  if (!authenticated || !user || userRole !== "Faculty") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="faculty-announcements">
        <section className="faculty-announcements__hero">
          <div className="faculty-announcements__hero-copy">
            <div className="faculty-announcements__eyebrow">
              <span className="faculty-announcements__eyebrow-icon">
                <Megaphone size={16} strokeWidth={2.2} />
              </span>
              Faculty · Announcements
            </div>

            <h1>Announcements</h1>

            <p>
              Stay informed with official notices, academic reminders, and
              portal updates intended for faculty members.
            </p>
          </div>

          <button
            type="button"
            className="faculty-announcements__refresh"
            onClick={() => setRefreshKey((current) => current + 1)}
            disabled={loading || refreshing}
          >
            <RefreshCw
              size={16}
              className={refreshing ? "is-spinning" : ""}
            />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </section>

        <section
          className="faculty-announcements__summary"
          aria-label="Announcement overview"
        >
          <article className="faculty-announcements__summary-card faculty-announcements__summary-card--primary">
            <span className="faculty-announcements__summary-icon">
              <Megaphone size={19} />
            </span>

            <div>
              <span>Available</span>
              <strong>{loading ? "…" : announcements.length}</strong>
              <small>Announcements visible to faculty</small>
            </div>
          </article>

          <article className="faculty-announcements__summary-card">
            <span className="faculty-announcements__summary-icon">
              <CalendarDays size={19} />
            </span>

            <div>
              <span>Recent</span>
              <strong>{loading ? "…" : recentCount}</strong>
              <small>Published within the last 7 days</small>
            </div>
          </article>

          <article className="faculty-announcements__summary-card">
            <span className="faculty-announcements__summary-icon">
              <UserRound size={19} />
            </span>

            <div>
              <span>Latest From</span>
              <strong className="faculty-announcements__summary-author">
                {loading
                  ? "…"
                  : latestAnnouncement
                    ? formatAuthor(latestAnnouncement.created_by)
                    : "—"}
              </strong>
              <small>
                {latestAnnouncement
                  ? formatDate(latestAnnouncement.publish_date)
                  : "No announcement available"}
              </small>
            </div>
          </article>
        </section>

        <section className="faculty-announcements__panel">
          <header className="faculty-announcements__panel-header">
            <div>
              <span className="faculty-announcements__panel-kicker">
                Faculty Notices
              </span>
              <h2>Latest Announcements</h2>
              <p>
                Only active, published, and currently available announcements
                intended for your Faculty role are shown here.
              </p>
            </div>

            <label className="faculty-announcements__search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search announcements"
                aria-label="Search announcements"
              />
            </label>
          </header>

          {loading && (
            <div
              className="faculty-announcements__loading"
              aria-live="polite"
            >
              {[1, 2, 3, 4].map((item) => (
                <div
                  className="faculty-announcements__skeleton"
                  key={item}
                >
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          )}

          {!loading && error && (
            <div
              className="faculty-announcements__state faculty-announcements__state--error"
              role="alert"
            >
              <span className="faculty-announcements__state-icon">
                <CircleAlert size={24} />
              </span>

              <div>
                <strong>Announcements could not be loaded</strong>
                <p>{error}</p>
              </div>

              <button
                type="button"
                onClick={() => setRefreshKey((current) => current + 1)}
              >
                Try Again
              </button>
            </div>
          )}

          {!loading &&
            !error &&
            announcements.length === 0 && (
              <div className="faculty-announcements__state">
                <span className="faculty-announcements__state-icon">
                  <Megaphone size={24} />
                </span>

                <div>
                  <strong>No announcements available</strong>
                  <p>
                    There are currently no active announcements for faculty.
                  </p>
                </div>
              </div>
            )}

          {!loading &&
            !error &&
            announcements.length > 0 &&
            filteredAnnouncements.length === 0 && (
              <div className="faculty-announcements__state">
                <span className="faculty-announcements__state-icon">
                  <Search size={24} />
                </span>

                <div>
                  <strong>No matching announcements</strong>
                  <p>
                    Try a different title, keyword, or announcement author.
                  </p>
                </div>

                <button type="button" onClick={() => setSearch("")}>
                  Clear Search
                </button>
              </div>
            )}

          {!loading &&
            !error &&
            filteredAnnouncements.length > 0 && (
              <div className="faculty-announcements__list">
                {filteredAnnouncements.map((announcement) => (
                  <article
                    key={announcement.announcement_id}
                    className="faculty-announcements__card"
                  >
                    <div className="faculty-announcements__card-accent" />

                    <div className="faculty-announcements__card-main">
                      <div className="faculty-announcements__card-top">
                        <span className="faculty-announcements__card-date">
                          <CalendarDays size={14} />
                          {formatDate(announcement.publish_date)}
                        </span>

                        {isRecent(announcement.publish_date) && (
                          <span className="faculty-announcements__new-badge">
                            New
                          </span>
                        )}
                      </div>

                      <h3>{announcement.title}</h3>

                      <p>{getPreview(announcement.content)}</p>

                      <div className="faculty-announcements__card-meta">
                        <span>
                          <UserRound size={14} />
                          Posted by{" "}
                          <strong>
                            {formatAuthor(announcement.created_by)}
                          </strong>
                        </span>

                        {announcement.attachments && (
                          <span className="faculty-announcements__attachment-note">
                            Attachment available
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="faculty-announcements__view"
                      onClick={() =>
                        navigate(
                          `/faculty/announcementDF/${announcement.announcement_id}`,
                        )
                      }
                    >
                      View Details
                    </button>
                  </article>
                ))}
              </div>
            )}
        </section>
      </main>
    </DashboardLayout>
  );
}
