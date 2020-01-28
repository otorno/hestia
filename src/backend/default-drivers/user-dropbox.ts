import * as path from 'path';
import * as fs from 'fs-extra';
import { Readable as ReadableStream } from 'stream';
import { Dropbox } from 'dropbox';
import * as fetch from 'node-fetch';
import * as uuid from 'uuid';
import { getLogger, Logger } from '@log4js-node/log4js-api';

import { Driver, DriverApiInterface } from '../data/driver';
import { NotFoundError, NotAllowedError, MalformedError } from '../data/hestia-errors';
import { User } from '../data/user';
import { urljoin, streamToBuffer } from '../util';
import { Subject } from 'rxjs';
import { find } from 'rxjs/operators';
import { SubTable } from '../data/db-driver';

interface UserDropboxDriverConfig {
  page_size: number; // global

  client_id: string; // the client Id for the http dropbox API
  secret: string; // the client secret for the http dropbox API
}

class JobQueue {

  queue: { [key: string]: {
    path: string;
    buffer: Buffer;
    contentType: string;
    contentLength: number;
    retries?: number;
  }[]; } = { };
  current: { [key: string]: {
    jobId: string;
    jobs: {
      path: string;
      buffer: Buffer;
      contentType: string;
      contentLength: number;
      retries?: number;
    }[];
  }; } = { };

  private _onJobComplete = new Subject<string>();
  public getOnJobComplete(p: string) { return this._onJobComplete.pipe(find(a => a.toLowerCase() === p.toLowerCase())); }

  constructor(private logger: Logger) { }

  private dbx(token: string) {
    return new Dropbox({ accessToken: token, fetch });
  }

  async add(token: string, job: { path: string; stream: ReadableStream; contentType: string; contentLength: number }) {
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
          if(entry['.tag'] === 'failure') {
            this.logger.error('Failed to upload:', entry.failure);
          } else {
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
      path: string;
      buffer: Buffer;
      contentType: string;
      contentLength: number;
    }[]; } = Object.assign({}, ...Object.entries(this.queue)
      .filter(([k]) => !this.current[k])
      .map(([k, v]) => ({ [k]: v.splice(0, 10) })));

    for(const key in queueSnapshot) if(queueSnapshot[key] && queueSnapshot[key].length > 0) {
      const dbx = this.dbx(key);

      const entries = [];
      for(let i = 0; i < queueSnapshot[key].length; i++) {
        const job = queueSnapshot[key][i];

        const sret = await dbx.filesUploadSessionStart({ contents: job.buffer, close: true });

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

  private jobQueue: JobQueue;
  private stateCache: { [key: string]: string } = { };

  private api: DriverApiInterface;
  private table: SubTable;

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
  }): Promise<{ stream: ReadableStream } | { redirectUrl: string }> {
    this.logger.info('Read: ' + urljoin(options.storageTopLevel, options.path));
    const p = urljoin(options.storageTopLevel, options.path);

    const dbx = this.dbx(options.user);

    // get shared link from db
    // if it doesn't exist, use filesCreateSharedLinkWithSettings
    // - settings are requested_visibility: public, audience: public, access: viewer
    // return { redirectUrl } instead of the stream whatnot

    const link = await this.table.get(options.user.connectionId + ':' + p.toLocaleLowerCase());
    if(link)
      return { redirectUrl: link };
    else {
      this.logger.debug('No link indexed, getting...');
      const res = await dbx.sharingGetSharedLinks({ path: '/' + p });
      let newLink: string;
      if(!res.links.length) {
        this.logger.debug('No links available, creating a new one!');
        const res2 = await dbx.sharingCreateSharedLinkWithSettings({
          path: '/' + p
        });
        newLink = res2.url;
      } else {
        newLink = res.links[0].url;
      }
      newLink = newLink.replace('?dl=0', '').replace('www.dropbox', 'dl.dropboxusercontent');
      await this.table.set(options.user.connectionId + ':' + p.toLocaleLowerCase(), newLink);
      return { redirectUrl: newLink };
    }
  }

  public async performWrite(options: {
    path: string;
    storageTopLevel: string;
    contentType: string;
    contentLength: number; // integer
    stream: ReadableStream;
    user: User;
  }): Promise<void> {
    this.logger.info('Write: ' + urljoin(options.storageTopLevel, options.path));
    const p = urljoin(options.storageTopLevel, options.path);
    const dbx = this.dbx(options.user);
    let filesUploadErr = false;

    if(options.contentLength < 8388608) { // 8MB
      try {
        await dbx.filesUpload({
          path: '/' + p,
          contents: await streamToBuffer(options.stream),
          mode: { '.tag': 'overwrite' }
        });
      } catch(e) {
        this.logger.error('Error uploading file: ', e);
        filesUploadErr = true;
      }
    }

    if(filesUploadErr || options.contentLength >= 8388608) { // 8MB
      await this.jobQueue.add(options.user.driverConfig.token, {
        path: p,
        contentType: options.contentType,
        contentLength: options.contentLength,
        stream: options.stream
      });
    }

    const res = await dbx.sharingGetSharedLinks({ path: '/' + p });
    let newLink: string;
    if(!res.links.length) {
      this.logger.debug('Creating a new shared link.');
      const res2 = await dbx.sharingCreateSharedLinkWithSettings({
        path: '/' + p
      });
      newLink = res2.url;
    } else {
      newLink = res.links[0].url;
    }
    newLink = newLink.replace('?dl=0', '').replace('www.dropbox', 'dl.dropboxusercontent');
    await this.table.set(options.user.connectionId + ':' + p.toLocaleLowerCase(), newLink);
  }

