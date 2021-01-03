import { Router, Request, Response, NextFunction, json } from 'express';
import { Logger } from 'log4js';
import { NotFoundError, NotAllowedError, MalformedError } from '../../data/hestia-errors';
import { parseAddressPathRegex, validateBucket, handleError, ADDRESS_PATH_REGEX, wrapAsync, ensureStream } from './middleware';

import auth from '../auth-service';
import gaia from '../gaia-service';
import meta from '../meta-service';
import drivers from '../driver-service';
import { trueArray } from '../../util';
import databaseService from '../database-service';

export default function createGaiaRouter(logger: Logger) {

  const router = Router();

  // STORE
  router.post(new RegExp(`/store/${ADDRESS_PATH_REGEX}`),
    parseAddressPathRegex, ensureStream,
    validateBucket({
      autoRegister: drivers.getAutoRegisterable(),
      getAuthTimestamp: a => gaia.getAuthTimestamp(a)
    }),
    wrapAsync(async (req: Request, res: Response, next: NextFunction) => {

      logger.debug('Gaia - Store: ', req.params.address, req.params.path);

      const errors = await gaia.store(req.params.address, req.params.path, {
        contentType: req.headers['content-type'],
        contentLength: Number(req.headers['content-length']) || 0,
        stream: (req as any).stream || req
      }, req.user).catch((e: Error) => [e]);

      if(errors.length > 0) {
        const errs = errors.map(e => {
          if(e instanceof NotFoundError) {
            logger.warn(`Store Error for /${req.params.address}/${req.params.path}: `, e.message);
            return '404 Not Found';
          } else if(e instanceof NotAllowedError) {
            logger.warn(`Store Error for /${req.params.address}/${req.params.path}: `, e.message);
            return '403 Not Allowed';
          } else if(e instanceof MalformedError) {
            logger.warn(`Store Error for /${req.params.address}/${req.params.path}: `, e.message);
            return '400 Malformed: ' + e.message;
          } else {
            logger.error(`Internal Store Error for /${req.params.address}/${req.params.path}:`, (e as any).isAxiosError ? e.stack : e);
            return '500 Failed to preform write.';
          }
        });
        const status = errs.map(a => Number(a.slice(0, 3)))
          .reduce((acc, c) => acc && c ? acc : 500, Number(errs[0].slice(0, 3)));
        res.status(status).json({
          publicURL: `${meta.origin()}/gaia/read/${req.params.address}/${req.params.path}`,
          errors: errs
        });
      } else {
        res.status(200).json({
          publicURL: `${meta.origin()}/gaia/read/${req.params.address}/${req.params.path}`,
        });
      }
    }), handleError('gaia store'));

  // READ
  router.get(new RegExp(`/read/${ADDRESS_PATH_REGEX}`),
    parseAddressPathRegex,
    wrapAsync(async (req, res) => {
      logger.debug('Gaia - Read: ', req.params.address, req.params.path);
      if(trueArray.includes(String(req.query.metadata)))
        return res.json(await databaseService.metadata.getForFile(req.params.address + '/' + req.params.path)
          .then(a => ({
            contentType: a.contentType,
            size: a.size,
            hash: a.hash,
          // lastModified: a.lastModified - for now, lets skip
          })));
      const read = await gaia.read(req.params.address, req.params.path);
      if('stream' in read)
        read.stream.pipe(res.status(202).contentType(read.contentType));
      else
        res.redirect(read.redirectUrl);
    }), handleError('gaia read'));

  // DELETE
  router.delete(new RegExp(`/delete/${ADDRESS_PATH_REGEX}`), json(),
    parseAddressPathRegex,
    validateBucket({ getAuthTimestamp: a => gaia.getAuthTimestamp(a) }),
    wrapAsync(async (req, res) => {

      logger.debug('Gaia - Delete: ', req.params.address, req.params.path);

      const errors = await gaia.delete(req.params.address, req.params.path);

      if(errors.length > 0) {
        const errs = errors.map(e => {
          if(e instanceof NotFoundError) {
            logger.warn(`Delete Error for /${req.params.address}/${req.params.path}: `, e.message);
            return '404 Not Found';
          } else if(e instanceof NotAllowedError) {
            logger.warn(`Delete Error for /${req.params.address}/${req.params.path}: `, e.message);
            return '403 Not Allowed';
          } else if(e instanceof MalformedError) {
            logger.warn(`Delete Error for /${req.params.address}/${req.params.path}: `, e.message);
            return '400 Malformed: ' + e.message;
          } else {
            logger.error(`Internal Delete Error for /${req.params.address}/${req.params.path}:`, e);
            return '500 Failed to preform write.';
          }
        });

        const status = errs.map(a => Number(a.slice(0, 3)))
          .reduce((acc, c) => acc && c ? acc : 500, Number(errs[0].slice(0, 3)));
        res.status(status).json({ errors: errs });
      } else
        res.sendStatus(202);
    }), handleError('gaia delete'));

  router.post('/list-files/:address', json(),
    validateBucket({ getAuthTimestamp: a => gaia.getAuthTimestamp(a) }),
    wrapAsync(async (req, res) => {
      const page = req.body.page ? Number.parseInt(req.body.page) : 0;
      if(page && Number.isNaN(page))
        throw new MalformedError('Could not parse page number as an Integer.');

      const state = req.body.state ? Boolean(req.body.state) : false;

      const ret = await gaia.listFiles(String(req.params.address), { page, state }, req.user);

      if(ret.page)
        ret.page = ret.page.toFixed() as any;

      res.status(202).json(ret);
    }), handleError('gaia list-files'));

  // HUB INFO
  router.get('/hub_info', (_, res) => {
    res.json({
      challenge_text: auth.getChallengeText(),
      latest_auth_version: auth.getLatestAuthVersion(),
      read_url_prefix: `${meta.origin()}/gaia/read/`
    });
  }, handleError('gaia hub_info'));

  // REVOKE ALL
  router.post('/revoke-all/:address', json(),
    validateBucket({ getAuthTimestamp: a => gaia.getAuthTimestamp(a) }),
    wrapAsync(async (req, res) => {

      const address = String(req.params.address);
      if(!/[a-zA-Z0-9]+/.test(address))
        res.sendStatus(400);

      const seconds = Number(req.body.oldestValidTimestamp);
      if(!seconds || seconds < 0 || !Number.isFinite(seconds))
        res.sendStatus(400);

      await gaia.setAuthTimestamp(address, req.user, seconds);
      res.status(202).json({ status: 'success' });
    }), handleError('gaia revoke-all'));

  return router;
}
