import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  BellRing,
  BookOpenCheck,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  GraduationCap,
  Megaphone,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/announcementProgramHead.css";

const API_BASE_URL = "http://localhost:3000";

interface AnnouncementRecipient {
  role_id?: number;
  role_name?: string;
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
  recipients?:
    | string
    | string[]
    | AnnouncementRecipient[]
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

type AnnouncementCategory =
  | "All"
  | "Grades"
  | "Faculty"
  | "Enrollment"
  | "Academic"
  | "General";

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Date unavailable";
  }

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

function getPreview(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= 190) {
    return normalized;
  }

  return `${normalized.slice(0, 190).trimEnd()}…`;
}

function getAnnouncementCategory(
  announcement: Announcement,
): Exclude<AnnouncementCategory, "All"> {
  const value =
    `${announcement.title} ${announcement.content}`.toLowerCase();

  if (
    value.includes("grade") ||
    value.includes("grading") ||
    value.includes("prelim") ||
    value.includes("midterm") ||
    value.includes("final rating")
  ) {
    return "Grades";
  }

  if (
    value.includes("faculty") ||
    value.includes("instructor") ||
    value.includes("evaluation")
  ) {
    return "Faculty";
  }

  if (
    value.includes("enrollment") ||
    value.includes("enrolment") ||
    value.includes("registration") ||
    value.includes("admission")
  ) {
    return "Enrollment";
  }

  if (
    value.includes("academic") ||
    value.includes("semester") ||
    value.includes("curriculum") ||
    value.includes("schedule") ||
    value.includes("subject") ||
    value.includes("section") ||
    value.includes("class")
  ) {
    return "Academic";
  }

  return "General";
}

function isExpiringSoon(announcement: Announcement) {
  if (!announcement.expiry_date) {
    return false;
  }

  const expiryDate = new Date(announcement.expiry_date);

  if (Number.isNaN(expiryDate.getTime())) {
    return false;
  }

  const difference = expiryDate.getTime() - Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  return difference >= 0 && difference <= sevenDays;
}

function isCurrentlyAvailable(announcement: Announcement) {
  if (Number(announcement.is_active) !== 1) {
    return false;
  }

  const now = Date.now();
  const publishDate = new Date(announcement.publish_date);

  if (
    !Number.isNaN(publishDate.getTime()) &&
    publishDate.getTime() > now
  ) {
    return false;
  }

  if (announcement.expiry_date) {
    const expiryDate = new Date(announcement.expiry_date);

    if (
      !Number.isNaN(expiryDate.getTime()) &&
      expiryDate.getTime() < now
    ) {
      return false;
    }
  }

  return true;
}

function isProgramHeadAudience(
  recipients: Announcement["recipients"],
) {
  if (recipients === null || recipients === undefined) {
    return true;
  }

  if (typeof recipients === "string") {
    return recipients
      .split(",")
      .map((role) => role.trim().toLowerCase())
      .includes("program head");
  }

  if (Array.isArray(recipients)) {
    return recipients.some((recipient) => {
      if (typeof recipient === "string") {
        return recipient.trim().toLowerCase() === "program head";
      }

      return (
        String(recipient.role_name || "")
          .trim()
          .toLowerCase() === "program head"
      );
    });
  }

  return true;
}

function needsProgramHeadAttention(
  announcement: Announcement,
) {
  const value =
    `${announcement.title} ${announcement.content}`.toLowerCase();

  const keywords = [
    "urgent",
    "important",
    "deadline",
    "required",
    "requirement",
    "submit",
    "submission",
    "approval",
    "approve",
    "grade",
    "faculty",
    "evaluation",
    "meeting",
    "enrollment",
    "registration",
    "compliance",
    "reminder",
    "action required",
  ];

  return (
    isExpiringSoon(announcement) ||
    keywords.some((keyword) => value.includes(keyword))
  );
}

function getCategoryIcon(
  category: Exclude<AnnouncementCategory, "All">,
) {
  switch (category) {
    case "Grades":
      return <ClipboardCheck size={17} />;

    case "Faculty":
      return <UsersRound size={17} />;

    case "Enrollment":
      return <GraduationCap size={17} />;

    case "Academic":
      return <BookOpenCheck size={17} />;

    default:
      return <Megaphone size={17} />;
  }
}

