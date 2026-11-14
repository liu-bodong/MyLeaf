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
6. **Compile views.** The source sent to the compiler is a projection of the
   document: "accepted only" (suggested insertions excluded, suggested
   deletions kept) or "all suggestions applied".

## Open

- **Presentation in the PDF view** (comment highlights and suggestion markup)
  is deferred. Known constraints: SyncTeX maps at roughly line granularity;
  wrapping arbitrary changed spans in markup macros can break compilation
  inside math or across environment boundaries.
- Notification delivery mechanism.
