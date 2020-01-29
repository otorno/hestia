import { Router, Request, Response, NextFunction, json } from 'express';
import * as cors from 'cors';
import { getLogger, Logger } from '@log4js-node/log4js-api';
import { PluginApiInterface, Plugin } from '../data/plugin';

import { ADDRESS_PATH_REGEX, wrapAsync, parseAddressPathRegex, ensureStream, validateBucket } from '../services/api/middleware';
import { AuthError } from '../data/hestia-errors';

interface AppDBPluginConfig {
  app_key: string;
}

class AppDBPlugin implements Plugin {

  private id: string;
  private config: AppDBPluginConfig;
  private api: PluginApiInterface;
  private logger: Logger;

  constructor() { }

  public async init(id: string, config: AppDBPluginConfig, api: PluginApiInterface) {
    this.id = id;
    this.config = config = Object.assign({ }, config);
    this.api = api;
    this.logger = getLogger('plugins.' + this.id);

    const authKey = function(req: Request, res: Response, next: NextFunction) {
      if(config.app_key && (!req.query.authKey || req.query.authKey !== config.app_key))
        next(new AuthError('Missing or invalid auth key!'));
      else
        next();
    };

    const authedAnyRouter = Router();
    authedAnyRouter.use(authKey);

    const localRouter = Router();
    localRouter.use(cors({
      origin(origin, callback) {
        if (!origin)
          callback(null, true);
        else
          callback(new Error('Not allowed by CORS.'));
      }
    }));
    localRouter.use(authKey);

    const dbApi = Object.freeze({
      getTables: wrapAsync(async (req, res) => {
        res.json(await this.api.db.plugin.listTables()
          .then(a => a.filter(b => b.startsWith(req.params.address)).map(b => b.slice(req.params.address.length + 1))));
      }),
      postTables: wrapAsync(async (req, res) => {
        await this.api.db.plugin.createTable(req.body.name);
        api.sockets.emitTo(['all'], 'createTable', req.body);
        res.sendStatus(203);
      }),
      deleteTable: wrapAsync(async (req, res) => {
        await this.api.db.plugin.dropTable(req.params.table);
        api.sockets.emitTo(['all', req.params.table], 'deleteTable', req.params.table);
        res.sendStatus(203);
      }),
      getAllData: wrapAsync(async (req, res) => {
        res.json(await this.api.db.plugin.getTable(req.params.table).then(table => table.getAll()));
      }),
      getData: wrapAsync(async (req, res) => {
        res.json(await this.api.db.plugin.getTable(req.params.table).then(table => table.get(req.params.key)));
      }),
      setData: wrapAsync(async (req, res) => {
        await this.api.db.plugin.getTable(req.params.table).then(table => table.set(req.params.key, req.body));
        api.sockets.emitTo(['all', req.params.table], 'set', req.params.table, req.params.key, req.body);
        res.sendStatus(203);
      }),
      deleteData: wrapAsync(async (req, res) => {
        await this.api.db.plugin.getTable(req.params.table).then(table => table.delete(req.params.key));
        api.sockets.emitTo(['all', req.params.table], 'delete', req.params.table, req.params.key);
        res.sendStatus(203);
      })
    });

    authedAnyRouter.get('tables', dbApi.getTables);
    localRouter.get('tables', dbApi.getTables);
    // POST { name: string }
    authedAnyRouter.post('tables', json(), dbApi.postTables);
    localRouter.post('tables', dbApi.postTables);

    authedAnyRouter.delete('tables/:table', dbApi.deleteTable);
    localRouter.delete('tables/:table', dbApi.deleteTable);

    authedAnyRouter.get('tables/:table/data', dbApi.getAllData);
    localRouter.get('tables/:table/data', dbApi.getAllData);
    authedAnyRouter.get('tables/:table/data/:key', dbApi.getData);
    localRouter.get('tables/:table/data/:key', dbApi.getData);
    // router.post('tables/:table/data'); INSERT instead of INSERT OR UPDATE
    authedAnyRouter.put('tables/:table/data/:key', json(), dbApi.setData);
    localRouter.get('tables/:table/data/:key', json(), dbApi.setData);
    // router.delete('tables/:table/data)
    authedAnyRouter.delete('tables/:table/data/:key', dbApi.deleteData);
    localRouter.delete('tables/:table/data/:key', dbApi.deleteData);

    return { name: 'App DB', longId: 'io.github.michaelfedora.hestia.appDB', router: localRouter, authedBucketRouter: authedAnyRouter };
  }

}

export default new AppDBPlugin();
