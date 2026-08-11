import express from "express";
import GradesController from "../controllers/grades.controller.js";

const router = express.Router();

// GET /api/grades
router.get("/", GradesController.getStudentGrades);

export default router;