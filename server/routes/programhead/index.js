import express from "express";

import classesRouter from "./classes.js";
import gradesRouter from "./grades.js";
import transferevaluationRouter from "./transferEvaluations.js";
const router = express.Router();

router.use("/classes", classesRouter);
router.use("/grades", gradesRouter);
router.use("/transfer-evaluations", transferevaluationRouter);
export default router;
