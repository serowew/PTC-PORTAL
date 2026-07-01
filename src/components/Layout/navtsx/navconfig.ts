import type { NavItem } from './nav';
import type { Role } from './nav';

/**
 * Student navigation tree.
 *
 * Adjust icons/paths/badges to match your real routes — the structure here
 * is what matters: any folder can nest any number of levels deep, e.g.
 * Courses -> BSIT -> 1st Year -> First Semester -> Subjects -> ...
 */
const studentNav: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '🏠', path: '/dashboard' },
  { id: 'profile', label: 'Profile', icon: '👤', path: '/profile' },
  {
    id: 'courses',
    label: 'Courses',
    icon: '🎓',
    children: [
      {
        id: 'bsit',
        label: 'BSIT',
        children: [
          { id: 'bsit-1st', label: '1st Year', path: '/courses/bsit/1st-year' },
          { id: 'bsit-2nd', label: '2nd Year', path: '/courses/bsit/2nd-year' },
          { id: 'bsit-3rd', label: '3rd Year', path: '/courses/bsit/3rd-year' },
        ],
      },
      {
        id: 'bsa',
        label: 'BSA',
        children: [
          { id: 'bsa-1st', label: '1st Year', path: '/courses/bsa/1st-year' },
          { id: 'bsa-2nd', label: '2nd Year', path: '/courses/bsa/2nd-year' },
        ],
      },
      {
        id: 'bsba',
        label: 'BSBA',
        children: [
          { id: 'bsba-1st', label: '1st Year', path: '/courses/bsba/1st-year' },
          { id: 'bsba-2nd', label: '2nd Year', path: '/courses/bsba/2nd-year' },
        ],
      },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    icon: '💳',
    badge: 2,
    children: [
      { id: 'finance-tuition', label: 'Tuition', path: '/finance/tuition' },
      { id: 'finance-payments', label: 'Payment History', path: '/finance/payments' },
    ],
  },
  { id: 'settings', label: 'Settings', icon: '⚙️', path: '/settings' },
];

const facultyNav: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '🏠', path: '/dashboard' },
  { id: 'profile', label: 'Profile', icon: '👤', path: '/profile' },
  {
    id: 'classes',
    label: 'My Classes',
    icon: '📚',
    children: [
      { id: 'class-bsit-1a', label: 'BSIT 1A', path: '/classes/bsit-1a' },
      { id: 'class-bsit-1b', label: 'BSIT 1B', path: '/classes/bsit-1b' },
    ],
  },
  { id: 'settings', label: 'Settings', icon: '⚙️', path: '/settings' },
];

const adminNav: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '🏠', path: '/dashboard' },
  {
    id: 'users',
    label: 'User Management',
    icon: '🧑‍💼',
    children: [
      { id: 'users-students', label: 'Students', path: '/admin/users/students' },
      { id: 'users-faculty', label: 'Faculty', path: '/admin/users/faculty' },
    ],
  },
  { id: 'settings', label: 'Settings', icon: '⚙️', path: '/settings' },
];

const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  student: studentNav,
  faculty: facultyNav,
  admin: adminNav,
};

/**
 * Returns the navigation tree for a given role.
 * Replace the bodies of studentNav/facultyNav/adminNav above with your real
 * navigation data — everything downstream (Sidebar, NavLevel) only depends
 * on the NavItem[] shape, not on this specific content.
 */
export function getNavByRole(role: Role): NavItem[] {
  return NAV_BY_ROLE[role] ?? [];
}