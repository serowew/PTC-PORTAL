export const adminNavGroups = [
  {
    id: "student-management",
    label: "Student Management",
    icon: "",
    children: [
      {
        id: "student-management-modify",
        label: "Modify Student",
        children: [
          {
            id: "student-management-modify-edit",
            label: "Edit",
            children: [
              { label: "sample", path: "/admin/students/modify/edit/sample-1" },
              { label: "sample", path: "/admin/students/modify/edit/sample-2" },
            ],
          },
          {
            id: "student-management-modify-delete",
            label: "Delete",
            children: [
              { label: "sample", path: "/admin/students/modify/delete/sample-1" },
              { label: "sample", path: "/admin/students/modify/delete/sample-2" },
            ],
          },

          {
            id: "student-management-modify-add",
            label: "Add",
            children: [
              { label: "sample", path: "/admin/students/modify/add/sample-1" },
              { label: "sample", path: "/admin/students/modify/add/sample-2" },
            ],
          },


        ],
      },

      { id: "student-management-list",
        label: "Student List", path: "/admin/students/list",
      },
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