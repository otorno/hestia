import { Request, Response, NextFunction } from 'express';
import { getLogger } from 'log4js';
import { User } from '../../data/user';
import auth from '../auth-service';
import { AuthError, NotFoundError, NotAllowedError, MalformedError } from '../../data/hestia-errors';
import { Readable } from 'stream';
import { bufferToStream } from '../../util';

export const ADDRESS_REGEX = '([a-zA-Z0-9]+)';
export const PATH_REGEX = '((?:[a-zA-Z0-9_\\-\\ \.]+/+)*[a-zA-Z0-9_\\-\\ \.]+)';
// export const ADDRESS_PATH_REGEX = '([a-zA-Z0-9]+)/+((?:[a-zA-Z0-9_\\-\\ \.]+/+)*[a-zA-Z0-9_\\-\\ \.]+)';
export const ADDRESS_PATH_REGEX = `${ADDRESS_REGEX}/+${PATH_REGEX}`;

// from https://github.com/blockstack/gaia/blob/master/hub/src/server/revocations.ts
export const AUTH_TIMESTAMP_FILE_NAME = 'authTimestamp';

const logger = getLogger('services.middleware');

export function wrapAsync(func: (req: Request, res?: Response, next?: NextFunction) => Promise<any>) {
  return function(req: Request, res: Response, next: NextFunction) {
    func(req, res, next).catch(next);
  };
}

export function parseAddressPathRegex(req: Request, res: Response, next: NextFunction) {
  const address = String(req.params[0]);
  let fpath = String(req.params[1]);
  if(fpath.endsWith('/'))
    fpath = fpath.slice(0, -1);
  fpath.replace(/\/{2,}/g, '/');
  req.params.address = address;
  req.params.path = fpath;
  next();
}

export function ensureStream(req: any, res: Response, next: NextFunction) {
  if(req.readable && req.readableLength > 0) {
    // logger.debug('Req is readable!');
    req.stream = req;
    next();
  } else if(req.body) {
    if(req.body instanceof Readable) {
      // logger.debug('Body is instanceof readable!');
      req.stream = req.body; // idk man
    } else if(req.body instanceof Buffer) {
      // logger.debug('Body is buffer!');
      req.stream = bufferToStream(req.body);
    } else if(typeof req.body === 'string') {
      // logger.debug('Body is string!', req.body);
      req.stream = bufferToStream(Buffer.from(req.body, 'utf8'));
    } else { // hope and pray
      logger.warn('Body should be stream but is just object(?):', req.body);
      req.stream = bufferToStream(Buffer.from(JSON.stringify(req.body), 'utf8'));
    }
    next();
  } else
    next(new MalformedError('Cannot get stream from Request.'));
}

export function handleValidationError(err: any, req: Request, res: Response, next: NextFunction) {
  if(!err)
    next();

  if(err instanceof AuthError) {
    res.status(403).json({ message: err.message });
  } else {
    logger.error(`Error validating token:`, err);
    res.status(500).json({ message: `Failed to validate token.` });
  }
}

export function handleError(action: string) {
  return function(err: any, req: Request, res: Response, next: NextFunction) {
    if(!err) {
      next();
      return;
    }

    logger.debug('Handle Error: ' + err);

    if(err instanceof NotFoundError) {
      res.sendStatus(404);
    } else if(err instanceof NotAllowedError) {
      res.status(403).json({ message: err.message });
    } else if(err instanceof MalformedError) {
      res.status(400).json({ message: err.message });
    } else if(err.type) {
      switch(err.type) {
        case 'not_found_error':
          res.sendStatus(404);
          break;
        case 'not_allowed_error':
          res.sendStatus(403).json({ message: err.message });
          break;
        case 'malformed_error':
          res.status(400).json({ message: err.message });
          break;
      }
    } else {
      logger.error(`Error performing ${action}: `, err);
      res.status(500).json({ message: `Failed to perform ${action}.` });
    }
  };
}

export function validateBucket(options: {
  autoRegister?: boolean,
  getAuthTimestamp: (address: string) => Promise<Date>
}) {
  options = Object.assign({ autoRegister: false }, options);
  return wrapAsync(async function(req: Request, res: Response, next: NextFunction) {
    const address = String(req.params.address);
    if(!/[a-zA-Z0-9]+/.test(address)) {
      res.sendStatus(400);
      return;
    }

    const path = String(req.params.path);
    if(path !== 'profile.json' && options.autoRegister)
      options.autoRegister = false;

    let user: User;
    try {
      user = await auth.validateBucket(address, req.headers, () => options.getAuthTimestamp(address), options.autoRegister);
    } catch(e) {
      handleValidationError(e, req, res, next);
      return;
    }
    req.user = user;
    next();
  });
}

export function validateUser(options?: { ignoreGaiaMismatch?: boolean, ignoreFailure?: boolean }) {
  options = Object.assign({ ignoreGaiaMismatch: false, ignoreFailure: false }, options);
  return wrapAsync(async function(req: Request, res: Response, next: NextFunction) {
    try {
      const headers = req.headers.authorization ? req.headers : { authorization: 'Bearer ' + req.query.authorizationBearer };
      req.user = await auth.validateUser(headers, options);
    } catch(e) {
      if(!options.ignoreFailure) {
        handleValidationError(e, req, res, next);
        return;
      }
    }
    next();
  });
}
