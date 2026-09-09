import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BellRing,
  BookOpenCheck,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  GraduationCap,
  Megaphone,
  Plus,
  RefreshCcw,
  Search,
  UserRound,
  UsersRound,
} from "lucide-react";

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

interface AnnouncementResponse {
  success?: boolean;
  announcements?: Announcement[];
  data?: Announcement[];
  message?: string;
  error?: string;
}

type AnnouncementCategory =
  | "All"
  | "Grades"
  | "Faculty"
  | "Enrollment"
  | "Academic"
  | "General";

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

  const expiryDate = new Date(
    announcement.expiry_date,
  );

  if (Number.isNaN(expiryDate.getTime())) {
    return false;
  }

  const difference =
    expiryDate.getTime() - Date.now();

  const sevenDays =
    7 * 24 * 60 * 60 * 1000;

  return difference >= 0 && difference <= sevenDays;
}

function isExpired(announcement: Announcement) {
  if (!announcement.expiry_date) {
    return false;
  }

  const expiryDate = new Date(
    announcement.expiry_date,
  );

  if (Number.isNaN(expiryDate.getTime())) {
    return false;
  }

  return expiryDate.getTime() < Date.now();
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
    keywords.some((keyword) =>
      value.includes(keyword),
    )
  );
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not specified";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not specified";
  }

  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getCategoryIcon(
  category: Exclude<
    AnnouncementCategory,
    "All"
  >,
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

  const [user] = useState(() =>
    authService.getSession(),
  );

  const [announcements, setAnnouncements] =
    useState<Announcement[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] = useState("");

  const [search, setSearch] =
    useState("");

  const [category, setCategory] =
    useState<AnnouncementCategory>("All");

  const [attentionOnly, setAttentionOnly] =
    useState(false);

  const [refreshKey, setRefreshKey] =
    useState(0);

  // =====================================================
  // LOAD ANNOUNCEMENTS
  // =====================================================

  useEffect(() => {
    const controller = new AbortController();

    async function loadAnnouncements() {
      try {
        setLoading(true);
        setError("");

        if (!user) {
          throw new Error(
            "User session not found.",
          );
        }

        if (user.role !== "Program Head") {
          navigate("/login", {
            replace: true,
          });

          return;
        }

        const response = await fetch(
          `${API_BASE_URL}/api/announcements?role_id=${user.role_id}`,
          {
            method: "GET",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          },
        );

        const contentType =
          response.headers.get(
            "content-type",
          ) || "";

        if (
          !contentType.includes(
            "application/json",
          )
        ) {
          const text =
            await response.text();

          throw new Error(
            `Server returned a non-JSON response (${response.status}): ${text.slice(
              0,
              200,
            )}`,
          );
        }

        const data = (await response.json()) as
          | Announcement[]
          | AnnouncementResponse;

        console.log(
          "PROGRAM HEAD ANNOUNCEMENTS:",
          data,
        );

        if (!response.ok) {
          const responseObject =
            Array.isArray(data)
              ? null
              : data;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              "Failed loading announcements.",
          );
        }

        let loadedAnnouncements: Announcement[] =
          [];

        if (Array.isArray(data)) {
          loadedAnnouncements = data;
        } else if (
          Array.isArray(data.announcements)
        ) {
          loadedAnnouncements =
            data.announcements;
        } else if (
          Array.isArray(data.data)
        ) {
          loadedAnnouncements =
            data.data;
        }

        setAnnouncements(
          loadedAnnouncements,
        );
      } catch (err) {
        if (
          err instanceof DOMException &&
          err.name === "AbortError"
        ) {
          return;
        }

        console.error(
          "PROGRAM HEAD ANNOUNCEMENTS ERROR:",
          err,
        );

        setAnnouncements([]);

        setError(
          err instanceof Error
            ? err.message
            : "Something went wrong.",
        );
      } finally {
        if (
          !controller.signal.aborted
        ) {
          setLoading(false);
        }
      }
    }

    void loadAnnouncements();

    return () => {
      controller.abort();
    };
  }, [user, navigate, refreshKey]);

  // =====================================================
  // ACTIVE ANNOUNCEMENTS
  // =====================================================

  const activeAnnouncements =
    useMemo(() => {
      return announcements.filter(
        (announcement) =>
          Number(
            announcement.is_active,
          ) !== 0 &&
          !isExpired(announcement),
      );
    }, [announcements]);

  // =====================================================
  // SUMMARY
  // =====================================================

  const summary = useMemo(() => {
    return {
      total:
        activeAnnouncements.length,

      attention:
        activeAnnouncements.filter(
          needsProgramHeadAttention,
        ).length,

      grades:
        activeAnnouncements.filter(
          (announcement) =>
            getAnnouncementCategory(
              announcement,
            ) === "Grades",
        ).length,

      expiring:
        activeAnnouncements.filter(
          isExpiringSoon,
        ).length,
    };
  }, [activeAnnouncements]);

  // =====================================================
  // FILTER
  // =====================================================

  const filteredAnnouncements =
    useMemo(() => {
      const normalizedSearch =
        search.trim().toLowerCase();

      return activeAnnouncements
        .filter((announcement) => {
          const announcementCategory =
            getAnnouncementCategory(
              announcement,
            );

          const matchesCategory =
            category === "All" ||
            category ===
              announcementCategory;

          const matchesAttention =
            !attentionOnly ||
            needsProgramHeadAttention(
              announcement,
            );

          const matchesSearch =
            !normalizedSearch ||
            announcement.title
              .toLowerCase()
              .includes(
                normalizedSearch,
              ) ||
            announcement.content
              .toLowerCase()
              .includes(
                normalizedSearch,
              ) ||
            announcement.created_by
              ?.toLowerCase()
              .includes(
                normalizedSearch,
              );

          return (
            matchesCategory &&
            matchesAttention &&
            matchesSearch
          );
        })
        .sort((a, b) => {
          const aAttention =
            needsProgramHeadAttention(a)
              ? 1
              : 0;

          const bAttention =
            needsProgramHeadAttention(b)
              ? 1
              : 0;

          if (
            aAttention !== bAttention
          ) {
            return (
              bAttention - aAttention
            );
          }

          return (
            new Date(
              b.publish_date ||
                b.created_at,
            ).getTime() -
            new Date(
              a.publish_date ||
                a.created_at,
            ).getTime()
          );
        });
    }, [
      activeAnnouncements,
      search,
      category,
      attentionOnly,
    ]);

  const clearFilters = () => {
    setSearch("");
    setCategory("All");
    setAttentionOnly(false);
  };

  if (
    !user ||
    user.role !== "Program Head"
  ) {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="announcement-student">
        {/* ===============================================
            HERO
        =============================================== */}

        <header className="programhead-announcement-hero">
          <div>
            <div className="programhead-announcement-eyebrow">
              <span>
                <Megaphone size={16} />
              </span>

              Program Head · Announcements
            </div>

            <h1>
              Announcement &amp; Action Center
            </h1>

            <p>
              Review school and department
              announcements, prioritize notices
              that require attention, and stay
              updated on grade, faculty, enrollment,
              and academic deadlines.
            </p>
          </div>

          <div className="programhead-announcement-hero-actions">
            <button
              type="button"
              className="programhead-announcement-create"
              onClick={() =>
                navigate("/programhead/announcement/create")
              }
            >
              <Plus size={16} />
              Create Announcement
            </button>

            <button
              type="button"
              className="programhead-announcement-refresh"
              onClick={() =>
                setRefreshKey(
                  (current) =>
                    current + 1,
                )
              }
              disabled={loading}
            >
              <RefreshCcw
                size={15}
                className={
                  loading
                    ? "programhead-refresh-spin"
                    : ""
                }
              />

              {loading
                ? "Refreshing..."
                : "Refresh"}
            </button>
          </div>
        </header>

        {/* ===============================================
            SUMMARY
        =============================================== */}

        <section className="programhead-announcement-summary">
          <div>
            <span className="programhead-summary-icon programhead-summary-icon-primary">
              <Megaphone size={18} />
            </span>

            <div>
              <span>Current Notices</span>
              <strong>
                {summary.total}
              </strong>
              <small>
                Active announcements
              </small>
            </div>
          </div>

          <div>
            <span className="programhead-summary-icon programhead-summary-icon-attention">
              <BellRing size={18} />
            </span>

            <div>
              <span>
                Needs Attention
              </span>
              <strong>
                {summary.attention}
              </strong>
              <small>
                Possible follow-up
              </small>
            </div>
          </div>

          <div>
            <span className="programhead-summary-icon">
              <ClipboardCheck
                size={18}
              />
            </span>

            <div>
              <span>Grade Notices</span>
              <strong>
                {summary.grades}
              </strong>
              <small>
                Grade-related updates
              </small>
            </div>
          </div>

          <div>
            <span className="programhead-summary-icon">
              <CalendarClock
                size={18}
              />
            </span>

            <div>
              <span>Expiring Soon</span>
              <strong>
                {summary.expiring}
              </strong>
              <small>
                Within seven days
              </small>
            </div>
          </div>
        </section>

        {/* ===============================================
            FILTERS
        =============================================== */}

        <section className="programhead-announcement-filters">
          <div className="programhead-announcement-search">
            <Search size={16} />

            <input
              type="text"
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value,
                )
              }
              placeholder="Search announcements..."
            />
          </div>

          <div className="programhead-category-filter">
            <label htmlFor="announcement-category">
              Category
            </label>

            <select
              id="announcement-category"
              value={category}
              onChange={(event) =>
                setCategory(
                  event.target
                    .value as AnnouncementCategory,
                )
              }
            >
              <option value="All">
                All Categories
              </option>

              <option value="Grades">
                Grade Review
              </option>

              <option value="Faculty">
                Faculty
              </option>

              <option value="Enrollment">
                Enrollment
              </option>

              <option value="Academic">
                Academic
              </option>

              <option value="General">
                General
              </option>
            </select>
          </div>

          <button
            type="button"
            className={`programhead-attention-filter ${
              attentionOnly
                ? "active"
                : ""
            }`}
            onClick={() =>
              setAttentionOnly(
                (current) =>
                  !current,
              )
            }
          >
            <BellRing size={14} />

            Needs Attention
          </button>

          <button
            type="button"
            className="programhead-clear-filter"
            onClick={clearFilters}
          >
            Clear
          </button>
        </section>

        {/* ===============================================
            ERROR
        =============================================== */}

        {error && (
          <section className="programhead-announcement-error">
            <AlertTriangle size={20} />

            <div>
              <strong>
                Announcements could not
                be loaded
              </strong>

              <p>{error}</p>
            </div>
          </section>
        )}

        {/* ===============================================
            LOADING
        =============================================== */}

        {loading && !error && (
          <section className="programhead-announcement-loading">
            <div className="programhead-announcement-spinner" />

            <div>
              <strong>
                Loading announcements
              </strong>

              <span>
                Retrieving notices for
                your Program Head account.
              </span>
            </div>
          </section>
        )}

        {/* ===============================================
            ANNOUNCEMENT WORKSPACE
        =============================================== */}

        {!loading && !error && (
          <section className="programhead-announcement-panel">
            <div className="programhead-announcement-panel-header">
              <div>
                <span>
                  <Megaphone size={13} />
                  Department Notices
                </span>

                <h2>
                  Program Head Announcements
                </h2>

                <p>
                  Important notices are
                  automatically prioritized
                  at the top.
                </p>
              </div>

              <strong>
                {
                  filteredAnnouncements.length
                }{" "}
                {filteredAnnouncements.length ===
                1
                  ? "notice"
                  : "notices"}
              </strong>
            </div>

            {filteredAnnouncements.length ===
            0 ? (
              <div className="programhead-announcement-empty">
                <span>
                  <CheckCircle2
                    size={22}
                  />
                </span>

                <strong>
                  No announcements found
                </strong>

                <p>
                  There are no notices
                  matching the current
                  filters.
                </p>

                {(search ||
                  category !== "All" ||
                  attentionOnly) && (
                  <button
                    type="button"
                    onClick={
                      clearFilters
                    }
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="announcement-list">
                {filteredAnnouncements.map(
                  (item) => {
                    const itemCategory =
                      getAnnouncementCategory(
                        item,
                      );

                    const attention =
                      needsProgramHeadAttention(
                        item,
                      );

                    const expiring =
                      isExpiringSoon(
                        item,
                      );

                    return (
                      <article
                        key={
                          item.announcement_id
                        }
                        className={`announcement-card ${
                          attention
                            ? "announcement-card-attention"
                            : ""
                        }`}
                      >
                        <div className="announcement-card-category">
                          <span
                            className={`announcement-category-icon category-${itemCategory.toLowerCase()}`}
                          >
                            {getCategoryIcon(
                              itemCategory,
                            )}
                          </span>

                          <div className="announcement-card-main">
                            <div className="announcement-card-badges">
                              <span className="announcement-category-badge">
                                {
                                  itemCategory
                                }
                              </span>

                              {attention && (
                                <span className="announcement-attention-badge">
                                  <BellRing
                                    size={
                                      10
                                    }
                                  />

                                  Needs
                                  Attention
                                </span>
                              )}

                              {expiring && (
                                <span className="announcement-expiring-badge">
                                  <CalendarClock
                                    size={
                                      10
                                    }
                                  />

                                  Expiring
                                  Soon
                                </span>
                              )}
                            </div>

                            <h3>
                              {item.title}
                            </h3>

                            <p>
                              {item.content
                                .length >
                              190
                                ? `${item.content.substring(
                                    0,
                                    190,
                                  )}...`
                                : item.content}
                            </p>

                            <div className="announcement-footer">
                              <span>
                                <UserRound
                                  size={
                                    13
                                  }
                                />

                                Posted by{" "}
                                <strong>
                                  {item.created_by ||
                                    "PTC Administration"}
                                </strong>
                              </span>

                              <span>
                                <CalendarDays
                                  size={
                                    13
                                  }
                                />

                                {formatDate(
                                  item.publish_date,
                                )}
                              </span>
                            </div>
                          </div>

                          <button
                            type="button"
                            className="view-details-btn"
                            onClick={() =>
                              navigate(
                                `/programhead/announcementprogD/${item.announcement_id}`,
                              )
                            }
                          >
                            Review

                            <ChevronRight
                              size={15}
                            />
                          </button>
                        </div>
                      </article>
                    );
                  },
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </DashboardLayout>
  );
}