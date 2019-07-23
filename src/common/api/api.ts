import axios, { AxiosResponse } from 'axios';

interface ApiInterface {
  token: string;
  hestiaUrl: string;
  headers: any;
}

class BackupPlugin {
  private apiUrl: string;

  constructor(private parent: ApiInterface, id: string) {
    this.apiUrl = this.parent.hestiaUrl + '/plugins/' + id;
  }

  async requestBackup() {
    await axios.post(this.apiUrl + '/request-backup', null, { headers: this.parent.headers });
  }

  status() {
    return axios.get<{ status: 'done' | 'working' | 'not started' }>(this.apiUrl + '/status', { headers: this.parent.headers });
  }

  get downloadLink() {
    return this.apiUrl + '/download?authorizationBearer=' + this.parent.token;
  }
}

const NOOP_STRING_GETTER = () => '';

type StringGetter = (() => string) | string;

export class HestiaApi implements ApiInterface {

  private _token: string;
  private _tokenGetter: () => string;

  private _hestiaUrl: string;
  private _hestiaUrlGetter: () => string;

  public plugins: {
    [key: string]: any;
    backup?: BackupPlugin;
  } = { };

  constructor(token: StringGetter, hestiaUrl: StringGetter = () => location.origin) {
    this.setToken(token);
    this.setHestiaUrl(hestiaUrl);
  }

  async populatePlugins() {
    const plugins = { } as { [key: string]: any };

    await this.meta.plugins().then(res => {
      for(const p of res.data) {
        switch(p.longId) {
          case 'io.github.michaelfedora.hestia.backup':
            plugins.backup = new BackupPlugin(this, p.id);
            break;
          default: break;
        }
      }
      this.plugins = Object.freeze(plugins);
    });
  }

  setToken(token: StringGetter) {
    this._token = '';
    this._tokenGetter = NOOP_STRING_GETTER;

    if(typeof token === 'string')
      this._token = token;
    else
      this._tokenGetter = token;
  }

  setHestiaUrl(hestiaUrl: StringGetter) {
    this._hestiaUrl = '';
    this._hestiaUrlGetter = NOOP_STRING_GETTER;

    if(typeof hestiaUrl === 'string')
      this._hestiaUrl = hestiaUrl;
    else
      this._hestiaUrlGetter = hestiaUrl;
  }

  get token() {
    return this._token ? this._token : this._tokenGetter();
  }

  get hestiaUrl() {
    return this._hestiaUrl ? this._hestiaUrl : this._hestiaUrlGetter();
  }

  get headers() {
    return this.token ? { Authorization: 'bearer ' + this.token } : null;
  }

  getDriverIconUrl(driverId: string) {
    return this.hestiaUrl + '/api/v1/drivers/' + driverId + '/icon';
  }

  getDriverRegisterUrl(driverId: string) {
    return this.hestiaUrl + '/api/v1/drivers/' + driverId + '/register';
  }

  getPluginApiUrl(pluginId: string) {
    return this.hestiaUrl + '/plugins/' + pluginId;
  }

  gaia = new class GaiaApi {

    constructor(private parent: ApiInterface) { }

    async read(address: string, path: string, responseType?: 'blob' | 'text' | 'json') {
      return this.readRaw(address + '/' + path, responseType);
    }

    async readRaw(path: string, responseType?: 'blob' | 'text' | 'json') {
      if(responseType)
        return axios.get(this.parent.hestiaUrl + '/gaia/read/' + path, { responseType: responseType });
      else
        return axios.get(this.parent.hestiaUrl + '/gaia/read/' + path);
    }

    async store(address: string, path: string, data: { contentType?: string, contentLength?: number, data: any }) {
      return this.storeRaw(address + '/' + path, data);
    }

    async storeRaw(path:  string, data: { contentType?: string, contentLength?: number, data: any }) {
      const headers = this.parent.headers;
      if(data.contentLength)
        headers['Content-Length'] = data.contentLength;
      if(data.contentType)
        headers['Content-Type'] = data.contentType;

      return axios.post<{ errors?: string[] }>(this.parent.hestiaUrl + '/gaia/store/' + path, data.data, { headers });
    }

    async delete(address: string, path: string) {
      return this.deleteRaw(address + '/' + path);
    }

    async deleteRaw(path: string) {
      return axios.delete<{ errors?: string[] }>(this.parent.hestiaUrl + '/gaia/delete/' + path, { headers: this.parent.headers });
    }

    async listFiles(address: string, page: string | number = 0) {
      return axios.post<{
        entries: string[], page?: string
      }>(this.parent.hestiaUrl + '/gaia/list-files/' + address, { page }, { headers: this.parent.headers });
    }

    async hubInfo() {
      return axios.get<{
        challenge_text: string;
        lastest_auth_version: string;
        read_url_prefix: string;
      }>(this.parent.hestiaUrl + '/gaia/hub_info');
    }

    async revokeAll(address: string, newTimestamp: Date) {
      return axios.post<void>(this.parent.hestiaUrl + '/gaia/revoke-all/' + address,
      { oldestValidTimestamp: (newTimestamp.getTime() / 1000).toFixed() },
      { headers: this.parent.headers });
    }

  }(this);

