import type { Brand } from './brand.js';

export type ProjectId = Brand<string, 'ProjectId'>;
export type FileId = Brand<string, 'FileId'>;
export type ActorId = Brand<string, 'ActorId'>;

/** Milliseconds since the Unix epoch (UTC). */
export type EpochMillis = number;

export const ProjectId = (value: string): ProjectId => value as ProjectId;
export const FileId = (value: string): FileId => value as FileId;
export const ActorId = (value: string): ActorId => value as ActorId;
