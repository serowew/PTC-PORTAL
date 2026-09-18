import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/activitylogger.css";


const API_BASE_URL = "http://localhost:3000/api/activity-logs";


type ActivityLog = {
  activity_id: number;
  user_id: number;
  username: string;
  role: string;
  activity_type: string;
  module_name: string;
  description: string;
  created_at: string;
};


interface ActivityLogResponse {
  success?: boolean;
  data?: ActivityLog[];
  logs?: ActivityLog[];
  message?: string;
  error?: string;
}


/* =========================================================
   NORMALIZE ACTIVITY TYPE

   Converts:
   FAILED LOGIN
   FAILED_LOGIN
   failed/login
   Failed-Login

   into:
   failed-login
   ========================================================= */

function normalizeActivityType(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}


/* =========================================================
   SEMANTIC ACTIVITY CLASS

   This prevents backend naming differences from breaking
   the badge color.

   Example:
   USER_LOGIN_FAILED
   LOGIN FAILED
   FAILED LOGIN ATTEMPT

   will all receive:
   failed-login
   ========================================================= */

function getActivitySemanticClass(activityType: string): string {
  const normalized = normalizeActivityType(activityType);

  /* =======================================================
     DEVELOPMENT LOGIN

     Must come BEFORE normal login.
     DEV LOGIN -> dev-login
     ======================================================= */

  if (
    normalized.includes("dev-login") ||
    normalized.includes("development-login") ||
    (
      normalized.includes("dev") &&
      normalized.includes("login")
    )
  ) {
    return "dev-login";
  }


  /* =======================================================
     BLOCKED LOGIN

     Must come before normal login.
     ======================================================= */

  if (
    normalized.includes("login") &&
    (
      normalized.includes("blocked") ||
      normalized.includes("disabled") ||
      normalized.includes("inactive") ||
      normalized.includes("denied")
    )
  ) {
    return "login-blocked";
  }


  /* =======================================================
     FAILED LOGIN
     ======================================================= */

  if (
    normalized.includes("login") &&
    (
      normalized.includes("fail") ||
      normalized.includes("invalid") ||
      normalized.includes("unsuccessful") ||
      normalized.includes("error")
    )
  ) {
    return "failed-login";
  }


  /* =======================================================
     LOGOUT
     ======================================================= */

  if (
    normalized.includes("logout") ||
    normalized.includes("sign-out") ||
    normalized.includes("signed-out")
  ) {
    return "logout";
  }


  /* =======================================================
     NORMAL LOGIN
     ======================================================= */

  if (
    normalized === "login" ||
    normalized.includes("sign-in") ||
    normalized.includes("signed-in")
  ) {
    return "login";
  }


  /* =======================================================
     DOCUMENT VERIFICATION
     ======================================================= */

  if (
    normalized.includes("document-verification") ||
    (
      normalized.includes("document") &&
      normalized.includes("verif")
    )
  ) {
    return "document-verification";
  }


  /* =======================================================
     DELETE / REMOVE
     ======================================================= */

  if (
    normalized.includes("delete") ||
    normalized.includes("remove")
  ) {
    return "delete";
  }


  /* =======================================================
     REJECT / DECLINE
     ======================================================= */

  if (
    normalized.includes("reject") ||
    normalized.includes("decline")
  ) {
    return "reject";
  }


  /* =======================================================
     APPROVE
     ======================================================= */

  if (
    normalized.includes("approve") ||
    normalized.includes("approval")
  ) {
    return "approve";
  }


  /* =======================================================
     PASSWORD / SECURITY
     ======================================================= */

  if (
    normalized.includes("password") ||
    normalized.includes("security")
  ) {
    return "security";
  }


  /* =======================================================
     GRADES
     ======================================================= */

  if (normalized.includes("grade")) {
    return "grade";
  }


  /* =======================================================
     ENROLLMENT
     ======================================================= */

  if (normalized.includes("enroll")) {
    return "enrollment";
  }


  /* =======================================================
     ANNOUNCEMENT
     ======================================================= */

  if (
    normalized.includes("announcement") ||
    normalized.includes("publish") ||
    normalized.includes("post")
  ) {
    return "announcement";
  }


  /* =======================================================
     EXPORT / DOWNLOAD
     ======================================================= */

  if (
    normalized.includes("export") ||
    normalized.includes("download")
  ) {
    return "export";
  }


  /* =======================================================
     IMPORT / UPLOAD
     ======================================================= */

  if (
    normalized.includes("import") ||
    normalized.includes("upload")
  ) {
    return "import";
  }


  /* =======================================================
     ARCHIVE
     ======================================================= */

  if (normalized.includes("archive")) {
    return "archive";
  }


  /* =======================================================
     DEACTIVATE
     Must come before activate.
     ======================================================= */

  if (
    normalized.includes("deactivate") ||
    normalized.includes("disable")
  ) {
    return "deactivate";
  }


  /* =======================================================
     RESTORE / REACTIVATE
     ======================================================= */

  if (
    normalized.includes("restore") ||
    normalized.includes("reactivate") ||
    normalized === "activate" ||
    normalized === "activated"
  ) {
    return "restore";
  }


  /* =======================================================
     ROLE CHANGE
     ======================================================= */

  if (normalized.includes("role")) {
    return "role-change";
  }


  /* =======================================================
     STATUS CHANGE
     ======================================================= */

  if (normalized.includes("status")) {
    return "status-change";
  }


  /* =======================================================
     UNASSIGN
     Must come before assign.
     ======================================================= */

  if (normalized.includes("unassign")) {
    return "unassign";
  }


  /* =======================================================
     ASSIGN
     ======================================================= */

  if (normalized.includes("assign")) {
    return "assign";
  }


  /* =======================================================
     SCHEDULE
     ======================================================= */

  if (normalized.includes("schedule")) {
    return "schedule";
  }


  /* =======================================================
     CANCEL
     ======================================================= */

  if (normalized.includes("cancel")) {
    return "cancel";
  }


  /* =======================================================
     COMPLETE
     ======================================================= */

  if (normalized.includes("complete")) {
    return "complete";
  }


  /* =======================================================
     INVALID
     ======================================================= */

  if (normalized.includes("invalid")) {
    return "invalid";
  }


  /* =======================================================
     VERIFY / VALIDATE

     "verif" catches:
     verify
     verified
     verification
     ======================================================= */

  if (
    normalized.includes("verif") ||
    normalized.includes("validat")
  ) {
    return "validate";
  }


  /* =======================================================
     SUBMIT
     ======================================================= */

  if (normalized.includes("submit")) {
    return "submit";
  }


  /* =======================================================
     EMAIL / SEND
     ======================================================= */

  if (
    normalized.includes("email") ||
    normalized.includes("notification") ||
    normalized.includes("send") ||
    normalized.includes("sent")
  ) {
    return "email";
  }


  /* =======================================================
     VIEW / OPEN
     ======================================================= */

  if (
    normalized.includes("view") ||
    normalized.includes("open")
  ) {
    return "view";
  }


  /* =======================================================
     USER MANAGEMENT
     ======================================================= */

  if (
    normalized.includes("user") ||
    normalized.includes("account")
  ) {
    return "user-management";
  }


  /* =======================================================
     UPDATE / EDIT
     ======================================================= */

  if (
    normalized.includes("update") ||
    normalized.includes("edit") ||
    normalized.includes("modify")
  ) {
    return "update";
  }


  /* =======================================================
     CREATE / ADD
     ======================================================= */

  if (
    normalized.includes("create") ||
    normalized.includes("add")
  ) {
    return "create";
  }


  /* =======================================================
     GENERAL FAILURE
     ======================================================= */

  if (
    normalized.includes("fail") ||
    normalized.includes("error")
  ) {
    return "error";
  }


  /* =======================================================
     UNKNOWN

     Keeps backend value as a CSS class while using
     the neutral badge base.
     ======================================================= */

  return normalized || "unknown";
}


