import { Router } from 'express';
import * as cors from 'cors';
import { Logger } from 'log4js';
import { handleError, handleValidationError, validateUser, wrapAsync } from './middleware';

import db from '../database-service';
import auth from '../auth-service';
import drivers from '../driver-service';
import meta from '../meta-service';
import { User } from '../../data/user';
import { trueArray, hashBuffer } from '../../util';
import { ExpandedMetadataIndex, MetadataIndex } from '../../data/metadata-index';

export default function createUserApi(logger: Logger) {
  const router = Router();

  router.get('/validate-token', wrapAsync(async (req, res) => {
    await auth.validateUser(req.headers);
    res.sendStatus(204);
  }), handleValidationError);

  router.post('/login', cors({ origin: meta.origin() }), wrapAsync(async (req, res, next) => {

    let addresses: { signerAddress: string; issuerAddress: string };

    try {
      // ignore gaia mismatch because it's from the same origin "frontend app"
      addresses = auth.partialValidate(req.headers, true);
    } catch(e) {
      handleValidationError(e, req, res, next);
      return;
    }

    const bucketAddress = addresses.signerAddress === addresses.issuerAddress ? '' : addresses.issuerAddress;
    let user: User = await db.users.get(addresses.signerAddress).catch(e => null);

    if(!user) { // register
      user = await db.users.register(addresses.signerAddress, bucketAddress);

      try {
        drivers.autoRegisterUser(user);
      } catch(e) {
        logger.error('Error auto-registering user auto- drivers from login: ' + (e.stack || e));
      }
    } else {
      if(bucketAddress && user.internalBucketAddress !== bucketAddress) {
        user.internalBucketAddress = bucketAddress;
        await db.users.update(user);
      }
    }

    res.sendStatus(204);
  }), handleError('user login'));

  router.post('/register', wrapAsync(async (req, res, next) => {

    let addresses: { signerAddress: string; issuerAddress: string };

    try {
      // require params because this is public facing
      addresses = auth.partialValidate(req.headers);
    } catch(e) {
      handleValidationError(e, req, res, next);
      return;
    }

    const bucketAddress = addresses.signerAddress === addresses.issuerAddress ? '' : addresses.issuerAddress;
    const user = await db.users.register(addresses.signerAddress, bucketAddress);

    try {
      drivers.autoRegisterUser(user);
    } catch(e) {
      logger.error('Error registering user auto- drivers: ' + (e.stack || e));
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

    const user = await db.users.get(signerAddress);
    for(const connId in user.connections) if(user.connections[connId]) {
      const driver = drivers.get(user.connections[connId].driver);
      await driver.unregister(user.makeSafeForConnection(connId));
    }
    await db.users.delete(signerAddress);
    res.sendStatus(204);
  }), handleError('user unregister'));

  router.get('/gdpr',
    validateUser(),
    wrapAsync(async (req, res) => {
      res.json(Object.assign({}, req.user, { indexes: await db.metadata.getForUserExpanded(req.user) }));
    }),
    handleError('user gdpr'));

  router.get('/list-files',
    validateUser(),
    wrapAsync(async (req, res) => {
      let index: ExpandedMetadataIndex | MetadataIndex;
      if(trueArray.includes(String(req.query.global)))
        index = await db.metadata.getForUserExpanded(req.user);
      else
        index = await db.metadata.getForUser(req.user);
      if(trueArray.includes(String(req.query.hash)))
        res.send(hashBuffer(Buffer.from(JSON.stringify(index), 'utf8')));
      else
        res.json(index);
    }),
    handleError('user list-files'));

  return router;
}
