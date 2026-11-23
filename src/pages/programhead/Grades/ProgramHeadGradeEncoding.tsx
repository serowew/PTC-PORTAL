import EnterGrades from "../../faculty/Grades/EnterGrades";
import "../../../styles/ProgramHeadGradeEncoding.css";

/**
 * Program Head teaching gradebook.
 * EnterGrades already uses the Program Head's instructor assignment and
 * the Program Head class endpoints when the authenticated role is Program Head.
 */
export default function ProgramHeadGradeEncoding() {
  return (
    <div className="programhead-grade-encoding-route">
      <EnterGrades />
    </div>
  );
}
