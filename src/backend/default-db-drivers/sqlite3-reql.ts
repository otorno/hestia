import { createSQLite3Database, Database, Table, Datum } from 'reql-bridge';
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

interface SQLite3ReQLConfig {
  filename?: string; // (optional) the SQLite3 DB filename, (default: `hestia-rql-db.sqlite`)
}

class SQLite3ReQLSubTable<T = any> implements SubTable<T> {
  constructor(private table: Table<{ key: string; value: any }>) { }

  async get(key: string): Promise<T> {
    return this.table.get(key)('value').run() as Promise<T>;
  }

  async getAll(): Promise<{ key: string; value: T }[]> {
    return this.table.run();
  }

  async set(key: string, value: any) {
    await this.table.insert({ key, value }, { conflict: 'replace' }).run();
  }

  async delete(key: string) {
    await this.table.get(key).delete().run();
  }
}

class SQLite3ReQLDriver implements DbDriver {

  private db: Database;
  private logger = getLogger('services.db.sqlite3-reql');

  private get usersTbl() { return this.db.table<SerializedUser>('users'); }
  private get metadataTbl() { return this.db.table<SerializedMetadataIndexEntry>('metadata'); }

  public async init(config: SQLite3ReQLConfig) {
    config = Object.assign({ filename: 'hestia-rql-db.sqlite' }, config);
    this.db = await createSQLite3Database({ filename: config.filename, logger: 'services.db.sqlite3-reql.raw'});

    const tbls = await this.db.tableList().run();

    if(!tbls.includes('metadata'))
      this.metadata.create(this.db);
    if(!tbls.includes('users'))
      await this.users.create(this.db);

    await this.users.init(this.usersTbl, this.metadataTbl);
    await this.metadata.init(this.metadataTbl);
    this.drivers.init(this.db);
    this.plugins.init(this.db);

    return { name: 'SQLite3-ReQL' };
  }

  public async close() {
    if(this.db)
      return this.db.close();
  }

