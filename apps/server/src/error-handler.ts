import type { ErrorResponse } from '@myleaf/api';
import {
  FileAlreadyExistsError,
  FileNotFoundError,
  InvalidPathError,
  InvalidProjectNameError,
  PathConflictError,
  ProjectNotFoundError,
} from '@myleaf/project';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ArchiveTooLargeError, InvalidArchiveError } from './zip-import.js';

const STATUS_BY_ERROR = new Map<abstract new (...args: never[]) => Error, number>([
  [ProjectNotFoundError, 404],
  [FileNotFoundError, 404],
  [InvalidPathError, 400],
  [InvalidProjectNameError, 400],
  [FileAlreadyExistsError, 409],
  [PathConflictError, 409],
  [InvalidArchiveError, 400],
  [ArchiveTooLargeError, 413],
]);

/** Maps domain errors to HTTP statuses; hides details of unexpected errors. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const domainStatus = [...STATUS_BY_ERROR].find(([type]) => error instanceof type)?.[1];
    const status = domainStatus ?? (error.validation ? 400 : (error.statusCode ?? 500));
    if (status >= 500) {
      request.log.error(error);
    }
    let body: ErrorResponse;
    if (status >= 500) {
      body = { error: 'InternalServerError', message: 'Internal server error' };
    } else if (error.validation) {
      // AJV reports are verbose and not a stable client contract.
      body = { error: 'ValidationError', message: 'Request failed validation' };
    } else {
      body = { error: error.name, message: error.message };
    }
    return reply.status(status).send(body);
  });
}
