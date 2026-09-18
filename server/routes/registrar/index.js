import express from "express";

import studentRecordsRoutes from "./studentrecords.js";
import enrollmentRoutes from "./enrollments.js";
import curriculumRoutes from "./curriculums.js";
import subjectRoutes from "./subjects.js";
import courseRoutes from "./courses.js";
import departmentRoutes from "./departments.js";
import offeringsRoutes from "./offerings.js";
import transferevaluationRoutes from "./transferEvaluations.js";

const router = express.Router();

router.use("/students", studentRecordsRoutes);
router.use("/enrollments", enrollmentRoutes);
router.use("/curriculums", curriculumRoutes);
router.use("/subjects", subjectRoutes);
router.use("/courses", courseRoutes);
router.use("/departments", departmentRoutes);
router.use("/offerings", offeringsRoutes);
router.use("/transfer-evaluations", transferevaluationRoutes);

export default router;
