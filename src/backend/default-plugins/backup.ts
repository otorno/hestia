import * as path from 'path';
import { Router } from 'express';
import * as fs from 'fs-extra';
import { getLogger, Logger } from '@log4js-node/log4js-api';
import { execSync } from 'child_process';
import { Plugin, PluginApiInterface } from '../data/plugin';
import { NotFoundError } from '../data/hestia-errors';

interface BackupPluginConfig {
  temp_directory?: string; // default: __dirname/backups
}

class BackupPlugin implements Plugin {

  private id: string;
  private api: PluginApiInterface;

  private tempDirectory: string;

  private router: Router;
  private backupWorking: { [key: string]: boolean } = { }; // true: working, false|null: not working
  private backupTimestamps: { [key: string]: number } = { }; // seconds

  private logger: Logger;

  lastTick = Date.now();
  tickWorking = false;

  async tick() {
    if(this.tickWorking || Date.now() - this.lastTick < 3600000) return; // one hour ticks
    this.tickWorking = true;

    const items = await fs.readdir(this.tempDirectory);
    for(const item of items) if(item.endsWith('.zip') && (await fs.stat(item)).isFile()) {
      const address = item.slice(0, -'.zip'.length);
      if(this.backupWorking[address])
        continue;
      if(this.backupTimestamps[address] && (Date.now() / 1000) - this.backupTimestamps[address] < 86400) // one day
        continue;
      await fs.remove(path.join(this.tempDirectory, item))
        .catch(e => this.logger.error(`Error removing backup zip: ${e.stack || e}`));
    }
    this.tickWorking = false;
  }

  getInfo() {
    return { version : '1.0.0', source: 'default' };
  }

  private async startWorking(address: string) {
    try {
      const zipPath = path.join(this.tempDirectory, address + '.zip');
      const filesPath = path.join(this.tempDirectory, address);
      if(fs.existsSync(zipPath))
        fs.removeSync(zipPath);
      fs.emptyDirSync(filesPath);

      const bigList: string[] = [];
      // get mass list of files TODO
      const user = await this.api.db.getUser(address);
      if(!user)
        throw new NotFoundError(`No user found with address: ${address}!`);
      for(const connId of Object.keys(user.connections)) {
        let page = 0;
        const miniList: string[] = [];
        do {
          if(page > 0)
            await new Promise(r => setTimeout(r, 500));
          const res = await this.api.connections.listFiles(connId, address, '', page);
          miniList.push(...res.entries.map(a => a.path));
          page = res.page || 0;
        } while(page > 0);
        bigList.push(...miniList.filter(a => !bigList.includes(a)));
      }
      // download files
      for(const entry of bigList) {
        const idx = entry.indexOf('/');

        if(idx >= entry.length - 1)
          continue; // houston we have a problemo

        const addr = entry.slice(0, idx);
        const fpath = entry.slice(idx + 1);

        const res = await this.api.gaia.read(addr, fpath);
        res.stream.pipe(fs.createWriteStream(path.join(filesPath, entry), { mode: 0o600 }));

        await new Promise(r => setTimeout(r, 500));
      }
      // zip 'em all
      execSync('lib/7za.exe a -sdel -tzip -mmt1 -mx4 ' + zipPath + ' ' + filesPath + '/*');
    } catch(e) {
      this.logger.error(`Error backing up ${address}: ${e.stack || e}`);
    }
    this.backupWorking[address] = false;
  }

  async init(id: string, config: BackupPluginConfig, api: PluginApiInterface) {

    this.id = id;
    this.api = api;
    this.logger = getLogger('plugins.' + id);

    config = config || { };
    this.tempDirectory = path.join(config.temp_directory || __dirname, 'backups'); // yeet

    this.router = Router();
    this.router.post('/request-backup', (req, res) => {
      if(fs.existsSync(path.join(this.tempDirectory, req.user.address + '.zip'))) {
        res.status(403).json({ message: 'Please wait ~24 hours between backups.' });
        return;
      }
      if(this.backupWorking[req.user.address]) {
        res.status(403).json({ message: 'Already working on a backup -- please wait.' });
        return;
      }
      this.backupWorking[req.user.address] = true;
      this.startWorking(req.user.address);
      res.sendStatus(204);
    });
    this.router.get('/backup-ready', (req, res) => {
      res.json({
        status: this.backupWorking ? 'working' :
          fs.existsSync(path.join(this.tempDirectory, req.user.address + '.zip')) ? 'done' :
          'not started'
      });
    });
    this.router.get('/download', (req, res) => {
      if(!fs.existsSync(path.join(this.tempDirectory, req.user.address + '.zip')) || this.backupWorking[req.user.address])
        res.sendStatus(403);
      res.download(path.join(this.tempDirectory, req.user.address + '.zip'), (err) => {
        this.logger.error('Error sending download from backup for address ' + req.user.address + ':');
        this.logger.error(err);
      });
    });

    await fs.emptyDir(this.tempDirectory);
    return {
      name: 'Backup',
      longId: 'io.github.michaelfedora.hestia.backup',
      authedRouter: this.router
    };
  }
}

export default new BackupPlugin();
