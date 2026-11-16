import type { ReactNode } from 'react';
import { SettingsButton } from '../settings/SettingsButton.js';
import { Dropdown, MenuBar, NOT_AVAILABLE } from '../ui/Menu.js';
import type { MenuDefinition, MenuItem } from '../ui/Menu.js';
import { Icon } from '../ui/icons.js';

interface TopBarProps {
  readonly projectName: string;
  /** Shown next to the title, e.g. "saved". */
  readonly saveState: string;
  readonly menus: readonly MenuDefinition[];
  /** Items of the project title dropdown. */
  readonly projectItems: readonly MenuItem[];
  /** Items of the Layout dropdown. */
  readonly layoutItems: readonly MenuItem[];
  /** The project's settings, in the settings window. */
  readonly projectSettings?: ReactNode;
}

/** Application bar: menus, project title, and project-level actions. */
export function TopBar({
  projectName,
  saveState,
  menus,
  projectItems,
  layoutItems,
  projectSettings,
}: TopBarProps) {
  return (
    <header className="topbar">
      <a href="#/" className="icon-button home" aria-label="Back to projects" title="Projects">
        <Icon name="home" />
      </a>
      <MenuBar menus={menus} />
      <div className="topbar-title">
        <h1 className="visually-hidden">{projectName}</h1>
        <Dropdown
          label={`Project: ${projectName}`}
          trigger={
            <>
              <span className="project-name">{projectName}</span>
              <Icon name="chevron-down" />
            </>
          }
          items={projectItems}
          align="start"
          buttonClassName="title-button"
        />
        <span className={`save-state ${saveState}`} data-testid="save-state">
          {saveState}
        </span>
      </div>
      <div className="topbar-actions">
        <button type="button" className="topbar-button" disabled title={NOT_AVAILABLE}>
          <Icon name="history" />
          History
        </button>
        <Dropdown
          label="Layout"
          trigger={
            <>
              <Icon name="layout" />
              Layout
              <Icon name="chevron-down" />
            </>
          }
          items={layoutItems}
          align="end"
          buttonClassName="topbar-button"
        />
        <button type="button" className="topbar-button" disabled title={NOT_AVAILABLE}>
          <Icon name="share" />
          Share
        </button>
        <SettingsButton projectSection={projectSettings} />
      </div>
    </header>
  );
}
