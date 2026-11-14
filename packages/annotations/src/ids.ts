import type { Brand } from '@myleaf/doc-model';

export type ThreadId = Brand<string, 'ThreadId'>;
export type CommentId = Brand<string, 'CommentId'>;
export type SuggestionId = Brand<string, 'SuggestionId'>;

export const ThreadId = (value: string): ThreadId => value as ThreadId;
export const CommentId = (value: string): CommentId => value as CommentId;
export const SuggestionId = (value: string): SuggestionId => value as SuggestionId;
