import db from './database-service';
import Config from '../data/config';
import drivers from './driver-service';
import { AuthError, NotFoundError, NotAllowedError } from '../data/hestia-errors';
import { decodeToken, TokenVerifier } from 'jsontokens';
import { User } from '../data/user';
import { ecPairToAddress } from 'blockstack';
import { ECPair } from 'bitcoinjs-lib';
import { getLogger } from 'log4js';

class AuthService {

  private whitelist: string[];
  private serverName: string;
  private validHubUrls: string[];

  private logger = getLogger('services.auth');

  public getLatestAuthVersion() {
    return 'v1';
  }

  public getChallengeText() {
    return JSON.stringify(['hestia', '0', this.serverName, 'blockstack_storage_please_sign']);
  }

  // are these even used?
  public getAuthScopes() {
    return [
      'putFile',
      'putFilePrefix',
      'deleteFile',
      'deleteFilePrefix'
    ];
  }

  private verifyToken(token: string, alg?: string, publicKey?: string) {
    const decodedToken = decodeToken(token) as any;
    const tokenVerifier = new TokenVerifier(alg || decodedToken.header.alg, publicKey || decodedToken.payload.issuer.publicKey);
    return (tokenVerifier && tokenVerifier.verify(token)) ? true : false;
  }

  private validateAssociationToken(token: string, bearerAddress: string) {
    // DECODING TOKEN
    let decodedToken;
    try {
      decodedToken = decodeToken(token);
    } catch(e) {
      throw new AuthError('Token malformed, could not decode.');
    }

    // PUBLIC KEY
    const publicKey = decodedToken.payload.iss;
    if(!publicKey)
      throw new AuthError('Malformed token: no ISS field for the public key.');

    // VERIFICATION
    let verified = false;
    try {
      verified = this.verifyToken(token, 'ES256K', publicKey);
    } catch(e) {
      throw new AuthError('Token malformed or internal error: unable to verify token.');
    }
    if(!verified)
      throw new AuthError('Token could not be verified.');

    // EXPIRATION TIME
    const expiresAt = Number(decodedToken.payload.exp);
    // if(!expiresAt)
    //   throw new AuthError('Malformed token: no expiration.');
    if(expiresAt && expiresAt < (Date.now() / 1000))
      throw new AuthError('Expired token.');

    // ISSUED AT TIME
    const issuedAt = Number(decodedToken.payload.iat);
    // if(!issuedAt)
    //   throw new AuthError('Malformed token: no issue-time.');
    if(issuedAt && Number(issuedAt) > (Date.now() / 1000))
      throw new AuthError('Malformed token: Issued in the future.');

    // CHILD PUBLIC KEY
    const childPublicKey = decodedToken.payload.childToAssociate;
    if(!childPublicKey)
      throw new AuthError('Malformed token: no childToAssociate field for the child public key.');

    const childAddress = ecPairToAddress(ECPair.fromPublicKey(Buffer.from(childPublicKey, 'hex')));
    if(childAddress !== bearerAddress)
      throw new AuthError('Child address does not match bearer address!');

    const signerAddress = ecPairToAddress(ECPair.fromPublicKey(Buffer.from(publicKey, 'hex')));
    return signerAddress;
  }

