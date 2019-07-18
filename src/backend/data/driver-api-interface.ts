import { DriverApiInterface } from './driver';

import db from '../services/database-service';
import meta from '../services/meta-service';

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

    constructor(private parent: InternalDriverApiInterface) { }

    async init() {
      await db.ensureDriverTable(this.parent.id);
    }

    async getAll() {
      return db.getDriverTable(this.parent.id).run();
    }

    async get<T = any>(key: string): Promise<T> {
      return db.getDriverTable(this.parent.id).get(key).run();
    }

    async set(key: string, value: any) {
      await db.getDriverTable(this.parent.id).insert({ key, value }, { conflict: 'replace' }).run();
    }

    async delete(key: string) {
      await db.getDriverTable(this.parent.id).get(key).delete().run();
    }
  }(this);
}
