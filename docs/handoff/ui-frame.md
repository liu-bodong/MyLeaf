# Handoff: workspace UI frame

The workspace frame from [ADR 0013](../adr/0013-workspace-ui-frame.md) is in
place: top bar with menus, editor toolbar, PDF toolbar, resizable
editor/PDF split with saved layout, and the sync arrows in the divider. This
document lists what is left, for the agent finishing the details.

Goal from the project owner: the workspace should feel familiar to Overleaf
users ("look like Overleaf, but not too much") without copying Overleaf's
branding, logo, colours or exact visual style.

## Before you start

- Node 22: `export PATH=$HOME/.nvm/versions/node/v22.23.5/bin:$PATH`
  (the default Node 20 cannot run pnpm 12).
- Run the app: `pnpm dev` (server on :3000, web on :5173).
- Before pushing: `pnpm check` and `pnpm e2e`. `pnpm e2e` needs the server
  built (`pnpm --filter "@myleaf/server..." run build`) and a Chromium. If
  Playwright's browser is not installed, use Chrome:
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.
  The live preview test runs only with `MYLEAF_TEXPRESSO` set to a TeXpresso
  binary built by `vendor/texpresso/build.sh`.
- Read `docs/adr/0009` (module boundaries), `0012` (live preview) and `0013`
  (this frame) before changing a design. A new UI decision is a new ADR;
  0014 is reserved for live preview.
- **Do not edit** `apps/web/src/live/`, `apps/server/src/live/`,
  `packages/live-preview/`, `packages/live-texpresso/` or `vendor/texpresso/`
  without asking the project owner: another agent owns live preview.
  `LivePreviewPane` fills its container (`flex: 1`); place it anywhere.
- Ask the project owner before adding a left icon rail (files, search,
  comments, chat, AI); it was deliberately left out. Ask rather than guess
  names, paths or formats.
- Never add `minimumReleaseAgeExclude` to the pnpm config; pin an older
  version instead.

## Where things are

| Area                         | Files                                                              |
| ---------------------------- | ------------------------------------------------------------------ |
| Workspace wiring, menus      | `apps/web/src/workspace/Workspace.tsx`                             |
| Top bar                      | `apps/web/src/workspace/TopBar.tsx`                                |
| Editor toolbar               | `apps/web/src/workspace/EditorToolbar.tsx`                         |
| PDF toolbar, compile popover | `apps/web/src/workspace/PdfToolbar.tsx`, `CompileSettings.tsx`     |
| Saved layout                 | `apps/web/src/workspace/layout.ts` (+ `layout.test.ts`)            |
| Shortcut labels              | `apps/web/src/workspace/shortcuts.ts`                              |
| Menu bar, dropdown           | `apps/web/src/ui/Menu.tsx`, `ui/useDismiss.ts`                     |
| Split pane                   | `apps/web/src/ui/SplitPane.tsx`                                    |
| Icons                        | `apps/web/src/ui/icons.tsx` (16×16 stroke paths)                   |
| PDF viewer, zoom maths       | `apps/web/src/pdf/PdfViewer.tsx`, `pdf/zoom.ts` (+ `zoom.test.ts`) |
| Editor handle (undo, search) | `apps/web/src/editor/LatexEditor.tsx`                              |
| Styles                       | `apps/web/src/styles.css` (tokens at the top; dark mode block)     |
| End-to-end tests             | `e2e/ui-frame.spec.ts`, `e2e/editing.spec.ts`                      |

## Remaining work

Each item: what to do, files, and what done looks like.

### 1. Menu keyboard behaviour — done

Menus open on click or ArrowDown/ArrowUp, close on Escape or an outside
click, and Up/Down/Home/End move between enabled items. Left/Right move
between the top-level menus; Escape and choosing an item return focus to the
trigger. Covered by `e2e/ui-frame.spec.ts`.

- Files: `ui/Menu.tsx`, `ui/useDismiss.ts`.
- Done: the menu bar and dropdowns follow the WAI-ARIA menubar/menu-button
  patterns; an e2e test opens a menu and picks an item with the keyboard only.

### 2. Placeholders

Disabled with the tooltip "Not available yet": Insert menu (Figure, Table,
Citation, Cross-reference), Format menu (Bold, Italic, lists), Help menu
(Keyboard shortcuts, Documentation), File/project menu "Download source
(.zip)", History, Share, and Visual in the editor toolbar.

- Files: menu definitions in `Workspace.tsx` (`menus`, `projectItems`);
  `TopBar.tsx`; `EditorToolbar.tsx`.
- Done: each placeholder is either wired to a feature or confirmed with the
  project owner as staying. Some need features first (server zip export,
  history, sharing); those are separate tasks, not styling.
- A cheap one: Help → Keyboard shortcuts as a dialog listing the existing
  shortcuts (Mod-S / Mod-Enter compile, Mod-Z, Mod-Shift-Z, Mod-F).

### 3. Keyboard shortcuts for the PDF — done

Mod-+/Mod-- zoom and PageUp/PageDown move pages while the PDF pane has
focus; elsewhere the browser's page zoom is untouched. The toolbar tooltips
show the shortcuts.

- Files: `PdfToolbar.tsx`, `PdfViewer.tsx`.
- Done: Mod-+/Mod-- zoom and PageUp/PageDown move pages while the PDF pane
  has focus, without stealing the browser's page zoom elsewhere.

