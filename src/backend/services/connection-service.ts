import { Readable } from 'stream';
import { User } from '../data/user';
import { NotFoundError, NotAllowedError } from '../data/hestia-errors';

import db from './database-service';
import drivers from './driver-service';
import { getLogger } from 'log4js';
import Config from '../data/config';
import { Metadata, metadataTrim } from '../data/metadata-index';
import { ReReadable } from 'rereadable-stream';
import { hashStream } from '../util';

class ConnectionService {

  private logger = getLogger('services.connection');
  private pageSize: number;

  public init(config: Config) {
    this.pageSize = config.page_size;
  }

  private getDriver(id: string, user: User) {
    const connection = user.connections[id];
    const driver = drivers.get(connection.driver);
    if(!driver)
      throw new NotAllowedError(`Driver that the connection "${id}" (for user "${user.address}") uses no longer exists!`);
    return driver;
  }

  private getDriverInfo(id: string, user: User) {
    const connection = user.connections[id];
    const info = drivers.getInfo(connection.driver);
    if(!info)
      throw new NotAllowedError(`Driver that the connection "${id}" (for user "${user.address}") uses no longer exists!`);
    return info;
  }

  /// = NON-PLUGIN UTIL FUNCTIONS

  public async deleteConnection(id: string, user: User): Promise<void> {
    if(!user.connections[id])
      throw new NotFoundError(`No connection with id "${id}" found for user "${user.address}!`);

    if(Object.keys(user.connections).length <= 1)
      throw new NotAllowedError('Cannot remove last connection.');

    const assembly = user.getConnectionArray().map(a => ({ driverInfo: drivers.getInfo(a.driver), ...a }));
    const conn = assembly.find(a => a.id === id);
    // the bro connection, to replace default connection if default gets deleted
    const broConn = assembly.find(a => a.id !== id && a.driverInfo && !a.driverInfo.rootOnly);

    if(!conn.driverInfo.rootOnly && !broConn)
      throw new NotAllowedError('Cannot remove last non-root-only connection.');

    try {
      const driver = await this.getDriver(id, user);
      driver.unregister(user.makeSafeForConnection(id));
    } catch(e) {
      // we can still remove the connection without having access to the driver (I guess)
      this.logger.warn(`[CONN]: Removing connection "${id}" (from user "${user.address}") while not having access to the driver!`);
    }
    user.removeConnection(id);
    if(user.defaultConnection === id)
      user.defaultConnection = broConn.id;

    await db.updateUser(user);
  }

  /// === PLUGIN API FUNCTIONS

  /// = GAIA FUNCTIONS

  public async read(id: string, user: User, address: string, path: string): Promise<{ stream: Readable } & Metadata> {
    if(!user.connections[id])
      throw new NotFoundError(`No connection with id "${id}" found for user "${user.address}!`);

    const info = await db.getFileInfo(address + '/' + path, id);

    const ret = await this.getDriver(id, user).performRead({ path, storageTopLevel: address, user: user.makeSafeForConnection(id) });
    return Object.assign(ret, metadataTrim(info));
  }

  public async store(id: string, user: User, address: string, path: string,
    data: { contentType: string, contentLength: number, stream: Readable }): Promise<void> {
    if(!user.connections[id])
      throw new NotFoundError(`No connection with id "${id}" found for user "${user.address}!`);
    if(!data.stream.readable)
      throw new Error('Stream is not readable!');
    const info = await this.getDriverInfo(id, user);
    if(info.rootOnly && user.address !== address)
      throw new NotAllowedError('Cannot write to a non-root address with a root-only driver!');

    const rereadable = data.stream.pipe(new ReReadable());

    const hash = await hashStream(rereadable.rewind());

    await drivers.get(info.id).performWrite({
      path,
      storageTopLevel: address,
      contentType: data.contentType,
      contentLength: data.contentLength,
      stream: rereadable.rewind(),
      user: user.makeSafeForConnection(id)
    });

    await db.updateIndex(address + '/' + path, id, {
      contentType: data.contentType,
      size: data.contentLength,
      lastModified: new Date(),
      hash
    });
  }

  public async delete(id: string, user: User, address: string, path: string): Promise<void> {
    if(!user.connections[id])
      throw new NotFoundError(`No connection with id "${id}" found for user "${user.address}!`);

    await this.getDriver(id, user).performDelete({ storageTopLevel: address, path, user: user.makeSafeForConnection(id) });
    await db.deleteIndex(address + '/' + path, id);
  }

  public async listFiles(id: string, user: User, path?: string, page?: number): Promise<{
    entries: ({ path: string } & Metadata)[],
    page?: number }> {
    if(!user.connections[id])
      throw new NotFoundError(`No connection with id "${id}" found for user "${user.address}!`);
    page = Number(page) || 0;
    // return this.getDriver(id, user).listFiles(path || '', page || 0, user.makeSafeForConnection(id));

    const index = await db.getIndexForConnection(id, path);
    const paths = Object.keys(index).sort();

    const entries = paths.map(p => ({ path: p, ...index[p] })).slice(this.pageSize * page, this.pageSize * (page + 1));

    if(paths.length > this.pageSize * (page + 1))
      return { entries, page: page + 1 };
    else
      return { entries };
  }

  /// = UTIL FUNCTIONS

  public async getInfo(id: string, user: User): Promise<{ spaceUsed: number, spaceAvailable?: number }> {
    if(!user.connections[id])
      throw new NotFoundError(`No connection with id "${id}" found for user "${user.address}!`);

    return await this.getDriver(id, user).getInfo(user.makeSafeForConnection(id));
  }

  public async setDefault(id: string, user: User): Promise<void> {
    if(!user.connections[id])
      throw new NotFoundError(`No connection with id "${id}" found for user "${user.address}!`);

    const driver = drivers.getInfo(user.connections[id].driver);
    if(!driver)
      throw new NotAllowedError(`Driver that the connection "${id}" (for user "${user.address}") uses no longer exists!`);
    if(driver.rootOnly)
      throw new NotAllowedError('Driver that the connection uses is limited to the root-folder!');

    user.defaultConnection = id;

    await db.updateUser(user);
  }

  public async setBuckets(id: string, user: User, addresses: string[]): Promise<void> {
    if(!user.connections[id])
      throw new NotFoundError(`No connection with id "${id}" found for user "${user.address}!`);

    const driverInfo = drivers.getInfo(user.connections[id].driver);
    if(driverInfo.rootOnly)
      throw new NotAllowedError('Cannot change the buckets of a root-only driver connection!');

    if(!addresses.includes(user.address))
      addresses.unshift(user.address);

    user.connections[id].buckets = addresses;

    await db.updateUser(user);
  }
}

export default new ConnectionService();
