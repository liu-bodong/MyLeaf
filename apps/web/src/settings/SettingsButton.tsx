import { useState } from 'react';
import { Icon } from '../ui/icons.js';
import { SettingsDialog } from './SettingsDialog.js';

/** Gear button that opens the settings window. */
export function SettingsButton() {
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
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
}
