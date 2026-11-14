/** A domain rule was violated (e.g. replying across threads, deciding a decided suggestion). */
export class AnnotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnnotationError';
  }
}
