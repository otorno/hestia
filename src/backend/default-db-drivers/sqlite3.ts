import { Database, Statement, verbose } from 'sqlite3';
import { getLogger, Logger } from '@log4js-node/log4js-api';
import { NotFoundError } from '../data/hestia-errors';
import { User } from '../data/user';
import { ConnectionMetadataIndex, ExpandedMetadataIndex, Metadata, MetadataIndex } from '../data/metadata-index';
import { DbDriver, DbDriverSubCategory, DbDriverUsersCategory, DbDriverMetadataCategory, SubTable } from '../data/db-driver';

interface SQLite3Config {
  filename?: string; // (optional) the filename of the database to use
                     // default is `hestia-db.sqlite`
}

class SQLite3Database {
  private db: Database;
  private logger: Logger;

  private constructor() { }
  public static async create(filename: string, logger: Logger) {
    const ret = new SQLite3Database();
    ret.logger = logger;
    await new Promise((resolve, reject) => {
      ret.db = new Database(filename, err => err ? reject(err) : resolve());
    });
    return ret;
  }

  public close(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.db.close((err) => err ? reject(err) : resolve());
    });
  }

  public configure(option: 'trace' | 'profile', cb: (val?: any) => void): void;
  public configure(option: 'busyTimeout', value: number): void;
  public configure(option: string, value: any) {
    this.db.configure(option as any, value);
  }

  public run(sql: string, params?: { [key: string]: any }): Promise<void> {
    this.logger.trace('run ' + sql);
    return new Promise<void>((resolve, reject) => {
      this.db.run(sql, params || [], (err) => err ? reject(err) : resolve());
    });
  }

  public get<T = any>(sql: string, params?: { [key: string]: any }): Promise<T> {
    this.logger.trace('get ' + sql);
    return new Promise<T>((resolve, reject) => {
      this.db.get(sql, params || [], (err, row) => err ? reject(err) : resolve(row));
    });
  }

  public all<T = any>(sql: string, params?: { [key: string]: any }): Promise<T[]> {
    this.logger.trace('all ' + sql);
    return new Promise<T[]>((resolve, reject) => {
      this.db.all(sql, params || [], (err, rows) => err ? reject(err) : resolve(rows));
    });
  }

  public each<T = any>(cb: (row: T) => void, sql: string, params?: { [key: string]: any }): Promise<number> {
    this.logger.trace('each ' + sql);
    return new Promise<number>((resolve, reject) => {
      this.db.each(sql, params || [], (err, row) => !err && cb(row), (err, count) => err ? reject(err) : resolve(count));
    });
  }

  public exec(sql: string): Promise<void> {
    this.logger.trace('exec ' + sql);
    return new Promise<void>((resolve, reject) => {
      this.db.exec(sql, (err) => err ? reject(err) : resolve());
    });
  }

  public prepare(sql: string, params?: { [key: string]: any }): Promise<SQLite3Statement> {
    this.logger.trace('prepare ' + sql);
    return new Promise<SQLite3Statement>((resolve, reject) => {
      let e: Error;
      const statement = this.db.prepare(sql, params || [], (err) => err && reject(e = err));
      if(!e)
        resolve(new SQLite3Statement(statement));
    });
  }
}

class SQLite3Statement {
  locked = false;

  constructor(private statement: Statement) { }

  public bind(params: { [key: string]: any }): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.statement.bind(params, (err) => err ? reject(err) : resolve());
    });
  }

  public reset(): Promise<void> {
    return new Promise<void>(resolve => {
      this.statement.reset(() => resolve());
    });
  }

  public async finalize(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.statement.finalize((err) => err ? reject(err) : resolve());
    });
    this.locked = true;
  }

  public run(params?: { [key: string]: any }): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.statement.run(params || [], (err) => err ? reject(err) : resolve());
    });
  }

  public get<T = any>(params?: { [key: string]: any }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.statement.get(params || [], (err, row) => err ? reject(err) : resolve(row));
    });
  }

  public all<T = any>(params?: { [key: string]: any }): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
      this.statement.all(params || [], (err, rows) => err ? reject(err) : resolve(rows));
    });
  }

  public each<T = any>(cb: (row: T) => void, params?: { [key: string]: any }): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.statement.each(params || [], (err, row) => !err && cb(row), (err, count) => err ? reject(err) : resolve(count));
    });
  }
}

