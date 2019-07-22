import * as path from 'path';
import * as fs from 'fs-extra';
import { Readable as ReadableStream } from 'stream';
import { Dropbox } from 'dropbox';
import * as fetch from 'node-fetch';
import * as uuid from 'uuid';
import { getLogger, Logger } from '@log4js-node/log4js-api';

import { Driver, DriverApiInterface } from '../data/driver';
import { DriverConfig } from '../data/config';
import { NotFoundError, NotAllowedError, MalformedError } from '../data/hestia-errors';
import { User } from '../data/user';
import { urljoin, streamToBuffer } from '../util';
import { Subject, merge } from 'rxjs';
import { find, groupBy, throttleTime, mergeAll } from 'rxjs/operators';

const METADATA_DIRNAME = '.hestia-metadata';

interface UserDropboxDriverConfig extends DriverConfig {
  page_size: number; // global

  client_id: string; // the client Id for the http dropbox API
  secret: string; // the client secret for the http dropbox API
  cache_time?: number; // (optional) the time (in seconds) for listFiles -- default 120s (2m)
}

class ListCache {
  cache: { [key: string]: { date: Date, list: { path: string, size: number }[] } } = { };

  private _onCacheChange = new Subject<{ key: string, date: Date, list: { path: string, size: number }[] }>();
  public get onCacheChange() { return this._onCacheChange.asObservable(); }

  constructor(private cacheTime: number, private logger: Logger) { }

  private forgeKey(prefix: string, user: User) {
    return user.address + ':' + prefix;
  }

  private validate(cache: { date: Date, list: { path: string, size: number }[] }) {
    return cache && cache.date.getTime() > (Date.now() - (this.cacheTime * 1000));
  }

  get(prefix: string, user: User) {
    const key = this.forgeKey(prefix, user);
    const cache = this.cache[key];
    if(this.validate(cache))
      return cache;
    delete this.cache[key];
    this._onCacheChange.next({ key, date: null, list: null });
    return null;
  }

  set(prefix: string, user: User, list: { path: string, size: number }[]) {
    const key = this.forgeKey(prefix, user);
    this.cache[key] = { date: new Date(), list: list.slice() };
    this._onCacheChange.next({ key, ...this.cache[key] });
  }

  clean() {
    for(const key in this.cache) {
      if(!this.validate(this.cache[key])) {
        this.logger.info(`Cleaned Cache for ${key}.`);
        delete this.cache[key];
        this._onCacheChange.next({ key, date: null, list: null });
      }
    }
  }
}

class JobQueue {

  queue: { [key: string]: {
    path: string,
    buffer: Buffer,
    contentType: string,
    contentLength: number,
    retries?: number
  }[] } = { };
  current: { [key: string]: {
    jobId: string,
    jobs: {
      path: string,
      buffer: Buffer,
      contentType: string,
      contentLength: number,
      retries?: number
    }[]
  } } = { };

  private _onJobComplete = new Subject<string>();
  public getOnJobComplete(p: string) { return this._onJobComplete.pipe(find(a => a.toLowerCase() === p.toLowerCase())); }

  constructor(private logger: Logger) { }

  private dbx(token: string) {
    return new Dropbox({ accessToken: token, fetch });
  }

  async add(token: string, job: { path: string, stream: ReadableStream, contentType: string, contentLength: number }) {
    if((this.queue[token] && this.queue[token].find(a => a.path === job.path)) ||
      (this.current[token] && this.current[token].jobs.find(a => a.path === job.path)))
      throw new NotAllowedError('Job is already queued!');

    const buffer = await streamToBuffer(job.stream);

    if(!this.queue[token])
      this.queue[token] = [];

    this.queue[token].push({ buffer, ...job });
    this.logger.debug('Added to queue (' + this.queue[token].length + '): ', job.path, '(' + buffer.length + ')');
    return this.getOnJobComplete(job.path).toPromise();
  }

/*
see:
https://github.com/SynchroLabs/CloudStashWeb/blob/f828bec5d81e3dd5b6784f359cf4bb75d82eb89a/public/script.js#L186-L376
https://github.com/dropbox/dropbox-sdk-js/issues/120
but particularly this one:
https://github.com/dropbox/dropbox-sdk-js/issues/80#issuecomment-283189888
*/

