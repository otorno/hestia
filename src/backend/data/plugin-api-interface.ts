import { NotFoundError, NotAllowedError } from './hestia-errors';
import { Readable } from 'stream';
import { PluginApiInterface } from './plugin';

import db from '../services/database-service';
import connections from '../services/connection-service';
import gaia from '../services/gaia-service';
import meta from '../services/meta-service';
import { Metadata } from './metadata-index';
import { User } from './user';

interface InternalPluginApiInterface {
  id: string;
}

export class PluginApi implements PluginApiInterface, InternalPluginApiInterface {

  private _id: string;
  public get id() { return this._id; }

  constructor(id: string) {
    this._id = id;
  }

  meta = Object.freeze({
    plugins(): { id: string, name: string }[] {
      return meta.plugins();
    },
    async drivers(userAddress?: string) {
      const user = await db.getUser(userAddress);
      if(!user)
        throw new NotFoundError(`No users found with address "${userAddress}"!`);
      return meta.drivers(user);
    },
    env(): string {
      return meta.env();
    },
    origin(): string {
      return meta.origin();
    }
  });

  gaia = Object.freeze({
    read(address: string, path: string) {
      return gaia.read(address, path);
    },
    store(address: string, path: string,
      data: { contentType: string, contentLength: number, stream: Readable }): Promise<Error[]> {
      return gaia.store(address, path, data);
    },
    delete(address: string, path: string): Promise<Error[]> {
      return gaia.delete(address, path);
    },
    listFiles(address: string, page?: number) {
      return gaia.listFiles(address, page);
    }
  });

  db = new class PluginDbApi {

    constructor(private parent: InternalPluginApiInterface) { }

    async getUser(address: string) {
      return db.getUser(address);
    }

    async getUserFromBucket(address: string) {
      return db.getUserFromBucket(address);
    }

    async getAllUsers() {
      return db.getAllUsers();
    }

    // metadata

    async getIndexForConnection(connId: string, bucket?: string) {
      return db.getIndexForConnection(connId, bucket);
    }

    async getGlobalUserIndex(user: User) {
      return db.getGlobalUserIndex(user);
    }

    async getUserIndex(user: User) {
      return db.getUserIndex(user);
    }

    async getFileInfo(path: string, connId?: string) {
      return db.getFileInfo(path, connId);
    }

    async updateIndex(path: string, connId: string, metadata: Metadata) {
      await db.updateIndex(path, connId, metadata);
    }

    async deleteIndex(path: string, connId: string) {
      await db.deleteIndex(path, connId);
    }

    // plugin data storage

    async init() {
      await db.ensurePluginTable(this.parent.id);
    }

    async getAll() {
      return db.getPluginTable(this.parent.id).run();
    }

    async get<T = any>(key: string): Promise<T> {
      return db.getPluginTable(this.parent.id).get(key).run();
    }

    async set(key: string, value: any) {
      await db.getPluginTable(this.parent.id).insert({ key, value }, { conflict: 'replace' }).run();
    }

    async delete(key: string) {
      await db.getPluginTable(this.parent.id).get(key).delete().run();
    }
  }(this);

  connections = Object.freeze({
    async read(id: string, userAddress: string, address: string, path: string) {
      const user = await db.getUser(userAddress);
      if(!user)
        throw new NotFoundError(`No users found with address "${userAddress}"!`);

      return connections.read(id, user, address, path);
    },
    async store(id: string, userAddress: string, address: string, path: string,
      data: { contentType: string, contentLength: number, stream: Readable }): Promise<void> {

      const user = await db.getUser(userAddress);
      if(!user)
        throw new NotFoundError(`No users found with address "${userAddress}"!`);

      return connections.store(id, user, address, path, data);
    },
    async delete(id: string, userAddress: string, address: string, path: string): Promise<void> {
      const user = await db.getUser(userAddress);
      if(!user)
        throw new NotFoundError(`No users found with address "${userAddress}"!`);

      return connections.delete(id, user, address, path);
    },
    async listFiles(id: string, userAddress: string, path?: string, page?: number) {
      const user = await db.getUser(userAddress);
      if(!user)
        throw new NotFoundError(`No users found with address "${userAddress}"!`);

      return connections.listFiles(id, user, path, page);
    },
    async getInfo(id: string, userAddress: string) {
      const user = await db.getUser(userAddress);
      if(!user)
        throw new NotFoundError(`No users found with address "${userAddress}"!`);

      return connections.getInfo(id, user);
    },
    async setDefault(id: string, userAddress: string): Promise<void> {
      const user = await db.getUser(userAddress);
      if(!user)
        throw new NotFoundError(`No users found with address "${userAddress}"!`);

      return connections.setDefault(id, user);
    },
    async setBuckets(id: string, userAddress: string, addresses: string[]): Promise<void> {
      const user = await db.getUser(userAddress);
      if(!user)
        throw new NotFoundError(`No users found with address "${userAddress}"!`);

      return connections.setBuckets(id, user, addresses);
    }
  });
}

export default PluginApi;