  public drivers = new class SQLite3ReQLDriversCategory implements DbDriverSubCategory {
    private db: Database;

    constructor() { }
    public init(db: Database) { if(!this.db) this.db = db; }

    private async createTable<T = any>(id: string, name: string): Promise<SubTable<T>> {
      await this.db.tableCreate('driver_' + id + '_' + name, [{ name: 'key', type: 'string' }, { name: 'value', type: 'any' }]).run();
      return this.getTable<T>(id, name);
    }

    private async dropTable(id: string, name: string): Promise<void> {
      await this.db.tableDrop('driver_' + id + '_' + name).run();
    }

    private async listTables(id: string): Promise<string[]> {
      return this.db.tableList().filter(doc => doc.startsWith('driver_' + id) as any).run();
    }

    private async getTable<T = any>(id: string, name: string): Promise<SubTable<T>> {
      return new SQLite3ReQLSubTable<T>(this.db.table('driver_' + id + '_' + name));
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
  }();

  public plugins = new class SQLite3ReQLPluginsCategory implements DbDriverSubCategory {
    private db: Database;

    constructor() { }
    public init(db: Database) { if(!this.db) this.db = db; }

    private async createTable<T = any>(id: string, name: string): Promise<SubTable<T>> {
      await this.db.tableCreate('plugin_' + id + '_' + name, [{ name: 'key', type: 'string' }, { name: 'value', type: 'any' }]).run();
      return this.getTable(id, name);
    }

    private async dropTable(id: string, name: string): Promise<void> {
      await this.db.tableDrop('plugin_' + id + '_' + name).run();
    }

    private async listTables(id: string): Promise<string[]> {
      return this.db.tableList().filter(doc => doc.startsWith('plugin_' + id)).run();
    }

    private async getTable<T = any>(id: string, name: string): Promise<SubTable<T>> {
      return new SQLite3ReQLSubTable<T>(this.db.table('plugin_' + id + '_' + name));
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
  }();

  public users = new class SQLite3ReQLUsersCategory implements DbDriverUsersCategory {
    private table: Table<SerializedUser>;
    private metadataTable: Table<SerializedMetadataIndexEntry>;

    constructor(private logger: Logger) { }

    public async create(db: Database) {
      return db.tableCreate('users', [
        { name: 'address', type: 'string', index: true },
        { name: 'internalBucketAddress', type: 'string' },
        { name: 'defaultConnection', type: 'string' },
        { name: 'buckets', type: 'object', index: true }, // string[]
        { name: 'connectionIds', type: 'object' }, // string[]
        { name: 'connections', type: 'object' }
      ]).run().then(a => this.logger.info('Created table "users"!'));
    }

    public async init(table: Table<SerializedUser>, metadataTable: Table<SerializedMetadataIndexEntry>) {
      if(!this.table)
        this.table = table;
      if(!this.metadataTable)
        this.metadataTable = metadataTable;

      await this.table.indexList().run().then(async result => {
        if(!result.includes('address'))
          await this.table.indexCreate('address').run()
            .then(a => this.logger.info('Created address index in user table (api db).'));
        if(!result.includes('buckets'))
          await this.table.indexCreate('buckets').run()
            .then(a => this.logger.info('Created buckets index in user table (api db).'));
      });
    }

    public async register(address: string, bucketAddress = '') {
      const user = await this.table.get(address).run();

      console.log('user: ', user);
      if(!user)
        await this.table.insert(new User({ address, internalBucketAddress: bucketAddress }).serialize(), { conflict: 'replace' }).run();
      else
        return User.deserialize(user);

      return this.get(address);
    }

    public async delete(address: string) {
      await this.table.get(address).delete().run();
    }

    public async get(address: string) {
      const user = await this.table.get(address).run();
      return User.deserialize(user);
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
      await this.table.get(user.address).update(user.serialize()).run();
    }

    public async updateConnectionBuckets(connId: string, addresses: string[]) {
      await this.metadataTable.getAll(connId, { index: 'connId' }).filter(doc => {
        let q: Datum<boolean>;
        for(const addr of addresses) {
          if(!q)
            q = doc('path').startsWith(addr).not();
          else
            q = q.and(doc('path').startsWith(addr).not());
        }
        return q;
      }).delete().run();
    }
  }(this.logger);

  public metadata = new class SQLite3ReQLMetadataCategory implements DbDriverMetadataCategory {
    private table: Table<SerializedMetadataIndexEntry>;

    constructor(private logger: Logger) { }

    public async create(db: Database) {
      return db.tableCreate('metadata', [
        { name: 'key', type: 'string', index: true },
        { name: 'connId', type: 'string', index: true },
        { name: 'path', type: 'string', index: true }
      ]).run().then(a => this.logger.info('Created table "metadata"!'));
    }

    public async init(table: Table<SerializedMetadataIndexEntry>) {
      if(!this.table)
        this.table = table;

      await this.table.indexList().run().then(async result => {
        if(!result.includes('path'))
          await this.table.indexCreate('path').run()
            .then(a => this.logger.info('Created path index in metadata table (api db).'));
        if(!result.includes('connId'))
          await this.table.indexCreate('connId').run()
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
      const info = await this.table.filter(doc => {
        let query: Datum<boolean>;
        for(const connId in user.connections) if(user.connections[connId]) {
          if(!query)
            query = doc('connId').eq(connId);
          else
            query = query.or(doc('connId').eq(connId));
        }
        return query;
      }).run();
      const ret: ExpandedMetadataIndex = { };
      for(const i of info) {
        if(!ret[i.path])
          ret[i.path] = { };
        ret[i.path][i.connId] = metadataTrim(i);
      }
      return ret;
    }

    public async getForUser(user: User): Promise<MetadataIndex> {
      const info = await this.table.filter(doc => {
        let query: Datum<boolean>;
        for(const connId in user.connections) if(user.connections[connId]) {
          if(!query)
            query = doc('connId').eq(connId);
          else
            query = query.or(doc('connId').eq(connId));
        }
        return query;
      }).run();

      const oldestLatestModifiedDates: { [path: string]: { oldest: Date; latest: Date } } = { };
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
      const info = await this.table.filter(doc => doc('path').startsWith(bucket)).run();

      const oldestLatestModifiedDates: { [path: string]: { oldest: Date; latest: Date } } = { };
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
  }(this.logger);
}

export default new SQLite3ReQLDriver();
