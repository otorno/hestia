import { Request as BaseESSCRequest, Params, ParamsDictionary } from 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    user?: any;
  }
}
