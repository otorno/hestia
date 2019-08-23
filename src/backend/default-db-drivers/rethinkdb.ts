import { r, MasterPool, RTable, RDatum, RDatabase } from 'rethinkdb-ts';
import { getLogger, Logger } from '@log4js-node/log4js-api';
import { NotFoundError } from '../data/hestia-errors';
import { User, SerializedUser } from '../data/user';
import { ConnectionMetadataIndex, ExpandedMetadataIndex, Metadata, MetadataIndex } from '../data/metadata-index';
import { DbDriver, DbDriverSubCategory, DbDriverUsersCategory, DbDriverMetadataCategory, SubTable, SubDB } from '../data/db-driver';

interface SerializedMetadataIndexEntry extends Metadata {
  // primary key
  key: string; // path + ':' + connId

  // secondary key
  path: string;
  // secondary key
  connId: string;
}

function metadataTrim(data: Metadata) {
  return {
    contentType: data.contentType,
    size: data.size,
    hash: data.hash,
    lastModified: new Date(data.lastModified.getTime())
  };
}

interface RethinkDBConfig {
  host?: string; // (optional) the RethinkDB host (default: `127.0.0.1`)
  port?: number; // (optional) the RethinkDB port (default: `28015`)
}

class RethinkDBSubTable<T = any> implements SubTable<T> {
  constructor(private table: RTable<{ key: string, value: any }>) { }

  async get(key: string): Promise<T> {
    return this.table.get(key)('value').run() as Promise<T>;
  }

  async getAll(): Promise<{ key: string, value: T }[]> {
    return this.table.run();
  }

  async set(key: string, value: any) {
    await this.table.insert({ key, value }, { conflict: 'replace' }).run();
  }

  async delete(key: string) {
    await this.table.get(key).delete().run();
  }
}

class RethinkDBDriver implements DbDriver {

  private pool: MasterPool;
  private logger = getLogger('services.db.rethinkdb');

  private get apiTableNames() { return ['users', 'metadata']; }

  private get apiDbName() { return 'hestia_api'; }
  private get dataDbName() { return 'hestia_data'; }

  private get dbNames() { return [ this.apiDbName, this.dataDbName ]; }

  private get apiDb() { return r.db(this.apiDbName); }
  private get dataDb() { return r.db(this.dataDbName); }

  private get usersTbl() { return this.apiDb.table('users'); }
  private get metadataTbl() { return this.apiDb.table('metadata'); }

  public async init(config: RethinkDBConfig) {
    config = Object.assign({ host: '127.0.0.1', port: 28015 }, config);
    this.pool = await r.connectPool({ host: config.host, port: config.port });

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

    await this.users.init();
    await this.metadata.init();

    return { name: 'RethinkDB' };
  }

  public close() {
    return this.pool.drain();
  }

  public drivers = new class RethinkDBDriversCategory implements DbDriverSubCategory {
    constructor(private db: RDatabase) { }

    private async createTable<T = any>(id: string, name: string): Promise<SubTable<T>> {
      await this.db.tableCreate('driver_' + id + '_' + name, { primaryKey: 'key' }).run();
      return this.getTable<T>(id, name);
    }

    private async dropTable(id: string, name: string): Promise<void> {
      await this.db.tableDrop('driver_' + id + '_' + name).run();
    }

    private async listTables(id: string): Promise<string[]> {
      return this.db.tableList().filter(doc => doc.match('^driver_' + id) as any).run();
    }

    private async getTable<T = any>(id: string, name: string): Promise<SubTable<T>> {
      return new RethinkDBSubTable<T>(this.db.table('driver_' + id + '_' + name));
    }

    public getDB(id: string): SubDB {
      const dis = this;
      return {
        createTable(name: string) { return dis.createTable(id, name); },
        dropTable(name: string) { return dis.dropTable(id, name); },
        listTables() { return dis.listTables(id); },
        getTable(name: string) { return dis.getTable(id, name); }
      };
    }
  }(this.dataDb);

