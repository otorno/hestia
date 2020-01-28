export class AuthError extends Error {
  type = 'auth_error';

  constructor(message?: string) {
    super(message);
  }
}

export class NotFoundError extends Error {
  type = 'not_found_error';

  constructor(message?: string) {
    super(message || 'Not found');
  }
}

export class NotAllowedError extends Error {
  type = 'not_allowed_error';

  constructor(message?: string) {
    super(message || 'Forbidden');
  }
}

export class MalformedError extends Error {
  type = 'malformed_error';

  constructor(message?: string) {
    super(message || 'Malformed');
  }
}

export class MultiError extends Error {
  type = 'multi_error';
  errors: Error[];

  constructor(errors: Error[], message?: string) {
    super(message || 'MultiError' + 'See: ' + errors.map(a => a.message).join('\n'));
  }
}
