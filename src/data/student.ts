export interface Student {
  student_id: number;
  student_number: string;

  first_name: string;
  middle_name?: string;
  last_name: string;

  gender: string;
  birth_date: string;
  contact_number: string;

  year_level: number;

  course_code: string;
  course_name: string;

  section_name: string;

  academic_year: string;

  admission_date: string;
}