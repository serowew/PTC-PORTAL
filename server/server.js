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

import facultyRouter from "./routes/faculty/index.js";
import programHeadRouter from "./routes/programhead/index.js";

import authenticate from "./middleware/authenticate.js";
import requireRole from "./middleware/requireRole.js";

const app = express();

// =====================================================
// GLOBAL MIDDLEWARE
// =====================================================

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
  }),
);

app.use(express.json());

// =====================================================
// STATIC FILES
// =====================================================

// TEMPORARY:
// Announcement/file URLs under /uploads are currently
// public.
//
// Later, sensitive academic/student files should be served
// through authenticated download endpoints instead of
// direct public URLs.
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// =====================================================
// PUBLIC AUTHENTICATION ROUTES
// =====================================================

app.use("/auth", authRouter);

// =====================================================
// ADMIN ROUTES
// =====================================================

app.use("/api/users", authenticate, requireRole("Admin"), usersRouter);

app.use("/api/roles", authenticate, requireRole("Admin"), rolesRouter);

app.use("/api/students", authenticate, requireRole("Admin"), studentsRouter);

app.use(
  "/api/activity-logs",
  authenticate,
  requireRole("Admin"),
  activityRouter,
);

// =====================================================
// ANNOUNCEMENT MANAGEMENT
//
// ADMIN + REGISTRAR
//
// GET    /api/announcement-management
// GET    /api/announcement-management/:id
// POST   /api/announcement-management
// PUT    /api/announcement-management/:id
// DELETE /api/announcement-management/:id
// PATCH  /api/announcement-management/:id/status
// =====================================================

app.use(
  "/api/announcement-management",
  authenticate,
  requireRole("Admin", "Registrar"),
  announcementManagementRouter,
);

// =====================================================
// SHARED ANNOUNCEMENT VIEWING
//
// ALL AUTHENTICATED USERS
//
// GET /api/announcements
// GET /api/announcements/:id
//
// Visibility is determined inside the router using:
//
// req.user.role_id
//
// Never trust role_id from the frontend.
// =====================================================

app.use("/api/announcements", authenticate, usersAnnouncementRoutes);

// =====================================================
// REGISTRAR ROUTES
// =====================================================

app.use(
  "/api/registrar",
  authenticate,
  requireRole("Registrar"),
  registrarRoutes,
);

// =====================================================
// FACULTY ROUTES
// =====================================================

app.use("/api/faculty", authenticate, requireRole("Faculty"), facultyRouter);

// =====================================================
// PROGRAM HEAD ROUTES
// =====================================================

app.use(
  "/api/program-head",
  authenticate,
  requireRole("Program Head"),
  programHeadRouter,
);

// =====================================================
// TEMPORARY STUDENT ROUTE DEBUG
// =====================================================

// =====================================================
// STUDENT ROUTES
// =====================================================

app.use("/api/student", authenticate, requireRole("Student"), studentRoutes);
// =====================================================
// SHARED AUTHENTICATED FILE ROUTES
// =====================================================

app.use("/api/files", authenticate, filesRouter);

// =====================================================
// ROOT ROUTE
// =====================================================

app.get("/", (req, res) => {
  return res.json({
    success: true,
    message: "PTC Student Portal API is running.",
  });
});

// =====================================================
// 404 HANDLER
// =====================================================

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: "API endpoint not found.",
  });
});

// =====================================================
// GLOBAL ERROR HANDLER
// =====================================================

app.use((err, req, res, next) => {
  console.error("UNHANDLED SERVER ERROR:", err);

  return res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
});

// =====================================================
// START SERVER
// =====================================================

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Backend running at http://localhost:${PORT}`);
});
