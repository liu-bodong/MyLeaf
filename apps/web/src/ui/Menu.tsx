import { useCallback, useEffect, useRef, useState } from 'react';
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
      /** Set for choices; renders a radio item, or a checkbox item with `checkbox`. */
      readonly checked?: boolean;
      readonly checkbox?: boolean;
    }
  | { readonly kind: 'separator' };

export interface MenuDefinition {
  readonly label: string;
  readonly items: readonly MenuItem[];
}

const ENABLED_ITEMS = '[role^="menuitem"]:not([aria-disabled="true"])';

/** Moves focus between enabled items with the arrow keys, Home and End. */
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ENABLED_ITEMS)];
  if (items.length === 0) return;
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    (event.key === 'Home' ? items[0] : items[items.length - 1])?.focus();
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
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
  /** Which end of the list receives focus when it opens. */
  readonly initialFocus?: 'first' | 'last' | undefined;
}

/** A popup list of menu items. Disabled items stay focusable so their hint is readable. */
export function MenuList({
  label,
  items,
  onClose,
  align = 'start',
  initialFocus = 'first',
}: MenuListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const focusable = [...(listRef.current?.querySelectorAll<HTMLElement>(ENABLED_ITEMS) ?? [])];
    const target = initialFocus === 'last' ? focusable[focusable.length - 1] : focusable[0];
    target?.focus();
  }, [initialFocus]);
  return (
    <div
      ref={listRef}
      role="menu"
      aria-label={label}
      className={`menu align-${align}`}
      onKeyDown={moveFocus}
    >
      {items.map((item, index) => {
        if (item.kind === 'separator') {
          return <div key={index} role="separator" className="menu-separator" />;
        }
        const disabled = item.disabled === true || item.onSelect === undefined;
        return (
          <button
            key={index}
            type="button"
            role={
              item.checked === undefined
                ? 'menuitem'
                : item.checkbox === true
                  ? 'menuitemcheckbox'
                  : 'menuitemradio'
            }
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const closeAndFocus = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  useDismiss(ref, open, close, closeAndFocus);
  return (
    <div className={`dropdown ${className ?? ''}`} ref={ref}>
      <button
        ref={triggerRef}
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
      {open && <MenuList label={label} items={items} onClose={closeAndFocus} align={align} />}
    </div>
  );
}

/** Application menu bar; once a menu is open, hovering another menu opens it instead. */
export function MenuBar({ menus }: { readonly menus: readonly MenuDefinition[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [initialFocus, setInitialFocus] = useState<'first' | 'last'>('first');
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(null), []);
  const triggers = useCallback(
    // Only the top-level buttons: menu items also have role="menuitem" and
    // would otherwise shift the indices of the menus after the open one.
    () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('.menubar-item') ?? [])],
    [],
  );
  const closeAndFocus = useCallback(() => {
    const index = open;
    setOpen(null);
    if (index !== null) triggers()[index]?.focus();
  }, [open, triggers]);
  useDismiss(ref, open !== null, close, closeAndFocus);

  const openMenu = (index: number, focus: 'first' | 'last' = 'first') => {
    setInitialFocus(focus);
    setOpen(index);
  };

  return (
    <div
      className="menubar"
      role="menubar"
      aria-label="Main menu"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        const current =
          open ?? triggers().findIndex((button) => button === window.document.activeElement);
        if (current < 0) return;
        event.preventDefault();
        const next =
          (current + (event.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length;
        triggers()[next]?.focus();
        if (open !== null) openMenu(next);
      }}
    >
      {menus.map((menu, index) => (
        <div className="dropdown" key={menu.label}>
          <button
            type="button"
            role="menuitem"
            className="menubar-item"
            aria-haspopup="menu"
            aria-expanded={open === index}
            onClick={() => (open === index ? setOpen(null) : openMenu(index))}
            onPointerEnter={() => {
              if (open !== null && open !== index) openMenu(index);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                openMenu(index, 'first');
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                openMenu(index, 'last');
              } else if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                const target = event.key === 'Home' ? 0 : menus.length - 1;
                triggers()[target]?.focus();
                if (open !== null) openMenu(target);
              }
            }}
          >
            {menu.label}
          </button>
          {open === index && (
            <MenuList
              label={menu.label}
              items={menu.items}
              onClose={closeAndFocus}
              initialFocus={initialFocus}
            />
          )}
        </div>
      ))}
    </div>
  );
}
