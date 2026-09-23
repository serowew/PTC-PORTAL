import db from "../db.js";

export async function logActivity(
  userId,
  activityType,
  moduleName,
  description,
) {
  try {
    await db.execute(
      `
      INSERT INTO activity_logs
      (
        user_id,
        activity_type,
        module_name,
        description
      )
      VALUES (?, ?, ?, ?)
      `,
      [userId, activityType, moduleName, description],
    );
  } catch (err) {
    console.error("Activity Log Error:", err);
  }
}