  public partialValidate(requestHeaders: { authorization?: string }, ignoreGaiaMismatch = false): {
    token: string;
    issuerAddress: string;
    signerAddress: string;
    issuedAt: number;
    claimedHub?: string;
    validHub?: boolean;
  } {
    if(!requestHeaders.authorization || !requestHeaders.authorization.toLowerCase().startsWith('bearer')) {
      throw new AuthError('Failed to parse authentication header; must start with "Bearer".');
    }

    const authPart = requestHeaders.authorization.slice('bearer '.length);
    const versionIndex = authPart.indexOf(':');

    if(versionIndex < 0) throw new AuthError('Legacy Authentication is Unsupported');

    let issuedAt = 0;
    const version = authPart.slice(0, versionIndex);
    let token = '';
    let publicKey = '';

    if(version === 'v1') {

      // DECODING TOKEN
      token = authPart.slice(versionIndex + 1);
      let decodedToken;
      try {
        decodedToken = decodeToken(token);
      } catch(e) {
        throw new AuthError('Token malformed, could not decode.');
      }

      // PUBLIC KEY
      publicKey = decodedToken.payload.iss;
      if(!publicKey)
        throw new AuthError('Malformed token: no ISS field for the public key.');

      // VERIFICATION
      let verified = false;
      try {
        verified = this.verifyToken(token, 'ES256K', publicKey);
      } catch(e) {
        throw new AuthError('Token malformed or internal error: unable to verify token.');
      }
      if(!verified)
        throw new AuthError('Token could not be verified.');

      // EXPIRATION TIME
      const expiresAt = Number(decodedToken.payload.exp);
      // if(!expiresAt)
      //   throw new AuthError('Malformed token: no expiration.');
      if(expiresAt && expiresAt < (Date.now() / 1000))
        throw new AuthError('Expired token.');

      // ISSUED AT TIME
      issuedAt = Number(decodedToken.payload.iat);
      // if(!issuedAt)
      //   throw new AuthError('Malformed token: no issue-time.');
      if(issuedAt && Number(issuedAt) > (Date.now() / 1000))
        throw new AuthError('Malformed token: Issued in the future.');

      // GAIA CHALLENGE
      if(!ignoreGaiaMismatch && !decodedToken.payload.gaiaChallenge)
        throw new AuthError('Malformed token: no gaia challenge.');

      const myGaiaChallenge = this.getChallengeText();
      if(!ignoreGaiaMismatch && myGaiaChallenge !== decodedToken.payload.gaiaChallenge)
        throw new AuthError('Malformed token: Supplied Gaia Challenge does not match.');

      // CLAIMED HUB
      let claimedHub = decodedToken.payload.hubUrl;
      if(!ignoreGaiaMismatch && !claimedHub)
        throw new AuthError('Malformed token: No claimed hub.');

      if(claimedHub.endsWith('/'))
        claimedHub = claimedHub.slice(0, -1);
      const validHub = Boolean(this.validHubUrls.find(a => claimedHub.startsWith(a)));
      if(!ignoreGaiaMismatch && !validHub)
        throw new AuthError('Claimed hub is invalid.');

      // AUTH SCOPES
      const scopes = decodedToken.payload.scopes;
      if(scopes) {
        if(scopes.length > 8)
          throw new AuthError('Too many authentication scopes.');

        const validScopes = this.getAuthScopes();
        for(const scope of scopes)
          if(!validScopes.includes(scope))
            throw new AuthError(`Unrecognized scope ${scope}!`);
      }

      const issuerAddress = ecPairToAddress(ECPair.fromPublicKey(Buffer.from(publicKey, 'hex')));

      let signerAddress: string;

      // ASSOCIATION TOKEN
      if(decodedToken.payload.associationToken != null) {
        // parent address
        signerAddress = this.validateAssociationToken(decodedToken.payload.associationToken, issuerAddress);
      } else {
        signerAddress = issuerAddress;
      }

      // WHITELIST
      if(this.whitelist && !this.whitelist.includes(signerAddress))
        throw new AuthError('Signer address is not in the whitelist!');

      const ret = { token, signerAddress, issuerAddress, issuedAt };
      if(ignoreGaiaMismatch)
        return Object.assign(ret, { claimedHub, validHub });
      return ret;

    } else {
      throw new AuthError(`No support for Authentication version ${version}!`);
    }
  }

  public async validateBucket(
    address: string,
    requestHeaders: { authorization?: string },
    getAuthTimestamp: (address: string) => Promise<Date>,
    autoRegister: boolean = false) {

    const data = this.partialValidate(requestHeaders);

    let user: User;
    try {
      user = await db.users.get(data.signerAddress);
    } catch(e) {
      if(e instanceof NotFoundError) {
        if(!autoRegister)
          throw new AuthError(`User with address "${data.signerAddress}" is not registered!`);
        else {
          user = await db.users.register(data.signerAddress);
          await drivers.autoRegisterUser(user);
        }
      } else {
        this.logger.error(e);
        throw new AuthError(`Erorr getting user with address "${data.signerAddress}"; might not exist!`);
      }
    }

    if(Object.keys(user.connections).length === 0)
      await drivers.autoRegisterUser(user);

    // ISSUER ADDRESS (but allow global tokens)
    if(data.signerAddress !== data.issuerAddress && user.internalBucketAddress !== data.issuerAddress && data.issuerAddress !== address)
      throw new AuthError('Issuer address mismatch: Issuer is not allowed to write on this address!');

    // REVOKE-ALL TIMESTAMP
    const authTimestamp = await getAuthTimestamp(address);
    if(data.issuedAt) {
      if(authTimestamp.getTime() > 0)
        throw new AuthError('User-defined timestamp exists, and token provided no issued-at time!');
    } else if(data.issuedAt < authTimestamp.getTime())
      throw new AuthError('Token issued before user-defined timestamp.');

    await db.users.update(user);

    return { user, auth: data };
  }

  public async validateUser(requestHeaders: { authorization?: string },
    options?: { ignoreGaiaMismatch?: boolean, autoRegister?: boolean }) {

    options = Object.assign({ ignoreGaiaMismatch: false, autoRegister: false }, options);

    const data = this.partialValidate(requestHeaders, options.ignoreGaiaMismatch);

    let user: User;
    try {
      user = await db.users.get(data.signerAddress);
    } catch(e) {
      if(e instanceof NotFoundError) {
        if(!options.autoRegister)
          throw new AuthError(`User with address "${data.signerAddress}" is not registered!`);
        else {
          user = await db.users.register(data.signerAddress);
          await drivers.autoRegisterUser(user);
        }
      } else {
        this.logger.error(e);
        throw new AuthError(`Erorr getting user with address "${data.signerAddress}"; might not exist!`);
      }
    }

    if(data.signerAddress !== data.issuerAddress && user.internalBucketAddress !== data.issuerAddress)
      throw new NotAllowedError('Issuer address must be the signer address (root bucket) or the internal (hestia) bucket!');

    return { user, auth: data };
  }

  public init(config: Config) {
    this.whitelist = config.whitelist ? config.whitelist.slice() : null;
    this.serverName = config.server_name;
    this.validHubUrls = [config.protocol + '://' + config.server_name].concat(config.valid_hub_urls || []);
  }
}

export default new AuthService();