  async tick() {

    const currentSnapshot = Object.assign({}, this.current);

    for(const key in currentSnapshot) if(currentSnapshot[key]) {
      const status = await this.dbx(key).filesUploadSessionFinishBatchCheck({ async_job_id: currentSnapshot[key].jobId });
      this.logger.debug(`Job ${currentSnapshot[key].jobId} is "${status['.tag']}"`);
      if(status['.tag'] === 'complete') {

        const succeededJobs = [];
        for(const entry of status.entries) {
          if(entry['.tag'] === 'failure')
            this.logger.error('Failed to upload:', entry.failure);
          else if(!entry.path_lower.startsWith('/' + METADATA_DIRNAME)) {
            succeededJobs.push(entry.path_lower.slice(1));
            this._onJobComplete.next(entry.path_lower.slice(1));
          }
        }

        const failedJobs = currentSnapshot[key].jobs.filter(a => !succeededJobs.find(b => b.startsWith(a.path.toLowerCase()))).reverse();

        if(failedJobs.length) {
          if(!this.queue[key])
              this.queue[key] = [];
          for(const job of failedJobs) if(!job.retries || job.retries < 3) {
            job.retries = (job.retries || 0) + 1;
            this.queue[key].unshift(job);
            this.logger.warn('Retrying ' + job.path + '(' + job.retries + ')');
          }
        }

        delete this.current[key];
      }
    } else delete this.current[key];

    // snapshot! (we don't need perfect copies -- just key/array dupes)
    const queueSnapshot: { [key: string]: {
      path: string,
      buffer: Buffer,
      contentType: string,
      contentLength: number
    }[] } = Object.assign({}, ...Object.entries(this.queue)
                                        .filter(([k]) => !this.current[k])
                                        .map(([k, v]) => ({ [k]: v.splice(0, 10) })));

    for(const key in queueSnapshot) if(queueSnapshot[key] && queueSnapshot[key].length > 0) {
      const dbx = this.dbx(key);

      const entries = [];
      for(let i = 0; i < queueSnapshot[key].length; i++) {
        const job = queueSnapshot[key][i];

        let sret: DropboxTypes.files.UploadSessionStartResult;

        const metadata = JSON.stringify({ 'content-type': job.contentType });

        sret = await dbx.filesUploadSessionStart({ contents: metadata, close: true });

        entries.push({
          cursor: { session_id: sret.session_id, offset: metadata.length },
          commit: { path: '/' + urljoin(METADATA_DIRNAME, job.path + '.json'), mode: 'overwrite' }
        });

        sret = await dbx.filesUploadSessionStart({ contents: job.buffer, close: true });

        entries.push({
          cursor: { session_id: sret.session_id, offset: job.contentLength },
          commit: { path: '/' + job.path, mode: 'overwrite' }
        });

        this.logger.debug(`Added entry: ${job.path} (${job.buffer.length} | ${job.contentLength})`);
      }

      const fret = await dbx.filesUploadSessionFinishBatch({ entries });
      if(fret['.tag'] === 'async_job_id')
        this.current[key] = { jobId: fret.async_job_id, jobs: queueSnapshot[key] };

      if(this.current[key])
        this.logger.debug('Started batch: ' + this.current[key].jobId);
      else
        this.logger.debug('Batch started and finished.');

      if(this.queue[key].length === 0) {
        delete this.queue[key];
        this.logger.debug('Queue was 0 length, deleted.');
      }
    } else if(this.queue[key].length === 0) {
      delete this.queue[key];
      this.logger.debug('Queue was 0 length, deleted.');
    }
  }
}

