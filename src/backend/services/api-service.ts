import { Router, static as serveStatic } from 'express';
import { NotAllowedError } from '../data/hestia-errors';
import { User } from '../data/user';
import * as path from 'path';

import { PluginInfo } from '../data/plugin';
import { Driver, DriverInfo } from '../data/driver';
import Config from '../data/config';
import * as uuid from 'uuid';
import {
  wrapAsync,
  handleValidationError, handleError,
  validateUser, validateBucket,
  ADDRESS_REGEX, parseAddressRegex, validateAny
} from './api/middleware';

import db from './database-service';
import auth from './auth-service';
import drivers from './driver-service';
import plugins from './plugin-service';
import meta from './meta-service';
import gaia from './gaia-service';

import createGaiaRouter from './api/gaia-api';
import createConnectionApi from './api/conn-api';
import createUserApi from './api/user-api';
import { Subscription } from 'rxjs';
import { getLogger } from 'log4js';

class Api {

  private _router: Router = Router();
  public get router(): Router { return this._router; }

  private _apiRouter: Router = Router();
  public get apiRouter(): Router { return this._apiRouter; }

  private _pluginRouter: Router = Router();
  public get pluginRouter(): Router { return this._pluginRouter; }

  private logger = getLogger('services.api');

  private serverName = 'localhost';
  private rootPlugin = '';
  private initialized = false;

  private subs: Subscription[] = [];

  public preInit(config: Config) {
    this.serverName = config.server_name;
    this.rootPlugin = config.root_plugin || '';

    this.subs.push(drivers.onDriverInit.subscribe(({ driver, driverInfo }) => this.addDriverApi(driverInfo, driver)));
    this.subs.push(plugins.onPluginInit.subscribe(({ pluginInfo }) => this.addPluginApi(pluginInfo)));
  }

  public postInit() {
    this.initialized = true;

    this.subs.forEach(s => s.unsubscribe());

    this.router.get('/', (_, res, next) => {
      if(!this.rootPlugin)
        res.json({ message: 'hello world!' });
      else
        next();
    });

    this.router.use('/', serveStatic(path.join(__dirname, '..', '..', 'common/static-serve')));

    this.router.get('/env',
      (_, res) => res.json({ message: meta.env() }));

    this.router.get('/manifest.json', (_, res) => {
      res.json({
          name: 'Hestia @ ' + this.serverName,
          start_url: this.serverName,
          description: 'A Hestia node',
          icons: [{
            src: `${meta.origin()}/assets/images/icon-192.png`,
            sizes: '192x192',
            type: 'image/png'
          }]
      });
    });

    this.apiRouter.get('/drivers',
      validateUser({ ignoreGaiaMismatch: true, ignoreFailure: true }),
      (req, res) => res.json(meta.drivers(req.user)),
      handleError('drivers'));

    this.apiRouter.get('/plugins',
      (_, res) => res.json(meta.plugins()),
      handleError('plugins'));

    this.apiRouter.use('/user', createUserApi(this.logger), handleError('user'));
    this.apiRouter.use('/connections', createConnectionApi(this.logger), handleError('connection'));

    this.router.use('/gaia', createGaiaRouter(this.logger), handleError('gaia'));
    this.router.use('/api/v1', this.apiRouter, handleError('api'));
    this.router.use('/plugins', this.pluginRouter, handleError('plugin'));
  }

