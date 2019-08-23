import { User } from './user';
import { ConnectionMetadataIndex, MetadataIndex, ExpandedMetadataIndex, Metadata } from './metadata-index';

// for when we want to implement multi-table interfaces for plugins
// i.e. for when a plugin needs a table for each user or bucket (appDB, udb driver, etc)
export interface SubDB {
  createTable<T = any>(name: string): Promise<SubTable<T>>;
  dropTable(name: string): Promise<void>;
  listTables(): Promise<string[]>;
  getTable<T = any>(name: string): Promise<SubTable<T>>;
}

export interface SubTable<T = any> {
  get(key: string): Promise<T>;
  getAll(): Promise<{ key: string, value: T }[]>;
  set(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface DbDriverMetadataCategory {
  getForConnection(connId: string, bucket?: string): Promise<ConnectionMetadataIndex>;
  getForUser(user: User): Promise<MetadataIndex>;
  getForUserExpanded(user: User): Promise<ExpandedMetadataIndex>;
  getForBucket(bucket: string): Promise<MetadataIndex>;
  getForFile(path: string, connId?: string): Promise<Metadata & { connIds: string[] }>;
  update(path: string, connId: string, metadata: Metadata): Promise<void>;
  delete(path: string, connId: string): Promise<void>;
  deleteAllForConnection(connId: string): Promise<void>;
}

export interface DbDriverUsersCategory {
  register(address: string, bucketAddress?: string): Promise<User>;
  delete(address: string): Promise<void>;
  get(address: string): Promise<User>;
  getFromBucket(bucketAddress: string): Promise<User>;
  getAll(): Promise<User[]>;
  update(user: User): Promise<void>;
  updateConnectionBuckets(connId: string, addresses: string[]): Promise<void>;
}

export interface DbDriverSubCategory {
  getDB(id: string): SubDB;
}

export interface DbDriver {
  init(config: any): Promise<{ name: string }>;
  close(): Promise<void>;
  plugins: DbDriverSubCategory;
  drivers: DbDriverSubCategory;
  users: DbDriverUsersCategory;
  metadata: DbDriverMetadataCategory;
}
