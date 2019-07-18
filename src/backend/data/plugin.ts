import { Readable } from 'stream';
import { Router } from 'express';
import { User } from './user';
import { Metadata, ConnectionMetadataIndex, GlobalMetadataIndex, MetadataIndex } from './metadata-index';

export interface PluginInfo {
  id: string;
  longId: string;
  name: string;
  router?: Router;
  authedRouter?: Router;
}

export interface PluginApiInterface {
  meta: {
    plugins(): { id: string, name: string }[];
    drivers(): Promise<{
      available: { id: string, name: string, rootOnly?: boolean, multi?: boolean }[]
    }>;
    drivers(userAddress: string): Promise<{
      current: { id: string, name: string, driver: string, rootOnly?: boolean, default?: boolean, buckets: string[] }[],
      available: { id: string, name: string, rootOnly?: boolean, multi?: boolean }[]
    }>;
    env(): string;
    origin(): string;
  };
  gaia: {
    read(address: string, path: string): Promise<{ contentType: string, stream: Readable }>;
    store(address: string, path: string,
      data: { contentType: string, contentLength: number, stream: Readable }, user?: User): Promise<Error[]>;
    delete(address: string, path: string): Promise<Error[]>;
    listFiles(address: string, page?: number): Promise<{ entries: string[], page?: number }>;
  };
  db: {
    // user
    getUser(address: string): Promise<User>;
    getUserFromBucket(address: string): Promise<User>;
    getAllUsers(): Promise<User[]>;
    // metadata
    getUserIndex(user: User): Promise<MetadataIndex>;
    getIndexForConnection(connId: string, bucket?: string): Promise<ConnectionMetadataIndex>;
    getGlobalUserIndex(user: User): Promise<GlobalMetadataIndex>;
    getFileInfo(path: string, connId?: string): Promise<Metadata & { connIds: string[] }>;
    updateIndex(path: string, connId: string, metadata: Metadata): Promise<void>;
    deleteIndex(path: string, connId: string): Promise<void>;
    // plugin storage
    init(): Promise<void>;
    set(key: string, value: any): Promise<void>;
    get<T = any>(key: string): Promise<T>;
    getAll(): Promise<{ key: string, value: any }[]>;
    delete(key: string): Promise<void>;
  };
  connections: {
    read(id: string, userAddress: string, address: string, path: string): Promise<{ contentType: string, stream: Readable }>;
    store(id: string, userAddress: string, address: string, path: string,
      data: { contentType: string, contentLength: number, stream: Readable }): Promise<void>;
    delete(id: string, userAddress: string, address: string, path: string): Promise<void>;
    listFiles(id: string, userAddress: string, path?: string, page?: number): Promise<{
      entries: { path: string, size: number }[],
      page?: number
    }>;

    getInfo(id: string, userAddress: string): Promise<{ spaceUsed: number, spaceAvailable?: number }>;
    setDefault(id: string, userAddress: string): Promise<void>;
    setBuckets(id: string, userAddress: string, addresses: string[]): Promise<void>;
  };
}

export interface Plugin {

  beforeStore?(options: {
    path: string
    storageTopLevel: string
    contentType: string
    contentLength: number
    stream: Readable
  }): Promise<{
    path: string
    storageTopLevel: string
    contentType: string
    contentLength: number
    stream: Readable
  }>;

  afterStore?(options: {
    path: string
    storageTopLevel: string
    contentType: string
    contentLength: number
  }): Promise<string>;

  beforeRead?(options: { path: string, storageTopLevel: string }): Promise<{ path: string, storageTopLevel: string }>;
  afterRead?(options: { stream: Readable, contentType: string }): Promise<{ stream: Readable, contentType: string }>;

  init(id: string, config: any, apiInterface: PluginApiInterface): Promise<{
    name: string,
    longId: string,
    router?: Router,
    authedRouter?: Router
  }>;

  getInfo?(): any;

  /**
   * Ticks each 500ms unless the promise hasn't returned yet, in which case it doesn't fire.
   */
  tick?(): Promise<void>;
}
