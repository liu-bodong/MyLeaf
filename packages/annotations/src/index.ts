export { AnnotationError } from './errors.js';
export { CommentId, SuggestionId, ThreadId } from './ids.js';
export {
  buildCommentTree,
  createRangeTarget,
  reopenThread,
  reply,
  resolveRangeTarget,
  resolveThread,
  startThread,
} from './comments.js';
export type {
  Comment,
  CommentInput,
  CommentThread,
  CommentTreeNode,
  Resolution,
  ThreadTarget,
} from './comments.js';
export {
  SUGGESTION_MARK_KEY,
  SuggestionConflictError,
  createSuggestion,
  decideSuggestion,
  getSuggestionRanges,
  projectText,
  suggestDeletion,
  suggestInsertion,
  suggestReplacement,
} from './suggestions.js';
export type {
  ProjectionView,
  Suggestion,
  SuggestionKind,
  SuggestionMark,
  SuggestionRange,
  SuggestionStatus,
} from './suggestions.js';
