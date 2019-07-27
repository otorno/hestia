import { Readable } from 'stream';
import { Router } from 'express';
import { User } from './user';
import { Metadata, ConnectionMetadataIndex, ExpandedMetadataIndex, MetadataIndex } from './metadata-index';
import { ListFilesResponse } from './driver';

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
    read(address: string, path: string): Promise<{ contentType: string } & ({ stream: Readable } | { redirectUrl: string })>;
    store(address: string, path: string,
      data: { contentType: string, contentLength: number, stream: Readable }, userAddress?: string): Promise<Error[]>;
    delete(address: string, path: string): Promise<Error[]>;
    listFiles<State extends boolean>(address: string, options?: { page?: number, state?: State },
      userAddress?: string): Promise<ListFilesResponse<State>>;
  };
  db: {
    // user
    users: {
      get(address: string): Promise<User>;
      getFromBucket(address: string): Promise<User>;
      getAll(): Promise<User[]>;
    }

    // metadata
    metadata: {
      getForUser(userAddress: string): Promise<MetadataIndex>;
      getForConnection(connId: string, bucket?: string): Promise<ConnectionMetadataIndex>;
      getForUserExpanded(userAddress: string): Promise<ExpandedMetadataIndex>;
      getForFile(path: string, connId?: string): Promise<Metadata & { connIds: string[] }>;
      update(path: string, connId: string, metadata: Metadata): Promise<void>;
      delete(path: string, connId: string): Promise<void>;
    }

    // plugin storage
    plugin: {
      init(): Promise<void>;
      set(key: string, value: any): Promise<void>;
      get<T = any>(key: string): Promise<T>;
      getAll(): Promise<{ key: string, value: any }[]>;
      delete(key: string): Promise<void>;
    }
  };
  connections: {
    read(id: string, userAddress: string, address: string, path: string): Promise<Metadata &
      ({ stream: Readable } | { redirectUrl: string })>;
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
  afterRead?(options: { stream: Readable }): Promise<{ stream: Readable }>;

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
