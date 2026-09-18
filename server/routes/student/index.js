import express from "express";

import enrollmentRoutes from "./enrollments.js";
import academicRoutes from "./academicRecords.js";
import profileRoutes from "./profile.js";

console.log("✅ STUDENT INDEX ROUTER LOADED");
console.log("✅ STUDENT ACADEMIC RECORD ROUTER REGISTERED");
console.log("✅ STUDENT PROFILE ROUTER REGISTERED");

const router = express.Router();

router.use("/enrollments", enrollmentRoutes);
router.use("/academic-records", academicRoutes);
router.use("/profile", profileRoutes);

export default router;
