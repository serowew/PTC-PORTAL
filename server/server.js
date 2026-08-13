import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";

import authRouter from "./routes/auth.routes.js";
import usersRouter from "./routes/users.routes.js";
import studentsRouter from "./routes/students.routes.js";
import rolesRouter from "./routes/roles.routes.js";

import activityRouter from "./routes/activity.routes.js";
<<<<<<< HEAD
import enrollmentRoutes from "./routes/enrollment.routes.js";
=======
import filesRouter from "./routes/files.routes.js";

import announcementRoutes from "./routes/announcement/adminAnnouncement.routes.js";
import usersAnnouncementRoutes from "./routes/announcement/usersAnnouncement.routes.js";

import registrarRoutes from "./routes/registrar/index.js";
import studentEnrollmentRoutes from "./routes/student/enrollments.js";
>>>>>>> 358a6e3c84374d2dcbfba7473f349cb250628467

const app = express();

// =======================
// Middleware
// =======================
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
  }),
);

app.use(express.json());

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// =======================
// API Routes
// =======================
app.use("/auth", authRouter);
app.use("/api/roles", rolesRouter);
app.use("/api/users", usersRouter);
app.use("/api/activity-logs", activityRouter);
app.use("/api/students", studentsRouter);
app.use("/api/files", filesRouter);
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Announcement Routing
app.use("/api/admin/announcements", announcementRoutes);
app.use("/api/announcements", usersAnnouncementRoutes);

// Registrar Routing
app.use("/api/registrar", registrarRoutes);
// Student Routing
app.use("/api/student/enrollments", studentEnrollmentRoutes);

app.use("/api/enrollment", enrollmentRoutes);

// =======================
// Root Route
// =======================
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "PTC Student Portal API is running.",
  });
});

// =======================
// 404 Handler
// =======================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found.",
  });
});

// =======================
// Global Error Handler
// =======================
app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
});

// =======================
// Start Server
// =======================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Backend running at http://localhost:${PORT}`);
});
