export const adminNavGroups = [
  {
    id: "student-management",
    label: "Student Management",
    icon: "",
    children: [
      { label: "Add / Edit Students", path: "/admin/students/manage" },
      { label: "Records Management", path: "/admin/students/records" },
    ],
  },
  {
    id: "enrollment-management",
    label: "Enrollment Management",
    icon: "",
    children: [
      { label: "Approve Enrollment", path: "/admin/enrollment/approve" },
      { label: "Class Scheduling", path: "/admin/enrollment/scheduling" },
    ],
  },
  {
    id: "financial-management",
    label: "Financial Management",
    icon: "",
    children: [
      { label: "Fees Setup", path: "/admin/financial/fees" },
      { label: "Payment Monitoring", path: "/admin/financial/payments" },
    ],
  },
  {
    id: "system-management",
    label: "System Management",
    icon: "",
    children: [
      { label: "User Accounts", path: "/admin/system/accounts" },
      { label: "Roles & Permissions", path: "/admin/system/roles" },
      { label: "System Settings", path: "/admin/system/settings" },
    ],
  },
  {
    id: "reports",
    label: "Reports & Analytics",
    icon: "",
    children: [
      { label: "Student Reports", path: "/admin/reports/students" },
      { label: "Financial Reports", path: "/admin/reports/financial" },
      { label: "Usage Analytics", path: "/admin/reports/analytics" },
    ],
  },
];

export const adminSoloLinks = [
  { label: "Dashboard", path: "/admin/dashboard", icon: "" },
];
