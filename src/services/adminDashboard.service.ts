import { authService } from "./auth.service";

const API_BASE_URL = "http://localhost:3000";

// =====================================================
// ADMIN DASHBOARD TYPES
// =====================================================

export interface AdminDashboardUserSummary {
  total: number;
  active: number;
  inactive: number;
  unverified: number;
  createdThisMonth: number;
}

export interface AdminDashboardStudentSummary {
  total: number;
  admittedThisMonth: number;

  byYearLevel: {
    firstYear: number;
    secondYear: number;
    thirdYear: number;
    fourthYear: number;
  };
}

export interface AdminDashboardAnnouncementSummary {
  total: number;
  active: number;
  scheduled: number;
  expired: number;
  inactive: number;
}

export interface CurrentAcademicYear {
  academic_year_id: number;
  academic_year: string;
}

export interface UserDistributionItem {
  roleId: number;
  role: string;
  total: number;
}

export interface StudentCourseDistributionItem {
  courseId: number;
  courseCode: string;
  courseName: string;
  total: number;
}

export interface StudentYearDistributionItem {
  yearLevel: number;
  total: number;
}

export interface AdminDashboardSecurity {
  successfulLoginsToday: number;
  failedLoginsToday: number;
  blockedLoginsToday: number;
  devLoginsToday: number;

  activeAccounts: number;
  inactiveAccounts: number;
  unverifiedAccounts: number;
}

export interface AdminRecentActivity {
  activity_id: number;
  user_id: number;
  username: string;
  role: string;
  activity_type: string;
  module_name: string | null;
  description: string | null;
  created_at: string;
}

export type AnnouncementStatus =
  | "Active"
  | "Scheduled"
  | "Expired"
  | "Inactive";

export interface AdminRecentAnnouncement {
  announcement_id: number;
  title: string;
  content: string;
  created_by: string | null;
  publish_date: string | null;
  expiry_date: string | null;
  is_active: number;
  created_at: string;
  status: AnnouncementStatus;
}

export interface AdminNotification {
  notification_id: number;
  title: string | null;
  message: string | null;
  notification_type:
    | "Grades"
    | "Finance"
    | "Announcement"
    | "System";
  is_read: number;
  created_at: string;
}

export interface AdminRecentUser {
  user_id: number;
  username: string;
  email: string;
  role: string;
  is_active: number;
  is_verified: number;
  created_at: string;
}

// =====================================================
// DASHBOARD DATA
// =====================================================

export interface AdminDashboardData {
  overview: {
    users: AdminDashboardUserSummary;
    students: AdminDashboardStudentSummary;
    announcements: AdminDashboardAnnouncementSummary;
  };

  currentAcademicYear: CurrentAcademicYear | null;

  userDistribution: UserDistributionItem[];

  studentDistribution: {
    byCourse: StudentCourseDistributionItem[];
    byYearLevel: StudentYearDistributionItem[];
  };

  security: AdminDashboardSecurity;

  recentActivity: AdminRecentActivity[];

  recentAnnouncements: AdminRecentAnnouncement[];

  notifications: AdminNotification[];

  recentUsers: AdminRecentUser[];
}

interface AdminDashboardResponse {
  success: boolean;
  message?: string;
  data?: AdminDashboardData;
}

interface NotificationReadResponse {
  success: boolean;
  message?: string;
}

// =====================================================
// ADMIN DASHBOARD SERVICE
// =====================================================

export const adminDashboardService = {
  // ===================================================
  // GET DASHBOARD
  // ===================================================

  async getDashboard(): Promise<AdminDashboardData> {
    const response = await authService.authFetch(
      `${API_BASE_URL}/api/admin/dashboard`,
      {
        method: "GET",

        headers: {
          Accept: "application/json",
        },
      },
    );

    const data =
      (await response.json()) as AdminDashboardResponse;

    if (!response.ok || !data.success) {
      throw new Error(
        data.message ||
          "Unable to load Admin dashboard.",
      );
    }

    if (!data.data) {
      throw new Error(
        "Admin dashboard data was not returned by the server.",
      );
    }

    return data.data;
  },

  // ===================================================
  // MARK NOTIFICATION AS READ
  // ===================================================

  async markNotificationAsRead(
    notificationId: number,
  ): Promise<void> {
    if (
      !Number.isInteger(notificationId) ||
      notificationId <= 0
    ) {
      throw new Error(
        "Invalid notification ID.",
      );
    }

    const response = await authService.authFetch(
      `${API_BASE_URL}/api/admin/dashboard/notifications/${notificationId}/read`,
      {
        method: "PATCH",

        headers: {
          Accept: "application/json",
        },
      },
    );

    const data =
      (await response.json()) as NotificationReadResponse;

    if (!response.ok || !data.success) {
      throw new Error(
        data.message ||
          "Unable to update notification.",
      );
    }
  },
};