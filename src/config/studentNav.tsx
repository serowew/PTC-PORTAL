export const studentNavGroups = [
  {
    id: "academic",
    label: "Academic Records",
    icon: "",
    children: [
      { label: "Schedule", path: "/student/schedule" },
      { label: "Grades", path: "/student/records" },
      { label: "Academic History", path: "/student/course-history" },
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
  {
    id: "document",
    label: "Document",
    icon: "",
    children: [
      { label: "Request Document", path: "/student/document/request" },
      { label: "Document Release", path: "/student/document/release" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: "",
    children: [{ label: "User Management", path: "/student/setting/user" }],
  },
];
export const studentSoloLinks = [
  { label: "Dashboard", path: "/student/dashboard", icon: "" },
  { label: "Profile", path: "/student/profile", icon: "" },
  { label: "Announcement", path: "/student/announcement", icon: "" },
];
