import express from "express";

import studentRecordsRoutes from "./studentrecords.js";
import enrollmentRoutes from "./enrollments.js";

const router = express.Router();

router.use("/students", studentRecordsRoutes);
router.use("/enrollments", enrollmentRoutes);

export default router;
