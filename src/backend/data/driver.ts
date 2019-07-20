import { Readable as ReadableStream } from 'stream';
import { User } from './user';

export interface DriverApiInterface {
  meta: {
    env(): string;
    origin(): string;
  };
  db: {
    init(): Promise<void>;
    set(key: string, value: any): Promise<void>;
    delete(key: string): Promise<void>;
    get<T = any>(key: string): Promise<T>;
    getAll(): Promise<{ key: string, value: any }[]>;
  };
}

export interface DriverInfo {
  id: string;
  longId: string;
  name: string;
  icon: string | Buffer;
  whitelist?: string[];
  multiUser?: boolean;
  autoRegister?: boolean;
  rootOnly?: boolean;
}

export interface Driver {

  performRead(options: {
    path: string;
    storageTopLevel: string;
    user: User;
  }): Promise<{ contentType: string, stream: ReadableStream }>;

  performWrite(options: {
    path: string;
    storageTopLevel: string;
    contentType: string;
    contentLength: number; // integer
    stream: ReadableStream;
    user: User;
  }): Promise<void>;

  performDelete(options: {
    path: string;
    storageTopLevel: string;
    user: User;
  }): Promise<void>;

  listFiles(prefix: string, page: number, user: User, justPaths: true): Promise<{
    entries: {
      path: string
    }[],
    page?: number }>;
  listFiles(prefix: string, page: number, user: User, justPaths?: false): Promise<{
      entries: {
        path: string,
        size: number
      }[],
      page?: number }>;

  init(id: string, config: any, api: DriverApiInterface): Promise<{
    name: string,
    longId: string,
    icon: Buffer,
    multiInstance?: boolean,
    multiUser?: boolean,
    autoRegisterable?: boolean
  }>;

  getInfo(user: User): Promise<{
    spaceUsed: number,
    spaceAvailable?: number,
  }>;

  tick?(): Promise<void>;

  register(user?: User): Promise<{
    finish?: { address: string, userdata?: any }
  }>;

  register(user: User, redirectUri: string, req: { headers: { [key: string]: string | string[] }, body: any, query: any }): Promise<{
    redirect?: {
      uri: string
      headers?: {[key: string]: any},
    },
    finish?: { address: string, userdata?: any }
  }>;

  postRegisterCheck?(user: User, newEntry: any): Promise<void>;

  unregister(user: User): Promise<void>;
}

export default Driver;
