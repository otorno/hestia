import { Readable } from 'stream';
import { ReReadable } from 'rereadable-stream';
import db from './database-service';
import drivers from './driver-service';
import { User } from '../data/user';
import { AUTH_TIMESTAMP_FILE_NAME } from './api/middleware';
import { streamToBuffer, bufferToStream, hashStream } from '../util';
import { getLogger } from 'log4js';
import { NotAllowedError, MultiError } from '../data/hestia-errors';
import axios from 'axios';
import Config from '../data/config';
import { ListFilesResponse } from '../data/driver';

class GaiaService {

  private authTimestampCache: { [key: string]: { bday: Date; ts: Date } } = { };
  private pageSize: number;
  private logger = getLogger('services.gaia');

  public init(config: Config) {
    this.pageSize = config.page_size;
  }

  public async getAuthTimestamp(address: string) {

    // if exists & is not more than an ten minutes
    if(this.authTimestampCache[address] && this.authTimestampCache[address].bday.getTime() > (Date.now() - 60000))
      return this.authTimestampCache[address].ts;
    else {
      try {
        const r = await this.read(address, AUTH_TIMESTAMP_FILE_NAME);
        let d: Buffer;
        if('redirectUrl' in r)
          d = (await axios.get(r.redirectUrl, { responseType: 'arraybuffer' })).data;
        else
          d = await streamToBuffer(r.stream);
        const ts = Number.parseInt(d.toString('utf8'));
        return (this.authTimestampCache[address] = { bday: new Date(), ts: new Date(ts * 1000) }).ts;
      } catch(e) {
        return (this.authTimestampCache[address] = { bday: new Date(), ts: new Date(0) }).ts;
      }
    }
  }

  public async setAuthTimestamp(address: string, user: User, seconds: number) {

    const b = Buffer.from(seconds.toFixed(), 'utf8');
    const s = bufferToStream(b);

    const connections = user.getConnections(address);

    for(const conn of connections) {
      const driver = drivers.get(conn.driver);

      await driver.performWrite({
        path: AUTH_TIMESTAMP_FILE_NAME,
        storageTopLevel: address,
        contentType: 'text/plain; charset=UTF-8',
        contentLength: b.length,
        stream: s,
        user: user.makeSafeForConnection(conn.id)
      });
    }

    this.authTimestampCache[`${address}`] = { bday: new Date(), ts: new Date(seconds * 1000) };
  }

  public async read(address: string, path: string): Promise<{ contentType: string} & ({ stream: Readable } | { redirectUrl: string })> {
    // this.logger.debug('Read: ' + address + '/' + path);
    const user = await db.users.getFromBucket(address);
    const info = await db.metadata.getForFile(address + '/' + path);
    const connId = info.connIds[Math.floor(Math.random() * info.connIds.length)];
    const driver = drivers.get(user.connections[connId].driver);

    return driver.performRead({
      path,
      storageTopLevel: address,
      user: user.makeSafeForConnection(connId)
    }).then(r => Object.assign(r, { contentType: info.contentType }));
  }

  public async store(address: string, path: string,
    data: { contentType: string; contentLength: number; stream: Readable }, user?: User): Promise<Error[]> {

    if(!data.stream.readable)
      throw new Error('Stream is not readable!');

    user = user || await db.users.getFromBucket(address);

    const rereadable = data.stream.pipe(new ReReadable());

    const hash = await hashStream(rereadable.rewind());

    const errors: Error[] = [];
    const connections = user.getConnections(address);
    let updateUser = false;

    for(const conn of connections) {
      const driver = drivers.get(conn.driver);
      if(!driver) {
        errors.push(new Error('No driver found of type ' + conn.driver + '!'));
        continue;
      }

      if(drivers.getInfo(conn.driver).rootOnly && user.address !== address) {
        errors.push(new NotAllowedError('Cannot write to a non-root address with a root-only driver!'));
        continue;
      }

      await driver.performWrite({
        path,
        storageTopLevel: address,
        contentType: data.contentType,
        contentLength: data.contentLength,
        stream: rereadable.rewind(),
        user: user.makeSafeForConnection(conn.id)
      }).then(() => {
        db.metadata.update(address + '/' + path, conn.id, {
          contentType: data.contentType,
          size: data.contentLength,
          lastModified: new Date(),
          hash
        });
        if(!conn.buckets.includes(address)) {
          user.connections[conn.id].buckets.push(address);
          updateUser = true;
        }
      }).catch(e => errors.push(e));
    }

    if(errors.length >= connections.length) {
      if(errors.length === 1)
        throw errors[0];
      else
        throw new MultiError(errors, 'All connections failed to write!');
    }

    if(updateUser)
      await db.users.update(user).catch(e => errors.push(e));

    return errors;
  }

  public async delete(address: string, path: string): Promise<Error[]> {
    const user = await db.users.getFromBucket(address);

    const errors: Error[] = [];
    const connections = user.getConnections(address);

    for(const conn of connections) {
      const driver = drivers.get(conn.driver);

      await driver.performDelete({
        path,
        storageTopLevel: address,
        user: user.makeSafeForConnection(conn.id)
      }).then(() => db.metadata.getForFile(address + '/' + path, conn.id))
        .catch(e => errors.push(e));
    }

    if(errors.length >= connections.length) {
      if(errors.length === 1)
        throw errors[0];
      else
        throw new MultiError(errors, 'All connections failed to write!');
    }

    return errors;
  }

  public async listFiles<State extends boolean>(address: string, options?: { page?: number; state?: State }, user?: User):
  Promise<ListFilesResponse<State>> {

    user = user || await db.users.getFromBucket(address);
    const info = await db.metadata.getForBucket(address);
    const { page, state } = Object.assign({ page: 0, state: false }, options);

    let entries = state ? Object.keys(info).map(k => ({
      name: k,
      contentLength: info[k].size,
      lastModifiedDate: info[k].lastModified.getTime()
    }))
      : Object.keys(info);

    const entryCount = entries.length;
    entries = entries.slice(page * this.pageSize, (page + 1) * this.pageSize);

    if(entryCount > this.pageSize * (page + 1))
      return { entries, page: page + 1 } as any;
    else
      return { entries } as any;
  }
}

export default new GaiaService();