class UserDropboxDriver implements Driver {

  private client_id: string;
  private secret: string;
  private pageSize: number;

  private listCache: ListCache;
  private jobQueue: JobQueue;
  private stateCache: { [key: string]: string } = { };

  private logger: Logger;

  private dbx(user: User) {
    return new Dropbox({ accessToken: user.driverConfig.token, fetch });
  }

  private handleDbxError(e: any) {
    if(e.error && e.response && e.status) { // it's a dropbox error
      if((e.error as string).includes('not_found'))
        throw new NotFoundError('File not found.');
    } else
      throw e;
  }

  public async performRead(options: {
    path: string;
    storageTopLevel: string;
    user: User;
  }): Promise<{ contentType: string, stream: ReadableStream }> {
    this.logger.info(`Read: ` + urljoin(options.storageTopLevel, options.path));
    const p = urljoin(options.storageTopLevel, options.path);

    const dbx = this.dbx(options.user);

    let ret, ret2;
    try {
      [ret, ret2] = await Promise.all([
        dbx.filesDownload({ path: '/' + p }),
        dbx.filesDownload({ path: '/' + urljoin(METADATA_DIRNAME, p) + '.json' })
      ]);
    } catch(e) {
      this.handleDbxError(e);
    }
    const stream = new ReadableStream();
    stream.push((ret as any).fileBinary as Buffer);
    stream.push(null);

    return { contentType: ((ret2 as any).fileBinary as Buffer).toString('utf-8'), stream };
  }

  public async performWrite(options: {
    path: string;
    storageTopLevel: string;
    contentType: string;
    contentLength: number; // integer
    stream: ReadableStream;
    user: User;
  }): Promise<void> {
    this.logger.info(`Write: ` + urljoin(options.storageTopLevel, options.path));
    const p = urljoin(options.storageTopLevel, options.path);

    await this.jobQueue.add(options.user.driverConfig.token, {
      path: p,
      contentType: options.contentType,
      contentLength: options.contentLength,
      stream: options.stream
    });
  }

  public async performDelete(options: {
    path: string;
    storageTopLevel: string;
    user: User;
  }): Promise<void> {
    this.logger.info(`Delete: ` + urljoin(options.storageTopLevel, options.path));
    const p = urljoin(options.storageTopLevel, options.path);

    return this.dbx(options.user).filesDelete({ path: '/' + p }).then(() => {}, this.handleDbxError);
  }

  public async listFiles(prefix: string, page: number, user: User, justEntries?: boolean) {
    this.logger.info(`List files: ` + (prefix || '(all) ') + (page ? 'p' + page : ''));

    let bigList: { path: string, size: number }[] = [];
    const cache = this.listCache.get(prefix || 'all', user);

    if(!cache) {

      const dbx = this.dbx(user);
      const rets: DropboxTypes.files.ListFolderResult[] = [];
      rets.push(await dbx.filesListFolder({ path: prefix ? '/' + prefix : '', recursive: true, limit: this.pageSize }));
      while(rets[rets.length - 1].has_more)
        rets.push(await dbx.filesListFolderContinue({ cursor: rets[rets.length - 1].cursor }));

      const entryData: {
        ['.tag']: 'folder' | 'file';
        name: string;
        path_lower: string;
        path_display: string;
        id: string;
        size?: number;
      }[] = rets.reduce((p, c) => p.concat(c.entries.filter(e => !e.path_lower.startsWith('/' + METADATA_DIRNAME))), []);
      // supposedly DropBox can't verify the integrity of the upper/lowercase-ness of things so we need to figure that out ourselves
      // (because it's important for Gaia/Hestia at least)

      const folders = entryData.filter(a => a['.tag'] === 'folder');
      const files = entryData.filter(a => a['.tag'] === 'file');
      for(const file of files) {
        const ffolders = file.path_lower.slice(1, -file.name.length).split('/');
        for(let i = 0; i < ffolders.length; i++) {
          if(!ffolders[i])
            continue;
          const ff = folders.find(a => a.name.toLocaleLowerCase() === ffolders[i]);
          if(ff)
            ffolders[i] = ff.name;
          else
            this.logger.error(`Error finding folders name: ` + ffolders[i]);
        }
        const fpath = ffolders.join('/') + file.name;
        bigList.push({ path: fpath, size: file.size });
      }

      this.listCache.set(prefix || 'all', user, bigList);
    } else {
      bigList = cache.list;
    }

    const entries = bigList.slice(this.pageSize * page, this.pageSize * (page + 1));
    if(bigList.length > this.pageSize * (page + 1))
      return { entries, page: page + 1 };
    else return { entries };
  }

