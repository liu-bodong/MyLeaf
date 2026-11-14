import { useCallback, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useDismiss } from './useDismiss.js';

/** Shown on menu items that have no action yet. */
export const NOT_AVAILABLE = 'Not available yet';

export type MenuItem =
  | {
      readonly kind?: 'item';
      readonly label: string;
      /** Without an action the item is shown disabled, as a placeholder. */
      readonly onSelect?: () => void;
      readonly disabled?: boolean;
      /** Tooltip, e.g. why the item is disabled. */
      readonly hint?: string;
      readonly shortcut?: string;
      /** Set for one-of-many choices; renders a radio item. */
      readonly checked?: boolean;
    }
  | { readonly kind: 'separator' };

export interface MenuDefinition {
  readonly label: string;
  readonly items: readonly MenuItem[];
}

const ENABLED_ITEMS = '[role^="menuitem"]:not([aria-disabled="true"])';

/** Moves focus between enabled items with the arrow keys. */
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ENABLED_ITEMS)];
  if (items.length === 0) return;
  const index = items.findIndex((item) => item === window.document.activeElement);
  const next =
    event.key === 'ArrowDown'
      ? (index + 1) % items.length
      : (index <= 0 ? items.length : index) - 1;
  items[next]?.focus();
}

interface MenuListProps {
  readonly label: string;
  readonly items: readonly MenuItem[];
  readonly onClose: () => void;
  readonly align?: 'start' | 'end' | undefined;
}

/** A popup list of menu items. Disabled items stay focusable so their hint is readable. */
export function MenuList({ label, items, onClose, align = 'start' }: MenuListProps) {
  return (
    <div role="menu" aria-label={label} className={`menu align-${align}`} onKeyDown={moveFocus}>
      {items.map((item, index) => {
        if (item.kind === 'separator') {
          return <div key={index} role="separator" className="menu-separator" />;
        }
        const disabled = item.disabled === true || item.onSelect === undefined;
        return (
          <button
            key={index}
            type="button"
            role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={item.checked}
            aria-disabled={disabled}
            title={item.hint ?? (item.onSelect === undefined ? NOT_AVAILABLE : undefined)}
            onClick={() => {
              if (disabled) return;
              onClose();
              item.onSelect?.();
            }}
          >
            <span className="menu-check" aria-hidden="true">
              {item.checked === true ? '✓' : ''}
            </span>
            <span className="menu-label">{item.label}</span>
            {item.shortcut !== undefined && <kbd>{item.shortcut}</kbd>}
          </button>
        );
      })}
    </div>
  );
}

interface DropdownProps {
  /** Accessible name of the trigger and the menu. */
  readonly label: string;
  /** Visible trigger content. */
  readonly trigger: ReactNode;
  readonly items: readonly MenuItem[];
  readonly align?: 'start' | 'end' | undefined;
  readonly className?: string;
  readonly buttonClassName?: string;
  readonly disabled?: boolean;
  readonly title?: string;
}

/** A button that opens a menu. */
export function Dropdown(props: DropdownProps) {
  const { label, trigger, items, align, className, buttonClassName, disabled, title } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  return (
    <div className={`dropdown ${className ?? ''}`} ref={ref}>
      <button
        type="button"
        className={buttonClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={title}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {open && <MenuList label={label} items={items} onClose={close} align={align} />}
    </div>
  );
}

/** Application menu bar; once a menu is open, hovering another menu opens it instead. */
export function MenuBar({ menus }: { readonly menus: readonly MenuDefinition[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(null), []);
  useDismiss(ref, open !== null, close);
  return (
    <div className="menubar" role="menubar" aria-label="Main menu" ref={ref}>
      {menus.map((menu, index) => (
        <div className="dropdown" key={menu.label}>
          <button
            type="button"
            role="menuitem"
            className="menubar-item"
            aria-haspopup="menu"
            aria-expanded={open === index}
            onClick={() => setOpen(open === index ? null : index)}
            onPointerEnter={() => {
              if (open !== null) setOpen(index);
            }}
          >
            {menu.label}
          </button>
          {open === index && <MenuList label={menu.label} items={menu.items} onClose={close} />}
        </div>
      ))}
    </div>
  );
}
