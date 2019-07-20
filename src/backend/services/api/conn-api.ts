import { Router, json } from 'express';
import { Logger } from 'log4js';
import { handleError, validateUser, wrapAsync, ADDRESS_PATH_REGEX, parseAddressPathRegex, ensureStream, PATH_REGEX } from './middleware';
import { MalformedError } from '../../data/hestia-errors';

import meta from '../meta-service';
import connections from '../connection-service';

export default function createConnectionApi(logger: Logger) {

  const router = Router({ mergeParams: true });

  // = UTIL FUNCTIONS

  router.post('/set-default', validateUser(), wrapAsync(async (req, res) => {
    await connections.setDefault(req.params.id, req.user);
    res.sendStatus(204);
  }), handleError('connection set-default'));

  router.get('/info', validateUser(), wrapAsync(async (req, res) => {
    res.json(await connections.getInfo(String(req.params.id), req.user));
  }), handleError('connection info'));

  router.delete('/', validateUser(), wrapAsync(async (req, res) => {
    await connections.deleteConnection(String(req.params.id), req.user);
    res.sendStatus(204);
  }), handleError('delete connection'));

  router.post('/set-buckets', validateUser(), json(), wrapAsync(async (req, res) => {
    if(!(req.body instanceof Array && !req.body.find(a => typeof a !== 'string')))
      throw new MalformedError('Body should be a string array in JSON format');
    await connections.setBuckets(req.params.id, req.user, req.body);
    res.sendStatus(204);
  }), handleError('connection set-buckets'));

  // = GAIA FUNCTIONS

  // STORE
  router.post(new RegExp(`/store/${ADDRESS_PATH_REGEX}`),
    parseAddressPathRegex, ensureStream, validateUser(),
    wrapAsync(async (req, res) => {

    await connections.store(req.params.id, req.user, req.params.address, req.params.path, {
      contentType: req.headers['content-type'],
      contentLength: Number(req.headers['content-length']) || 0,
      stream: (req as any).stream || req
    });

    res.status(200).json({
      publicURL: `${meta.origin()}/gaia/read/${req.params.address}/${req.params.path}`,
    });
  }), handleError('gaia store'));

  // READ
  router.get(new RegExp(`/read/${ADDRESS_PATH_REGEX}`),
  parseAddressPathRegex, validateUser(),
  wrapAsync(async (req, res) => {
    const read = await connections.read(req.params.id, req.user, req.params.address, req.params.path);
    read.stream.pipe(res.status(202).contentType(read.contentType));
  }), handleError('gaia read'));

  // DELETE
  router.delete(new RegExp(`/delete/${ADDRESS_PATH_REGEX}`), json(),
    parseAddressPathRegex, validateUser(),
    wrapAsync(async (req, res) => {
    await connections.delete(req.params.id, req.user, req.params.address, req.params.path);
    res.sendStatus(202);
  }), handleError('gaia delete'));

  // LIST FILES
  router.post(new RegExp('/list-files/' + PATH_REGEX + '?'), json(), validateUser(), wrapAsync(async (req, res) => {
    const path = req.params[1] || '';

    const page = req.body.page ? Number.parseInt(req.body.page) : undefined;
    if(page && Number.isNaN(page))
      throw new MalformedError('Could not parse page number as an Integer.');

    const ret = await connections.listFiles(String(req.params.id), req.user, path, page);

    if(ret.page)
      ret.page = ret.page.toFixed() as any;

    res.status(202).json(ret);
  }), handleError('connection list-files'));

  const parentRouter = Router();
  parentRouter.use('/:id', (req, _, next) => {
    if(typeof req.params.id !== 'string')
      next(new MalformedError('Given ID is not a string!'));
    else
      next();
  }, router);
  return parentRouter;
}
