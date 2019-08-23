import { NotFoundError, NotAllowedError } from './hestia-errors';
import { Readable } from 'stream';
import { PluginApiInterface } from './plugin';

import db from '../services/database-service';
import connections from '../services/connection-service';
import gaia from '../services/gaia-service';
import meta from '../services/meta-service';
import { Metadata } from './metadata-index';
import { SubDB } from './db-driver';
import { User } from './user';

interface InternalPluginApiInterface {
  id: string;
}

export class PluginApi implements PluginApiInterface, InternalPluginApiInterface {

  private _id: string;
  public get id() { return this._id; }

  constructor(id: string) {
    this._id = id;
    this.db.plugin = db.plugins.getDB(id);
  }

  meta = Object.freeze({
    plugins(): { id: string, name: string }[] {
      return meta.plugins();
    },
    async drivers(userAddress?: string) {
      const user = await db.users.get(userAddress);
      if(!user)
        throw new NotFoundError(`No users found with address "${userAddress}"!`);
      return meta.drivers(user);
    },
    env(): string {
      return meta.env();
    },
    origin(): string {
      return meta.origin();
    },
    host(): string {
      return meta.host();
    }
  });

  gaia = Object.freeze({
    read(address: string, path: string) {
      return gaia.read(address, path);
    },
    async store(address: string, path: string,
      data: { contentType: string, contentLength: number, stream: Readable }, userAddress?: string): Promise<Error[]> {
      const user = userAddress ? await db.users.get(userAddress) : null;
      return gaia.store(address, path, data, user);
    },
    delete(address: string, path: string): Promise<Error[]> {
      return gaia.delete(address, path);
    },
    async listFiles<State extends boolean>(address: string, options?: { page?: number, state?: State }, userAddress?: string) {
      let user: User;
      if(userAddress)
        user = await db.users.get(userAddress);
      return gaia.listFiles<State>(address, options, user);
    }
  });

  db = new class PluginDbApi {

    constructor(private parent: InternalPluginApiInterface) { }

    plugin: SubDB;

    users = new class {
      constructor(private parent: InternalPluginApiInterface) { }
      async get(address: string) {
        return db.users.get(address);
      }

      async getFromBucket(address: string) {
        return db.users.getFromBucket(address);
      }

      async getAll() {
        return db.users.getAll();
      }
    }(this.parent);

    // metadata
    metadata = new class {
      constructor(private parent: InternalPluginApiInterface) { }
      async getForConnection(connId: string, bucket?: string) {
        return db.metadata.getForConnection(connId, bucket);
      }

      async getForUserExpanded(userAddress: string) {
        return db.metadata.getForUserExpanded(await db.users.get(userAddress));
      }

      async getForUser(userAddress: string) {
        return db.metadata.getForUser(await db.users.get(userAddress));
      }

      async getForFile(path: string, connId?: string) {
        return db.metadata.getForFile(path, connId);
      }

      async update(path: string, connId: string, metadata: Metadata) {
        await db.metadata.update(path, connId, metadata);
      }

      async delete(path: string, connId: string) {
        await db.metadata.delete(path, connId);
      }
    }(this.parent);
  }(this);

  connections = Object.freeze({
    async read(id: string, userAddress: string, address: string, path: string) {
      const user = await db.users.get(userAddress);
      if(!user)
        throw new NotFoundError(`No users found with address "${userAddress}"!`);

      return connections.read(id, user, address, path);
    },
    async store(id: string, userAddress: string, address: string, path: string,
      data: { contentType: string, contentLength: number, stream: Readable }): Promise<void> {

      const user = await db.users.get(userAddress);
      if(!user)
        throw new NotFoundError(`No users found with address "${userAddress}"!`);

      return connections.store(id, user, address, path, data);
    },
    async delete(id: string, userAddress: string, address: string, path: string): Promise<void> {
      const user = await db.users.get(userAddress);
      if(!user)
        throw new NotFoundError(`No users found with address "${userAddress}"!`);

      return connections.delete(id, user, address, path);
    },
    async listFiles(id: string, userAddress: string, path?: string, page?: number) {
      const user = await db.users.get(userAddress);
      if(!user)
        throw new NotFoundError(`No users found with address "${userAddress}"!`);

      return connections.listFiles(id, user, path, page);
    },
    async getInfo(id: string, userAddress: string) {
      const user = await db.users.get(userAddress);
      if(!user)
        throw new NotFoundError(`No users found with address "${userAddress}"!`);

      return connections.getInfo(id, user);
    },
    async setDefault(id: string, userAddress: string): Promise<void> {
      const user = await db.users.get(userAddress);
      if(!user)
        throw new NotFoundError(`No users found with address "${userAddress}"!`);

      return connections.setDefault(id, user);
    },
    async setBuckets(id: string, userAddress: string, addresses: string[]): Promise<void> {
      const user = await db.users.get(userAddress);
      if(!user)
        throw new NotFoundError(`No users found with address "${userAddress}"!`);

      return connections.setBuckets(id, user, addresses);
    }
  });
}

export default PluginApi;