  connections = new class ConnectionApi {

    constructor(private parent: ApiInterface) { }

    private getUrl(connId: string) {
      return this.parent.hestiaUrl + '/api/v1/connections/' + connId;
    }

    async setDefault(connId: string) {
      return axios.post<void>(this.getUrl(connId) + '/set-default', null, { headers: this.parent.headers });
    }

    async getInfo(connId: string) {
      return axios.get<{
        spaceUsed: number;
        spaceAvailable?: number;
    }>(this.getUrl(connId) + '/info', { headers: this.parent.headers });
    }

    async delete(connId: string) {
      return axios.delete<void>(this.getUrl(connId), { headers: this.parent.headers });
    }

    async setBuckets(connId: string, buckets: string[]) {
      return axios.post<void>(this.getUrl(connId) + '/set-buckets', buckets, { headers: this.parent.headers });
    }

    // GAIA(ish)

    async read(connId: string, address: string, path: string) {
      return this.readRaw(connId, address + '/' + path);
    }

    async readRaw(connId: string, path: string) {
      return axios.get(this.getUrl(connId) + '/read/' + path);
    }

    async store(connId: string, address: string, path: string, data: { contentType?: string, contentLength?: number, data: any }) {
      return this.storeRaw(connId, address + '/' + path, data);
    }

    async storeRaw(connId: string, path: string, data: { contentType?: string, contentLength?: number, data: any }) {
      const headers = this.parent.headers;
      if(data.contentLength)
        headers['content-length'] = data.contentLength;
      if(data.contentType)
        headers['content-type'] = data.contentType;

      return axios.post<{ errors?: string[] }>(this.getUrl(connId) + '/store/' + path, data.data, { headers });
    }

    async deleteFile(connId: string, address: string, path: string) {
      return this.deleteFileRaw(connId, address + '/' + path);
    }

    async deleteFileRaw(connId: string, path: string) {
      return axios.delete<{ errors?: string[] }>(this.getUrl(connId) + '/delete/' + path, { headers: this.parent.headers });
    }

    async listFiles(connId: string, path: string = '', page: string | number = 0) {
      return axios.post<{
        entries: {
          path: string;
          size: number;
          hash: string;
          lastModified: string;
        }[];
        page?: number;
      }>(this.getUrl(connId) + '/list-files/' + path, { page }, { headers: this.parent.headers });
    }
  }(this);

  meta = new class MetaApi {
    constructor(private parent: ApiInterface) { }

    async plugins() {
      return axios.get<{ id: string, longId: string, name: string }[]>(this.parent.hestiaUrl + '/api/v1/plugins');
    }

    async drivers(): Promise<AxiosResponse<{
      current?: { id: string, name: string, driver: string, default?: boolean, buckets: string[] }[],
      available: { id: string, longId: string, name: string, rootOnly?: boolean, multi?: boolean }[]
    }>> {
      if(this.parent.token)
        return axios.get<{
          current: { id: string, name: string, driver: string, default?: boolean, buckets: string[] }[],
          available: { id: string, longId: string, name: string, rootOnly?: boolean, multi?: boolean }[]
        }>(this.parent.hestiaUrl + '/api/v1/drivers', { headers: this.parent.headers });
      else
        return axios.get<{
          available: { id: string, longId: string, name: string, rootOnly?: boolean, multi?: boolean }[]
        }>(this.parent.hestiaUrl + '/api/v1/drivers');
    }

    async env() {
      return axios.get<{ message: string }>(this.parent.hestiaUrl + '/env');
    }
  }(this);

  user = new class UserApi {

    constructor(private parent: ApiInterface) { }

    get apiUrl() {
      return this.parent.hestiaUrl + '/api/v1/user';
    }

    async validateToken() {
      return axios.get<void>(this.apiUrl + '/validate-token', { headers: this.parent.headers });
    }

    async login() {
      return axios.post<void>(this.apiUrl + '/login', null, { headers: this.parent.headers });
    }

    async register(token: string) {
      return axios.post<void>(this.apiUrl + '/register', null, { headers: { Authorization: 'bearer ' + token } });
    }

    async unregister() {
      return axios.post<void>(this.apiUrl + '/unregister', null, { headers: this.parent.headers });
    }

    async listFiles(options?: { global?: false, hash?: false }): Promise<AxiosResponse<{
      [path: string]: {
        contentType: string;
        size: number;
        hash: string;
        lastModified: string;
        connIds: string[]
      }
    }>>;
    async listFiles(options: { global: true, hash?: false }): Promise<AxiosResponse<{
      [path: string]: {
        [connId: string]: {
          contentType: string;
          size: number;
          hash: string;
          lastModified: string;
        }
      }
    }>>;
    async listFiles(options: { global?: boolean, hash?: true }): Promise<AxiosResponse<string>>;
    async listFiles(options?: { global?: boolean, hash?: boolean }) {
      options = Object.assign({}, options);
      let url = this.apiUrl + '/list-files';
      if(options.global && options.hash)
        url += '?global=true&hash=true';
      else if(options.global)
        url += '?global=true';
      else if(options.hash)
        url += '?hash=true';
      return axios.get(url, { headers: this.parent.headers });
    }

    async gdpr() {
      return axios.get<{
        id: string;
        address: string;
        internalBucketAddress: string;
        defaultConnection: string;
        connections: {
          [id: string]: {
            driver: string;
            name: string;
            config: any;
            buckets: string[];
          }
        },
        indexes: {
          [path: string]: {
            [connId: string]: {
              contentType: string;
              size: number;
              hash: string;
              lastModified: Date;
            }
          }
        };
      }>(this.apiUrl + '/gdpr', { headers: this.parent.headers });
    }
  }(this);
}
