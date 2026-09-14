import express from "express";
import db from "../../db.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function toNumber(value) {
  return Number(value ?? 0);
}

/*
|--------------------------------------------------------------------------
| ADMIN DASHBOARD
|--------------------------------------------------------------------------
|
| GET /api/admin/dashboard
|
| PURPOSE:
| Provides the real data used by the Admin Dashboard.
|
| ADMIN RESPONSIBILITIES ONLY:
| - Users
| - Students
| - Announcements
| - Activity
| - Account / Security status
| - Admin notifications
|
| IMPORTANT:
| Enrollment is intentionally NOT included here.
| Enrollment management belongs to the Registrar.
|
*/

router.get("/", async (req, res) => {
  try {
    const adminUserId = Number(req.user?.user_id);

    const [
      userSummaryResult,
      studentSummaryResult,
      announcementSummaryResult,
      roleDistributionResult,
      studentsByCourseResult,
      studentsByYearResult,
      recentActivityResult,
      latestAnnouncementsResult,
      notificationsResult,
      securityResult,
      recentUsersResult,
      academicYearResult,
    ] = await Promise.all([
      /*
      |--------------------------------------------------------------------------
      | USER SUMMARY
      |--------------------------------------------------------------------------
      */

      db.execute(`
        SELECT
          COUNT(*) AS total_users,

          SUM(
            CASE
              WHEN is_active = 1
              THEN 1
              ELSE 0
            END
          ) AS active_users,

          SUM(
            CASE
              WHEN is_active = 0
              THEN 1
              ELSE 0
            END
          ) AS inactive_users,

          SUM(
            CASE
              WHEN is_verified = 0
              THEN 1
              ELSE 0
            END
          ) AS unverified_users,

          SUM(
            CASE
              WHEN created_at >= DATE_FORMAT(
                CURRENT_DATE,
                '%Y-%m-01'
              )
              THEN 1
              ELSE 0
            END
          ) AS users_created_this_month

        FROM users
      `),

      /*
      |--------------------------------------------------------------------------
      | STUDENT SUMMARY
      |--------------------------------------------------------------------------
      */

      db.execute(`
        SELECT
          COUNT(*) AS total_students,

          SUM(
            CASE
              WHEN year_level = 1
              THEN 1
              ELSE 0
            END
          ) AS first_year,

          SUM(
            CASE
              WHEN year_level = 2
              THEN 1
              ELSE 0
            END
          ) AS second_year,

          SUM(
            CASE
              WHEN year_level = 3
              THEN 1
              ELSE 0
            END
          ) AS third_year,

          SUM(
            CASE
              WHEN year_level = 4
              THEN 1
              ELSE 0
            END
          ) AS fourth_year,

          SUM(
            CASE
              WHEN admission_date >= DATE_FORMAT(
                CURRENT_DATE,
                '%Y-%m-01'
              )
              THEN 1
              ELSE 0
            END
          ) AS admitted_this_month

        FROM students
      `),

      /*
      |--------------------------------------------------------------------------
      | ANNOUNCEMENT SUMMARY
      |--------------------------------------------------------------------------
      |
      | Active means:
      |
      | is_active = 1
      | AND publish date has already arrived
      | AND announcement has not expired
      |
      */

      db.execute(`
        SELECT
          COUNT(*) AS total_announcements,

          SUM(
            CASE
              WHEN is_active = 1
                AND (
                  publish_date IS NULL
                  OR publish_date <= NOW()
                )
                AND (
                  expiry_date IS NULL
                  OR expiry_date >= NOW()
                )
              THEN 1
              ELSE 0
            END
          ) AS active_announcements,

          SUM(
            CASE
              WHEN is_active = 1
                AND publish_date > NOW()
              THEN 1
              ELSE 0
            END
          ) AS scheduled_announcements,

          SUM(
            CASE
              WHEN expiry_date IS NOT NULL
                AND expiry_date < NOW()
              THEN 1
              ELSE 0
            END
          ) AS expired_announcements,

          SUM(
            CASE
              WHEN is_active = 0
              THEN 1
              ELSE 0
            END
          ) AS inactive_announcements

        FROM announcements
      `),

      /*
      |--------------------------------------------------------------------------
      | USERS BY ROLE
      |--------------------------------------------------------------------------
      |
      | Admin
      | Registrar
      | Program Head
      | Faculty
      | Student
      |
      */

      db.execute(`
        SELECT
          r.role_id,
          r.role_name,
          COUNT(u.user_id) AS total

        FROM roles r

        LEFT JOIN users u
          ON u.role_id = r.role_id

        GROUP BY
          r.role_id,
          r.role_name

        ORDER BY
          r.role_id ASC
      `),

      /*
      |--------------------------------------------------------------------------
      | STUDENTS BY COURSE
      |--------------------------------------------------------------------------
      */

      db.execute(`
        SELECT
          c.course_id,
          c.course_code,
          c.course_name,
          COUNT(s.student_id) AS total

        FROM courses c

        LEFT JOIN students s
          ON s.course_id = c.course_id

        GROUP BY
          c.course_id,
          c.course_code,
          c.course_name

        ORDER BY
          total DESC,
          c.course_code ASC
      `),

      /*
      |--------------------------------------------------------------------------
      | STUDENTS BY YEAR LEVEL
      |--------------------------------------------------------------------------
      */

      db.execute(`
        SELECT
          year_level,
          COUNT(*) AS total

        FROM students

        WHERE year_level IS NOT NULL

        GROUP BY year_level

        ORDER BY year_level ASC
      `),

      /*
      |--------------------------------------------------------------------------
      | RECENT SYSTEM ACTIVITY
      |--------------------------------------------------------------------------
      */

      db.execute(`
        SELECT
          a.activity_id,
          a.user_id,

          u.username,

          r.role_name AS role,

          a.activity_type,
          a.module_name,
          a.description,
          a.created_at

        FROM activity_logs a

        INNER JOIN users u
          ON u.user_id = a.user_id

        INNER JOIN roles r
          ON r.role_id = u.role_id

        ORDER BY
          a.created_at DESC,
          a.activity_id DESC

        LIMIT 8
      `),

      /*
      |--------------------------------------------------------------------------
      | LATEST ANNOUNCEMENTS
      |--------------------------------------------------------------------------
      */

      db.execute(`
        SELECT
          a.announcement_id,
          a.title,
          a.content,

          u.username AS created_by,

          a.publish_date,
          a.expiry_date,
          a.is_active,
          a.created_at,

          CASE
            WHEN a.is_active = 0
              THEN 'Inactive'

            WHEN a.publish_date IS NOT NULL
              AND a.publish_date > NOW()
              THEN 'Scheduled'

            WHEN a.expiry_date IS NOT NULL
              AND a.expiry_date < NOW()
              THEN 'Expired'

            ELSE 'Active'
          END AS status

        FROM announcements a

        LEFT JOIN users u
          ON u.user_id = a.created_by

        ORDER BY
          a.created_at DESC,
          a.announcement_id DESC

        LIMIT 5
      `),

      /*
      |--------------------------------------------------------------------------
      | ADMIN NOTIFICATIONS
      |--------------------------------------------------------------------------
      |
      | Only notifications owned by the authenticated Admin.
      |
      | Legacy Enrollment notifications are excluded because
      | enrollment belongs to the Registrar.
      |
      */

      db.execute(
        `
        SELECT
          notification_id,
          title,
          message,
          notification_type,
          is_read,
          created_at

        FROM notifications

        WHERE user_id = ?
          AND notification_type <> 'Enrollment'

        ORDER BY
          created_at DESC,
          notification_id DESC

        LIMIT 6
        `,
        [adminUserId],
      ),

      /*
      |--------------------------------------------------------------------------
      | ACCOUNT / SECURITY ACTIVITY TODAY
      |--------------------------------------------------------------------------
      */

      db.execute(`
        SELECT

          SUM(
            CASE
              WHEN activity_type IN (
                'LOGIN',
                'DEV LOGIN'
              )
              AND DATE(created_at) = CURRENT_DATE
              THEN 1
              ELSE 0
            END
          ) AS successful_logins_today,

          SUM(
            CASE
              WHEN activity_type = 'FAILED LOGIN'
              AND DATE(created_at) = CURRENT_DATE
              THEN 1
              ELSE 0
            END
          ) AS failed_logins_today,

          SUM(
            CASE
              WHEN activity_type = 'LOGIN BLOCKED'
              AND DATE(created_at) = CURRENT_DATE
              THEN 1
              ELSE 0
            END
          ) AS blocked_logins_today,

          SUM(
            CASE
              WHEN activity_type = 'DEV LOGIN'
              AND DATE(created_at) = CURRENT_DATE
              THEN 1
              ELSE 0
            END
          ) AS dev_logins_today

        FROM activity_logs

        WHERE module_name = 'Authentication'
      `),

      /*
      |--------------------------------------------------------------------------
      | RECENTLY CREATED USERS
      |--------------------------------------------------------------------------
      */

      db.execute(`
        SELECT
          u.user_id,
          u.username,
          u.email,

          r.role_name AS role,

          u.is_active,
          u.is_verified,
          u.created_at

        FROM users u

        INNER JOIN roles r
          ON r.role_id = u.role_id

        ORDER BY
          u.created_at DESC,
          u.user_id DESC

        LIMIT 5
      `),

      /*
      |--------------------------------------------------------------------------
      | CURRENT ACADEMIC YEAR
      |--------------------------------------------------------------------------
      |
      | Academic year is general school context.
      |
      | This does NOT expose enrollment management
      | to the Admin.
      |
      */

      db.execute(`
        SELECT
          academic_year_id,
          academic_year

        FROM academic_years

        WHERE is_current = 1

        ORDER BY academic_year_id DESC

        LIMIT 1
      `),
    ]);

    /*
    |--------------------------------------------------------------------------
    | NORMALIZE SUMMARY VALUES
    |--------------------------------------------------------------------------
    */

    const userSummary = userSummaryResult[0][0] ?? {};

    const studentSummary =
      studentSummaryResult[0][0] ?? {};

    const announcementSummary =
      announcementSummaryResult[0][0] ?? {};

    const securitySummary =
      securityResult[0][0] ?? {};

    /*
    |--------------------------------------------------------------------------
    | RESPONSE
    |--------------------------------------------------------------------------
    */

    return res.json({
      success: true,

      data: {
        /*
        |--------------------------------------------------------------------------
        | TOP DASHBOARD CARDS
        |--------------------------------------------------------------------------
        */

        overview: {
          users: {
            total: toNumber(
              userSummary.total_users,
            ),

            active: toNumber(
              userSummary.active_users,
            ),

            inactive: toNumber(
              userSummary.inactive_users,
            ),

            unverified: toNumber(
              userSummary.unverified_users,
            ),

            createdThisMonth: toNumber(
              userSummary.users_created_this_month,
            ),
          },

          students: {
            total: toNumber(
              studentSummary.total_students,
            ),

            admittedThisMonth: toNumber(
              studentSummary.admitted_this_month,
            ),

            byYearLevel: {
              firstYear: toNumber(
                studentSummary.first_year,
              ),

              secondYear: toNumber(
                studentSummary.second_year,
              ),

              thirdYear: toNumber(
                studentSummary.third_year,
              ),

              fourthYear: toNumber(
                studentSummary.fourth_year,
              ),
            },
          },

          announcements: {
            total: toNumber(
              announcementSummary.total_announcements,
            ),

            active: toNumber(
              announcementSummary.active_announcements,
            ),

            scheduled: toNumber(
              announcementSummary.scheduled_announcements,
            ),

            expired: toNumber(
              announcementSummary.expired_announcements,
            ),

            inactive: toNumber(
              announcementSummary.inactive_announcements,
            ),
          },
        },

        /*
        |--------------------------------------------------------------------------
        | ACADEMIC YEAR
        |--------------------------------------------------------------------------
        */

        currentAcademicYear:
          academicYearResult[0][0] ?? null,

        /*
        |--------------------------------------------------------------------------
        | USER DISTRIBUTION
        |--------------------------------------------------------------------------
        */

        userDistribution:
          roleDistributionResult[0].map(
            (row) => ({
              roleId: Number(row.role_id),

              role: row.role_name,

              total: toNumber(row.total),
            }),
          ),

        /*
        |--------------------------------------------------------------------------
        | STUDENT DISTRIBUTION
        |--------------------------------------------------------------------------
        */

        studentDistribution: {
          byCourse:
            studentsByCourseResult[0].map(
              (row) => ({
                courseId: Number(
                  row.course_id,
                ),

                courseCode:
                  row.course_code,

                courseName:
                  row.course_name,

                total: toNumber(
                  row.total,
                ),
              }),
            ),

          byYearLevel:
            studentsByYearResult[0].map(
              (row) => ({
                yearLevel: Number(
                  row.year_level,
                ),

                total: toNumber(
                  row.total,
                ),
              }),
            ),
        },

        /*
        |--------------------------------------------------------------------------
        | SECURITY
        |--------------------------------------------------------------------------
        */

        security: {
          successfulLoginsToday:
            toNumber(
              securitySummary.successful_logins_today,
            ),

          failedLoginsToday:
            toNumber(
              securitySummary.failed_logins_today,
            ),

          blockedLoginsToday:
            toNumber(
              securitySummary.blocked_logins_today,
            ),

          devLoginsToday:
            toNumber(
              securitySummary.dev_logins_today,
            ),

          activeAccounts:
            toNumber(
              userSummary.active_users,
            ),

          inactiveAccounts:
            toNumber(
              userSummary.inactive_users,
            ),

          unverifiedAccounts:
            toNumber(
              userSummary.unverified_users,
            ),
        },

        /*
        |--------------------------------------------------------------------------
        | DASHBOARD LISTS
        |--------------------------------------------------------------------------
        */

        recentActivity:
          recentActivityResult[0],

        recentAnnouncements:
          latestAnnouncementsResult[0],

        notifications:
          notificationsResult[0],

        recentUsers:
          recentUsersResult[0],
      },
    });
  } catch (error) {
    console.error(
      "GET ADMIN DASHBOARD ERROR:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to load Admin dashboard data.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| MARK ADMIN NOTIFICATION AS READ
|--------------------------------------------------------------------------
|
| PATCH /api/admin/dashboard/notifications/:id/read
|
*/

router.patch(
  "/notifications/:id/read",
  async (req, res) => {
    try {
      const notificationId =
        Number(req.params.id);

      const adminUserId =
        Number(req.user?.user_id);

      if (
        !Number.isInteger(notificationId) ||
        notificationId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid notification ID.",
        });
      }

      const [result] =
        await db.execute(
          `
          UPDATE notifications

          SET is_read = 1

          WHERE notification_id = ?
            AND user_id = ?
            AND notification_type <> 'Enrollment'
          `,
          [
            notificationId,
            adminUserId,
          ],
        );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message:
            "Notification not found.",
        });
      }

      return res.json({
        success: true,
        message:
          "Notification marked as read.",
      });
    } catch (error) {
      console.error(
        "MARK ADMIN NOTIFICATION READ ERROR:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to update notification.",
      });
    }
  },
);

export default router;