  async tick() {
    this.listCache.clean();
    await this.jobQueue.tick();
  }

  async init(id: string, config: UserDropboxDriverConfig, api: DriverApiInterface) {

    this.client_id = String(config.client_id);
    this.secret = String(config.secret);
    this.pageSize = Number(config.page_size) || 50;

    this.logger = getLogger('drivers.' + id);
    this.listCache = new ListCache(Number(config.cache_time) || 120, this.logger);
    this.jobQueue = new JobQueue(this.logger);

    await api.db.init();

    const cache = await api.db.getAll();
    for(const entry of cache)
      this.listCache.cache[entry.key] = { date: entry.value.date, list: entry.value.list };

    this.listCache.onCacheChange.pipe(groupBy(v => v.key), throttleTime(30000), mergeAll()).subscribe(val => {
      if(val.date === null)
        api.db.delete(val.key);
      else
        api.db.set(val.key, { date: val.date, list: val.list });
    });

    this.listCache.clean();

    const icon = fs.readFileSync(path.join(__dirname, 'icons', 'dropbox.png'));

    return {
      name: 'Dropbox',
      longId: 'io.github.michaelfedora.hestia.userDropbox',
      icon,
      multiUser: true
    };
  }

  async getInfo(user: User) {
    const info = await this.dbx(user).usersGetSpaceUsage();
    return {
      spaceUsed: info.used,
      spaceAvailable: info.allocation['.tag'] === 'individual' ? info.allocation.allocated : 0,
      queueCount: Object.values(this.jobQueue.queue).length,
      workingCount: Object.values(this.jobQueue.current).length
    };
  }

  async register(user?: User, redirectUri?: string, req?: { headers: { [key: string]: string }, body: any, query: any }) {
    const dbx = new Dropbox({ clientId: this.client_id, fetch });
    dbx.setClientSecret(this.secret);

    if(user) {

      const state = uuid.v4();
      this.stateCache[state] = user.address;
      const url = dbx.getAuthenticationUrl(redirectUri, state, 'code');

      return { redirect: { uri: url } };
    } else if(req.query.code && req.query.state) {

      const code = String(req.query.code);
      const state = String(req.query.state);

      const address = this.stateCache[state];
      if(!address) throw new NotAllowedError('State mismatch.');

      const token = await dbx.getAccessTokenFromCode(redirectUri, code);
      const acc = await new Dropbox({ accessToken: token, fetch }).usersGetCurrentAccount();

      return { finish: { address, userdata: { uid: acc.account_id, token } } };
    }

    throw new MalformedError('Not a redirect nor a properly formatted request!');
  }

  async postRegister(user: User, newEntry: { uid: string, token: string }): Promise<void> {
    if(Object.values(user.connections).find(a => a.config.uid === newEntry.uid))
      throw new Error('Cannot register two entries with the same account!');
  }

  async unregister(user: User) {
    return this.dbx(user).authTokenRevoke();
  }
}

const driver = new UserDropboxDriver(); // singleton

export default Object.freeze({ create() { return driver; } });
