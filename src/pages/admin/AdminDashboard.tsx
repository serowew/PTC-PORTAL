import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  BadgeCheck,
  BookOpen,
  GraduationCap,
  LogIn,
  Megaphone,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";

import DashboardLayout from "../../components/Layout/DashboardLayout";
import QuickAccessMenu from "./dashboard/QuickAccessMenu";
import DashboardAnnouncements from "./dashboard/Announcements";
import Notifications from "./dashboard/Notifications";

import { authService } from "../../services/auth.service";

import {
  adminDashboardService,
  type AdminDashboardData,
  type AdminRecentActivity,
} from "../../services/adminDashboard.service";

import "../styles/dashboard.css";

// =====================================================
// DATE FORMATTER
// =====================================================

function formatDateTime(
  value: string | null | undefined,
) {
  if (!value) {
    return "No date available";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

// =====================================================
// ACTIVITY COLOR
// =====================================================

function getActivityTone(
  activityType: string,
) {
  const normalized =
    activityType.trim().toUpperCase();

  if (
    normalized.includes("FAILED") ||
    normalized.includes("BLOCKED") ||
    normalized.includes("DELETE")
  ) {
    return "warning";
  }

  if (
    normalized.includes("LOGIN") ||
    normalized.includes("CREATE") ||
    normalized.includes("APPROVE")
  ) {
    return "success";
  }

  return "info";
}

// =====================================================
// ACTIVITY DESCRIPTION
// =====================================================

function getActivityLabel(
  activity: AdminRecentActivity,
) {
  return (
    activity.description?.trim() ||
    `${activity.username} performed ${activity.activity_type}.`
  );
}

// =====================================================
// ADMIN DASHBOARD
// =====================================================

export default function AdminDashboard() {
  const navigate = useNavigate();

  const user = authService.getSession();

  const isAdmin =
    user?.role === "Admin";

  const [
    dashboard,
    setDashboard,
  ] =
    useState<AdminDashboardData | null>(
      null,
    );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState("");

  // ===================================================
  // LOAD DASHBOARD DATA
  // ===================================================

  const loadDashboard =
    useCallback(async () => {
      try {
        setLoading(true);
        setError("");

        const data =
          await adminDashboardService.getDashboard();

        setDashboard(data);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Unable to load Admin dashboard.";

        setError(message);
      } finally {
        setLoading(false);
      }
    }, []);



    // ===================================================
// MARK LOCAL NOTIFICATION AS READ
// ===================================================

const handleNotificationMarkedRead =
  useCallback(
    (notificationId: number) => {
      setDashboard((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,

          notifications:
            current.notifications.map(
              (notification) =>
                notification.notification_id ===
                notificationId
                  ? {
                      ...notification,
                      is_read: 1,
                    }
                  : notification,
            ),
        };
      });
    },
    [],
  );

  // ===================================================
  // AUTH + INITIAL LOAD
  // ===================================================

  useEffect(() => {
    if (!isAdmin) {
      navigate("/login", {
        replace: true,
      });

      return;
    }

    void loadDashboard();
  }, [
    isAdmin,
    loadDashboard,
    navigate,
  ]);

  // ===================================================
  // BLOCK NON-ADMIN
  // ===================================================

  if (!user || !isAdmin) {
    return null;
  }

  // ===================================================
  // UI
  // ===================================================

  return (
    <DashboardLayout>
      <div className="admin-dashboard">

        {/* =================================================
            HEADER
        ================================================= */}

        <div className="dashboard-header">
          <div className="header-content">

            <div>
              <h1>
                Admin Dashboard
              </h1>

              <p>
                Welcome back,{" "}
                <strong>
                  {user.username}
                </strong>
                . Monitor users, students,
                announcements, account
                security, and recent system
                activity.
              </p>
            </div>

            <div className="header-stats">

              <div className="header-stat">
                <BookOpen size={18} />

                <span>
                  AY{" "}
                  {dashboard
                    ?.currentAcademicYear
                    ?.academic_year ??
                    "Not set"}
                </span>
              </div>

              <button
                type="button"
                className="action-btn"
                onClick={() =>
                  void loadDashboard()
                }
                disabled={loading}
              >
                <RefreshCw
                  size={16}
                />

                <span>
                  {loading
                    ? "Refreshing..."
                    : "Refresh"}
                </span>
              </button>

            </div>
          </div>
        </div>

        {/* =================================================
            INITIAL LOADING
        ================================================= */}

        {loading && !dashboard ? (
          <div className="dashboard-card">

            <div className="card-header">
              <h3>
                Loading Dashboard
              </h3>
            </div>

            <p>
              Loading the latest Admin
              dashboard data...
            </p>

          </div>
        ) : error && !dashboard ? (

          /* ===============================================
             ERROR
          =============================================== */

          <div className="dashboard-card">

            <div className="card-header">
              <h3>
                Dashboard Could Not Be
                Loaded
              </h3>

              <ShieldAlert
                size={18}
              />
            </div>

            <p>
              {error}
            </p>

            <button
              type="button"
              className="action-btn"
              onClick={() =>
                void loadDashboard()
              }
            >
              <RefreshCw
                size={16}
              />

              <span>
                Try Again
              </span>
            </button>

          </div>

        ) : dashboard ? (
          <>

            {/* =============================================
                REFRESH ERROR
            ============================================= */}

            {error ? (
              <div className="dashboard-card dashboard-section">
                <p>
                  {error}
                </p>
              </div>
            ) : null}

            {/* =============================================
                MAIN STAT CARDS
            ============================================= */}

            <div className="stats-grid">

              {/* USER ACCOUNTS */}

              <div className="stat-card">

                <div className="stat-icon">
                  <Users size={32} />
                </div>

                <div className="stat-content">

                  <h3>
                    User Accounts
                  </h3>

                  <p className="stat-number">
                    {
                      dashboard
                        .overview
                        .users
                        .total
                    }
                  </p>

                  <div className="stat-breakdown">

                    <span className="stat-active">
                      {
                        dashboard
                          .overview
                          .users
                          .active
                      }{" "}
                      Active
                    </span>

                    <span className="stat-inactive">
                      {
                        dashboard
                          .overview
                          .users
                          .inactive
                      }{" "}
                      Inactive
                    </span>

                    <span className="stat-pending">
                      {
                        dashboard
                          .overview
                          .users
                          .unverified
                      }{" "}
                      Unverified
                    </span>

                  </div>
                </div>
              </div>

              {/* STUDENTS */}

              <div className="stat-card">

                <div className="stat-icon">
                  <GraduationCap
                    size={32}
                  />
                </div>

                <div className="stat-content">

                  <h3>
                    Student Profiles
                  </h3>

                  <p className="stat-number">
                    {
                      dashboard
                        .overview
                        .students
                        .total
                    }
                  </p>

                  <div className="stat-breakdown">

                    <span className="stat-month">
                      {
                        dashboard
                          .overview
                          .students
                          .admittedThisMonth
                      }{" "}
                      Admitted This Month
                    </span>

                  </div>
                </div>
              </div>

              {/* ACCOUNT HEALTH */}

              <div className="stat-card">

                <div className="stat-icon">
                  <ShieldCheck
                    size={32}
                  />
                </div>

                <div className="stat-content">

                  <h3>
                    Account Health
                  </h3>

                  <p className="stat-number">
                    {
                      dashboard
                        .security
                        .activeAccounts
                    }
                  </p>

                  <div className="stat-breakdown">

                    <span className="stat-active">
                      Active Accounts
                    </span>

                    <span className="stat-inactive">
                      {
                        dashboard
                          .security
                          .inactiveAccounts
                      }{" "}
                      Inactive
                    </span>

                    <span className="stat-pending">
                      {
                        dashboard
                          .security
                          .unverifiedAccounts
                      }{" "}
                      Unverified
                    </span>

                  </div>
                </div>
              </div>

              {/* ANNOUNCEMENTS */}

              <div className="stat-card">

                <div className="stat-icon">
                  <Megaphone
                    size={32}
                  />
                </div>

                <div className="stat-content">

                  <h3>
                    Announcements
                  </h3>

                  <p className="stat-number">
                    {
                      dashboard
                        .overview
                        .announcements
                        .total
                    }
                  </p>

                  <div className="stat-breakdown">

                    <span className="stat-active">
                      {
                        dashboard
                          .overview
                          .announcements
                          .active
                      }{" "}
                      Active
                    </span>

                    <span className="stat-upcoming">
                      {
                        dashboard
                          .overview
                          .announcements
                          .scheduled
                      }{" "}
                      Scheduled
                    </span>

                    <span className="stat-inactive">
                      {
                        dashboard
                          .overview
                          .announcements
                          .expired
                      }{" "}
                      Expired
                    </span>

                  </div>
                </div>
              </div>

            </div>

            {/* =============================================
                USER + STUDENT DISTRIBUTION
            ============================================= */}

            <div className="dashboard-section split-section">

              {/* USERS BY ROLE */}

              <div className="dashboard-card">

                <div className="card-header">
                  <h3>
                    User Accounts by Role
                  </h3>

                  <Users size={18} />
                </div>

                <div className="activity-timeline">

                  {dashboard
                    .userDistribution
                    .map((item) => (
                      <div
                        className="activity-item"
                        key={item.roleId}
                      >
                        <div className="activity-icon info">
                          <Users
                            size={17}
                          />
                        </div>

                        <div className="activity-content">

                          <p>
                            <strong>
                              {item.role}
                            </strong>
                          </p>

                          <small>
                            {item.total}{" "}
                            account(s)
                          </small>

                        </div>
                      </div>
                    ))}

                </div>
              </div>

              {/* STUDENTS BY PROGRAM */}

              <div className="dashboard-card">

                <div className="card-header">
                  <h3>
                    Student Profiles by
                    Program
                  </h3>

                  <GraduationCap
                    size={18}
                  />
                </div>

                <div className="activity-timeline">

                  {dashboard
                    .studentDistribution
                    .byCourse
                    .length > 0 ? (

                    dashboard
                      .studentDistribution
                      .byCourse
                      .map((item) => (
                        <div
                          className="activity-item"
                          key={
                            item.courseId
                          }
                        >

                          <div className="activity-icon primary">
                            <GraduationCap
                              size={17}
                            />
                          </div>

                          <div className="activity-content">

                            <p>
                              <strong>
                                {
                                  item.courseCode
                                }
                              </strong>
                              {" — "}
                              {
                                item.courseName
                              }
                            </p>

                            <small>
                              {
                                item.total
                              }{" "}
                              student
                              profile(s)
                            </small>

                          </div>
                        </div>
                      ))

                  ) : (

                    <div className="activity-item">
                      <div className="activity-content">
                        <p>
                          No student
                          distribution data
                          is available.
                        </p>
                      </div>
                    </div>

                  )}

                </div>
              </div>

            </div>


            {/* =============================================
                QUICK ACCESS
            ============================================= */}

            <div className="dashboard-section">
              <QuickAccessMenu />
            </div>


            {/* =============================================
                SECURITY OVERVIEW
            ============================================= */}

            <div className="dashboard-section">

              <h2>
                Account & Security Overview
              </h2>

              <div className="overview-grid">

                {/* SUCCESSFUL LOGIN */}

                <div className="overview-card">

                  <div className="overview-icon">
                    <LogIn size={30} />
                  </div>

                  <h3>
                    Successful Logins Today
                  </h3>

                  <p>
                    {
                      dashboard
                        .security
                        .successfulLoginsToday
                    }
                  </p>

                  <div className="overview-metrics">
                    <span>
                      Authentication activity
                    </span>
                  </div>

                </div>

                {/* FAILED LOGIN */}

                <div className="overview-card">

                  <div className="overview-icon">
                    <ShieldAlert
                      size={30}
                    />
                  </div>

                  <h3>
                    Failed Logins Today
                  </h3>

                  <p>
                    {
                      dashboard
                        .security
                        .failedLoginsToday
                    }
                  </p>

                  <div className="overview-metrics">
                    <span>
                      Failed authentication
                      attempts
                    </span>
                  </div>

                </div>

                {/* BLOCKED LOGIN */}

                <div className="overview-card">

                  <div className="overview-icon">
                    <ShieldCheck
                      size={30}
                    />
                  </div>

                  <h3>
                    Blocked Attempts Today
                  </h3>

                  <p>
                    {
                      dashboard
                        .security
                        .blockedLoginsToday
                    }
                  </p>

                  <div className="overview-metrics">
                    <span>
                      Blocked authentication
                      activity
                    </span>
                  </div>

                </div>

                {/* NEW USERS */}

                <div className="overview-card">

                  <div className="overview-icon">
                    <UserPlus
                      size={30}
                    />
                  </div>

                  <h3>
                    New Accounts This Month
                  </h3>

                  <p>
                    {
                      dashboard
                        .overview
                        .users
                        .createdThisMonth
                    }
                  </p>

                  <div className="overview-metrics">
                    <span>
                      Recently created
                      accounts
                    </span>
                  </div>

                </div>

              </div>
            </div>


                {/* =============================================
                        LATEST ANNOUNCEMENTS
                    ============================================= */}

  {/* =============================================
    ANNOUNCEMENTS + NOTIFICATIONS
============================================= */}

<div className="dashboard-section split-section">

  <DashboardAnnouncements
    announcements={
      dashboard.recentAnnouncements
    }
  />

  <Notifications
    notifications={
      dashboard.notifications
    }
    onMarkedRead={
      handleNotificationMarkedRead
    }
  />

</div>

{/* =============================================
    RECENT ACTIVITY + RECENT ACCOUNTS
============================================= */}

<div className="dashboard-section split-section dashboard-bottom-grid">

  {/* RECENT ACTIVITY */}

  <div className="dashboard-card">

    <div className="card-header">

      <div>
        <h3>
          Recent Activity
        </h3>

        <p className="card-subtitle">
          Latest recorded activity across the portal.
        </p>
      </div>

      <button
        type="button"
        className="dashboard-text-button"
        onClick={() =>
          navigate(
            "/admin/user/activity",
          )
        }
      >
        <Activity size={15} />

        <span>
          View All
        </span>
      </button>

    </div>

    <div className="activity-timeline">

      {dashboard.recentActivity.length > 0 ? (

        dashboard.recentActivity.map(
          (activity) => (

            <div
              className="activity-item"
              key={
                activity.activity_id
              }
            >

              <div
                className={`activity-icon ${getActivityTone(
                  activity.activity_type,
                )}`}
              >
                <Activity
                  size={17}
                />
              </div>

              <div className="activity-content">

                <p>
                  <strong>
                    {getActivityLabel(
                      activity,
                    )}
                  </strong>
                </p>

                <small>
                  {activity.username}
                  {" • "}
                  {activity.role}
                  {" • "}
                  {activity.module_name ||
                    "System"}
                </small>

                <small>
                  {formatDateTime(
                    activity.created_at,
                  )}
                </small>

              </div>

            </div>
          ),
        )

      ) : (

        <div className="dashboard-empty-state dashboard-empty-compact">

          <div className="dashboard-empty-icon">
            <Activity size={20} />
          </div>

          <strong>
            No recent activity
          </strong>

          <p>
            There is no system activity
            available to display.
          </p>

        </div>

      )}

    </div>

  </div>

  {/* RECENT ACCOUNTS */}

  <div className="dashboard-card">

    <div className="card-header">

      <div>
        <h3>
          Recently Created Accounts
        </h3>

        <p className="card-subtitle">
          Latest user accounts created in the system.
        </p>
      </div>

      <button
        type="button"
        className="dashboard-text-button"
        onClick={() =>
          navigate(
            "/admin/user/list",
          )
        }
      >
        <Users size={15} />

        <span>
          View All
        </span>
      </button>

    </div>

    <div className="activity-timeline">

      {dashboard.recentUsers.length > 0 ? (

        dashboard.recentUsers.map(
          (recentUser) => (

            <div
              className="activity-item"
              key={
                recentUser.user_id
              }
            >

              <div
                className={`activity-icon ${
                  recentUser.is_active
                    ? "success"
                    : "warning"
                }`}
              >

                {recentUser.is_verified ? (
                  <BadgeCheck
                    size={17}
                  />
                ) : (
                  <ShieldAlert
                    size={17}
                  />
                )}

              </div>

              <div className="activity-content">

                <p>
                  <strong>
                    {recentUser.username}
                  </strong>

                  <span className="activity-role">
                    {recentUser.role}
                  </span>
                </p>

                <small>
                  {recentUser.email}
                </small>

                <small>
                  {recentUser.is_active
                    ? "Active"
                    : "Inactive"}

                  {" • "}

                  {recentUser.is_verified
                    ? "Verified"
                    : "Unverified"}

                  {" • "}

                  {formatDateTime(
                    recentUser.created_at,
                  )}
                </small>

              </div>

            </div>
          ),
        )

      ) : (

        <div className="dashboard-empty-state dashboard-empty-compact">

          <div className="dashboard-empty-icon">
            <Users size={20} />
          </div>

          <strong>
            No recent accounts
          </strong>

          <p>
            There are no recently created
            user accounts.
          </p>

        </div>

      )}

    </div>

  </div>

</div>

          </>
        ) : null}

      </div>
    </DashboardLayout>
  );
}