interface SerializedMetadataIndexEntry {
  // primary key
  key: string; // path + ':' + connId
  // secondary key
  path: string;
  // secondary key
  connId: string;
  contentType: string;
  size: number; // int
  hash: string;
  lastModified: number; // int
}

function createMetadata(metadata: { contentType: string;
  size: number; // int
  hash: string;
  lastModified: number;
}): Metadata {
  return {
    contentType: metadata.contentType,
    size: metadata.size,
    hash: metadata.hash,
    lastModified: new Date(metadata.lastModified)
  };
}

class SQLite3SubTable {
  private _get: SQLite3Statement;
  private _getAll: SQLite3Statement;
  private _set: SQLite3Statement;
  private _delete: SQLite3Statement;

  static async create(db: SQLite3Database, table: string) {
    const ret = new SQLite3SubTable();
    ret._get = await db.prepare(`SELECT value FROM ${table} WHERE key = $key`);
    ret._getAll = await db.prepare(`SELECT * FROM ${table}`);
    ret._set = await db.prepare(`INSERT OR REPLACE INTO ${table} (key, value) VALUES ($key, $value)`);
    ret._delete = await db.prepare(`DELETE FROM ${table} WHERE key = $key`);
    return ret;
  }
  async get<T = any>(key: string): Promise<T> {
    return this._get.get<{ key: string, value: string }>({ $key: key }).then(obj => obj && obj.value ? JSON.parse(obj.value) : undefined);
  }

  async getAll<T = any>(): Promise<{ key: string, value: T }[]> {
    return this._getAll.all<{ key: string, value: string }>().then(v => v ? v.map(a => ({ key: a.key, value: JSON.parse(a.value) })) : []);
  }

  async set(key: string, value: any) {
    await this._set.run({ $key: key, $value: JSON.stringify(value) });
  }

  async delete(key: string) {
    await this._delete.run({ $key: key });
  }
}

class SQLite3Driver implements DbDriver {
  private logger = getLogger('services.db.sqlite3');
  private db: SQLite3Database;

  async init(config?: SQLite3Config) {
    config = Object.assign({ filename: 'hestia-db.sqlite' }, config);
    if(process.env.NODE_ENV !== 'production')
      verbose();
    this.db = await SQLite3Database.create(config.filename, this.logger);
    await this.drivers.init(this.db);
    await this.plugins.init(this.db);
    await this.users.init(this.db);
    await this.metadata.init(this.db);
    return { name: 'SQLite3' };
  }

  public close() {
    return this.db.close();
  }

  plugins = new class SQLite3PluginsCategory implements DbDriverSubCategory {
    private db: SQLite3Database;

    async init(db: SQLite3Database) {
      this.db = db;
    }

    public async ensureTable(id: string): Promise<void> {
      await this.db.exec(`CREATE TABLE IF NOT EXISTS [plugin_${id}] (key text primary key, value text)`);
      await this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS [plugin_${id}_key_index] ON [plugin_${id}] (key)`);
    }

    public async getTable(id: string): Promise<SubTable> {
      return SQLite3SubTable.create(this.db, `[plugin_${id}]`);
    }
  };

  drivers = new class SQLite3DriversCategory implements DbDriverSubCategory {
    private db: SQLite3Database;

    async init(db: SQLite3Database) {
      this.db = db;
    }

    public async ensureTable(id: string): Promise<void> {
      await this.db.exec(`CREATE TABLE IF NOT EXISTS [driver_${id}] (key text primary key, value text)`);
      await this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS [driver_${id}_key_index] ON [driver_${id}] (key)`);
    }

