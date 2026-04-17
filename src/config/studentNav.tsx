export const studentNavGroups = [
  {
    id: "academic",
    label: "Academic Records",
    icon: "",
    children: [
      { label: "Grades & Results", path: "/student/records" },
      { label: "Transcript", path: "/student/transcript" },
      { label: "Course History", path: "/student/course-history" },
      { label: "Schedule", path: "/student/schedule" },
    ],
  },
  {
    id: "courses",
    label: "Course Management",
    icon: "",
    children: [
      { label: "View Subjects", path: "/student/courses/subjects" },
      { label: "Assignments", path: "/student/courses/assignments" },
      { label: "Lecture Notes", path: "/student/courses/notes" },
      { label: "Syllabus", path: "/student/courses/syllabus" },
      { label: "Submit Requirements", path: "/student/courses/submissions" },
    ],
  },
  {
    id: "enrollment",
    label: "Enrollment System",
    icon: "",
    children: [
      { label: "Available Courses", path: "/student/enrollment/courses" },
      { label: "Add / Drop Subjects", path: "/student/enrollment/add-drop" },
      { label: "Submit Enrollment", path: "/student/enrollment/submit" },
      { label: "Enrollment Status", path: "/student/enrollment/status" },
    ],
  },
  {
    id: "financial",
    label: "Financial",
    icon: "",
    children: [
      { label: "Tuition Fees", path: "/student/financial/tuition" },
      { label: "Payment History", path: "/student/financial/history" },
      { label: "Balance Inquiry", path: "/student/financial/balance" },
      { label: "Online Payment", path: "/student/financial/pay" },
    ],
  },
];
export const studentSoloLinks = [
  { label: "Dashboard", path: "/student/dashboard", icon: "" },
  { label: "Profile", path: "/student/profile", icon: "" },
];
