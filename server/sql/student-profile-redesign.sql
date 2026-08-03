-- Student profile redesign using ALTER TABLE statements only.
-- These statements preserve the existing table and add the missing normalization features.

-- Remove legacy profile columns if they still exist.
SET @department_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'student_profiles'
    AND column_name = 'department'
);

SET @curriculum_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'student_profiles'
    AND column_name = 'curriculum'
);

SET @sql := IF(@department_exists > 0, 'ALTER TABLE student_profiles DROP COLUMN department', 'SELECT "department column not present"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(@curriculum_exists > 0, 'ALTER TABLE student_profiles DROP COLUMN curriculum', 'SELECT "curriculum column not present"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 1) Keep profile-specific data only and make the profile columns explicit.
ALTER TABLE student_profiles
  MODIFY profile_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  MODIFY student_id BIGINT UNSIGNED NOT NULL,
  MODIFY photo VARCHAR(255) NULL,
  MODIFY address VARCHAR(255) NULL,
  MODIFY guardian_name VARCHAR(100) NULL,
  MODIFY guardian_relationship VARCHAR(50) NULL,
  MODIFY guardian_contact VARCHAR(20) NULL,
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

-- 2) Add an index on student_id for faster profile lookups.
ALTER TABLE student_profiles
  ADD INDEX idx_student_profiles_student_id (student_id);

-- 3) Enforce a parent-child relationship with the students table.
--    ON DELETE CASCADE ensures profile rows are removed if the student is deleted.
ALTER TABLE student_profiles
  ADD CONSTRAINT fk_student_profiles_student
  FOREIGN KEY (student_id) REFERENCES students(student_id)
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- Notes:
-- - Profile-specific fields remain in student_profiles.
-- - Course, year level, section, and enrollment status should stay in students
--   or related academic tables to preserve normalization.
-- - Guardian relationship is included because it is a profile-specific family detail.
-- - updated_at is maintained automatically by MySQL via ON UPDATE CURRENT_TIMESTAMP.
