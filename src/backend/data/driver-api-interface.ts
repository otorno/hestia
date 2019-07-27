import { DriverApiInterface } from './driver';

import db from '../services/database-service';
import meta from '../services/meta-service';
import { SubTable } from './db-driver';

interface InternalDriverApiInterface {
  id: string;
}

export class DriverApi implements InternalDriverApiInterface, DriverApiInterface {

  private _id: string;

  get id() {
    return this._id;
  }

  constructor(id: string) {
    this._id = id;
  }

  meta = Object.freeze({
    env(): string {
      return meta.env();
    },
    origin(): string {
      return meta.origin();
    }
  });

  db = new class DriverDbApi {

    private table: SubTable;

    constructor(private parent: InternalDriverApiInterface) { }

    async init() {
      if(this.table)
        return;
      await db.drivers.ensureTable(this.parent.id);
      this.table = await db.drivers.getTable(this.parent.id);
    }

    async getAll<T = any>() {
      return this.table.getAll<T>();
    }

    async get<T = any>(key: string): Promise<T> {
      return this.table.get<T>(key);
    }

    async set(key: string, value: any) {
      await this.table.set(key, value);
    }

    async delete(key: string) {
      await this.table.delete(key);
    }
  }(this);
}
