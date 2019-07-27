import { User } from './user';
import { ConnectionMetadataIndex, MetadataIndex, ExpandedMetadataIndex, Metadata } from './metadata-index';

export interface SubTable {
  get<T = any>(key: string): Promise<T>;
  getAll<T = any>(): Promise<{ key: string, value: T }[]>;
  set(key: string, value: any): Promise<void>;
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
  ensureTable(id: string): Promise<void>;
  getTable(id: string): Promise<SubTable>;
}

export interface DbDriver {
  init(config: any): Promise<{ name: string }>;
  close(): Promise<void>;
  plugins: DbDriverSubCategory;
  drivers: DbDriverSubCategory;
  users: DbDriverUsersCategory;
  metadata: DbDriverMetadataCategory;
}
