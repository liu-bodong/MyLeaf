import { useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../ui/icons.js';
import { SettingsDialog } from './SettingsDialog.js';

/** Gear button that opens the settings window; `projectSection` adds the open project's settings. */
export function SettingsButton({ projectSection }: { readonly projectSection?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label="Settings"
        title="Settings"
        onClick={() => setOpen(true)}
      >
        <Icon name="settings" />
      </button>
      {open && <SettingsDialog onClose={() => setOpen(false)} projectSection={projectSection} />}
    </>
  );
}
