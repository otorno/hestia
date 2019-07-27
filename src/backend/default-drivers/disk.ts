import { Readable as ReadableStream } from 'stream';
import * as fs from 'fs-extra';
import * as path from 'path';
import { getLogger, Logger } from '@log4js-node/log4js-api';

import Driver from '../data/driver';
import { NotFoundError, NotAllowedError, MalformedError } from '../data/hestia-errors';
import { User } from '../data/user';
import { parseBytes } from '../util';

interface DiskDriverConfigType {
  page_size: number; // global

  storage_root_directory: string; // the directory to put the files (default: `./hestia-storage`)

  // for storage caps (below), use a number of bytes or a string representation (i.e. "5mb")
  max_user_storage?: string | number; // the storage cap for each  user (default: unlimited)
  max_total_storage?: string | number; // the overall storage cap for Hestia (default: unlimited)
}

class DiskDriver implements Driver {

  private storageRootDirectory: string;
  private pageSize: number;
  private maxUserStorage: number;
  private maxTotalStorage: number;

  private logger: Logger;

  private validatePath(storageTopLevel: string, userAddress: string, remainderPath: string) {
    const topP = path.normalize(path.join(this.storageRootDirectory, storageTopLevel, userAddress));
    const p = path.normalize(path.join(topP, remainderPath));

    if(!(p.startsWith(topP) && p.length > topP.length))
      throw new NotAllowedError('Path is not formatted correctly (i.e. is relative)!');

    return p;
  }

  /// see: https://github.com/jprichardson/node-fs-extra/issues/656#issuecomment-500135176
  private getSize(p: string): number {
    if(!fs.existsSync(p))
      return 0;
    const stat = fs.statSync(p);
    if(stat.isFile())
      return stat.size;
    else if(stat.isDirectory())
      return fs.readdirSync(p).reduce((a, e) => a + this.getSize(path.join(p, e)), 0);
    else return 0; // can't take size of a stream/symlink/socket/etc
  }

  private validateUserStorage(userAddress: string) {
    if(this.maxUserStorage && this.getSize(path.join(this.storageRootDirectory, userAddress)) >= this.maxUserStorage)
      throw new NotAllowedError('User has reached their storage limit!');
    if(this.maxTotalStorage && this.getSize(this.storageRootDirectory) >= this.maxTotalStorage)
      throw new NotAllowedError('Disk (driver) has reached the alloted size limit!');
  }

  public async performRead(options: {
    path: string;
    storageTopLevel: string;
    user: User;
  }): Promise<{ stream: ReadableStream }> {
    this.logger.info(`Read: ` + path.join(options.storageTopLevel, options.path));
    const p = this.validatePath(options.storageTopLevel, options.user.address, options.path);

    if(!fs.existsSync(p))
      throw new NotFoundError();
    if(!fs.statSync(p).isFile())
      throw new NotFoundError();

    return { stream: fs.createReadStream(p) };
  }

  public async performWrite(options: {
    path: string;
    storageTopLevel: string;
    contentType: string;
    contentLength: number; // integer
    stream: ReadableStream;
    user: User;
  }): Promise<void> {
    this.logger.info(`Write: ` + path.join(options.storageTopLevel, options.path));
    const p = this.validatePath(options.storageTopLevel, options.user.address, options.path);
    this.validateUserStorage(options.user.address);

    if(fs.existsSync(p) && !fs.statSync(p).isFile())
      throw new MalformedError('Path is a directory, cannot be written to!');

    fs.ensureFileSync(p);
    options.stream.pipe(fs.createWriteStream(p, { mode: 0o600 }));
  }

  public async performDelete(options: {
    path: string;
    storageTopLevel: string;
    user: User;
  }): Promise<void> {
    this.logger.info(`Delete: ` + path.join(options.storageTopLevel, options.path));
    const p = this.validatePath(options.storageTopLevel, options.user.address, options.path);

    if(!fs.existsSync(p))
      throw new NotFoundError();

    return fs.remove(p);
  }

  private getAllFiles(dir: string): { name: string, contentLength: number, lastModifiedDate: number }[] {
    let ret: { name: string, contentLength: number, lastModifiedDate: number }[] = [];
    const entries = fs.readdirSync(dir);
    for(const e of entries) {
      const stat = fs.statSync(path.join(dir, e));
      if(stat.isFile())
        ret.push({ name: path.posix.normalize(e), contentLength: stat.size, lastModifiedDate: stat.mtimeMs });
      if(stat.isDirectory())
        ret = ret.concat(this.getAllFiles(path.join(dir, e)).map(a => Object.assign(a, { name: path.posix.join(e, a.name) })));
    }
    return ret;
  }

  public async listFiles(prefix: string, page: number, state: boolean, user: User): Promise<any> {
    this.logger.info(`List files: ` + path.normalize(prefix));

    const p = path.normalize(path.join(this.storageRootDirectory, user.address, prefix));
    if(!p.startsWith(path.normalize(this.storageRootDirectory)) || !p.endsWith(prefix) || !p.includes(user.address))
      throw new NotAllowedError(); // no funny business

    if(!fs.existsSync(p))
      throw new NotFoundError();

    if(!fs.statSync(p).isDirectory())
      throw new MalformedError('Not a directory.');

    const files = this.getAllFiles(p);

    if(files.length <= page * this.pageSize)
      return { entries: [] };

    const entries = files.sort((a, b) => a.name.localeCompare(b.name)).slice(page * this.pageSize, (page + 1) * this.pageSize);

    const includePage = files.length > ((page + 1) * this.pageSize);
    if(state) {
      if(includePage)
        return { entries: entries.map(a => a.name), page: page + 1 };
      else
        return { entries: entries.map(a => a.name) };
    } else {
      if(includePage)
        return { entries, page: page + 1 };
      else
        return { entries };
    }
  }

  async init(id: string, config: DiskDriverConfigType) {

    this.storageRootDirectory = String(config.storage_root_directory) || './hestia-storage';
    this.pageSize = Number(config.page_size || 50);
    this.maxTotalStorage = parseBytes(config.max_total_storage || 0);
    this.maxUserStorage = parseBytes(config.max_user_storage || 0);

    this.logger = getLogger('drivers.' + id);

    await fs.ensureDir(this.storageRootDirectory);
    const icon = fs.readFileSync(path.join(__dirname, 'icons', 'harddisk.png'));

    if(this.maxTotalStorage && this.getSize(this.storageRootDirectory) >= this.maxTotalStorage)
      this.logger.warn(`Disk (driver) has reached the alloted size limit!`);

    const mp = path.join(this.storageRootDirectory, '.hestia_metadata');
    if(fs.existsSync(mp))
      await fs.remove(mp);

    return {
      name: 'Harddisk',
      longId: 'io.github.michaelfedora.hestia.disk',
      icon,
      multiInstance: true,
      autoRegisterable: true
    };
  }

  async getInfo(user: User) {
    return {
      spaceUsed: this.getSize(path.join(this.storageRootDirectory, user.address)),
      spaceAvailable: this.maxUserStorage || undefined,
    };
  }

  async register(user: User) {
    return this.autoRegister(user);
  }

  async autoRegister(user: User) {
    if(!user)
      throw new MalformedError('Must have user object to register.');

    fs.ensureDirSync(path.join(this.storageRootDirectory, user.address));
    return { finish: { address: user.address} };
  }

  async unregister(user: User) {
    const p = path.join(this.storageRootDirectory, user.address);
    if(fs.existsSync(p))
      await fs.remove(p);
  }
}


// multi-instance!
export default Object.freeze({ create() { return new DiskDriver(); } });