  public async performDelete(options: {
    path: string;
    storageTopLevel: string;
    user: User;
  }): Promise<void> {
    this.logger.info('Delete: ' + urljoin(options.storageTopLevel, options.path));
    const p = urljoin(options.storageTopLevel, options.path);

    await this.table.delete(options.user.connectionId + ':' + p);
    await this.dbx(options.user).filesDelete({ path: '/' + p }).then(() => {}, this.handleDbxError);
  }

  public async listFiles(prefix: string, page: number, state: boolean, user: User): Promise<any> {
    this.logger.info('List files: ' + (prefix || '(all) ') + (page ? 'p' + page : '') + (state ? 'w/ state' : ''));

    const bigList: { name: string; contentLength: number; lastModifiedDate: number }[] = [];

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
      server_modified?: string;
    }[] = rets.reduce((p, c) => p.concat(c.entries), []);
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
          this.logger.error('Error finding folders name: ' + ffolders[i]);
      }
      const fpath = ffolders.join('/') + file.name;
      bigList.push({ name: fpath, contentLength: file.size, lastModifiedDate: new Date(file.server_modified).getTime() });
    }

    const entries = bigList.slice(this.pageSize * page, this.pageSize * (page + 1));
    const includePage = bigList.length > this.pageSize * (page + 1);
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

  async tick() {
    await this.jobQueue.tick();
  }

  async init(id: string, config: UserDropboxDriverConfig, api: DriverApiInterface) {

    this.client_id = String(config.client_id);
    this.secret = String(config.secret);
    this.pageSize = Number(config.page_size) || 50;

    this.logger = getLogger('drivers.' + id);
    this.jobQueue = new JobQueue(this.logger);

    this.api = api;

    const tableList = await this.api.db.listTables();
    if(!tableList.includes('basic'))
      this.table = await this.api.db.createTable('basic');
    else
      this.table = await this.api.db.getTable('basic');

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

  async register(user: User); // ignore
  async register(user: User, redirectUrl: string, req: { headers: { [key: string]: string }; query: any }): Promise<{
    redirect: { url: string };
  } | {
    finish: { address: string; userdata: { uid: string; token: string } };
  }>;
  async register(user: User, redirectUrl?: string, req?: { headers: { [key: string]: string }; query: any }) {

    if(!redirectUrl || !req)
      throw new Error('Cannot be used as a hub-backend (must be user-backend)!');

    const dbx = new Dropbox({ clientId: this.client_id, fetch });
    dbx.setClientSecret(this.secret);

    if(user) {

      const state = uuid.v4();
      this.stateCache[state] = user.address;
      const url = dbx.getAuthenticationUrl(redirectUrl, state, 'code');

      return { redirect: { url } };
    } else if(req.query.code && req.query.state) {

      const code = String(req.query.code);
      const state = String(req.query.state);

      const address = this.stateCache[state];
      if(!address) throw new NotAllowedError('State mismatch.');

      const token = await dbx.getAccessTokenFromCode(redirectUrl, code);
      const acc = await new Dropbox({ accessToken: token, fetch }).usersGetCurrentAccount();

      if(!acc.email_verified)
        throw new NotAllowedError('User\'s email is not verified!');

      return { finish: { address, userdata: { uid: acc.account_id, token } } };
    }

    throw new MalformedError('Not a redirect nor a properly formatted request!');
  }

  async postRegisterCheck(user: User, id: string, userData: { uid: string; token: string }): Promise<void> {
    if(Object.values(user.connections).filter(a => a.config.uid === userData.uid).length > 1)
      throw new Error('Cannot register two entries with the same account!');

    const dbx = this.dbx(user.makeSafeForConnection(id));
    let cursor = '';
    do {
      const res = await dbx.sharingListSharedLinks({ direct_only: true }); // do this on init too :thonk:?
      for(const link of res.links) {
        if((link.expires && link.expires !== 'never') ||
          (link.link_permissions.requested_visibility && link.link_permissions.requested_visibility['.tag'] !== 'public'))
          continue;
        this.table.set(id + ':' + link.path_lower.slice(1), link.url);
      }
      if(res.has_more)
        cursor = res.cursor;
      else
        cursor = '';
    } while(cursor);
  }

  async unregister(user: User) {
    await this.dbx(user).authTokenRevoke();
    const idx = await this.table.getAll();
    const todel = idx.map(a => a.key).filter(a => a.startsWith(user.connectionId));
    for(const key of todel)
      await this.table.delete(key);
  }
}

const driver = new UserDropboxDriver(); // singleton

export default Object.freeze({ create() { return driver; } });
