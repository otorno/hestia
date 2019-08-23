import { getLogger } from 'log4js';
import { User } from '../data/user';
import { DbDriver, DbDriverSubCategory, DbDriverUsersCategory, DbDriverMetadataCategory, SubTable, SubDB } from '../data/db-driver';
import { ConnectionMetadataIndex, ExpandedMetadataIndex, Metadata, MetadataIndex } from '../data/metadata-index';
import Config from '../data/config';

interface DbDriverHandler {
  driver: DbDriver;
}

class DatabaseService implements DbDriver, DbDriverHandler {

  private logger = getLogger('services.db');

  private _driver: DbDriver;
  public get driver() { return this._driver; }

  public async init(config: Config) {
    let path = config.db_driver_path || 'default-db-drivers/sqlite3.js';
    if(path.startsWith('default-db-drivers'))
          path = '../' + path;
    const driver: DbDriver = (await import(path)).default;
    const initData = await driver.init(config.db_driver_config);
    this.logger.info('Initialized DB driver "' + initData.name + '"!');
    this._driver = driver;

    return initData;
  }

  public close() {
    return this.driver.close();
  }

  drivers = new class DbDriversCategory implements DbDriverSubCategory {
    constructor(private parent: DbDriverHandler) { }
    public getDB(id: string): SubDB { return this.parent.driver.drivers.getDB(id); }
  }(this);

  plugins = new class DbPluginsCategory implements DbDriverSubCategory {
    constructor(private parent: DbDriverHandler) { }
    public getDB(id: string): SubDB { return this.parent.driver.plugins.getDB(id); }
  }(this);

  users = new class DbUsersCategory implements DbDriverUsersCategory {
    constructor(private parent: DbDriverHandler) { }
    public async register(address: string, bucketAddress: string = ''): Promise<User> {
      return this.parent.driver.users.register(address, bucketAddress);
    }
    public async delete(address: string): Promise<void> {
      return this.parent.driver.users.delete(address);
    }
    public async get(address: string): Promise<User> {
      return this.parent.driver.users.get(address);
    }
    public async getFromBucket(bucketAddress: string): Promise<User> {
      return this.parent.driver.users.getFromBucket(bucketAddress);
    }
    public async getAll(): Promise<User[]> {
      return this.parent.driver.users.getAll();
    }
    public async update(user: User): Promise<void> {
      return this.parent.driver.users.update(user);
    }
    public async updateConnectionBuckets(connId: string, addresses: string[]): Promise<void> {
      return this.parent.driver.users.updateConnectionBuckets(connId, addresses);
    }
  }(this);

  metadata = new class DbMetadataCategory implements DbDriverMetadataCategory {
    constructor(private parent: DbDriverHandler) { }
    public async getForConnection(connId: string, bucket?: string): Promise<ConnectionMetadataIndex> {
      return this.parent.driver.metadata.getForConnection(connId, bucket);
    }
    public async getForUser(user: User): Promise<MetadataIndex> {
      return this.parent.driver.metadata.getForUser(user);
    }
    public async getForUserExpanded(user: User): Promise<ExpandedMetadataIndex> {
      return this.parent.driver.metadata.getForUserExpanded(user);
    }
    public async getForBucket(bucket: string): Promise<MetadataIndex> {
      return this.parent.driver.metadata.getForBucket(bucket);
    }
    public async getForFile(path: string, connId?: string): Promise<Metadata & { connIds: string[] }> {
      return this.parent.driver.metadata.getForFile(path, connId);
    }
    public async update(path: string, connId: string, metadata: Metadata): Promise<void> {
      return this.parent.driver.metadata.update(path, connId, metadata);
    }
    public async delete(path: string, connId: string): Promise<void> {
      return this.parent.driver.metadata.delete(path, connId);
    }
    public async deleteAllForConnection(connId: string): Promise<void> {
      return this.parent.driver.metadata.deleteAllForConnection(connId);
    }
  }(this);
}

export default new DatabaseService();
