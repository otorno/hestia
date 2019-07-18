import { Readable } from 'stream';
import { ReReadable } from 'rereadable-stream';
import db from './database-service';
import drivers from './driver-service';
import { User } from '../data/user';
import { AUTH_TIMESTAMP_FILE_NAME } from './api/middleware';
import { streamToBuffer, bufferToStream, hashStream } from '../util';
import { getLogger } from 'log4js';
import { NotAllowedError, MultiError, NotFoundError } from '../data/hestia-errors';
import Config from '../data/config';

class GaiaService {

  private authTimestampCache: { [key: string]: { bday: Date, ts: Date } } = { };
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
        const d = await streamToBuffer(r.stream);
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

  public async read(address: string, path: string): Promise<{ contentType: string, stream: Readable }> {
    // this.logger.debug('Read: ' + address + '/' + path);
    const user = await db.getUserFromBucket(address);
    const info = await db.getFileInfo(address + '/' + path);
    const connId = info.connIds[Math.floor(Math.random() * info.connIds.length)];
    const driver = drivers.get(user.connections[connId].driver);

    return driver.performRead({
      path,
      storageTopLevel: address,
      user: user.makeSafeForConnection(connId)
    }).then(r => Object.assign(r, { contentType: info.contentType }));
  }

  public async store(address: string, path: string,
    data: { contentType: string, contentLength: number, stream: Readable }, user?: User): Promise<Error[]> {

    if(!data.stream.readable)
      throw new Error('Stream is not readable!');

    user = user || await db.getUserFromBucket(address);

    const rereadable = data.stream.pipe(new ReReadable());

    const hash = await hashStream(rereadable.rewind());

    const errors: Error[] = [];
    const connections = user.getConnections(address);

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
      }).then(() => db.updateIndex(address + '/' + path, conn.id, {
        contentType: data.contentType,
        size: data.contentLength,
        lastModified: new Date(),
        hash
      })).catch(e => errors.push(e));
    }

    if(errors.length >= connections.length) {
      if(errors.length === 1)
        throw errors[0];
      else
        throw new MultiError(errors, 'All connections failed to write!');
   }

    return errors;
  }

  public async delete(address: string, path: string, user?: User): Promise<Error[]> {
    user = user || await db.getUserFromBucket(address);

    const errors: Error[] = [];
    const connections = user.getConnections(address);

    for(const conn of connections) {
      const driver = drivers.get(conn.driver);

      await driver.performDelete({
        path,
        storageTopLevel: address,
        user: user.makeSafeForConnection(conn.id)
      }).then(() => db.deleteIndex(address + '/' + path, conn.id))
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

  public async listFiles(address: string, page?: number, user?: User): Promise<{ entries: string[], page?: number }> {
    user = user || await db.getUserFromBucket(address);
    const info = await db.getIndex(address);
    page = Number(page) || 0;
    /*
    const connId = info.connIds[Math.floor(Math.random() * info.connIds.length)];
    const driver = drivers.get(user.connections[connId].driver);

    const result = await driver.listFiles(address, page, user.makeSafeForConnection(connection.id), true);
    const entries = result.entries.map(a => a.path);
    if(result.page)
      return { entries, page: result.page };
    else
      return { entries };
    */
   let entries = Object.keys(info);
   const entryCount = entries.length;
   entries = entries.slice(page * this.pageSize, (page + 1) * this.pageSize);
   if(entryCount > this.pageSize * (page + 1))
      return { entries, page: page + 1 };
    else
      return { entries };
  }
}

export default new GaiaService();
