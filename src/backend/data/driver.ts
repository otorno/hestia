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

interface ListFilesResponseExtended {
  entries: { name: string, contentLength: number, lastModifiedDate: number }[];
  page?: number;
}

interface ListFilesResponseNormal {
  entries: string[];
  page?: number;
}

export type ListFilesResponse<State> = State extends true ? ListFilesResponseExtended : ListFilesResponseNormal;

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
  }): Promise<{ stream: ReadableStream } | { redirectUrl: string }>;

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

  /*listFiles(prefix: string, page: number, state: false, user: User): Promise<{
    entries: string[],
    page?: number }>;
  listFiles(prefix: string, page: number, state: true, user: User): Promise<{
      entries: {
        name: string,
        lastModifiedDate: number,
        contentLength: number
      }[],
      page?: number }>;*/

  // I don't know if these typings are better or worse...
  listFiles<State extends boolean>(prefix: string, page: number, state: State, user: User): Promise<ListFilesResponse<State>>;

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

  /**
   * (Auto-)register the driver for the user.
   * @param user The user
   */
  autoRegister?(user: User): Promise<{
    finish: { address: string, userdata?: any }
  }>;

  /**
   * Start the registration workflow for the driver
   * @param user The user
   * @param redirectUrl The url that the driver should redirect towards to continue the workflow
   * @param req The request object
   */
  register(user: User, redirectUrl: string, req: { headers: { [key: string]: string | string[] }, query: any }): Promise<{
    redirect: {
      url: string
      headers?: {[key: string]: any},
    }
  } | {
    finish: { address: string, userdata?: any }
  }>;

  postRegisterCheck?(user: User, connId: string, userData: any): Promise<void>;

  unregister(user: User): Promise<void>;
}

export default Driver;