  public plugins = new class RethinkDBPluginsCategory implements DbDriverSubCategory {
    constructor(private db: RDatabase) { }

    private async createTable<T = any>(id: string, name: string): Promise<SubTable<T>> {
      await this.db.tableCreate('plugin_' + id + '_' + name).run();
      return this.getTable(id, name);
    }

    private async dropTable(id: string, name: string): Promise<void> {
      await this.db.tableDrop('plugin_' + id + '_' + name).run();
    }

    private async listTables(id: string): Promise<string[]> {
      return this.db.tableList().filter(doc => doc.match('^plugin_' + id) as any).run();
    }

    private async getTable<T = any>(id: string, name: string): Promise<SubTable<T>> {
      return new RethinkDBSubTable<T>(this.db.table('plugin_' + id + '_' + name));
    }

    public getDB(id: string): SubDB {
      const dis = this;
      return {
        createTable(name: string) { return dis.createTable(id, name); },
        dropTable(name: string) { return dis.dropTable(id, name); },
        listTables() { return dis.listTables(id); },
        getTable(name: string) { return dis.getTable(id, name); }
      };
    }
  }(this.dataDb);

  public users = new class RethinkDBUsersCategory implements DbDriverUsersCategory {
    constructor(private table: RTable<SerializedUser>,
      private metadataTable: RTable<SerializedMetadataIndexEntry>,
      private logger: Logger) { }

    public async init() {
      await this.table.indexList().run().then(async result => {
        if(!result.includes('address'))
          await this.table.indexCreate('address').run()
            .then(() => this.table.indexWait('address').run())
            .then(a => this.logger.info(`Created address index in user table (api db).`));
        if(!result.includes('buckets'))
          await this.table.indexCreate('buckets', { multi: true }).run()
            .then(() => this.table.indexWait('buckets').run())
            .then(a => this.logger.info(`Created buckets index in user table (api db).`));
        if(!result.includes('drivers'))
          await this.table.indexCreate('drivers', { multi: true }).run()
            .then(() => this.table.indexWait('drivers').run())
            .then(a => this.logger.info(`Created drivers index in user table (api db).`));
      });
    }

    public async register(address: string, bucketAddress: string = '') {
      const users = await this.table.getAll(address, { index: 'address' }).run();
      if(users.length > 1)
        throw new Error('More than one user with address ' + address + '!');
      if(users.length < 1 || !users[0].id)
        await this.table.insert(new User({ address, internalBucketAddress: bucketAddress }).serialize(true), { conflict: 'replace' }).run();

      return this.get(address);
    }

    public async delete(address: string) {
      const users = await this.table.getAll(address, { index: 'address' }).run();
      if(users.length > 1)
        throw new Error('More than one user with address ' + address + '!');
      if(users.length === 1)
        await this.table.get(users[0].id).delete().run();
      else
        throw new NotFoundError('No user found with address ' + address + '!');
    }

    public async get(address: string) {
      const users = await this.table.getAll(address, { index: 'address' }).run();
      if(users.length > 1) throw new Error('More than one user with address ' + address + '!');
      if(users.length <= 0) throw new NotFoundError('No users with the address ' + address + '!');
      return User.deserialize(users[0]);
    }

    public async getFromBucket(address: string) {
      const users = await this.table.getAll(address, { index: 'buckets' }).run();
      if(users.length > 1) throw new Error('More than one user with bucket address ' + address + '!');
      if(users.length <= 0) throw new NotFoundError('No users with the bucket address ' + address + '!');
      return User.deserialize(users[0]);
    }

    public async getAll() {
      const users = await this.table.run();
      return users.map(a => User.deserialize(a));
    }

    public async update(user: User) {
      await this.table.get(user.id).update(user.serialize()).run();
    }

    public async updateConnectionBuckets(connId: string, addresses: string[]) {
      const matchers = r.expr(addresses.map(a => '^' + a));
      this.metadataTable.getAll(connId, { index: 'connId' }).filter(
        doc => matchers.contains(matcher => doc('path').match(matcher)).not())
        .delete().run();
    }
  }(this.usersTbl, this.metadataTbl, this.logger);

