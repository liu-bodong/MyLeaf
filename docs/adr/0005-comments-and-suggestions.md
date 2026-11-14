# 0005. Comments and suggestions model

- Status: Accepted
- Date: 2026-11-14

## Context

Collaboration is the top-priority feature set:

- Comments directed at collaborators (@mentions), with replies (comments on
  comments), visible in both the source and the PDF.
- Edits reviewed like Google Docs suggest mode / Word track changes: reviewers
  see exactly what was inserted and deleted, and can accept or reject each
  change. An edit can @mention a reviewer.

## Decision

1. **Annotations are stored separately from the `.tex` source.** The LaTeX
   source is never modified to hold comments. Export to LaTeX macros may be
   added later as an option.
2. **Anchoring.** A comment's range is a pair of Yjs relative positions, so it
   follows the text through concurrent edits.
3. **Threads.** A comment thread is a tree of comments. Each comment has an
   author (human or AI actor, ADR 0007), body, @mentions, timestamps, and the
   thread has a resolved state.
4. **Suggestions (suggest mode).**
   - A suggested insertion is real text in the document, marked with its
     suggestion id and author.
   - A suggested deletion leaves the text in the document, marked as
     "suggested deletion", until accepted.
   - Accept/reject applies or reverts the marked change.
   - Each suggestion can have a comment thread and assigned reviewers.
5. **Editor presentation** is Word style: insertions highlighted, deletions
   struck through, per author color, with a side panel listing threads and
   suggestions.
6. **Deleting text that another suggestion inserted.** A character carries at
   most one suggestion mark. Deleting text inserted by the _same_ suggestion
   removes it outright. Deleting text inserted by _other_ pending suggestions
   is refused the first time (`SuggestionConflictError`, which lists the
   affected suggestions) and nothing changes. The editor shows a blocking
   warning; if the user confirms, the edit is retried with
   `overrideConflicts: true` and the overlapping text is removed from those
   suggestions.
7. **Compile views.** The source sent to the compiler is a projection of the
   document: "accepted only" (suggested insertions excluded, suggested
   deletions kept) or "all suggestions applied".

## Open

- **Presentation in the PDF view** (comment highlights and suggestion markup)
  is deferred. Known constraints: SyncTeX maps at roughly line granularity;
  wrapping arbitrary changed spans in markup macros can break compilation
  inside math or across environment boundaries.
- Notification delivery mechanism.
- **Editor binding.** `Y.Text#insert` copies neighbouring formatting when no
  attributes are given; the editor binding must insert typed text through the
  `TextDocument` port (which always passes explicit marks), or typing next to a
  suggestion would extend it.
