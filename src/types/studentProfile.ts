export interface StudentProfile {
  profileId?: number;
  studentId?: number;
  studentNumber?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email?: string;
  contactNumber?: string;
  gender?: string;
  birthDate?: string;
  address?: string;
  course?: string;
  yearLevel?: string;
  section?: string;
  enrollmentStatus?: string;
  guardianName?: string;
  guardianRelationship?: string;
  guardianContact?: string;
  photo?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
