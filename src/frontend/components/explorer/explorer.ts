import Vue from 'vue';
import { VVue, makeUserSession } from 'frontend/vvue';
import axios, { AxiosError } from 'axios';
import _ from 'lodash';
import { UserData } from 'blockstack/lib/auth/authApp';
import { mapGetters } from 'vuex';
import JSZip from 'jszip';
import FileSaver from 'file-saver';
import * as filesize from 'filesize';
import { DateTime } from 'luxon';

import { HestiaApi } from 'common/api/api';

import BucketConnectionsModal from '../bucket-connections/bucket-connections';

interface EntryInfo {
  name: string;
  size: string;
  rawSize: number;
  lastModified: string;
  rawLastModified: number;

  conns: string[];
  oldConns: string[];

  itemCount?: number;

  hash?: string;
  contentType?: string;
  fileIcon?: string;
  fileIconColor?: string;
}

export default (Vue as VVue).component('hestia-explorer', {
  data() {
    const rootInfo: EntryInfo = {
      name: 'root',
      size: filesize(0),
      rawSize: 0,
      lastModified: 'null',
      rawLastModified: 0,
      conns: [] as string[],
      oldConns: [] as string[]
    };
    return {
      userSession: makeUserSession(this.$store),
      api: new HestiaApi(() => (this as any).token),
      token: '',

      working: false,
      progress: 0,
      workingOn: '',
      dir: '/',
      dirInfo: rootInfo,

      bigList: [] as string[],
      index: { } as { [path: string]: { files: EntryInfo[], folders: EntryInfo[] } },
      indexHash: '',
      rootInfo,

      sortByName: 'name',
      sortByDir: false,
      useFamiliar: true,

      lastActive: '',
      lastActiveTime: 0,
      active: {} as { [key: string]: boolean },
      anyActive: false,

      drawing: false,
      drawBegin: { x: 0, y: 0 },
      drawPoints: { x1: 0, y1: 0, x2: 0, y2: 0 },
      drawPos: {
        top: '0px',
        left: '0px',
        height: '0px',
        width: '0px'
      },

      nameAnnotations: { } as  { [key: string]: string },
      connections: { } as { [id: string]: { icon: string, name: string } },
      connString: '',
      apps: [] as { name: string, website: string, address: string }[],
    };
  },
  computed: {
    ...mapGetters({
      loggedIn: 'isLoggedIn'
    }) as { loggedIn: () => boolean },

    splitDir(): string[] {
      const sdir = [];
      let buff = '';
      this.dir.replace(/^\/|\/$/g, '').split('/').forEach(v => {
        if(!v) buff += '/';
        else if(buff) sdir.push(buff + v);
        else sdir.push(v);
      });
      return [
        location.origin,
        ...sdir
      ];
    },
    userdata(): UserData {
      return this.loggedIn ? this.$store.state.sessionData.userData : null;
    },
    migrationIndex(): { url_prefix: string, entries: string[] } {
      return { url_prefix: location.origin + '/gaia/read/', entries: this.bigList };
    },

    sortedFolders(): EntryInfo[] {
      if(!this.index || !this.index[this.dir])
        return [];
      return this.sortEntries(this.index[this.dir].folders);
    },

    sortedFiles(): EntryInfo[] {
      if(!this.index || !this.index[this.dir])
        return [];
      return this.sortEntries(this.index[this.dir].files);
    },

    status(): string {
      return this.workingOn || (this.working && 'Working') || '';
    }
  },
  watch: {
    dir() {
      this.active = { };
      this.lastActive = '';
      this.lastActiveTime = 0;

      if(this.$route.path !== this.dir)
        this.$router.replace({ path: this.dir });

      if(this.dir.length > 1 && this.index && this.index[this.dir]) {
        const idx = this.dir.lastIndexOf('/', this.dir.length - 2);
        const dirParent = this.dir.slice(0, idx + 1);
        const dirName = this.dir.slice(idx + 1, -1);
        const info = this.index[dirParent] ? this.index[dirParent].folders.find(a => a.name === dirName) : null;
        this.dirInfo = info || this.rootInfo;
      } else
        this.dirInfo = this.rootInfo;

      this.refresh();
    },
    $route() {
      if(this.$route.path !== this.dir && this.index[this.$route.path])
        this.dir = this.$route.path;
    },
    active() {
      this.anyActive = this.active && Object.values(this.active).reduce((a, b) => a || b, false);
    },
    status(n, o) {
      if(n !== o) {
        this.$store.commit('setStatus', n);
        if(n)
          console.log('Explorer - ' + n);
      }
    }
  },
  async mounted() {
    window.addEventListener('mouseup', this.drawEnd);
    window.addEventListener('mousemove', this.drawContinue);

    this.token = (await this.userSession.getOrSetLocalGaiaHubConnection()).token;

    let alreadyReddir = false;
    if(this.index && this.index[this.$route.path]) {
      this.dir = this.$route.path;
      alreadyReddir = true;
    }

    await this.refresh();
    if(!alreadyReddir) {
      if(this.index[this.$route.path])
        this.dir = this.$route.path;
      else
        this.$router.replace('/');
    }
  },
  destroyed() {
    window.removeEventListener('mouseup', this.drawEnd);
    window.removeEventListener('mousemove', this.drawContinue);
  },
  methods: {
    handleError(e: AxiosError, action: string) {
      const message = (e.response && e.response.data  && e.response.data.message) || e.message || 'error';
      console.error(e);
      this.$dialog.alert({ title: 'error', type: 'is-danger', message: `Error ${action}: ${message}`, });
    },
    formatDate(time: number) {
      return DateTime.fromMillis(time, { zone: 'utc' }).toLocal().toLocaleString(DateTime.DATETIME_SHORT);
    },
    getConn(connId: string) {
      return this.connections[connId] || { icon: '', name: '{null}' };
    },
    getFileIcon(contentType: string): { fileIcon: string, fileIconColor: string } {
      if(contentType.startsWith('application/json'))
        return { fileIcon: 'file-xml', fileIconColor: '#f44336' };
      if(contentType.startsWith('application/octet-stream'))
        return { fileIcon: 'file-question', fileIconColor: '#BDBDBD' };
      if(contentType.startsWith('text'))
        return { fileIcon: 'file-document', fileIconColor: '#3F51B5' };
      if(contentType.startsWith('audio'))
        return { fileIcon: 'file-music', fileIconColor: '#E91E63' };
      if(contentType.startsWith('image'))
        return { fileIcon: 'file-image', fileIconColor: '#4CAF50' };
      if(contentType.startsWith('video'))
        return { fileIcon: 'file-video', fileIconColor: '#673AB7' };
      return { fileIcon: 'file', fileIconColor: '#78909C' };
    },
    sortEntries(entries: EntryInfo[]): EntryInfo[] {
      return entries.sort((_a, _b) => {
        let a: EntryInfo, b: EntryInfo;
        if(!this.sortByDir) {
          a = _a;
          b = _b;
        } else {
          b = _a;
          a = _b;
        }

        switch(this.sortByName) {
          case 'conn':
            if(a.conns.length === b.conns.length) {
              const aNames = a.conns.map(n => this.getConn(n).name);
              const bNames = b.conns.map(n => this.getConn(n).name);
              return aNames.sort()[0].localeCompare(bNames.sort()[0]);
            } else return b.conns.length - a.conns.length;
          case 'size': return b.rawSize - a.rawSize;
          case 'mod': return b.rawLastModified - a.rawLastModified;
          case 'name':
          default:
            if(this.useFamiliar) {
              if(this.nameAnnotations[a.name] && this.nameAnnotations[b.name])
                return this.nameAnnotations[a.name].localeCompare(this.nameAnnotations[b.name]);
              else if(this.nameAnnotations[a.name])
                return -1;
              else if(this.nameAnnotations[b.name])
                return 1;
            }
            return a.name.localeCompare(b.name);
        }
      });
    },
    sort(col: string) {
      if(col === this.sortByName)
        this.sortByDir = !this.sortByDir;
      else {
        this.sortByName = col;
        this.sortByDir = false;
      }

    },
    async listFiles(connections?: { // just to not call /api/v1/drivers twice
        id: string;
        name: string;
        driver: string;
        default?: boolean;
        buckets: string[];
    }[]) { // make index
      this.workingOn = 'Fetching & indexing files...';

      connections = connections || (await this.api.meta.drivers()).data.current;
      const connString = JSON.stringify(connections);

      const hash = (await this.api.user.listFiles({ global: true, hash: true })).data;
      if(this.connString === connString && this.indexHash && this.indexHash === hash)
        return;
      this.connString = connString;
      this.indexHash = hash;

      const entries = (await this.api.user.listFiles({ global: true })).data;
      this.bigList = Object.keys(entries);

      const index: { [name: string]: { files: EntryInfo[], folders: EntryInfo[] } } = { };
      if(!this.index || Object.keys(this.index).length === 0)
        this.index = index;

      // let currentPath = 0;
      // const maxPath = Object.keys(entries).length;

      const oldestLatestModifiedDates: { [path: string]: { oldest: number, latest: number } } = { };
      for(const path in entries) if(entries[path]) {
        /*currentPath++;
        this.workingOn = 'Indexing files (' + currentPath + '/' + maxPath + ')...';
        this.progress = currentPath / maxPath;*/
        const allConnIds = Object.keys(entries[path]);
        const oldConnIds = connections.filter(a => !allConnIds.includes(a.id) && a.buckets.find(b => path.startsWith(b))).map(a => a.id);
        if(oldConnIds.length > 0) console.log('Found old connections: ', oldConnIds.map(a => this.getConn(a).name));
        for(const connId in entries[path]) if(entries[path][connId]) {

          const entry = entries[path][connId];

          // create folder objects
          const folders = path.split('/').map((p, i, arr) => '/' + arr.slice(0, i).join('/') + '/').slice(1);
          folders.unshift('/');
          for(let i = 0, fpath = folders[i]; i < folders.length; i++, fpath = folders[i]) {
            if(!index[fpath]) {
              index[fpath] = { files: [], folders: [] };
            }

            if(i + 1 < folders.length) {
              const subFName = folders[i + 1].slice(folders[i + 1].lastIndexOf('/', folders[i + 1].length - 2)).replace(/\//g, '');
              if(!index[fpath].folders.find(a => a.name === subFName)) {
                index[fpath].folders.push({
                  name: subFName,
                  size: filesize(0),
                  rawSize: 0,
                  lastModified: this.formatDate(0),
                  rawLastModified: 0,
                  conns: [connId],
                  oldConns: oldConnIds
                });
              }
            }
          }

          // file logic
          const folder = index[folders[folders.length - 1]];
          const fileName = path.slice(path.lastIndexOf('/', path.length - 2) + 1);
          const file = folder.files.find(a => a.name === fileName);
          const rawLastModified = DateTime.fromISO(entry.lastModified).toUTC().toMillis();
          // new
          if(!file) {
            const newFile: EntryInfo = {
              name: fileName,
              hash: entry.hash,
              rawSize: entry.size,
              size: filesize(entry.size),
              rawLastModified: rawLastModified,
              lastModified: this.formatDate(rawLastModified),
              conns: [connId],
              oldConns: oldConnIds.sort(),
              contentType: entry.contentType,
              ...this.getFileIcon(entry.contentType)
            };
            folder.files.push(newFile);
            oldestLatestModifiedDates[path] = { oldest: rawLastModified, latest: rawLastModified };
            // same hash
          } else if(file.hash === entry.hash) {
            if(!file.conns.find(a => a === connId))
              file.conns = [ ...file.conns, connId].sort();

            if(oldestLatestModifiedDates[path].latest < rawLastModified) {
              oldestLatestModifiedDates[path].latest = rawLastModified;

            } else if(oldestLatestModifiedDates[path].oldest > rawLastModified) {
              oldestLatestModifiedDates[path].oldest = rawLastModified;
              file.rawLastModified = rawLastModified;
              file.lastModified = this.formatDate(rawLastModified);
            }
            // different hash and newer AND has a size
          } else if(oldestLatestModifiedDates[path].latest < rawLastModified && entry.size > 0) {
            file.hash = entry.hash;
            file.rawSize = entry.size;
            file.size = filesize(entry.size);
            file.rawLastModified = rawLastModified;
            file.lastModified = this.formatDate(rawLastModified);
            file.oldConns = [...file.oldConns, ...file.conns].sort();
            file.conns = [connId];
            file.contentType = entry.contentType;
            const icon = this.getFileIcon(entry.contentType);
            file.fileIcon = icon.fileIcon;
            file.fileIconColor = icon.fileIconColor;
            oldestLatestModifiedDates[path] = { oldest: rawLastModified, latest: rawLastModified };
            // it's just old (or non existant)
          } else {
            if(file.conns.find(a => a === connId))
              file.conns = file.conns.filter(a => a !== connId);
            if(!file.oldConns.find(a => a === connId))
              file.oldConns = [...file.oldConns, connId].sort();
          }
        }
      }

      // post-entries logic -- fill out folder information
      // make sure we process the farthest folders first (i.e. the longest paths)
      // so the shorter ones can reference their children
      let paths = Object.keys(index).filter(a => index[a] && (index[a].folders.length || index[a].files.length));
      paths = paths.sort((a, b) => a.length === b.length ? a.localeCompare(b) : a.length - b.length);
      // currentPath = 0;
      for(const path of paths) {
        /*currentPath++;
        this.workingOn = 'Filling folder information (' + currentPath + '/' + paths.length + ')...';
        this.progress = currentPath / paths.length;*/
        let totalSize = 0;
        let lastModified = 0;
        const conns = { } as { [id: string]: boolean };
        const oldConns = { } as { [id: string]: boolean };
        let itemCount = 0;

        for(const f of index[path].folders) {
          totalSize += f.rawSize;
          lastModified = Math.max(lastModified, f.rawLastModified);
          for(const c of f.conns)
            conns[c] = true;
          for(const c of f.oldConns)
            oldConns[c] = true;
          itemCount += f.itemCount;
        }

        for(const f of index[path].files) {
          totalSize += f.rawSize;
          lastModified = Math.max(lastModified, f.rawLastModified);
          for(const c of f.conns)
            conns[c] = true;
          for(const c of f.oldConns)
            oldConns[c] = true;
          itemCount++;
        }

        if(path.length > 1) {
          const idx = path.lastIndexOf('/', path.length - 2);
          const subPath = path.slice(0, idx + 1);
          const fName = path.slice(idx + 1, -1);
          const folder = index[subPath].folders.find(a => a.name === fName);
          folder.rawSize = totalSize;
          folder.size = filesize(totalSize);
          folder.rawLastModified = lastModified;
          folder.lastModified = this.formatDate(lastModified);
          folder.oldConns = Object.keys(oldConns).sort();
          folder.conns = Object.keys(conns).filter(a => !oldConns[a]).sort();
          folder.itemCount = itemCount;
        } else {
          this.rootInfo.rawSize = totalSize;
          this.rootInfo.size = filesize(totalSize);
          this.rootInfo.rawLastModified = lastModified;
          this.rootInfo.lastModified = this.formatDate(lastModified);
          this.rootInfo.oldConns = Object.keys(oldConns).sort();
          this.rootInfo.conns = Object.keys(conns).filter(a => !oldConns[a]).sort();
          this.rootInfo.itemCount = itemCount;
        }
      }
      this.index = index;
      this.$forceUpdate();
      // this.workingOn = '';
      // this.progress = 0;
    },
    async getApps() {
      const apps = [];
      if(!this.apps || this.apps.length === 0)
        this.apps = apps;

      const nameAnnotations = { [this.userdata.identityAddress]: 'User' };
      if(!this.nameAnnotations || Object.keys(this.nameAnnotations).length === 0)
        this.nameAnnotations = nameAnnotations;
      try {
        // const r = await axios.get(location.origin + '/gaia/read/' + this.userdata.identityAddress + '/profile.json');
        const a = this.userdata.profile.apps as { [key: string]: string };
        for(const k in a) if(a[k]) {
          const matches = /(\w+)\/$/.exec(a[k]);
          if(!matches || matches.length < 2)
            continue;
          const app = { name: k.replace(/^https?:\/\/|\/$/g, ''), website: k, address: matches[1] };
          apps.push(app);
          nameAnnotations[app.address] = app.name;
        }
      } catch(e) {
        console.warn('Issue getting profile: ', e);
      }
      this.apps = apps;
    },
    async getConnections() {
      const res = await this.api.meta.drivers();

      this.connections = { };

      for(const conn of res.data.current) {
        this.connections[conn.id] = {
          icon: location.origin + '/api/v1/drivers/' + conn.driver + '/icon',
          name: conn.name
        };
      }
      return res.data.current;
    },
    async refresh() {
      if(this.working)
        return;

      this.working = true;
      this.workingOn = 'Refreshing';

      return Promise.all([this.getApps(), this.getConnections()])
        .then(([a, b]) => this.listFiles(b))
        .catch(err => this.handleError(err, 'listing files'))
        .then(() => { this.working = false; this.workingOn = ''; });
    },
    goto(dir: number) {
      if(dir <= 0) {
        this.dir = '/';
        return;
      } else if(dir >= this.splitDir.length)
        return;

      const d = '/' + this.splitDir.slice(1, dir + 1).join('/');
      this.dir = d.endsWith('/') ? d : d + '/';
    },
    clickItem(event: MouseEvent, item: string) {
      if(event.getModifierState('Shift') || event.shiftKey) {
        const allItems = this.index[this.dir].folders.map(a => '/' + a.name).concat(this.index[this.dir].files.map(a => a.name));
        const s1 = allItems.indexOf(this.lastActive);
        const s2 = allItems.indexOf(item);
        const items = allItems.slice(Math.min(s1, s2), Math.max(s1, s2) + 1);

        if(event.getModifierState('Control') || event.ctrlKey)
          for(const i of items)
            Vue.set(this.active, i, true);
        else
          this.active = items.reduce((acc, c) => { acc[c] = true; return acc; }, { });

        this.lastActiveTime = 0;
        return; // no 'lastActive' whatnot
      } else if(event.getModifierState('Control') || event.ctrlKey) {
        this.active[item] = !this.active[item];
        this.lastActiveTime = 0;
      } else {
        this.active = { [item]: true };
        if(Date.now() - this.lastActiveTime < 333) // 1/3 of a sec
          item.startsWith('/') ? this.openFolder(item.slice(1)) : this.openFile(item);
        this.lastActiveTime = Date.now();
      }

      this.lastActive = item;
    },
    openFolder(folder: string) {
      if(this.dir)
        this.dir = this.dir + folder + '/';
      else
        this.dir = '/' + folder + '/';
    },
    async openFile(file: string, options?: { open?: boolean, rawPath?: boolean }) {
      options = Object.assign({ open: true, rawPath: false }, options);
      const path = options.rawPath ? file : (this.dir.length > 1 ? this.dir.slice(1) : '') + file;
      if(options.open) {
        const w = window.open();
        w.location.href = this.api.hestiaUrl + '/gaia/read/' + path;
        // otherwise, res.headers['content-type'] + ',' + JSON.stringify(data)
      } else {
        const res = await this.api.gaia.readRaw(path);
        const data = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);

        return new Blob([data], { type: res.headers['content-type'] });
      }
    },
    async downloadSelected() {
      if(this.working)
        return;

      const items: string[] = [];
      for(const k in this.active) if(this.active[k] === true)
        items.push(k.startsWith('/') ? k.slice(1) : k);

      let allItems: string[] = [];
      for(const i of items) {
        allItems = allItems.concat(this.bigList
          .filter(a => a.startsWith(this.dir.slice(1) + i)));
      }

      let name = items.length === 1 ?
        items[0] :
        this.splitDir.length === 1 ?
          'hestia-data-from-' + location.hostname :
          this.splitDir[this.splitDir.length - 1];

      if(this.useFamiliar)
        name = this.nameAnnotations[name] || name;

      return this.download(allItems, name);
    },
    async downloadDir(path: string) {
      if(this.working)
        return;

      if(!path.endsWith('/'))
        path += '/';
      if(path.startsWith('/'))
        path = path.slice(1);

      let name: string;
      if(path.length < 2)
        name = 'hestia-data-from-' + location.hostname;
      else {
        const idx = path.lastIndexOf('/', path.length - 2);
        const dirName = path.slice(idx + 1, -1);
          name = (this.useFamiliar && this.nameAnnotations[dirName]) || dirName;
      }

      return this.download(this.bigList.filter(a => a.startsWith(path)), name);
    },
    async download(items: string[], name: string) {
      if(this.working)
        return;
      this.working = true;
      this.progress = 0;

      const zip = new JSZip();
      for(let n = 0, it = items[n]; n < items.length; n++, it = items[n]) {
        console.log('download:', it);
        this.progress = n / items.length;
        this.workingOn = 'Zipping ' + it;
        await new Promise(resolve => setTimeout(resolve, 500));
        zip.file(it, await this.openFile(it, { rawPath: true, open: false }));
      }
      this.progress = 1;
      this.workingOn = 'Serving the Zip';
      const blob = await zip.generateAsync({ type: 'blob' });
      FileSaver.saveAs(blob, name.replace('*', ''));
      this.workingOn = '';
      this.working = false;
      this.progress = 0;
    },
    drawStart(event: MouseEvent) {
      if(event.button !== 0)
        return;

      this.drawing = true;
      Vue.set(this.drawBegin, 'x', event.x);
      Vue.set(this.drawBegin, 'y', event.y);
      this.drawPoints = { x1: event.x, x2: event.x, y1: event.y, y2: event.y };
      this.drawPos = { top: event.y + 'px', left: event.x + 'px', height: 0 + 'px', width: 0 + 'px' };
    },
    boxInside(
      a: { x1: number, y1: number, x2: number, y2: number },
      b: { x1: number, y1: number, x2: number, y2: number }) {
      return !(a.x1 > b.x2 ||
              a.x2 < b.x1 ||
              a.y1 > b.y2 ||
              a.y2 < b.y1);
    },
    drawContinue: _.throttle(function(this, event: MouseEvent) {
      if(!this.drawing) return;
      Vue.set(this.drawPoints, 'y1', Math.min(event.y, this.drawBegin.y)); // top
      Vue.set(this.drawPoints, 'x1', Math.min(event.x, this.drawBegin.x)); // left
      Vue.set(this.drawPoints, 'y2', Math.max(event.y, this.drawBegin.y)); // bottom
      Vue.set(this.drawPoints, 'x2', Math.max(event.x, this.drawBegin.x)); // right

      Vue.set(this.drawPos, 'top', this.drawPoints.y1 + 'px');
      Vue.set(this.drawPos, 'left', this.drawPoints.x1 + 'px');
      Vue.set(this.drawPos, 'height', this.drawPoints.y2 - this.drawPoints.y1 + 'px');
      Vue.set(this.drawPos, 'width', this.drawPoints.x2 - this.drawPoints.x1 + 'px');

      const children = (this.$refs.explorer as HTMLElement).children;

      for(let i = 0, child = children.item(i); i < children.length; i++, child = children.item(i)) {
        if(!(child.classList.contains('folder') || child.classList.contains('file')))
          continue;

        const box = child.getBoundingClientRect();
        const b = {
          x1: box.left,
          y1: box.top,
          x2: box.right,
          y2: box.bottom
        };

        if(this.boxInside(b, this.drawPoints))
          child.classList.add('hover');
        else if(child.classList.contains('hover'))
          child.classList.remove('hover');
      }
    }, 15), // a little over 60 per second
    drawEnd(event: MouseEvent) {
      if(!this.drawing || event.button !== 0)
        return;

      this.drawing = false;
      const children = (this.$refs.explorer as HTMLElement).children;

      const newActive = [];
      for(let i = 0, child = children.item(i); i < children.length; i++, child = children.item(i)) {
        if(!(child.classList.contains('folder') || child.classList.contains('file')))
          continue;

        if(child.classList.contains('hover')) {
          const itemMatch = /m-(.+)/.exec(child.id);
          if(itemMatch && itemMatch[1])
            newActive.push(itemMatch[1]);
          child.classList.remove('hover');
        }
      }

      if(!(event.getModifierState('State') || event.shiftKey))
        this.active = { };
      for(const i of newActive)
        Vue.set(this.active, i, true);
    },
    getPath(folder: string) {
      return this.dir + folder;
    },
    getLink(file: string) {
      return location.origin + '/gaia/read' + this.dir + file;
    },
    async importMigrationIndex() {
      if(this.working)
        return;
      this.working = true;
      this.workingOn = 'Getting index...';
      try {
        const jsonIndex = await new Promise<string>(r => this.$dialog.prompt({
          message: 'JSON index from Mercurius or another Hestia hub:',
          inputAttrs: {
            type: 'textarea',
            placeholder: `{"url_prefix":"${location.origin}/gaia/read/","entries":[]}`
          },
          onConfirm: value => r(value),
          onCancel: () => r('')
        }));
        if(!jsonIndex) {
          this.working = false;
          this.workingOn = '';
          return;
        }
        const index: { url_prefix: string, entries: string[] } = JSON.parse(jsonIndex);
        if(!index.url_prefix || !index.entries)
          throw new Error('Malformed index: must have a url_prefix and an entries array.');

        for(let i = 0, entry = index.entries[i]; i < index.entries.length; i++, entry = index.entries[i]) {
          this.workingOn = 'Migrating ' + entry;
          this.progress = i / index.entries.length;
          const res = await axios.get(index.url_prefix + entry);
          // const headers = { authorization: 'bearer ' + this.token, 'content-type': res.headers['content-type'] };
          // await axios.post(location.origin + '/gaia/store/' + entry, res.data, { headers });
          await this.api.gaia.storeRaw(entry, {
            data: res.data,
            contentType: res.headers['content-type'],
            contentLength: res.headers['content-length']
          });
          await new Promise(r => setTimeout(r, 500));
        }
      } catch(e) {
        this.handleError(e, 'importing migration index');
      }
      this.working = false;
      this.workingOn = '';
      this.progress = 0;
      return this.refresh();
    },
    manageConnections(item?: EntryInfo) {
      if(this.working)
        return;

      const path = item ? this.dir + item.name + '/' : this.dir;
      const idx = path.indexOf('/', 2);
      const bucket = path.slice(1, idx);
      const info = this.index['/'].folders.find(a => a.name === bucket);
      if(!info) {
        console.warn(`Couldn't find info for bucket ${bucket}!`);
        return;
      }

      this.$modal.open({
        hasModalCard: true,
        props: { token: this.token, bucket, rootDir: this.userdata.identityAddress === bucket },
        component: BucketConnectionsModal,
        canCancel: true,
        parent: this,
        events: {
          close: () => this.refresh().then(() => this.sync(bucket, '/', false))
        }
      });
    },
    async refreshAndSync() {
      if(this.working || !this.index || !this.index['/'])
        return;
      await this.refresh();
      this.working = true;
      this.workingOn = 'Syncing...';
      let worked = false;
      for(const folder of this.index['/'].folders) {
        worked = await this.syncFolder(folder, '/') || worked;
      }
      if(worked)
        await this.listFiles();
      this.working = false;
      this.workingOn = '';
      this.progress = 0;
    },
    async syncFile(item: EntryInfo, dir: string) {
      this.workingOn = 'Syncing file ' + dir + item.name + '';
      const path = (dir + item.name).replace(/^\//, '');
      if(!item.oldConns.length)
        return false;
      for(const oldConn of item.oldConns) {
        const res = await this.api.gaia.readRaw(path);
        await this.api.connections.storeRaw(oldConn, path, {
          contentType: res.headers['content-type'],
          contentLength: res.headers['content-length'],
          data: res.data
        });
      }
      return true;
    },
    async syncFolder(item: EntryInfo, dir: string) {
      if(!item.oldConns.length)
        return false;
      const path = dir + item.name + '/';
      const index = this.index[path];
      if(!index)
        return false;
      let progressIt = 0;
      let worked = false;
      for(const file of index.files) {
        worked = await this.syncFile(file, path) || worked;
        this.progress = (++progressIt) / index.files.length;
      }
      for(const folder of index.folders)
        worked = await this.syncFolder(folder, path) || worked;
      return worked;
    },
    async syncDir() {
      if(this.working)
        return;

      if(this.dir === '/') {
        if(!this.rootInfo.oldConns.length)
            return;
        const index = this.index['/'];
        if(!index)
          return;

        this.working = true;
        this.workingOn = 'Syncing directory...';

        let progressIt = 0;
        let worked = false;
        for(const file of index.files) {
          worked = await this.syncFile(file, '/') || worked;
          this.progress = (++progressIt) / index.files.length;
        }
        for(const folder of index.folders)
          worked = await this.syncFolder(folder, '/') || worked;

        if(worked)
          await this.listFiles();
        this.working = false;
        this.workingOn = '';
        this.progress = 0;
      } else {
        const dir = this.dir.slice(0, this.dir.lastIndexOf('/', this.dir.length - 2) + 1);
        return this.sync(this.dirInfo.name, dir);
      }
    },
    async sync(itemName: string, dir?: string, refresh: boolean = true) {
      if(this.working)
        return;
      this.working = true;
      this.workingOn = 'Syncing ' + itemName + '...';
      dir = dir || this.dir;
      if(refresh)
        await this.listFiles();
      if(this.index[dir]) {
        let worked = false;
        let item = this.index[dir].files.find(a => a .name === itemName);
        if(item)
          worked = await this.syncFile(item, dir);
        else {
          item = this.index[dir].folders.find(a => a.name === itemName);
          if(item)
            worked = await this.syncFolder(item, dir);
        }
        if(worked)
          await this.listFiles();
      }
      this.working = false;
      this.workingOn = '';
      this.progress = 0;
    }
  }
});
