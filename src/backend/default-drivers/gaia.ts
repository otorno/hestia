import { Readable as ReadableStream } from 'stream';
import { getLogger, Logger } from '@log4js-node/log4js-api';

import Driver, { ListFilesResponse, DriverApiInterface } from '../data/driver';
import { MalformedError } from '../data/hestia-errors';
import { User } from '../data/user';
import axios from 'axios';
import { join as pathJoin } from 'path';
import * as fs from 'fs-extra';
import { urljoin, streamToBuffer } from '../util';
import authService from '../services/auth-service';
import { SubTable } from '../data/db-driver';

interface GaiaDriverConfigType {
  page_size: number; // global

  token?: string; // (optional - required for hub-backend) the authorization token
                  // if not provided, this will be a per-user backend
}

class GaiaDriver implements Driver {

  private id: string;
  private pageSize: number;
  private api: DriverApiInterface;
  private table: SubTable<{
    bucket: string;
    hubUrl: string;
    readUrl: string;
    token: string;
  }>;

  private hubUrl: string;
  private token: string;

  private readUrl: string;
  private bucket: string;

  private logger: Logger;

  public async performRead(options: {
    path: string;
    storageTopLevel: string;
    user: User;
  }): Promise<{ redirectUrl: string }> {
    const path = options.storageTopLevel + '/' + options.path;
    this.logger.info('Read - ' + path);

    let url: string;
    if(this.token) {
      url = urljoin(this.readUrl, this.bucket, options.user.address, path);
    } else {
      const { readUrl, bucket } = await this.table.get(options.user.connectionId);
      url = urljoin(readUrl, bucket, path);
    }

    return {
      redirectUrl: url
    };
  }

  public async performWrite(options: {
    path: string;
    storageTopLevel: string;
    contentType: string;
    contentLength: number; // integer
    stream: ReadableStream;
    user: User;
  }): Promise<void> {
    const path = options.storageTopLevel + '/' + options.path;
    this.logger.info('Write - ' + path);

    let url: string, token: string;
    if(this.token) {
      token = this.token;
      url = urljoin(this.hubUrl, 'store', this.bucket, options.user.address, path);
    } else {
      const { hubUrl, bucket, token: tok } = await this.table.get(options.user.connectionId);
      token = tok;
      url = urljoin(hubUrl, 'store', bucket, path);
    }

    await axios.post(url, await streamToBuffer(options.stream), {
      headers: {
        ['Content-Type']: options.contentType,
        ['Content-Length']: options.contentLength,
        Authorization: 'Bearer ' + token
      }
    });
  }

  public async performDelete(options: {
    path: string;
    storageTopLevel: string;
    user: User;
  }): Promise<void> {
    const path = options.storageTopLevel + '/' + options.path;
    this.logger.info('Delete - ' + path);
    let url: string, token: string;
    if(this.token) {
      token = this.token;
      url = urljoin(this.hubUrl, 'delete', this.bucket, options.user.address, path);
    } else {
      const { hubUrl, bucket, token: tok } = await this.table.get(options.user.connectionId);
      token = tok;
      url = urljoin(hubUrl, 'delete', bucket, path);
    }

    await axios.delete(url, {
      headers: { Authorization: 'Bearer ' + token }
    });
  }



  public async listFiles<State extends boolean>(prefix: string, page: number, state: State, user: User): Promise<ListFilesResponse<State>> {
    this.logger.info(`List files: ` + prefix);

    let hubUrl: string, bucket: string, token: string, searchPrefix: string;
    if(this.token) {
      hubUrl = this.hubUrl;
      bucket = this.bucket;
      token = this.token;
      searchPrefix = urljoin(bucket, user.address, prefix);
    } else {
      const data = await this.table.get(user.connectionId);
      hubUrl = data.hubUrl;
      bucket = data.bucket;
      token = data.token;
      searchPrefix = urljoin(bucket, prefix);
    }

    const ret = { entries: [] } as ListFilesResponse<State>;

    let p = 0;
    do {
      const res = await axios.post<ListFilesResponse<State>>(urljoin(hubUrl, 'list-files', bucket), { page: p, state }, {
        headers: { Authorization: 'Bearer ' + token }
      });

      if(!res.data.entries.length) {
        break;
      } else {

        ret.entries.push(...(res.data.entries as any[])
          .filter((a: string | { name: string }) => (typeof a === 'string' ? a : a.name).startsWith(searchPrefix)));

        if(ret.entries.length < (page * this.pageSize) && res.data.page) {
          p = res.data.page; // we continue!
        } else {
          ret.entries = ret.entries.slice(page * this.pageSize, this.pageSize * (page + 1));
          if(res.data.page)
            ret.page = page + 1;
          break; // we stop!
        }
      }
    } while(p);

    return ret;
  }