  public addDriverApi(driverInfo: DriverInfo, driver: Driver) {
    if(this.initialized)
      throw new Error('Cannot add more driver APIs after initialization!');

    const prefix = '/drivers/' + driverInfo.id;

    this.apiRouter.get(prefix + '/icon', (_, res) => {
      if(typeof driverInfo.icon === 'string')
        res.redirect(driverInfo.icon);
      else
        res.send(driverInfo.icon);
    });

    this.apiRouter.get(prefix + '/register', wrapAsync(async (req, res, next) => {
      let authorization = '';

      if(req.query.authorizationBearer)
        authorization = 'bearer ' + req.query.authorizationBearer;

      let user: User;
      if(authorization) {
        try {
          user = (await auth.validateUser({ authorization }, { ignoreGaiaMismatch: true })).user;
        } catch(e) {
          handleValidationError(e, req, res, next);
          return;
        }
      }

      if(user && user.connections && Object.values(user.connections).find(a => a && a.driver === driverInfo.id) && !driverInfo.multiUser)
        throw new NotAllowedError('You can only register with this driver once.');

      if(user && driverInfo.whitelist && !driverInfo.whitelist.includes(user.address))
        throw new NotAllowedError('You cannot register to a driver which you are not whitelisted for!');

      const ret = await driver.register(
        user && user.makeSafeForDriver(driverInfo.id),
        // urljoin(req.originalUrl.replace(/\?.*$/, ''), prefix + '/register')
        `${meta.origin()}/api/v1${prefix}/register`, {
        headers: req.headers,
        query: req.query
      });

      if('redirect' in ret) {
        if(ret.redirect.headers)
          for(const k in ret.redirect.headers) res.setHeader(k, ret.redirect.headers[k]);

        res.redirect(ret.redirect.url);
        return;
      }

      if('finish' in ret) {
        if(!user)
          user = await db.users.get(ret.finish.address);
        let id = uuid.v4();
        while(user.connections[id]) // force unique (at least within the same user)
          id = uuid.v4();
        const n = Object.values(user.connections).filter(a => a.driver === driverInfo.id).length;
        user.connections[id] = {
          driver: driverInfo.id,
          name: n ? `${driverInfo.name}-${n + 1}` : driverInfo.name,
          config: ret.finish.userdata || null,
          buckets: [user.address]
        };
        if(driver.postRegisterCheck)
          await driver.postRegisterCheck(user.makeSafeForDriver(driverInfo.id), id, ret.finish.userdata || null);

        if(!user.defaultConnection || !user.connections[user.defaultConnection] ||
          (drivers.getInfo().find(a => a.id === user.connections[user.defaultConnection].driver) || { rootOnly: false }).rootOnly)
          user.defaultConnection = id;

        await db.users.update(user);
      }

      res.redirect('/auto-close');
    }), handleError('driver ' + driverInfo.id + ' register'));

    this.logger.info(`Added ${driverInfo.name} driver: ${prefix}`);
  }

  public addPluginApi(pluginInfo: PluginInfo) {

    if(!pluginInfo.router && !pluginInfo.authedBucketRouter && !pluginInfo.authedUserRouter)
      return;

    if(this.initialized)
      throw new Error('Cannot add more plugin APIs after initialization!');

      let prefix = pluginInfo.id;

      if(!prefix.startsWith('/') && prefix.length > 0)
        prefix = '/' + prefix;
      if(prefix.endsWith('/'))
        prefix = prefix.slice(0, -1);

    if(pluginInfo.router) {
      this.pluginRouter.use(prefix, pluginInfo.router, handleError('plugin ' + pluginInfo.id));

      if(this.rootPlugin === pluginInfo.id)
        this.router.use('/', pluginInfo.router, handleError('root plugin ' + pluginInfo.id));
    }

    if(pluginInfo.authedAnyRouter) {
      this.pluginRouter.use(prefix, validateAny({ ignoreGaiaMismatch: true }),
        pluginInfo.authedAnyRouter, handleError('authed (any) plugin ' + pluginInfo.id));

      if(this.rootPlugin === pluginInfo.id)
        this.router.use(prefix, validateAny({ ignoreGaiaMismatch: true }),
          pluginInfo.authedAnyRouter, handleError('authed (any) root plugin ' + pluginInfo.id));
    }

    if(pluginInfo.authedBucketRouter) {
      this.pluginRouter.use(new RegExp(`${prefix}/${ADDRESS_REGEX}`),
        parseAddressRegex, validateBucket({ getAuthTimestamp: a => gaia.getAuthTimestamp(a) }),
        pluginInfo.authedBucketRouter, handleError('authed (bucket) plugin ' + pluginInfo.id));

      if(this.rootPlugin === pluginInfo.id)
        this.router.use(new RegExp(`/${ADDRESS_REGEX}`),
          parseAddressRegex, validateBucket({ getAuthTimestamp: a => gaia.getAuthTimestamp(a) }),
          pluginInfo.authedBucketRouter, handleError('authed (bucket) root plugin ' + pluginInfo.id));
    }

    if(pluginInfo.authedUserRouter) {
      this.pluginRouter.use(prefix, validateUser(), pluginInfo.authedUserRouter, handleError('authed (user) plugin ' + pluginInfo.id));

      if(this.rootPlugin === pluginInfo.id)
        this.router.use('/', validateUser(), pluginInfo.authedUserRouter, handleError('authed (user) root plugin ' + pluginInfo.id));
    }

    this.logger.info(`Added ${this.rootPlugin === pluginInfo.id ? 'root ' : ''}${pluginInfo.name} plugin: ${prefix}`);
  }
}

export default new Api();
