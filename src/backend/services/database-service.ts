import { r, MasterPool, RTable, Connection, RDatum } from 'rethinkdb-ts';
import { User, SerializedUser } from '../data/user';
import { NotFoundError } from '../data/hestia-errors';
import { SessionEntry } from '../data/session-entry';
import { getLogger } from 'log4js';
import {
  SerializedMetadataIndexEntry,
  ConnectionMetadataIndex,
  GlobalMetadataIndex,
  metadataTrim,
  Metadata,
  MetadataIndex
} from '../data/metadata-index';

class DatabaseService {

  private pool: MasterPool;
  private logger = getLogger('services.db');

  public get apiTableNames() { return ['users', 'sessions', 'metadata']; }

  public get apiDbName() { return 'hestia_api'; }
  public get dataDbName() { return 'hestia_data'; }

  public get dbNames() { return [ this.apiDbName, this.dataDbName ]; }

  public get apiDb() { return r.db(this.apiDbName); }
  public get dataDb() { return r.db(this.dataDbName); }

  public get users(): RTable<SerializedUser> { return this.apiDb.table('users'); }
  public get sessions(): RTable<SessionEntry> { return this.apiDb.table('sessions'); }
  public get metadata(): RTable<SerializedMetadataIndexEntry> { return this.apiDb.table('metadata'); }

  public async ensurePluginTable(pluginId: string) {
    return this.dataDb.tableList().contains(`plugin_${pluginId}`).branch(
      { dbs_created: 0 },
      this.dataDb.tableCreate(`plugin_${pluginId}`, { primaryKey: 'key' })).run();
  }

  public async ensureDriverTable(driverId: string) {
    return this.dataDb.tableList().contains(`driver_${driverId}`).branch(
      { dbs_created: 0 },
      this.dataDb.tableCreate(`driver_${driverId}`, { primaryKey: 'key' })).run();
  }

  public getPluginTable(pluginId: string): RTable { return this.dataDb.table(`plugin_${pluginId}`); }
  public getDriverTable(driverId: string): RTable { return this.dataDb.table(`driver_${driverId}`); }

  public async init(host: string, port: number): Promise<void> {
    this.pool = await r.connectPool({ host, port });

    await r(this.dbNames).difference(r.dbList()).run().then(async result => {
      for(const dbName of result)
          await r.dbCreate(dbName).run().then(a => this.logger.info(`Created db "${dbName}!`));
    });

    await r(this.apiTableNames).difference(this.apiDb.tableList()).run().then(async result => {
      for(const tableName of result) {
        if(tableName === 'metadata')
          await this.apiDb.tableCreate('metadata', { primaryKey: 'key' }).run().then(a => this.logger.info(`Created api table metadata!`));
        else
          await this.apiDb.tableCreate(tableName).run().then(a => this.logger.info(`Created api table "${tableName}"!`));
      }
    });

    await this.users.indexList().run().then(async result => {
      if(!result.includes('address'))
        await this.users.indexCreate('address').run()
          .then(() => this.users.indexWait('address').run())
          .then(a => this.logger.info(`Created address index in user table (api db).`));
      if(!result.includes('buckets'))
        await this.users.indexCreate('buckets', { multi: true }).run()
          .then(() => this.users.indexWait('buckets').run())
          .then(a => this.logger.info(`Created buckets index in user table (api db).`));
      if(!result.includes('drivers'))
        await this.users.indexCreate('drivers', { multi: true }).run()
          .then(() => this.users.indexWait('drivers').run())
          .then(a => this.logger.info(`Created drivers index in user table (api db).`));
    });

    await this.sessions.indexList().run().then(async result => {
      if(!result.includes('expires'))
        await this.sessions.indexCreate('expires').run()
          .then(() => this.users.indexWait('expires').run())
          .then(a => this.logger.info(`Created expires index in session table (api db).`));
    });

    await this.metadata.indexList().run().then(async result => {
      if(!result.includes('path'))
        await this.metadata.indexCreate('path').run()
          .then(() => this.metadata.indexWait('path').run())
          .then(a => this.logger.info('Created path index in metadata table (api db).'));
      if(!result.includes('connId'))
        await this.metadata.indexCreate('connId').run()
          .then(() => this.metadata.indexWait('connId').run())
          .then(a => this.logger.info('Created connId index in metadata table (api db).'));
    });
  }

  public async registerUser(address: string, bucketAddress: string = '') {
    const users = await this.users.getAll(address, { index: 'address' }).run();
    if(users.length > 1)
      throw new Error('More than one user with address ' + address + '!');
    if(users.length < 1 || !users[0].id)
      await this.users.insert(new User({ address, internalBucketAddress: bucketAddress }).serialize(true), { conflict: 'replace' }).run();

    return this.getUser(address);
  }