export default function AnnouncementProg() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();
  const authenticated = Boolean(session && token);
  const userRole = session?.role;

  const [announcements, setAnnouncements] =
    useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [category, setCategory] =
    useState<AnnouncementCategory>("All");
  const [attentionOnly, setAttentionOnly] =
    useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Program Head") {
      navigate(authService.getDashboardRoute(session!.role), {
        replace: true,
      });
    }
  }, [authenticated, userRole, session, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Program Head") {
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

        const contentType =
          response.headers.get("content-type") || "";

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
          AnnouncementListResponse;

        if (response.status === 403) {
          const message = Array.isArray(data)
            ? undefined
            : data.message || data.error;

          throw new Error(
            message || "Program Head access is required.",
          );
        }

        if (!response.ok) {
          const message = Array.isArray(data)
            ? undefined
            : data.message || data.error;

          throw new Error(
            message || "Unable to load announcements.",
          );
        }

        let rows: Announcement[] = [];

        if (Array.isArray(data)) {
          rows = data;
        } else if (Array.isArray(data.announcements)) {
          rows = data.announcements;
        } else if (Array.isArray(data.data)) {
          rows = data.data;
        }

        setAnnouncements(
          rows.filter(
            (announcement) =>
              isCurrentlyAvailable(announcement) &&
              isProgramHeadAudience(announcement.recipients),
          ),
        );
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error(
          "LOAD PROGRAM HEAD ANNOUNCEMENTS ERROR:",
          requestError,
        );

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
  }, [
    authenticated,
    userRole,
    navigate,
    refreshKey,
  ]);

  const summary = useMemo(() => {
    return {
      total: announcements.length,
      attention: announcements.filter(
        needsProgramHeadAttention,
      ).length,
      grades: announcements.filter(
        (announcement) =>
          getAnnouncementCategory(announcement) === "Grades",
      ).length,
      expiring: announcements.filter(isExpiringSoon).length,
    };
  }, [announcements]);

  const filteredAnnouncements = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return announcements
      .filter((announcement) => {
        const announcementCategory =
          getAnnouncementCategory(announcement);

        const matchesCategory =
          category === "All" ||
          category === announcementCategory;

        const matchesAttention =
          !attentionOnly ||
          needsProgramHeadAttention(announcement);

        const matchesSearch =
          !normalizedSearch ||
          announcement.title
            .toLowerCase()
            .includes(normalizedSearch) ||
          announcement.content
            .toLowerCase()
            .includes(normalizedSearch) ||
          String(announcement.created_by || "")
            .toLowerCase()
            .includes(normalizedSearch);

        return (
          matchesCategory &&
          matchesAttention &&
          matchesSearch
        );
      })
      .sort((a, b) => {
        const aAttention =
          needsProgramHeadAttention(a) ? 1 : 0;
        const bAttention =
          needsProgramHeadAttention(b) ? 1 : 0;

        if (aAttention !== bAttention) {
          return bAttention - aAttention;
        }

        return (
          new Date(
            b.publish_date || b.created_at,
          ).getTime() -
          new Date(
            a.publish_date || a.created_at,
          ).getTime()
        );
      });
  }, [
    announcements,
    search,
    category,
    attentionOnly,
  ]);

  const hasActiveFilters =
    search.trim() !== "" ||
    category !== "All" ||
    attentionOnly;

  const clearFilters = () => {
    setSearch("");
    setCategory("All");
    setAttentionOnly(false);
  };

  if (
    !authenticated ||
    !session ||
    userRole !== "Program Head"
  ) {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="programhead-announcements">
        <section className="programhead-announcements__hero">
          <div className="programhead-announcements__hero-copy">
            <div className="programhead-announcements__eyebrow">
              <span>
                <Megaphone size={16} strokeWidth={2.2} />
              </span>
              Program Head · Announcements
            </div>

            <h1>Announcements</h1>

            <p>
              Review official notices available to your Program Head
              account and prioritize grade, Faculty, enrollment, and
              academic updates that may require attention.
            </p>
          </div>

          <button
            type="button"
            className="programhead-announcements__refresh"
            onClick={() =>
              setRefreshKey((current) => current + 1)
            }
            disabled={loading || refreshing}
          >
            <RefreshCw
              size={16}
              className={
                refreshing
                  ? "programhead-announcements__spin"
                  : ""
              }
            />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </section>

        <section
          className="programhead-announcements__summary"
          aria-label="Announcement summary"
        >
          <article className="programhead-announcements__stat programhead-announcements__stat--primary">
            <span className="programhead-announcements__stat-icon">
              <Megaphone size={19} />
            </span>

            <div>
              <small>Available Notices</small>
              <strong>{loading ? "…" : summary.total}</strong>
              <span>Active notices for Program Head</span>
            </div>
          </article>

          <article className="programhead-announcements__stat">
            <span className="programhead-announcements__stat-icon programhead-announcements__stat-icon--attention">
              <BellRing size={19} />
            </span>

            <div>
              <small>Needs Attention</small>
              <strong>{loading ? "…" : summary.attention}</strong>
              <span>Notices with possible follow-up</span>
            </div>
          </article>

          <article className="programhead-announcements__stat">
            <span className="programhead-announcements__stat-icon">
              <ClipboardCheck size={19} />
            </span>

            <div>
              <small>Grade Notices</small>
              <strong>{loading ? "…" : summary.grades}</strong>
              <span>Grade-related announcements</span>
            </div>
          </article>

          <article className="programhead-announcements__stat">
            <span className="programhead-announcements__stat-icon">
              <CalendarClock size={19} />
            </span>

            <div>
              <small>Expiring Soon</small>
              <strong>{loading ? "…" : summary.expiring}</strong>
              <span>Within the next seven days</span>
            </div>
          </article>
        </section>

        <section className="programhead-announcements__filters">
          <header className="programhead-announcements__filters-header">
            <div>
              <span className="programhead-announcements__filters-icon">
                <Search size={16} />
              </span>

              <div>
                <strong>Find Announcements</strong>
                <p>
                  Search notices or narrow the list by category and
                  attention status.
                </p>
              </div>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                className="programhead-announcements__clear"
                onClick={clearFilters}
              >
                <RotateCcw size={14} />
                Clear Filters
              </button>
            )}
          </header>

          <div className="programhead-announcements__filter-grid">
            <label className="programhead-announcements__search">
              <span>Search</span>

              <div>
                <Search size={15} />

                <input
                  type="search"
                  value={search}
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
                  placeholder="Title, message, or author..."
                />
              </div>
            </label>

            <label className="programhead-announcements__category">
              <span>Category</span>

              <select
                value={category}
                onChange={(event) =>
                  setCategory(
                    event.target
                      .value as AnnouncementCategory,
                  )
                }
              >
                <option value="All">All Categories</option>
                <option value="Grades">Grade Review</option>
                <option value="Faculty">Faculty</option>
                <option value="Enrollment">Enrollment</option>
                <option value="Academic">Academic</option>
                <option value="General">General</option>
              </select>
            </label>

            <button
              type="button"
              className={`programhead-announcements__attention-toggle ${
                attentionOnly ? "is-active" : ""
              }`}
              onClick={() =>
                setAttentionOnly((current) => !current)
              }
              aria-pressed={attentionOnly}
            >
              <BellRing size={15} />
              <span>
                <small>Priority Filter</small>
                <strong>Needs Attention</strong>
              </span>
            </button>
          </div>
        </section>

        {error && !loading && (
          <section
            className="programhead-announcements__error"
            role="alert"
          >
            <span>
              <AlertCircle size={20} />
            </span>

            <div>
              <strong>Announcements could not be loaded</strong>
              <p>{error}</p>
            </div>

            <button
              type="button"
              onClick={() =>
                setRefreshKey((current) => current + 1)
              }
            >
              Try Again
            </button>
          </section>
        )}

        {loading && (
          <section className="programhead-announcements__panel">
            <header className="programhead-announcements__panel-header">
              <div>
                <span>Program Head Notices</span>
                <h2>Announcement Feed</h2>
                <p>
                  Retrieving notices available to your account.
                </p>
              </div>
            </header>

            <div className="programhead-announcements__skeleton-list">
              {[1, 2, 3].map((item) => (
                <div
                  className="programhead-announcements__skeleton"
                  key={item}
                >
                  <i />

                  <span>
                    <i />
                    <i />
                    <i />
                  </span>

                  <i />
                </div>
              ))}
            </div>
          </section>
        )}

        {!loading && !error && (
          <section className="programhead-announcements__panel">
            <header className="programhead-announcements__panel-header">
              <div>
                <span>Program Head Notices</span>
                <h2>Announcement Feed</h2>
                <p>
                  Important notices are prioritized first, followed
                  by the newest published announcements.
                </p>
              </div>

              <strong className="programhead-announcements__result-count">
                {filteredAnnouncements.length}{" "}
                {filteredAnnouncements.length === 1
                  ? "notice"
                  : "notices"}
              </strong>
            </header>

            {filteredAnnouncements.length === 0 ? (
              <div className="programhead-announcements__empty">
                <span>
                  <CheckCircle2 size={23} />
                </span>

                <strong>
                  {announcements.length === 0
                    ? "No announcements available"
                    : "No announcements found"}
                </strong>

                <p>
                  {announcements.length === 0
                    ? "There are currently no active notices available to the Program Head role."
                    : "No notices match the current search and filter settings."}
                </p>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                  >
                    <RotateCcw size={14} />
                    Clear Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="programhead-announcements__list">
                {filteredAnnouncements.map((item) => {
                  const itemCategory =
                    getAnnouncementCategory(item);
                  const attention =
                    needsProgramHeadAttention(item);
                  const expiring = isExpiringSoon(item);

                  return (
                    <article
                      className={`programhead-announcements__card ${
                        attention
                          ? "programhead-announcements__card--attention"
                          : ""
                      }`}
                      key={item.announcement_id}
                    >
                      <span className="programhead-announcements__card-accent" />

                      <span
                        className={`programhead-announcements__category-icon programhead-announcements__category-icon--${itemCategory.toLowerCase()}`}
                      >
                        {getCategoryIcon(itemCategory)}
                      </span>

                      <div className="programhead-announcements__card-main">
                        <div className="programhead-announcements__badges">
                          <span className="programhead-announcements__category-badge">
                            {itemCategory}
                          </span>

                          {attention && (
                            <span className="programhead-announcements__attention-badge">
                              <BellRing size={11} />
                              Needs Attention
                            </span>
                          )}

                          {expiring && (
                            <span className="programhead-announcements__expiry-badge">
                              <CalendarClock size={11} />
                              Expiring Soon
                            </span>
                          )}
                        </div>

                        <h3>{item.title}</h3>

                        <p>{getPreview(item.content)}</p>

                        <div className="programhead-announcements__meta">
                          <span>
                            <UserRound size={13} />
                            Posted by{" "}
                            <strong>
                              {formatAuthor(item.created_by)}
                            </strong>
                          </span>

                          <span>
                            <CalendarDays size={13} />
                            {formatDate(item.publish_date)}
                          </span>

                          {item.expiry_date && (
                            <span>
                              <CalendarClock size={13} />
                              Until {formatDate(item.expiry_date)}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        className="programhead-announcements__review"
                        onClick={() =>
                          navigate(
                            `/programhead/announcementprogD/${item.announcement_id}`,
                          )
                        }
                      >
                        Review
                        <ChevronRight size={15} />
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        <section className="programhead-announcements__access-note">
          <ShieldCheck size={17} />

          <div>
            <strong>Authenticated Program Head notices</strong>
            <p>
              Announcement visibility is determined by your signed-in
              Program Head role. The page does not send a role ID from
              the browser to request additional announcements.
            </p>
          </div>
        </section>
      </main>
    </DashboardLayout>
  );
}
