import express from "express";

import studentRecordsRoutes from "./studentrecords.js";
import corRoutes from "./cor.js";
import enrollmentRoutes from "./enrollments.js";
import curriculumRoutes from "./curriculums.js";
import subjectRoutes from "./subjects.js";
import courseRoutes from "./courses.js";
import departmentRoutes from "./departments.js";
import offeringsRoutes from "./offerings.js";
import offeringBatchesRoutes from "./offeringBatches.js";
import transferevaluationRoutes from "./transferEvaluations.js";
import documentRequestsRoutes from "./documentRequests.js";
import gradeChangeRequestRoutes from "./gradeChangeRequests.js";
import financeHistoryRoutes from "./financehistory.js";
import academicYearsRoutes from "./academicYears.js";

const router = express.Router();

router.use("/students", corRoutes);
router.use("/students", studentRecordsRoutes);
router.use("/enrollments", enrollmentRoutes);
router.use("/curriculums", curriculumRoutes);
router.use("/subjects", subjectRoutes);
router.use("/courses", courseRoutes);
router.use("/departments", departmentRoutes);
router.use("/offerings", offeringsRoutes);
router.use("/offering-batches", offeringBatchesRoutes);
router.use("/transfer-evaluations", transferevaluationRoutes);
router.use("/document-requests", documentRequestsRoutes);
router.use("/grade-change-requests", gradeChangeRequestRoutes);
router.use("/finance-history", financeHistoryRoutes);
router.use("/academic-years",academicYearsRoutes);

export default router;
