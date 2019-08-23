import { DriverApiInterface } from './driver';

import db from '../services/database-service';
import meta from '../services/meta-service';
import { SubDB } from './db-driver';

interface InternalDriverApiInterface {
  id: string;
}

export class DriverApi implements InternalDriverApiInterface, DriverApiInterface {

  private _id: string;
  public db: SubDB;

  get id() { return this._id; }

  constructor(id: string) {
    this._id = id;
    this.db = db.drivers.getDB(this.id);
  }

  meta = Object.freeze({
    env(): string {
      return meta.env();
    },
    origin(): string {
      return meta.origin();
    }
  });
}
