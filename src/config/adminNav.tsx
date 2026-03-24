export const adminNavGroups = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: '📊',
    children: [
      { label: 'Overview', path: '/admin/dashboard' },
      { label: 'Analytics', path: '/admin/dashboard' },
    ]
  },
  {
    id: 'admissions',
    label: 'Admissions',
    icon: '📝',
    children: [
      { label: 'Manage Admissions', path: '/admin/Admissions' },
      { label: 'Applications', path: '/admin/Admissions' },
    ]
  },
  {
    id: 'students',
    label: 'Students',
    icon: '👥',
    children: [
      { label: 'Manage Students', path: '/admin/Students' },
      { label: 'Student List', path: '/admin/Students' },
    ]
  },
  {
    id: 'announcements',
    label: 'Announcements',
    icon: '📢',
    children: [
      { label: 'Manage Announcements', path: '/admin/Announcements' },
      { label: 'Post New', path: '/admin/Announcements' },
    ]
  }
];
