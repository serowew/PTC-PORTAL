import "dotenv/config";

import express from "express";
import cors from "cors";
import path from "path";

import authRouter from "./routes/auth.routes.js";
import usersRouter from "./routes/admin/users.routes.js";
import studentsRouter from "./routes/admin/students.routes.js";
import rolesRouter from "./routes/admin/roles.routes.js";

import activityRouter from "./routes/admin/activity.routes.js";
import filesRouter from "./routes/files.routes.js";

import announcementManagementRouter from "./routes/announcement/adminAnnouncement.routes.js";
import usersAnnouncementRoutes from "./routes/announcement/usersAnnouncement.routes.js";

import registrarRoutes from "./routes/registrar/index.js";
import studentRoutes from "./routes/student/index.js";

import admissionPeriodsRouter from "./routes/admissionPeriods.routes.js";
import admissionsPublicRouter from "./routes/admissionsPublic.routes.js";
import admissionApplicationsRouter from "./routes/admissionApplications.routes.js";

import facultyRouter from "./routes/faculty/index.js";
import programHeadRouter from "./routes/programhead/index.js";

import authenticate from "./middleware/authenticate.js";
import requireRole from "./middleware/requireRole.js";

import financeRouter from "./routes/finance/index.js";
import manualPaymentVerificationsRouter from "./routes/manualPaymentVerifications.routes.js";

import gradebookInitializationRouter from "./routes/gradebookInitialization.routes.js";
import gradebookAssessmentsRouter from "./routes/gradebookAssessments.routes.js";
import gradebookRosterRouter from "./routes/gradebookRoster.routes.js";
import gradebookScoresRouter from "./routes/gradebookScores.routes.js";
import gradebookAttendanceMeetingsRouter from "./routes/gradebookAttendanceMeetings.routes.js";
import gradebookAttendanceEntriesRouter from "./routes/gradebookAttendanceEntries.routes.js";

const app = express();

// Global middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
  }),
);

app.use(express.json());

// Static files
// Keep sensitive uploaded files behind authenticated routes.
// app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Public authentication
app.use("/auth", authRouter);

// Public admission
app.use("/api/admissions", admissionsPublicRouter);

// Protected admission period management
app.use(
  "/api/admission-periods",
  authenticate,
  requireRole("Admin", "Registrar"),
  admissionPeriodsRouter,
);

// Admission Application Management
app.use(
  "/api/admission-applications",
  authenticate,
  requireRole("Admin", "Registrar"),
  admissionApplicationsRouter,
);

// Admin routes
app.use("/api/users", authenticate, requireRole("Admin"), usersRouter);
app.use("/api/roles", authenticate, requireRole("Admin"), rolesRouter);
app.use("/api/students", authenticate, requireRole("Admin"), studentsRouter);

app.use(
  "/api/activity-logs",
  authenticate,
  requireRole("Admin"),
  activityRouter,
);

// Announcement management
app.use(
  "/api/announcement-management",
  authenticate,
  requireRole("Admin", "Registrar"),
  announcementManagementRouter,
);

// Shared announcement viewing
app.use("/api/announcements", authenticate, usersAnnouncementRoutes);

// Registrar routes
app.use(
  "/api/registrar",
  authenticate,
  requireRole("Registrar"),
  registrarRoutes,
);

// Faculty routes
app.use("/api/faculty", authenticate, requireRole("Faculty"), facultyRouter);

// Program Head routes
app.use(
  "/api/program-head",
  authenticate,
  requireRole("Program Head"),
  programHeadRouter,
);

// Student routes
app.use("/api/student", authenticate, requireRole("Student"), studentRoutes);

// Finance routes
app.use("/api/finance", authenticate, requireRole("Finance"), financeRouter);

// Manual payment verification
app.use(
  "/api/manual-payment-verifications",
  authenticate,
  manualPaymentVerificationsRouter,
);

// Shared authenticated file routes
app.use("/api/files", authenticate, filesRouter);

// Root route
app.get("/", (req, res) => {
  return res.json({
    success: true,
    message: "PTC Student Portal API is running.",
  });
});

// Gradebook initialization testing
app.use(
  "/api/gradebook",
  authenticate,
  requireRole("Faculty", "Program Head"),
  gradebookInitializationRouter,
);

// Gradebook assessment management
app.use(
  "/api/gradebook",
  authenticate,
  requireRole("Faculty", "Program Head"),
  gradebookAssessmentsRouter,
);

app.use(
  "/api/gradebook",
  authenticate,
  requireRole("Faculty", "Program Head"),
  gradebookRosterRouter,
);
app.use(
  "/api/gradebook",
  authenticate,
  requireRole("Faculty", "Program Head"),
  gradebookScoresRouter,
);

app.use(
  "/api/gradebook",
  authenticate,
  requireRole("Faculty", "Program Head"),
  gradebookAttendanceMeetingsRouter,
);

app.use(
  "/api/gradebook",
  authenticate,
  requireRole("Faculty", "Program Head"),
  gradebookAttendanceEntriesRouter,
);

// 404 handler
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: "API endpoint not found.",
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("UNHANDLED SERVER ERROR:", err);

  return res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
});

// Start server
const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Backend running at http://localhost:${PORT}`);
});
