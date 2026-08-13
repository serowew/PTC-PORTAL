export const adminNavGroups = [
  {
    id: "student-management",
    label: "Student Management",
    icon: "",
    children: [
      { label: "Student List", path: "/admin/students/manage" },
      { label: "Student Management", path: "/admin/students/addeditdrop" },
      {
  label: "Students for Setup",
  path: "/admin/students/setup"
}
    ],
  },
  
  {
  id: "enrollment-management",
  label: "Enrollment Management",
  icon: "",
  children: [
    {
      label: "Pending Requests",
      path: "/admin/enrollment/pending"
    },
    {
      label: "Enrolled Students",
      path: "/admin/enrollment/students"
    }
  ]
},


  {
    id: "financial-management",
    label: "Financial Management",
    icon: "",
    children: [
      { label: "Payment Monitoring", path: "/admin/financial/payments" },
      { label: "Billing", path: "/admin/financial/billing" },
      { label: "Scholarship", path: "/admin/financial/scholarship" },
      { label: "Reports", path: "/admin/financial/freport" },
    ],
  },
  {
    id: "system-management",
    label: "System Management",
    icon: "",
    children: [
      { label: "backup", path: "/admin/system/backup" },
      { label: "Acadsetting", path: "/admin/system/acadsetting" },
      { label: "Settings", path: "/admin/system/Gsettings" },
      { label: "Security", path: "/admin/system/security" },
      { label: "Email", path: "/admin/system/email" },
    ],
  },

  {
    id: "report-management",
    label: "Report Management",
    icon: "",
    children: [
      { label: "Dashboard", path: "/admin/reports/dashboard" },
      { label: "Export Reports", path: "/admin/reports/export" },
      { label: "Audit Logs", path: "/admin/reports/auditlog" },
      { label: "Usage Analytics", path: "/admin/reports/analytics" },
    ],
  },
  {
    id: "user-management",
    label: "User Management",
    icon: "",
    children: [
      { label: "User List", path: "/admin/user/list" },
      { label: "UserActivity", path: "/admin/user/activity" },
      { label: "User Roles", path: "/admin/user/roles" },
    ],
  },
];

export const adminSoloLinks = [
  { label: "Dashboard", path: "/admin/dashboard", icon: "" },
];
