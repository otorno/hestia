import { Request } from 'express-serve-static-core';

declare module 'express' {
  interface Request {
    user?: any;
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: any;
  }
}
