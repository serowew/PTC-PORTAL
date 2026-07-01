import type { NavItem } from '../navtsx/nav';
import { isFolder } from '../navtsx/navutils';
import NavRow from './navrow';

interface NavLevelProps {
  /** The sibling items to render at this level. */
  items: NavItem[];
  /** Full active chain of selected folders, root to deepest. */
  activePath: NavItem[];
  /** How deep this level is in activePath (0 = root level). */
  levelIndex: number;
  currentPathname: string;
  /**
   * Called when a folder row is clicked.
   * - Pass `item` to select/replace the open folder at this level.
   * - Omit `item` to close the currently-open folder at this level
   *   (this is what makes the open folder act as its own back button).
   */
  onToggleFolder: (levelIndex: number, item?: NavItem) => void;
  onNavigatePage: (item: NavItem) => void;
}

/**
 * Renders one "screen" of the drill-down sidebar and recurses into whichever
 * folder is currently selected at this level.
 *
 * Behavior, matching the spec exactly:
 * - If no folder is selected at this level: show every item normally.
 * - If a folder IS selected: show items up to and including the selected
 *   folder, render the selected folder as an open header, and recurse into
 *   its children directly underneath. Items after the selected folder are
 *   not rendered — the child list takes their place, which is what makes
 *   clicking a folder feel like "stepping into" it rather than expanding
 *   an accordion.
 * - Exception: at the root level (levelIndex 0), items are never truncated.
 *   Root items (Dashboard, Profile, Courses, Finance, Settings, ...) are
 *   independent top-level entries, not siblings "inside" a shared group, so
 *   opening one of them (e.g. Courses) must not hide the others.
 */
export default function NavLevel({
  items,
  activePath,
  levelIndex,
  currentPathname,
  onToggleFolder,
  onNavigatePage,
}: NavLevelProps) {
  const selectedId = activePath[levelIndex]?.id;
  const selectedIndex = selectedId ? items.findIndex((item) => item.id === selectedId) : -1;

  // Root level (levelIndex 0) always shows every item — Dashboard, Profile,
  // Finance, Settings etc. are separate top-level entries, not part of
  // whatever group is open, so opening Courses shouldn't hide them.
  // Every level below that DOES truncate: BSA/BSBA disappearing when BSIT
  // is picked is "its own group" collapsing, which is still the point.
  const visibleItems =
    levelIndex === 0 || selectedIndex === -1 ? items : items.slice(0, selectedIndex + 1);

  return (
    <ul className="sidebar-nav-level" role="list">
      {visibleItems.map((item, index) => {
        const folder = isFolder(item);
        const isSelected = index === selectedIndex;

        if (isSelected && folder) {
          return (
            <li key={item.id} className="nav-group">
              <NavRow
                item={item}
                isOpen
                isActive={false}
                onClick={() => onToggleFolder(levelIndex)}
              />
              <NavLevel
                items={item.children as NavItem[]}
                activePath={activePath}
                levelIndex={levelIndex + 1}
                currentPathname={currentPathname}
                onToggleFolder={onToggleFolder}
                onNavigatePage={onNavigatePage}
              />
            </li>
          );
        }

        return (
          <li key={item.id} className="nav-item-wrapper">
            <NavRow
              item={item}
              isOpen={false}
              isActive={!folder && item.path === currentPathname}
              onClick={() =>
                folder ? onToggleFolder(levelIndex, item) : onNavigatePage(item)
              }
            />
          </li>
        );
      })}
    </ul>
  );
}