    public async getTable(id: string): Promise<SubTable> {
      return SQLite3SubTable.create(this.db, `[driver_${id}]`);
    }
  };

  users = new class SQLite3UsersCategory implements DbDriverUsersCategory {
    private db: SQLite3Database;

    async init(db: SQLite3Database) {
      await db.exec(`CREATE TABLE IF NOT EXISTS users (address text primary key, internalBucketAddress text, defaultConnection text)`);
      await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS user_address_index ON users (address)`);

      await db.exec(`CREATE TABLE IF NOT EXISTS bucket_user_map (bucket text primary key, user text)`);
      await db.exec(`CREATE INDEX IF NOT EXISTS bucket_user_index ON bucket_user_map (user)`);

      await db.exec(`CREATE TABLE IF NOT EXISTS conn_user_map (connId text primary key, user text, connData text)`);
      await db.exec(`CREATE INDEX IF NOT EXISTS conn_user_index ON conn_user_map (user)`);

      this.db = db;
    }

    public async register(address: string, bucketAddress: string = ''): Promise<User> {
      const count: number = await this.db.get<{
        'COUNT(*)': number
      }>(`SELECT COUNT(*) FROM users WHERE address = "${address}"`).then(a => a ? a['COUNT(*)'] : 0);
      if(count > 1)
        throw new Error('More than one user with address ' + address + '!');
      else if(count < 1)
        await this.db.exec(`INSERT INTO users (address, internalBucketAddress, defaultConnection)`
          + ` VALUES ("${address}", "${bucketAddress}", "")`);
      return this.get(address);
    }

    public async delete(address: string): Promise<void> {
      await this.db.exec(`DELETE FROM users WHERE address = "${address}"`);
      await this.db.exec(`DELETE FROM bucket_user_map WHERE user = "${address}"`);
      await this.db.exec(`DELETE FROM conn_user_map WHERE user = "${address}"`);
    }

    public async get(address: string): Promise<User> {

      const user = await this.db.get<{
        address: string,
        internalBucketAddress: string,
        defaultConnection: string,
      }>(`SELECT * FROM users WHERE address = "${address}"`);

      if(!user)
        throw new NotFoundError('No user found with address "' + address + '"!');

      const conns = await this.db.all<{
        connId: string,
        connData: string
      }>(`SELECT connId, connData FROM conn_user_map WHERE user = "${address}"`);

      const buckets = await this.db.all<{
        bucket: string
      }>(`SELECT bucket FROM bucket_user_map WHERE user = "${address}"`);

      return User.deserialize({
        address: user.address,
        internalBucketAddress: user.internalBucketAddress,
        defaultConnection: user.defaultConnection,
        buckets: buckets.map(a => a.bucket),
        connectionIds: conns.map(a => a.connId),
        connections: conns.map(a => JSON.parse(a.connData))
      });
    }

    public async getFromBucket(bucketAddress: string): Promise<User> {
      const userAddress = await this.db.get<{
        user: string
      }>(`SELECT user FROM bucket_user_map WHERE bucket = "${bucketAddress}"`).then(a => a && a.user);
      if(!userAddress)
        throw new NotFoundError('No user found with bucket address "' + bucketAddress + '"!');
      return this.get(userAddress); // talk about l a z y
    }

    public async getAll(): Promise<User[]> {
      const users = await this.db.all<{
        address: string,
        internalBucketAddress: string,
        defaultConnection: string
      }>(`SELECT * FROM users`);

      const conns = await this.db.all<{
        connId: string,
        user: string,
        connData: string
      }>(`SELECT * FROM conn_user_map`);

      const buckets = await this.db.all<{
        bucket: string,
        user: string
      }>(`SELECT * FROM bucket_user_map`);

      return users.map(u => {
        const uconns = conns.filter(c => c.user === u.address);
        const ubuckets = buckets.filter(b => b.user === u.address);
        return User.deserialize({
          address: u.address,
          internalBucketAddress: u.internalBucketAddress,
          defaultConnection: u.defaultConnection,
          buckets: ubuckets.map(a => a.bucket),
          connectionIds: uconns.map(a => a.connId),
          connections: uconns.map(a => JSON.parse(a.connData))
        });
      });
    }
    public async update(user: User): Promise<void> {
      const suser = user.serialize();
      const address = suser.address;
      await this.db.run(`UPDATE users SET internalBucketAddress = "${suser.internalBucketAddress}",`
      + ` defaultConnection = "${suser.defaultConnection}" WHERE address = "${address}"`);

      // get current buckets
      const cbuckets = await this.db.all<{
        bucket: string
      }>(`SELECT bucket FROM bucket_user_map WHERE user = "${address}"`).then(v => v ? v.map(a => a.bucket) : []);

      // new buckets
      for(const nbucket of suser.buckets.filter(a => !cbuckets.includes(a)))
        await this.db.exec(`INSERT OR IGNORE INTO bucket_user_map (bucket, user) VALUES ("${nbucket}", "${address}")`);

      // old buckets
      for(const obucket of cbuckets.filter(a => !suser.buckets.includes(a)))
        await this.db.exec(`DELETE FROM bucket_user_map WHERE bucket = "${obucket}"`);

      // get current conns
      const cconns = await this.db.all<{
        connId: string,
        connData: string
      }>(`SELECT connId, connData FROM conn_user_map WHERE user = "${address}"`);
      const cconnIds = cconns.map(a => a.connId);

      const suserConns = suser.connectionIds.map((a, i) => ({ connId: a, connData: JSON.stringify(suser.connections[i]) }));

      // new conns
      for(const nconn of suserConns.filter(c => !cconnIds.includes(c.connId)))
        await this.db.run(`INSERT OR REPLACE INTO conn_user_map (connId, user, connData) VALUES`
          + ` ("${nconn.connId}", "${address}", $connData)`, { $connData: nconn.connData });
      // modified conns
      for(const mconn of suserConns.filter(c => cconns.find(a => a.connId === c.connId && a.connData !== c.connData)))
        await this.db.run(`UPDATE conn_user_map SET connData = $connData WHERE connId = "${mconn.connId}"`, { $connData: mconn.connData });
      // removed conns
      for(const oconn of cconns.filter(c => !suser.connectionIds.includes(c.connId)))
        await this.db.exec(`DELETE FROM conn_user_map WHERE connId = "${oconn.connId}"`);
    }
    public async updateConnectionBuckets(connId: string, addresses: string[]): Promise<void> {
      // select all metadata where connId exists and where address does not exist in the new array -- and Belete
      let query = `DELETE FROM metadata WHERE connId = "${connId}"`;
      for(const a of addresses)
        query += ` AND path NOT LIKE "${a}%"`; // wack
      await this.db.exec(query);
    }
  };

  metadata = new class SQLite3MetadataCategory implements DbDriverMetadataCategory {

    private db: SQLite3Database;

    async init(db: SQLite3Database) {
      await db.exec(`CREATE TABLE IF NOT EXISTS metadata (key text primary key, connId text, path text,`
        + ` contentType text, size integer, hash text, lastModified number)`);
      await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS metadata_key_index ON metadata (key)`);
      await db.exec(`CREATE INDEX IF NOT EXISTS metadata_connId_index ON metadata (connId)`);
      await db.exec(`CREATE INDEX IF NOT EXISTS metadata_path_index ON metadata (path)`);
      this.db = db;
    }

    public async getForConnection(connId: string, bucket?: string): Promise<ConnectionMetadataIndex> {
      const data = await this.db.all<SerializedMetadataIndexEntry>(`SELECT * FROM metadata WHERE`
        + ` connId = "${connId}"` + (bucket ? ` AND path LIKE "${bucket}%"` : ''));
      const ret: ConnectionMetadataIndex = { };
      for(const entry of data) {
        ret[entry.path] = {
          contentType: entry.contentType,
          size: entry.size,
          hash: entry.hash,
          lastModified: new Date(entry.lastModified)
        };
      }
      return ret;
    }

    public async getForUser(user: User): Promise<MetadataIndex> {

      let query = `SELECT * FROM metadata WHERE`;
      const startLen = query.length;

      for(const connId in user.connections) if(user.connections[connId])
        query += ` connId = "${connId}" OR`;

      query = query.slice(0, -3);

      if(query.length <= startLen)
        throw new Error('Error creating query; no connections (I think).');

      const data = await this.db.all<SerializedMetadataIndexEntry>(query);

      const oldestLatestModifiedDates: { [path: string]: { oldest: number, latest: number } } = { };
      const ret: MetadataIndex = { };
      for(const entry of data) {
        if(!ret[entry.path]) {
          ret[entry.path] = { connIds: [entry.connId], ...createMetadata(entry) };
          oldestLatestModifiedDates[entry.path] = { oldest: entry.lastModified, latest: entry.lastModified };
          // same hash
        } else if(ret[entry.path].hash === entry.hash) {
          ret[entry.path].connIds.push(entry.connId);

          if(oldestLatestModifiedDates[entry.path].latest < entry.lastModified) {
            oldestLatestModifiedDates[entry.path].latest = entry.lastModified;

          } else if(oldestLatestModifiedDates[entry.path].oldest > entry.lastModified) {
            oldestLatestModifiedDates[entry.path].oldest = entry.lastModified;
            ret[entry.path].lastModified = new Date(entry.lastModified);
          }
          // different hash and newer
        } else if(oldestLatestModifiedDates[entry.path].latest < entry.lastModified) {
          ret[entry.path] = { connIds: [entry.connId], ...createMetadata(entry) };
          oldestLatestModifiedDates[entry.path] = { oldest: entry.lastModified, latest: entry.lastModified };
        }
      }

      return ret;
    }

    public async getForUserExpanded(user: User): Promise<ExpandedMetadataIndex> {
      let query = `SELECT * FROM metadata WHERE`;
      const startLen = query.length;

      for(const connId in user.connections) if(user.connections[connId])
        query += ` connId = "${connId}" OR`;

      query = query.slice(0, -3);

      if(query.length <= startLen)
        throw new Error('Error creating query; no connections (I think).');

      const data = await this.db.all<SerializedMetadataIndexEntry>(query);

      const ret: ExpandedMetadataIndex = { };
      for(const entry of data) {
        if(!ret[entry.path])
          ret[entry.path] = { };
        ret[entry.path][entry.connId] = createMetadata(entry);
      }
      return ret;
    }

    public async getForBucket(bucket: string): Promise<MetadataIndex> {
      const data = await this.db.all<SerializedMetadataIndexEntry>(`SELECT * FROM metadata WHERE path LIKE "${bucket}%"`);
      const oldestLatestModifiedDates: { [path: string]: { oldest: number, latest: number } } = { };
      const ret: MetadataIndex = { };
      for(const entry of data) {
        // new
        if(!ret[entry.path]) {
          ret[entry.path] = { connIds: [entry.connId], ...createMetadata(entry) };
          oldestLatestModifiedDates[entry.path] = { oldest: entry.lastModified, latest: entry.lastModified };
          // same hash
        } else if(ret[entry.path].hash === entry.hash) {
          ret[entry.path].connIds.push(entry.connId);

          if(oldestLatestModifiedDates[entry.path].latest < entry.lastModified) {
            oldestLatestModifiedDates[entry.path].latest = entry.lastModified;

          } else if(oldestLatestModifiedDates[entry.path].oldest > entry.lastModified) {
            oldestLatestModifiedDates[entry.path].oldest = entry.lastModified;
            ret[entry.path].lastModified = new Date(entry.lastModified);
          }
          // different hash and newer
        } else if(oldestLatestModifiedDates[entry.path].latest < entry.lastModified) {
          ret[entry.path] = { connIds: [entry.connId], ...createMetadata(entry) };
          oldestLatestModifiedDates[entry.path] = { oldest: entry.lastModified, latest: entry.lastModified };
        }
      }
      return ret;
    }

    public async getForFile(path: string, connId?: string): Promise<Metadata & { connIds: string[] }> {
      if(connId) {
        const data = await this.db.get<SerializedMetadataIndexEntry>(`SELECT * FROM metadata WHERE key = "${path}:${connId}"`);
        return { connIds: [connId], ...createMetadata(data) };
      } else {
        // ignore deleted files
        const data = await this.db.all<SerializedMetadataIndexEntry>(`SELECT * FROM metadata WHERE path = "${path}" AND size > 0`);
        if(data.length < 1) {
          throw new NotFoundError('File with path ' + path + ' does not exist in the index!');

        } else if(data.length === 1) {
          return { connIds: [data[0].connId], ...createMetadata(data[0]) };

        } else {
          let latest = data[0];
          for(const entry of data)
            if(entry.lastModified > latest.lastModified)
              latest = entry;
          const entries = data.filter(a => a.hash === latest.hash);

          let oldestTimestamp = entries[0].lastModified;
          for(const e of entries)
            if(e.lastModified < oldestTimestamp)
              oldestTimestamp = e.lastModified;

          latest.lastModified = oldestTimestamp;
          return Object.assign({ connIds: entries.map(e => e.connId) }, createMetadata(latest));
        }
      }
    }

    public async update(path: string, connId: string, metadata: Metadata): Promise<void> {
      await this.db.exec(`INSERT OR REPLACE INTO metadata (key, path, connId, contentType, hash, lastModified, size)`
      + ` VALUES ("${path}:${connId}", "${path}", "${connId}", "${metadata.contentType}", "${metadata.hash}",`
      + ` "${metadata.lastModified.getTime()}", "${metadata.size}")`);
    }

    public async delete(path: string, connId: string): Promise<void> {
      await this.db.exec(`DELETE FROM metadata WHERE key = "${path}:${connId}"`);
    }

    public async deleteAllForConnection(connId: string): Promise<void> {
      await this.db.exec(`DLETE FROM metadata WHERE connId = "${connId}"`);
    }
  };
}

export default new SQLite3Driver();