  async init(id: string, config: GaiaDriverConfigType, api: DriverApiInterface) {
    this.id = id;
    this.pageSize = Number(config.page_size || 50);
    this.api = api;
    this.logger = getLogger('drivers.' + id);

    this.token = String(config.token || '');
    if(this.token) {
      const { issuerAddress, claimedHub, validHub } = authService.partialValidate({ authorization: 'Bearer ' + this.token }, true);
      this.bucket = issuerAddress;
      this.hubUrl = claimedHub;
      if(validHub)
        throw new Error('Cannot use a token to the same hub that this is running on!');

      try {
        const res = await axios.get<{
          challenge_text: string;
          latest_auth_version: string;
          read_url_prefix: string;
        }>(this.hubUrl + '/hub_info');
        this.readUrl = res.data.read_url_prefix;
      } catch(e) {
        throw new Error('Error getting hub info: ' + (e.message || e));
      }

    } else {
      this.bucket = '';
      this.hubUrl = '';
      this.readUrl = '';

      const tableList = await this.api.db.listTables();
      if(!tableList.includes('basic'))
        this.table = await this.api.db.createTable('basic');
      else
        this.table = await this.api.db.getTable('basic');
    }

    const icon = fs.readFileSync(pathJoin(__dirname, 'icons', 'gaia.png'));

    const hasToken = Boolean(this.token);
    return {
      name: 'Gaia Hub' + (!hasToken ? ' (User)' : ''),
      longId: 'io.github.michaelfedora.hestia.gaia' + (!hasToken ? 'User' : ''),
      icon,
      multiInstance: hasToken,
      multiUser: !hasToken,
      autoRegisterable: hasToken
    };
  }

  async getInfo(user: User) {
    return {
      spaceUsed: -1
    };
  }

  async autoRegister(user: User) {
    if(!this.token)
      throw new Error('Cannot auto-register for user-backend!');
    return { finish: { address: user.address } };
  }

  async register(user: User, redirectUrl: string, req: { headers: { [key: string]: string | string[] }, query: any }) {
    if(this.token)
      return this.autoRegister(user);

    // gib token
    if(!(req && req.query && req.query.token))
      throw new MalformedError('Tried to register for the user-driver but there was no token query paramater!');

    const token = String(req.query.token);

    let bucket: string, signerAddress: string, claimedHub: string, validHub: boolean;
    try {
      const stats = authService.partialValidate({ authorization: 'Bearer ' + token }, true);
      bucket = stats.issuerAddress;
      signerAddress = stats.signerAddress;
      claimedHub = stats.claimedHub;
      validHub = stats.validHub;
    } catch(e) {
      throw new MalformedError('Error validating token: ' + (e.message || e));
    }

    if(signerAddress !== user.address)
      throw new MalformedError('Token must be signed by the user!');
    if(validHub)
      throw new MalformedError('Cannot register for the same hub that this is running on!');
    if(!claimedHub)
      throw new MalformedError('Must have a claimed hub in the token (otherwise, who am I supposed to talk to?)');

    let readUrl: string;
    try {
      const res = await axios.get<{ read_url_prefix: string }>(claimedHub + '/hub_info');
      readUrl = res.data.read_url_prefix;
    } catch(e) {
      throw new Error('Error getting hub info for claimed hub ' + claimedHub);
    }

    await this.table.set(user.connectionId, { bucket, hubUrl: claimedHub, readUrl, token });
    return { finish: { address: user.address } };
  }

  async unregister(user: User) {
    if(this.token) { // hub-driver
      // do nothing?
      // get my metadata, look for the user's, delete those files?
      // or le the user do the above (like how we do in the dashboard...)
      // this.table.metadata.get(user.connectionId);
    } else { // user-driver
      // delete info
      await this.table.delete(user.connectionId);
    }
  }
}


// multi-instance!
export default Object.freeze({ create() { return new GaiaDriver(); } });
