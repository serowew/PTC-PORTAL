import type { NavItem } from './nav';
/** True if an item is a folder (has at least one child). */
export function isFolder(item: NavItem): boolean {
  return Array.isArray(item.children) && item.children.length > 0;
}

/**
 * Recursively walks the tree looking for the first item matching `predicate`.
 * Returns the full chain of items from the root down to (and including) the
 * match, or null if nothing matched.
 *
 * Used to sync `activePath` with the current URL: e.g. if the user lands
 * directly on /courses/bsit/1st-year (deep link, page refresh, or browser
 * back/forward), we can reconstruct which folders should be open.
 */
export function findPathToItem(
  items: NavItem[],
  predicate: (item: NavItem) => boolean,
  trail: NavItem[] = [],
): NavItem[] | null {
  for (const item of items) {
    const nextTrail = [...trail, item];

    if (predicate(item)) {
      return nextTrail;
    }

    if (item.children && item.children.length > 0) {
      const found = findPathToItem(item.children, predicate, nextTrail);
      if (found) return found;
    }
  }

  return null;
}