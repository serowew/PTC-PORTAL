import express from "express";

import studentRecordsRoutes from "./studentrecords.js";

import corRoutes from "./cor.js";

import enrollmentRoutes from "./enrollments.js";

import curriculumRoutes from "./curriculums.js";

import subjectRoutes from "./subjects.js";

import courseRoutes from "./courses.js";

import departmentRoutes from "./departments.js";

import offeringsRoutes from "./offerings.js";

import transferevaluationRoutes from "./transferEvaluations.js";

// Document Request Workflow

import documentRequestsRoutes from "./documentRequests.js";

const router = express.Router();

// ============================================================
// REGISTRAR ROUTES
// ============================================================

// ============================================================
// STUDENT COR
//
// GET
// /api/registrar/students/:studentId/cor
//
// Optional:
// ?enrollment_id=123
// ============================================================

router.use("/students", corRoutes);

// ============================================================
// STUDENT RECORDS
// ============================================================

router.use("/students", studentRecordsRoutes);

// ============================================================
// ENROLLMENT
// ============================================================

router.use("/enrollments", enrollmentRoutes);

// ============================================================
// CURRICULUM
// ============================================================

router.use("/curriculums", curriculumRoutes);

// ============================================================
// SUBJECTS
// ============================================================

router.use("/subjects", subjectRoutes);

// ============================================================
// COURSES
// ============================================================

router.use("/courses", courseRoutes);

// ============================================================
// DEPARTMENTS
// ============================================================

router.use("/departments", departmentRoutes);

// ============================================================
// OFFERINGS
// ============================================================

router.use("/offerings", offeringsRoutes);

// ============================================================
// TRANSFER EVALUATIONS
// ============================================================

router.use("/transfer-evaluations", transferevaluationRoutes);

// ============================================================
// DOCUMENT REQUEST WORKFLOW
// ============================================================

router.use("/document-requests", documentRequestsRoutes);

export default router;
