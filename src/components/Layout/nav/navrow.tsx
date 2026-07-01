import type { KeyboardEvent, ReactNode } from 'react';
import type { NavItem } from '../navtsx/nav';
import { isFolder } from '../navtsx/navutils';

interface NavRowProps {
  item: NavItem;
  /** True when this folder is the currently-open one at its level. */
  isOpen: boolean;
  /** True when this is the page matching the current route. */
  isActive: boolean;
  onClick: () => void;
}

function renderIcon(item: NavItem, folder: boolean, isOpen: boolean): ReactNode {
  if (item.icon !== undefined) {
    // string icons (emoji / css class name) and custom ReactNode icons both
    // just get wrapped so spacing/alignment stays consistent.
    return (
      <span className="nav-icon" aria-hidden="true">
        {item.icon}
      </span>
    );
  }

  if (folder) {
    return (
      <span className="nav-icon" aria-hidden="true">
        {isOpen ? '📂' : '📁'}
      </span>
    );
  }

  return null;
}

/**
 * Single clickable row in the sidebar. Has no knowledge of the tree —
 * it just renders one item and reports clicks upward. This is what keeps
 * NavLevel free of duplicated markup regardless of nesting depth.
 */
export default function NavRow({ item, isOpen, isActive, onClick }: NavRowProps) {
  const folder = isFolder(item);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className={[
        'nav-row',
        folder ? 'nav-row--folder' : 'nav-row--page',
        isOpen ? 'folder-open' : '',
        isActive ? 'active' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role={folder ? 'button' : 'link'}
      tabIndex={0}
      aria-expanded={folder ? isOpen : undefined}
      aria-current={isActive ? 'page' : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      {renderIcon(item, folder, isOpen)}
      <span className="nav-label">{item.label}</span>
      {typeof item.badge === 'number' && item.badge > 0 && (
        <span className="nav-badge">{item.badge}</span>
      )}
    </div>
  );
}