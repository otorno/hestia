import 'source-map-support/register';
import configureLogger from './logger';

import * as express from 'express';
import * as cors from 'cors';
import * as jsonfile from 'jsonfile';
import * as helmet from 'helmet';
import { getLogger, shutdown } from 'log4js';
import bodyParser = require('body-parser');

import Config from './data/config';
import { User } from './data/user';
import { parseBytes } from './util';

import db from './services/database-service';
import drivers from './services/driver-service';
import plugins from './services/plugin-service';
import auth from './services/auth-service';
import gaia from './services/gaia-service';
import connections from './services/connection-service';
import meta from './services/meta-service';
import api from './services/api-service';

let config: Config;
const production = process.env.NODE_ENV === 'production';

try {
  config = jsonfile.readFileSync('config.json');
  // force number
  config.max_blob_size = parseBytes(config.max_blob_size || '7.5mb');
} catch(e) {
  console.error(`Couldn't read config.json! ${e}`);
  process.exit(1);
}

configureLogger(config);

/*
{"url_prefix": "https://gaia.blockstack.org/hub/", "entries":["19u3AZ6Z2FqBHqMjGHiZDZ7UBGJhoUvCoP/key.json"] }
*/

console.log('Initializing Database...');

db.init(config.db_host || '127.0.0.1', config.db_port || 28015).then(async () => {

  const logger = getLogger('app');
  const httpLogger = getLogger('express');

  const app = express();
  app.set('trust proxy', 1);

  app.use(bodyParser.raw({ limit: config.max_blob_size }));
  app.use(bodyParser.text({ limit: config.max_blob_size }));
  app.use(bodyParser.urlencoded({ limit: config.max_blob_size, parameterLimit: config.max_blob_size as number, extended: true }));

  app.use(cors({ origin: '*', methods: 'GET,POST' }));
  app.use(helmet());
  app.use(helmet.referrerPolicy({
    policy: 'no-referrer-when-downgrade'
  }));

  app.use(helmet.contentSecurityPolicy({
    directives: production ? {
      styleSrc: ["'self'"], // tslint:disable-line
      scriptSrc: ["'self'"] // tslint:disable-line
    } : {
      styleSrc: ["'self'", "'unsafe-inline'"], // tslint:disable-line
      scriptSrc: ["'self'", "'unsafe-eval'"], // tslint:disable-line
    }
  }));

  app.use((req, res, next) => {
    const host = req.headers.origin || req.headers.host || req.ip;
    httpLogger.info(`${req.method} ${req.hostname}${req.originalUrl} from ${host} (ip: ${req.ip}, ips: [${req.ips}])`);
    next();
  });

  meta.init(config);
  auth.init(config);
  gaia.init(config);
  connections.init(config);
  api.preInit(config);
  await drivers.init(config);
  await plugins.init(config);
  api.postInit();

  app.use('/', api.router);

  app.use((err, req, res, next) => {
    httpLogger.error('Express caught an error!');
    httpLogger.error(err);
    res.status(500).json({ message: 'Something broke!' });
  });

  logger.info('Verifying users...');
  const users = await db.users.run();
  for(const u of users) {
    const stringed = JSON.stringify(u);
    const user = User.deserialize(u);

    for(const connection of Object.values(user.connections)) {
      if(drivers.getInfo(connection.driver).rootOnly && (
          connection.buckets.length > 1 ||
          connection.buckets[0] !== user.address
        ))
        connection.buckets = [user.address];

      if(!connection.buckets.includes(user.address))
        connection.buckets.unshift(user.address);
    }

    if(stringed !== JSON.stringify(user.serialize()))
      db.updateUser(user);
  } // u of user

  logger.info('== Initialized! ==');
  console.log(`Listening on ${config.ip}:${config.port}, access via ${config.server_name}!`);

  // @ts-ignore
  app.listen(config.port, config.ip);

  setInterval(() => { drivers.tick(); plugins.tick(); db.trimDeletedTick(); }, 500);

}, err => {
  console.log('Failed to initialize the database: ' + err);
  process.exit(1);
}).catch(err => {
  console.error('Hestia.js caught an error!');
  console.error(err);
  shutdown((e) => {
    if(e) {
      console.error('**ERROR SHUTTING DOWN LOG4JS**');
      console.error(e);
    }
    process.exit(1);
  });
});

process.on('unhandledRejection', err => {
  console.error('**UNHANDLED REJECTION**');
  console.error(err);
  shutdown((e) => {
    console.error('**ERROR SHUTTING DOWN LOG4JS**');
    console.error(e);
    process.exit(1);
  });
});