  public metadata = new class RethinkDBMetadataCategory implements DbDriverMetadataCategory {
    constructor(private table: RTable<SerializedMetadataIndexEntry>, private logger: Logger) { }
    public async init() {
      await this.table.indexList().run().then(async result => {
        if(!result.includes('path'))
          await this.table.indexCreate('path').run()
            .then(() => this.table.indexWait('path').run())
            .then(a => this.logger.info('Created path index in metadata table (api db).'));
        if(!result.includes('connId'))
          await this.table.indexCreate('connId').run()
            .then(() => this.table.indexWait('connId').run())
            .then(a => this.logger.info('Created connId index in metadata table (api db).'));
      });
    }

    public async getForConnection(connId: string, bucket?: string): Promise<ConnectionMetadataIndex> {
      const entries = await this.table.getAll(connId, { index: 'connId' }).run();
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

    public async getForUserExpanded(user: User): Promise<ExpandedMetadataIndex> {
      const connIds = r.expr(Object.keys(user.connections));
      const info = await this.table.filter(d => connIds.contains(d('connId'))).run();
      const ret: ExpandedMetadataIndex = { };
      for(const i of info) {
        if(!ret[i.path])
          ret[i.path] = { };
        ret[i.path][i.connId] = metadataTrim(i);
      }
      return ret;
    }

    public async getForUser(user: User): Promise<MetadataIndex> {
      const connIds = r.expr(Object.keys(user.connections));
      const info = await this.table.filter(d => connIds.contains(d('connId'))).run();
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
    public async getForBucket(bucket: string): Promise<MetadataIndex> {
      const info = await this.table.filter(doc => doc('path').match('^' + bucket) as RDatum<any>).run();

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

    public async getForFile(path: string, connId?: string): Promise<Metadata & { connIds: string[] }> {
      if(connId) {
        const info = await this.table.get(path + ':' + connId).run();
        if(!info)
          throw new NotFoundError('File with path ' + path + ' does not exist in the index!');
        return { connIds: [connId], ...metadataTrim(info) };

      } else {
        // ignore 0-length entries when fetching file info
        const info = await this.table.getAll(path, { index: 'path' }).filter(doc => doc('size').gt(0)).run();

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

    public async update(path: string, connId: string, metadata: Metadata) {
      await this.table.insert({ key: path + ':' + connId, path, connId, ...metadata }, { conflict: 'replace' }).run();
    }

    public async delete(path: string, connId: string) {
      await this.table.get(path + ':' + connId).update({ size: 0, hash: '', lastModified: new Date() }).run();
    }

    public async deleteAllForConnection(connId: string) {
      await this.table.getAll(connId, { index: 'connId' }).delete().run();
    }
  }(this.metadataTbl, this.logger);


  private lastTick = Date.now();
  private trimDeletedTickWorking = false;
  public async trimDeletedTick() {
    if(this.trimDeletedTickWorking || Date.now() - this.lastTick < 120000) // two minutes
      return;
    this.trimDeletedTickWorking = true;
    this.lastTick = Date.now();

    const rowsToDelete: string[] = await (this.metadataTbl.group({ index: 'path' }) as RDatum<{
      group: string, reduction: SerializedMetadataIndexEntry[]
    }[]>).filter(r.row('reduction').contains(d => d('size').ne(0)).not()).ungroup().map(r.row('key')).run();

    if(rowsToDelete.length)
      await this.metadataTbl.getAll(rowsToDelete).delete().run();

    this.trimDeletedTickWorking = false;
  }
}

export default new RethinkDBDriver();
