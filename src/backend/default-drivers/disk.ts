import { Readable as ReadableStream } from 'stream';
import * as fs from 'fs-extra';
import * as path from 'path';
import { getLogger, Logger } from '@log4js-node/log4js-api';

import Driver from '../data/driver';
import { DriverConfig } from '../data/config';
import { NotFoundError, NotAllowedError, MalformedError } from '../data/hestia-errors';
import { User } from '../data/user';
import { parseBytes } from '../util';

interface DiskDriverConfigType extends DriverConfig {
  storage_root_directory: string;
  page_size: number;
  max_user_storage: string | number;
  max_total_storage: string | number;
}

const METADATA_DIRNAME = '.hestia-metadata';

class DiskDriver implements Driver {

  private id: string;
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
  }): Promise<{ contentType: string, stream: ReadableStream }> {
    this.logger.info(`Read: ` + path.join(options.storageTopLevel, options.path));
    const p = this.validatePath(options.storageTopLevel, options.user.address, options.path);
    const mp = path.normalize(path.join(
      this.storageRootDirectory,
      METADATA_DIRNAME,
      options.storageTopLevel,
      options.user.address,
      options.path));

    if(!fs.existsSync(p))
      throw new NotFoundError();
    if(!fs.statSync(p).isFile())
      throw new NotFoundError();

    const metadata = fs.readJsonSync(mp);

    return { contentType: metadata['content-type'], stream: fs.createReadStream(p) };
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

    const mp = path.normalize(path.join(
      this.storageRootDirectory,
      METADATA_DIRNAME,
      options.storageTopLevel,
      options.user.address,
      options.path));

    if(fs.existsSync(p) && !fs.statSync(p).isFile())
      throw new MalformedError('Path is a directory, cannot be written to!');

    fs.ensureFileSync(p);
    options.stream.pipe(fs.createWriteStream(p, { mode: 0o600 }));

    fs.outputJsonSync(mp, { 'content-type': options.contentType }, { mode: 0o600 });
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

  private getMetadata(userAddress: string, paths: string[]) {
    const metadata: { 'content-type': string }[] = [];
    const root = path.normalize(path.join(this.storageRootDirectory, METADATA_DIRNAME, userAddress));
    for(const p of paths)
      metadata.push(fs.readJsonSync(path.join(root, p)));
    return metadata;
  }

  private getAllFiles(dir: string): { path: string, size: number }[] {
    let ret: { path: string, size: number }[] = [];
    const entries = fs.readdirSync(dir);
    for(const e of entries) {
      const stat = fs.statSync(path.join(dir, e));
      if(stat.isFile())
        ret.push({ path: path.posix.normalize(e), size: stat.size });
      if(stat.isDirectory())
        ret = ret.concat(this.getAllFiles(path.join(dir, e)).map(a => ({ size: a.size, path: path.posix.join(e, a.path) })));
    }
    return ret;
  }

  public async listFiles(prefix: string, page: number, user: User, justEntries?: boolean) {
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

    const entriesPartial = files.sort().slice(page * this.pageSize, (page + 1) * this.pageSize);
    let entries;
    if(justEntries)
      entries = entriesPartial.map(a => a.path);
    else {
      const metadata = this.getMetadata(user.address, entriesPartial.map(a => a.path));
      entries = entriesPartial.map((a, i) => ({ ...a, type: metadata[i]['content-type'] }));
    }

    if(files.length > ((page + 1) * this.pageSize))
      return { entries, page: page + 1 };
    else
      return { entries };
  }

  async init(id: string, config: DiskDriverConfigType) {
    this.id = id;
    this.storageRootDirectory = String(config.storage_root_directory) || './hestia-storage';
    this.pageSize = Number(config.page_size || 50);
    this.maxTotalStorage = parseBytes(config.max_total_storage || 0);
    this.maxUserStorage = parseBytes(config.max_user_storage || 0);

    this.logger = getLogger('drivers.' + id);

    await fs.ensureDir(this.storageRootDirectory);
    const icon = fs.readFileSync(path.join(__dirname, 'icons', 'harddisk.png'));

    if(this.maxTotalStorage && this.getSize(this.storageRootDirectory) >= this.maxTotalStorage)
      this.logger.warn(`Disk (driver) has reached the alloted size limit!`);

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
    if(!user)
      throw new MalformedError('Must have user object to register.');

    fs.ensureDirSync(path.join(this.storageRootDirectory, user.address));
    fs.ensureDirSync(path.join(this.storageRootDirectory, METADATA_DIRNAME, user.address));
    return { finish: { address: user.address} };
  }

  async unregister(user: User) {
    const p = path.join(this.storageRootDirectory, user.address);
    if(fs.existsSync(p))
      await fs.remove(p);

    const mp = path.join(this.storageRootDirectory, METADATA_DIRNAME, user.address);
    if(fs.existsSync(mp))
      await fs.remove(mp);
  }
}


// multi-instance!
export default Object.freeze({ create() { return new DiskDriver(); } });
