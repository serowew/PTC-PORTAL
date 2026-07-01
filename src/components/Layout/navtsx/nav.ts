import type { ReactNode } from 'react';

/**
 * Roles supported by the portal. Extend this union as new roles are added —
 * TypeScript will then force getNavByRole() and any role-switch logic to
 * handle the new case.
 */
export type Role = 'student' | 'faculty' | 'admin';

/**
 * A single entry in the sidebar navigation tree.
 *
 * - If `children` is present and non-empty, the item is a FOLDER.
 * - If `children` is absent/empty, the item is a PAGE and should have `path`.
 *
 * There is no `depth` or `level` field on purpose: depth is derived from
 * where the item sits in the tree, so nesting is unlimited by construction.
 */
export interface NavItem {
  /** Stable unique id, used for React keys and for matching selection state. */
  id: string;
  label: string;
  /** Emoji/string icon, or a fully custom ReactNode (e.g. an <Icon /> component). */
  icon?: string | ReactNode;
  /** Route path. Present on pages (leaf items). Folders usually omit this. */
  path?: string;
  /** Optional numeric badge, e.g. unread count. */
  badge?: number;
  /** Child items. Presence of a non-empty array makes this item a folder. */
  children?: NavItem[];
}