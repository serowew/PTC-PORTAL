import express from "express";
import { getStudentProfile, updateStudentProfile } from "../controllers/studentProfile.controller.js";

const router = express.Router();

router.get("/me", getStudentProfile);
router.get("/:studentId", getStudentProfile);
router.put("/:studentId", updateStudentProfile);

export default router;