### 4. Visual styling

The frame uses the existing tokens (`--bg`, `--accent`, …) with neutral
toolbars. Remaining:

- Icons in `ui/icons.tsx` are hand-drawn placeholders; replace them with a
  consistent set (an icon library is an acceptable dependency if its licence
  is AGPL-compatible; pin a version at least as old as the pnpm release-age
  policy requires).
- Check every new element in dark mode (`prefers-color-scheme: dark`):
  menus, segmented controls, divider, count badge, page box.
- Hover, active and focus states for toolbar buttons and menu items are
  minimal; make them consistent.
- Keep MyLeaf's own colours; do not adopt Overleaf's green/navy palette.
- Done: screenshots at 1400×860 and 1024×768, light and dark, reviewed by
  the project owner.

### 5. Narrow widths

The PDF toolbar overflows when the PDF pane is narrower than about 520 px
(split at 80 % or small windows). Under 800 px the workspace stacks
(sidebar, editor, PDF), the divider and the menu bar are hidden.

- Files: `styles.css` (`@media (max-width: 800px)`), `PdfToolbar.tsx`,
  `TopBar.tsx`.
- Done: no control is clipped at any split ratio between 20 % and 80 % on a
  1280 px window; the toolbar collapses lower-priority controls (page box,
  zoom presets) into a menu. Mobile behaviour agreed with the project owner
  (for example an editor/PDF toggle instead of stacking).

### 6. Live preview in the toolbar

While the Live tab is shown, the PDF toolbar's page and zoom controls and
the ← arrow are disabled; `LivePreviewPane` has its own page buttons. The
live-preview agent is changing that pane to continuous scrolling.

- Files: `Workspace.tsx`, `PdfToolbar.tsx`; the pane itself is in
  `apps/web/src/live/` (not yours).
- Done: once live preview exposes page, page count and zoom, the PDF
  toolbar drives both views and the pane's own header controls go away.
  Agree the interface with the live-preview owner through the project owner.

### 7. Logs

The Logs button shows the error count of the last compile and toggles the
diagnostics strip under the PDF (open by default).

- Files: `PdfToolbar.tsx`, `Workspace.tsx` (`logsOpen`), `Diagnostics.tsx`.
- Decide with the project owner: open automatically when a compile fails,
  close on success, remember the choice, show the warning count too.
- Done: behaviour agreed and covered by `e2e/ui-frame.spec.ts`.

### 8. Split and sidebar — done (except collapsing)

- Split ratio is limited to 20–80 % and saved per browser. Double-click on
  the divider resets it to 50 % (covered by `e2e/ui-frame.spec.ts`). Still
  open: touch drag on a device.
- The sidebar is resizable by dragging its right edge or with the keyboard
  (focus the separator; arrows/Home/End), double-click resets it, and the
  width is saved per browser. Still open: collapsing it.
- Files: `ui/SplitPane.tsx`, `workspace/Sidebar.tsx`, `workspace/layout.ts`,
  `styles.css`, `Workspace.tsx`.
- Done: divider reset and sidebar resize, both with e2e checks.

### 9. PDF viewer details

- Zoom keeps the page and the vertical position at the top of the view;
  the horizontal position is not kept when zoomed wider than the pane.
- No Ctrl/Cmd+wheel or pinch zoom.
- "Fit to page" fits the tallest page.
- The page box shows the page with the largest visible area.
- Download uses `<a download>`; the file name `<project>.pdf` applies only
  when the browser honours `download` for this URL. Check Safari and
  Firefox.
- Files: `pdf/PdfViewer.tsx`, `pdf/zoom.ts`.
- Done: wheel/pinch zoom anchored at the pointer; download name checked in
  Chrome, Firefox and Safari.

### 10. Sync arrows

- → runs forward search for the editor's cursor line and switches to the PDF
  (and from "Editor only" to the split view).
- ← runs inverse search for the point a third down the PDF view, horizontally
  centred, and switches from "PDF only" to the split view.
- Double-click in the PDF still runs inverse search for the clicked point.
- Files: `Workspace.tsx` (`goToPdf`, `goToSource`), `PdfViewer.tsx`
  (`readingPoint`).
- Decide with the project owner whether switching the view is wanted.
- Done: behaviour agreed; `e2e/editing.spec.ts` covers both arrows.

### 11. Prompts

Rename (project title menu), new file and rename/delete in the file tree use
`window.prompt`/`window.confirm`.

- Files: `Workspace.tsx`, `TopBar.tsx`, `FileTree.tsx`.
- Done: inline title editing for the project name and a small dialog
  component for file actions; e2e tests no longer rely on `page.on('dialog')`.

### 12. Accessibility check

- Run an automated check (for example axe in Playwright) on the workspace.
- Done: no serious violations; landmark names make sense ("Editor",
  "Output", "Main menu").

## Checks before you push

1. `pnpm check` (format, lint, typecheck, unit tests, build).
2. `pnpm e2e` (all specs; with `MYLEAF_TEXPRESSO` for the live test).
3. Manual look in the browser, light and dark, at the widths in item 4.
4. Push to a branch, rebase on `main`, wait for green CI; the project owner
   fast-forwards `main`.
