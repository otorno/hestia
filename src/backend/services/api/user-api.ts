import { Router } from 'express';
import * as cors from 'cors';
import * as uuid from 'uuid';
import { Logger } from 'log4js';
import { handleError, handleValidationError, validateUser, wrapAsync } from './middleware';

import db from '../database-service';
import auth from '../auth-service';
import drivers from '../driver-service';
import meta from '../meta-service';
import { User } from '../../data/user';
import { trueArray, hashBuffer } from '../../util';
import { GlobalMetadataIndex, MetadataIndex } from '../../data/metadata-index';

export default function createUserApi(logger: Logger) {
  const router = Router();

  router.get('/validate-token', wrapAsync(async (req, res) => {
    await auth.validateUser(req.headers);
    res.sendStatus(204);
  }), handleValidationError);

  router.post('/login', cors({ origin: meta.origin() }), wrapAsync(async (req, res, next) => {

    let addresses: { signerAddress: string, issuerAddress: string };

    try {
      // ignore gaia mismatch because it's from the same origin "frontend app"
      addresses = auth.partialValidate(req.headers, true);
    } catch(e) {
      handleValidationError(e, req, res, next);
      return;
    }

    const bucketAddress = addresses.signerAddress === addresses.issuerAddress ? '' : addresses.issuerAddress;
    let user: User = await db.getUser(addresses.signerAddress).catch(e => null);

    if(!user) { // register
      user = await db.registerUser(addresses.signerAddress, bucketAddress);

      try {
        for(const info of drivers.getInfo()) if(info.autoRegister) {

          if(Object.values(user.connections).find(a => a.driver === info.id))
            continue;

          const driver = drivers.get(info.id);
          const ret = await driver.register(user.makeSafeForDriver(info.id));

          let id = uuid.v4();
          while(user.connections[id]) // force unique (at least within the same user)
            id = uuid.v4();
          const n = Object.values(user.connections).filter(a => a.driver === info.id).length;
          user.connections[id] = {
            driver: info.id,
            name: n ? `${info.name}-${n + 1}` : info.name,
            config: ret.finish.userdata || null,
            buckets: [user.address]
          };
          if(driver.postRegisterCheck)
            await driver.postRegisterCheck(user.makeSafeForDriver(info.id), ret.finish.userdata || null);

          if(!user.defaultConnection)
            user.defaultConnection = id;
        }

        await db.updateUser(user);
      } catch(e) {
        logger.error('Error auto-registering user from login: ' + (e.stack || e));
      }
    } else {
      if(bucketAddress && user.internalBucketAddress !== bucketAddress) {
        user.internalBucketAddress = bucketAddress;
        await db.updateUser(user);
      }
    }

    res.sendStatus(204);
  }), handleError('user login'));

  router.post('/register', wrapAsync(async (req, res, next) => {

    let addresses: { signerAddress: string, issuerAddress: string };

    try {
      // require params because this is public facing
      addresses = auth.partialValidate(req.headers);
    } catch(e) {
      handleValidationError(e, req, res, next);
      return;
    }

    const bucketAddress = addresses.signerAddress === addresses.issuerAddress ? '' : addresses.issuerAddress;
    const user = await db.registerUser(addresses.signerAddress, bucketAddress);

    try {
      for(const info of drivers.getInfo()) if(info.autoRegister) {

        if(Object.values(user.connections).find(a => a.driver === info.id))
          continue;

        const driver = drivers.get(info.id);
        const ret = await driver.register(user.makeSafeForDriver(info.id));

        let id = uuid.v4();
        while(user.connections[id]) // force unique (at least within the same user)
          id = uuid.v4();
        const n = Object.values(user.connections).filter(a => a.driver === info.id).length;
        user.connections[id] = {
          driver: info.id,
          name: n ? `${info.name}-${n + 1}` : info.name,
          config: ret.finish.userdata || null,
          buckets: [user.address]
        };
        if(driver.postRegisterCheck)
          await driver.postRegisterCheck(user.makeSafeForDriver(info.id), ret.finish.userdata || null);

        if(!user.defaultConnection)
          user.defaultConnection = id;
      }

      await db.updateUser(user);
    } catch(e) {
      logger.error('Error registering user: ' + (e.stack || e));
    }

    res.sendStatus(204);
  }), handleError('user register'));

  router.post('/unregister', wrapAsync(async (req, res, next) => {
    let signerAddress: string;

    try {
      signerAddress = auth.partialValidate(req.headers, true).signerAddress;
    } catch(e) {
      handleValidationError(e, req, res, next);
      return;
    }

    const user = await db.getUser(signerAddress);
    for(const connId in user.connections) if(user.connections[connId]) {
      const driver = drivers.get(user.connections[connId].driver);
      await driver.unregister(user.makeSafeForConnection(connId));
    }
    await db.deleteUser(signerAddress);
    res.sendStatus(204);
  }), handleError('user unregister'));

  router.get('/gdpr',
    validateUser(),
    wrapAsync(async (req, res) => {
      res.json(Object.assign({}, req.user, { indexes: await db.getGlobalUserIndex(req.user) }));
    }),
    handleError('user gdpr'));

  router.get('/list-files',
    validateUser(),
    wrapAsync(async (req, res) => {
      let index: GlobalMetadataIndex | MetadataIndex;
      if(trueArray.includes(req.query.global))
        index = await db.getGlobalUserIndex(req.user);
      else
        index = await db.getUserIndex(req.user);
      if(trueArray.includes(req.query.hash))
          res.send(hashBuffer(Buffer.from(JSON.stringify(index), 'utf8')));
      else
        res.json(index);
    }),
    handleError('user list-files'));

  return router;
}