  public async deleteUser(address: string) {
    const users = await this.users.getAll(address, { index: 'address' }).run();
    if(users.length > 1)
      throw new Error('More than one user with address ' + address + '!');
    if(users.length === 1)
      return this.users.get(users[0].id).delete().run();
    else
      throw new NotFoundError('No user found with address ' + address + '!');
  }

  public async getUser(address: string) {
    const users = await this.users.getAll(address, { index: 'address' }).run();
    if(users.length > 1) throw new Error('More than one user with address ' + address + '!');
    if(users.length <= 0) throw new NotFoundError('No users with the address ' + address + '!');
    return User.deserialize(users[0]);
  }

  public async getUserFromBucket(address: string) {
    const users = await this.users.getAll(address, { index: 'buckets' }).run();
    if(users.length > 1) throw new Error('More than one user with bucket address ' + address + '!');
    if(users.length <= 0) throw new NotFoundError('No users with the bucket address ' + address + '!');
    return User.deserialize(users[0]);
  }

  public async getAllUsers() {
    const users = await this.users.run();
    return users.map(a => User.deserialize(a));
  }

  public async updateUser(user: User) {
    return this.users.get(user.id).update(user.serialize()).run();
  }

  public async getIndexForConnection(connId: string, bucket?: string): Promise<ConnectionMetadataIndex> {
    const entries = await this.metadata.getAll(connId, { index: 'connId' }).run();
    const ret: ConnectionMetadataIndex = { };
    if(bucket) {
      for(const entry of entries) if(entry.path.startsWith(bucket))
        ret[entry.path] = metadataTrim(entry);
    } else {
      for(const entry of entries)
        ret[entry.path] = metadataTrim(entry);
    }
    return ret;
  }

  /**
   * Gets the global index, which includes metadata from every connection
   * @param bucket The bucket to limit the results to
   */
  public async getGlobalIndex(bucket?: string): Promise<GlobalMetadataIndex> {
    const info = await this.metadata.run();
    const ret: GlobalMetadataIndex = { };
    if(bucket) {
      for(const i of info) if(i.path.startsWith(bucket)) {
        if(!ret[i.path])
          ret[i.path] = { };
        ret[i.path][i.connId] = metadataTrim(i);
      }
    } else {
      for(const i of info) {
        if(!ret[i.path])
          ret[i.path] = { };
        ret[i.path][i.connId] = metadataTrim(i);
      }
    }
    return ret;
  }

  public async getGlobalUserIndex(user: User): Promise<GlobalMetadataIndex> {
    const connIds = r.expr(Object.keys(user.connections));
    const info = await this.metadata.filter(d => connIds.contains(d('connId'))).run();
    const ret: GlobalMetadataIndex = { };
    for(const i of info) {
      if(!ret[i.path])
        ret[i.path] = { };
      ret[i.path][i.connId] = metadataTrim(i);
    }
    return ret;
  }

  public async getUserIndex(user: User): Promise<MetadataIndex> {
    const connIds = r.expr(Object.keys(user.connections));
    const info = await this.metadata.filter(d => connIds.contains(d('connId'))).run();
    const oldestLatestModifiedDates: { [path: string]: { oldest: Date, latest: Date } } = { };
    const ret: MetadataIndex = { };
    for(const i of info) {
      // new
      if(!ret[i.path]) {
        ret[i.path] = { connIds: [i.connId], ...metadataTrim(i) };
        oldestLatestModifiedDates[i.path] = { oldest: i.lastModified, latest: i.lastModified };
        // same hash
      } else if(ret[i.path].hash === i.hash) {
        ret[i.path].connIds.push(i.connId);

        if(oldestLatestModifiedDates[i.path].latest < i.lastModified) {
          oldestLatestModifiedDates[i.path].latest = i.lastModified;

        } else if(oldestLatestModifiedDates[i.path].oldest > i.lastModified) {
          oldestLatestModifiedDates[i.path].oldest = i.lastModified;
          ret[i.path].lastModified = i.lastModified;
        }
        // different hash and newer
      } else if(oldestLatestModifiedDates[i.path].latest < i.lastModified) {
        ret[i.path] = { connIds: [i.connId], ...metadataTrim(i) };
        oldestLatestModifiedDates[i.path] = { oldest: i.lastModified, latest: i.lastModified };
      }
    }
    return ret;
  }

