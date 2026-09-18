// programHeadNav.ts

export const programHeadSoloLinks = [
  {
    label: "Dashboard",
    path: "/programhead/dashboard",
    icon: "",
  },
  {
    label: "Announcement",
    path: "/programhead/announcementprog",
    icon: "",
  },
];

export const programHeadNavGroups = [
  {
    id: "grade-approval",
    label: "Grade Approval",
    icon: "📋",
    children: [
      {
        label: "Pending Grades",
        path: "/programhead/gradeapproval/pending",
      },
      {
        label: "Transfer Evaluations",
        path: "/programhead/transfer-evaluations",
      },
    ],
  },
  {
    id: "class-management",
    label: "Class Management",
    icon: "📋",
    children: [
      {
        label: "Classes",
        path: "/programhead/class/management",
      },
    ],
  },
];
