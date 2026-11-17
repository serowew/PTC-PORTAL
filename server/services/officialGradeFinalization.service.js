/* Official Grade Eligibility */

// SQL requires:
// g  = grades
// es = enrollment_subjects

export const officialGradeFinalizationSql = `
(
  EXISTS (
    SELECT 1
    FROM gradebook_finalized_roster fr
    JOIN gradebook_official_sheets sh
      ON sh.sheet_id = fr.sheet_id
    JOIN gradebook_offering_config cfg
      ON cfg.config_id = sh.config_id
    WHERE fr.grade_id = g.grade_id
      AND fr.enrollment_subject_id = es.enrollment_subject_id
      AND cfg.offering_id = es.offering_id
      AND fr.roster_disposition = 'APPROVED_GRADE'
      AND fr.grade_status_snapshot = 'Approved'
      AND sh.sheet_status = 'FINALIZED'
      AND sh.finalized_at IS NOT NULL
      AND sh.finalized_roster_count = (
        SELECT COUNT(*)
        FROM gradebook_finalized_roster all_fr
        WHERE all_fr.sheet_id = sh.sheet_id
      )
  )

  OR (
    -- Transitional protection for previously approved
    -- grades with no modern submission history.
    NOT EXISTS (
      SELECT 1
      FROM gradebook_official_grade_publications p
      WHERE p.grade_id = g.grade_id
    )

    AND NOT EXISTS (
      SELECT 1
      FROM gradebook_grade_submission_attempts a
      WHERE a.grade_id = g.grade_id
    )

    AND NOT EXISTS (
      SELECT 1
      FROM gradebook_term_submission_attempts t
      WHERE t.enrollment_subject_id =
        es.enrollment_subject_id
    )

    AND NOT EXISTS (
      SELECT 1
      FROM gradebook_inc_outcome_requests ir
      WHERE ir.enrollment_subject_id =
        es.enrollment_subject_id
    )

    AND NOT EXISTS (
      SELECT 1
      FROM gradebook_ud_outcome_requests ur
      WHERE ur.enrollment_subject_id =
        es.enrollment_subject_id
    )

    AND NOT EXISTS (
      SELECT 1
      FROM gradebook_special_outcomes so
      WHERE so.grade_id = g.grade_id
    )
  )
)`;