  /**
   * Gets the index, which only includes the latest metadata
   * @param bucket The bucket to limit the results to
   */
  public async getIndex(bucket?: string): Promise<MetadataIndex> {
    const info = await this.metadata.run();
    const oldestLatestModifiedDates: { [path: string]: { oldest: Date, latest: Date } } = { };
    const ret: MetadataIndex = { };
    if(bucket) {
      for(const i of info) if(i.path.startsWith(bucket)) {
        // new
        if(!ret[i.path]) {
          ret[i.path] = { connIds: [i.connId], ...metadataTrim(i) };
          oldestLatestModifiedDates[i.path] = { oldest: i.lastModified, latest: i.lastModified };
          // same hash
        } else if(ret[i.path].hash === i.hash) {
          ret[i.path].connIds.push(i.connId);

          if(oldestLatestModifiedDates[i.path].latest < i.lastModified) {
            oldestLatestModifiedDates[i.path].latest = i.lastModified;

          } else if(oldestLatestModifiedDates[i.path].oldest > i.lastModified) {
            oldestLatestModifiedDates[i.path].oldest = i.lastModified;
            ret[i.path].lastModified = i.lastModified;
          }
          // different hash and newer
        } else if(oldestLatestModifiedDates[i.path].latest < i.lastModified) {
          ret[i.path] = { connIds: [i.connId], ...metadataTrim(i) };
          oldestLatestModifiedDates[i.path] = { oldest: i.lastModified, latest: i.lastModified };
        }
      }
    } else {
      for(const i of info) {
        // new
        if(!ret[i.path]) {
          ret[i.path] = { connIds: [i.connId], ...metadataTrim(i) };
          oldestLatestModifiedDates[i.path] = { oldest: i.lastModified, latest: i.lastModified };
          // same hash
        } else if(ret[i.path].hash === i.hash) {
          ret[i.path].connIds.push(i.connId);

          if(oldestLatestModifiedDates[i.path].latest < i.lastModified) {
            oldestLatestModifiedDates[i.path].latest = i.lastModified;

          } else if(oldestLatestModifiedDates[i.path].oldest > i.lastModified) {
            oldestLatestModifiedDates[i.path].oldest = i.lastModified;
            ret[i.path].lastModified = i.lastModified;
          }
          // different hash and newer
        } else if(oldestLatestModifiedDates[i.path].latest < i.lastModified) {
          ret[i.path] = { connIds: [i.connId], ...metadataTrim(i) };
          oldestLatestModifiedDates[i.path] = { oldest: i.lastModified, latest: i.lastModified };
        }
      }
    }
    return ret;
  }

  public async getFileInfo(path: string, connId?: string): Promise<Metadata & { connIds: string[] }> {
    if(connId) {
      const info = await this.metadata.get(path + ':' + connId).run();
      if(!info)
        throw new NotFoundError('File with path ' + path + ' does not exist in the index!');
      return { connIds: [connId], ...metadataTrim(info) };

    } else {
      const info = await this.metadata.getAll(path, { index: 'path' }).run();

      if(info.length < 1) {
        throw new NotFoundError('File with path ' + path + ' does not exist in the index!');

      } if(info.length === 1) {
        return { connIds: [info[0].connId], ...metadataTrim(info[0]) };

      } else {
        let latest = info[0];
        for(const i of info)
          if(i.lastModified > latest.lastModified)
            latest = i;
        const entries = info.filter(a => a.hash === latest.hash);

        let oldestTimestamp = entries[0].lastModified;
        for(const e of entries)
          if(e.lastModified < oldestTimestamp)
            oldestTimestamp = e.lastModified;
        return Object.assign(metadataTrim(latest), { connIds: entries.map(e => e.connId), lastModified: oldestTimestamp });
      }
    }
  }

  public async updateIndex(path: string, connId: string, metadata: Metadata) {
    return this.metadata.insert({ key: path + ':' + connId, path, connId, ...metadata }, { conflict: 'replace' }).run();
  }

  public async deleteIndex(path: string, connId: string) {
    return this.metadata.get(path + ':' + connId).update({ size: 0, hash: '', lastModified: new Date() }).run();
  }

  private lastTick = Date.now();
  private trimDeletedTickWorking = false;
  public async trimDeletedTick() {
    if(this.trimDeletedTickWorking || Date.now() - this.lastTick < 120000) // two minutes
      return;
    this.trimDeletedTickWorking = true;
    this.lastTick = Date.now();

    const rowsToDelete: string[] = await (this.metadata.group({ index: 'path' }) as RDatum<{
      group: string, reduction: SerializedMetadataIndexEntry[]
    }[]>).filter(r.row('reduction').contains(d => d('size').ne(0)).not()).ungroup().map(r.row('key')).run();

    if(rowsToDelete.length)
      await this.metadata.getAll(rowsToDelete).delete().run();

    this.trimDeletedTickWorking = false;
  }
}

export default new DatabaseService();