/* =========================================================
   ACTIVITY LOGGER
   ========================================================= */

export default function UserActivity() {
  const navigate = useNavigate();

  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");


  /* =========================================================
     SESSION
     ========================================================= */

  const session = authService.getSession();

  const token = authService.getToken();

  const userRole = session?.role;

  const authenticated = Boolean(
    session &&
    token
  );


  /* =========================================================
     AUTHORIZATION
     ========================================================= */

  useEffect(() => {
    if (!authenticated) {
      authService.logout();

      navigate(
        "/login",
        {
          replace: true,
        },
      );

      return;
    }


    if (userRole !== "Admin") {
      if (userRole) {
        navigate(
          authService.getDashboardRoute(userRole),
          {
            replace: true,
          },
        );
      } else {
        navigate(
          "/login",
          {
            replace: true,
          },
        );
      }
    }
  }, [
    authenticated,
    userRole,
    navigate,
  ]);


  /* =========================================================
     LOAD ACTIVITY LOGS
     ========================================================= */

  useEffect(() => {
    if (
      !authenticated ||
      userRole !== "Admin"
    ) {
      return;
    }


    const controller =
      new AbortController();


    const loadActivityLogs =
      async () => {
        try {
          setLoading(true);

          setError("");


          const response =
            await authService.authFetch(
              API_BASE_URL,
              {
                method: "GET",

                signal:
                  controller.signal,

                headers: {
                  Accept:
                    "application/json",
                },
              },
            );


          /* =================================================
             SESSION EXPIRED
             ================================================= */

          if (
            response.status === 401
          ) {
            authService.logout();

            navigate(
              "/login",
              {
                replace: true,
              },
            );

            return;
          }


          /* =================================================
             READ RESPONSE SAFELY
             ================================================= */

          const contentType =
            response.headers.get(
              "content-type",
            ) || "";


          let payload:
            | ActivityLogResponse
            | ActivityLog[]
            | null = null;


          if (
            contentType.includes(
              "application/json",
            )
          ) {
            payload =
              await response.json();
          }


          /* =================================================
             FORBIDDEN
             ================================================= */

          if (
            response.status === 403
          ) {
            const message =
              !Array.isArray(payload)
                ? payload?.message ||
                  payload?.error
                : null;

            throw new Error(
              message ||
                "You do not have permission to view activity logs.",
            );
          }


          /* =================================================
             OTHER HTTP ERRORS
             ================================================= */

          if (!response.ok) {
            const message =
              !Array.isArray(payload)
                ? payload?.message ||
                  payload?.error
                : null;

            throw new Error(
              message ||
                `Unable to load activity logs. Server returned ${response.status}.`,
            );
          }


          /* =================================================
             NORMALIZE API RESPONSE
             ================================================= */

          let activityLogs:
            ActivityLog[] = [];


          if (
            Array.isArray(payload)
          ) {
            activityLogs = payload;
          } else if (
            Array.isArray(
              payload?.logs,
            )
          ) {
            activityLogs =
              payload.logs;
          } else if (
            Array.isArray(
              payload?.data,
            )
          ) {
            activityLogs =
              payload.data;
          }


          setLogs(
            activityLogs,
          );
        } catch (err) {
          if (
            err instanceof DOMException &&
            err.name === "AbortError"
          ) {
            return;
          }


          if (
            err instanceof TypeError
          ) {
            setError(
              "Unable to connect to the activity log server. Make sure the backend is running on port 3000.",
            );

            return;
          }


          if (
            err instanceof Error
          ) {
            setError(
              err.message,
            );

            return;
          }


          setError(
            "Unable to load activity logs.",
          );
        } finally {
          if (
            !controller.signal.aborted
          ) {
            setLoading(false);
          }
        }
      };


    void loadActivityLogs();


    return () => {
      controller.abort();
    };
  }, [
    authenticated,
    userRole,
    navigate,
  ]);


  /* =========================================================
     FILTER LOGS
     ========================================================= */

  const filteredLogs =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();


      if (!query) {
        return logs;
      }


      return logs.filter(
        (log) => {
          const values = [
            log.username,
            log.role,
            log.activity_type,
            log.module_name,
            log.description,
          ];


          return values.some(
            (value) =>
              String(
                value ?? "",
              )
                .toLowerCase()
                .includes(
                  query,
                ),
          );
        },
      );
    }, [
      logs,
      search,
    ]);


  /* =========================================================
     ACCESS GUARD
     ========================================================= */

  if (
    !authenticated ||
    !session ||
    userRole !== "Admin"
  ) {
    return null;
  }


  /* =========================================================
     RENDER
     ========================================================= */

  return (
    <DashboardLayout>
      <div className="admin-activity">

        <div className="admin-activity-header">
          <h1></h1>
        </div>


        {error && (
          <p className="admin-manage-students__error">
            {error}
          </p>
        )}


        <input
          type="text"
          placeholder="Search activity..."
          className="activity-search"
          value={search}
          onChange={(event) =>
            setSearch(
              event.target.value,
            )
          }
        />


        <div className="activity-table-wrapper">
          <table className="activity-table">

            <thead>
              <tr>
                <th>
                  Date &amp; Time
                </th>

                <th>
                  User
                </th>

                <th>
                  Role
                </th>

                <th>
                  Activity
                </th>

                <th>
                  Module
                </th>

                <th>
                  Description
                </th>
              </tr>
            </thead>


            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      textAlign:
                        "center",
                    }}
                  >
                    Loading activity logs...
                  </td>
                </tr>
              ) : filteredLogs.length ===
                0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      textAlign:
                        "center",
                    }}
                  >
                    No activity found.
                  </td>
                </tr>
              ) : (
                filteredLogs.map(
                  (log) => {
                    const rawClass =
                      normalizeActivityType(
                        log.activity_type,
                      );

                    const semanticClass =
                      getActivitySemanticClass(
                        log.activity_type,
                      );


                    return (
                      <tr
                        key={
                          log.activity_id
                        }
                      >
                        <td>
                          {log.created_at
                            ? new Date(
                                log.created_at,
                              ).toLocaleString()
                            : "—"}
                        </td>


                        <td>
                          {log.username ||
                            "—"}
                        </td>


                        <td>
                          {log.role ||
                            "—"}
                        </td>


                        <td>
                          <span
                            className={[
                              "activity-badge",
                              semanticClass,
                              rawClass,
                            ]
                              .filter(
                                Boolean,
                              )
                              .join(
                                " ",
                              )}
                          >
                            {log.activity_type ||
                              "Unknown"}
                          </span>
                        </td>


                        <td>
                          {log.module_name ||
                            "—"}
                        </td>


                        <td>
                          {log.description ||
                            "—"}
                        </td>
                      </tr>
                    );
                  },
                )
              )}
            </tbody>

          </table>
        </div>

      </div>
    </DashboardLayout>
  );
}