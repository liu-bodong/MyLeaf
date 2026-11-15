import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import { loadSettings, resolveTheme, saveSettings } from './settings.js';
import type { ResolvedTheme, Settings } from './settings.js';

interface SettingsContextValue {
  readonly settings: Settings;
  readonly updateSettings: (change: Partial<Settings>) => void;
  /** The theme in effect, with `system` resolved. */
  readonly theme: ResolvedTheme;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function systemDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

/** Holds the settings, saves them, and applies the theme to the document. */
export function SettingsProvider({ children }: { readonly children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const dark = useSyncExternalStore(subscribeSystemTheme, systemDark);
  const theme = resolveTheme(settings.theme, dark);

  // Before paint, so the page does not flash the other theme.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const updateSettings = useCallback((change: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...change };
      saveSettings(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ settings, updateSettings, theme }),
    [settings, updateSettings, theme],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (value === null) throw new Error('useSettings must be used inside SettingsProvider');
  return value;
}
