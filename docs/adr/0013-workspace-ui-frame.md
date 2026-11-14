# 0013. Workspace UI frame

- Status: Accepted
- Date: 2026-11-14

## Context

Most users arrive from Overleaf. They should not have to learn a new
interface, so the workspace follows the layout conventions they know: an
application bar with menus, the file tree on the left, the source editor and
the PDF side by side, a toolbar above each. MyLeaf has its own name, colours
and visual style; it does not copy Overleaf's branding.

Several features in that layout (history, sharing, visual editing, insert and
format commands) do not exist yet.

## Decision

1. **Layout.** Top to bottom: top bar, optional error bar, then the file tree
   sidebar and a resizable editor/PDF split. There is no left icon rail.
   - **Top bar** (`workspace/TopBar.tsx`): home link, menus (File, Edit,
     Insert, View, Format, Help), project title with a dropdown, save state,
     History, Layout, Share.
   - **Editor toolbar** (`workspace/EditorToolbar.tsx`): Code/Visual switch
     and undo/redo only. No formatting buttons and no track changes.
   - **PDF toolbar** (`workspace/PdfToolbar.tsx`): Recompile with a settings
     dropdown, logs button with the error count, download, Live/PDF switch
     (while live preview is on), previous/next page, page box, zoom out/in
     and zoom level.
   - **Divider** between editor and PDF: drag handle and two arrows, forward
     search (→, "Show in PDF") and inverse search from the PDF's reading line
     (←, "Show in source").
2. **Placeholders.** Controls for features that do not exist yet are shown
   disabled with the tooltip "Not available yet", so the layout does not
   shift when they arrive. A feature replaces its placeholder.
3. **Layout state** (view: split / editor only / PDF only, split ratio, PDF
   zoom) is saved per browser in `localStorage` (`workspace/layout.ts`), not
   per project or on the server. Invalid saved values fall back to defaults.
4. **Zoom** is "fit to width", "fit to page" or a factor where 100 % is
   actual size (96 CSS px per inch, i.e. 96/72 px per PDF point). Fit modes
   follow the pane size. The viewer reports page, page count and zoom to the
   toolbar and keeps the same part of the document in view across zooms.
5. **Primitives** (`apps/web/src/ui/`): menu bar, dropdown menu, split pane,
   icons. They are written for MyLeaf with no UI library, have no knowledge
   of projects or compiles, and follow the WAI-ARIA menu and separator roles.

## Consequences

- Overleaf users find the main controls where they expect them.
- Disabled placeholders advertise features that are not built; each needs
  wiring or removal when its feature is decided.
- The layout is not shared across a user's browsers; moving it to a user
  profile is a later change in `workspace/layout.ts`.
- The PDF toolbar's page and zoom controls act on the pdf.js viewer only;
  live preview keeps its own controls until the two are unified.
