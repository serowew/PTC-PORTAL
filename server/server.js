import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";

import authRouter from "./routes/auth.routes.js";
import studentsRouter from "./routes/students.routes.js";
import usersRouter from "./routes/users.routes.js";
import activityRouter from "./routes/activity.routes.js";
import announcementRoutes from "./routes/announcement.routes.js";
import profileRouter from "./routes/profile.routes.js";

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

app.use("/api/students", studentsRouter);

app.use("/api/users", usersRouter);

app.use("/api/activity-logs", activityRouter);

app.use("/api/announcements", announcementRoutes);

app.use("/api/profile", profileRouter);

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
