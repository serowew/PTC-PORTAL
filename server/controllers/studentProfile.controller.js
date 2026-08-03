import { studentProfileModel } from "../models/studentProfile.model.js";

export const getStudentProfile = async (req, res, next) => {
  try {
    const identifier = req.params.studentId ?? req.query.studentId ?? req.query.userId ?? req.query.identifier;

    const profile = await studentProfileModel.getByIdentifier(identifier);

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Student profile not found.",
      });
    }

    return res.json({
      success: true,
      data: profile,
    });
  } catch (error) {
    next(error);
  }
};

export const updateStudentProfile = async (req, res, next) => {
  try {
    const identifier = req.params.studentId ?? req.query.studentId;
    const payload = req.body;

    const profile = await studentProfileModel.updateOrCreateByIdentifier(identifier, payload);

    return res.json({
      success: true,
      message: "Student profile updated successfully.",
      data: profile,
    });
  } catch (error) {
    if (error.message === "Student not found.") {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    next(error);
  }
};
