import { getLogger, Logger } from '@log4js-node/log4js-api';
import { Plugin, PluginApiInterface } from '../data/plugin';
import { Router } from 'express';
import { wrapAsync } from '../services/api/middleware';
import { User } from '../data/user';

interface SyncPluginConfig {
  // time in seconds to wait until trying to sync again; default: 600 (10 minutes)
  timeout?: number;
}

class SyncPlugin implements Plugin {

  private id: string;
  private timeout: number;
  private api: PluginApiInterface;
  private logger: Logger;

  private workedUsers: { [address: string]: boolean } = { };
  private workingUsers: { [address: string]: boolean } = { };

  async init(id: string, config: SyncPluginConfig, api: PluginApiInterface) {
    this.id = id;
    this.timeout = Number(config.timeout) || 600;
    this.logger = getLogger('plugins.' + id);
    this.api = api;

    const router = Router();
    router.post('/start', wrapAsync(async (req, res) => {
      const user: User = req.user;
      if(this.workingUsers[user.address])
        res.status(403).json({ message: 'Cannot start a Sync job while another is going on! '});
      else {
        this.work(user).then(
          () => this.workedUsers[user.address] = true,
          err => this.logger.error('Error syncing all of user "' + user.address + '"', err));
        res.sendStatus(204);
      }
    }));

    router.post('/start/:connId', wrapAsync(async (req, res) => {
      const user: User = req.user;
      const connId: string = req.params.connId;

      if(this.workingUsers[user.address])
        res.status(403).json({ message: 'Cannot start a Sync job while another is going on! '});
      else if(connId && !Object.keys(user.connections).includes(connId))
        res.status(404).json({ message: 'Connection with id "' + connId + '" not found!' });
      else {
        this.work(user, req.params.connId)
          .catch(err => this.logger.error('Error syncing connection "' + connId + '" of user "' + user.address + '"', err));
        res.sendStatus(204);
      }
    }));

    router.get('/working', wrapAsync(async (req, res) => {
      const user: User = req.user;
      res.json(Boolean(this.workingUsers[user.address]));
    }));

    return {
      name: 'Sync',
      longId: 'io.github.michaelfedora.hestia.sync',
      authedRouter: router
    };
  }

  // @todo if user has been using the connection, back off immediately
  private async work(user: User, connId?: string) {
    this.workingUsers[user.address] = true;

    if(connId) {
      // [path]{ metadata }
      const index = await this.api.db.getIndexForConnection(connId);
      for(const path in index) if(index[path]) {
        const bestInfo = await this.api.db.getFileInfo(path).catch(e => {
          if(e && e.type === 'not_found_error')
            return null;
          else throw e;
        });
        if(bestInfo && !bestInfo.connIds.includes(connId)) {
          if(bestInfo.size === 0) {
            await this.api.connections.delete(connId, user.address, '', path);
          } else {
            await this.api.connections.store(connId, user.address, '', path, {
              contentType: bestInfo.contentType,
              contentLength: bestInfo.size,
              stream: await this.api.gaia.read('', path).then(a => a.stream)
            });
          }
        }
      }

    } else {
      // [path][cId]{ metadata }
      const index = await this.api.db.getGlobalUserIndex(user);
      for(const path in index) if(index[path]) {
        const bestInfo = await this.api.db.getFileInfo(path).catch(e => {
          if(e && e.type === 'not_found_error')
            return null;
          else throw e;
        });
        if(!bestInfo)
          continue;
        for(const cId in index[path]) {
          if(index[path][cId] && !bestInfo.connIds.includes(cId)) {
            if(bestInfo.size === 0) {
              await this.api.connections.delete(cId, user.address, '', path);
            } else {
              await this.api.connections.store(cId, user.address, '', path, {
                contentType: bestInfo.contentType,
                contentLength: bestInfo.size,
                stream: await this.api.gaia.read('', path).then(a => a.stream)
              });
            }
          }
        }
      }
    }

    this.workingUsers[user.address] = false;
  }

  lastTick = 0;
  async tick() {
    if(Date.now() - this.lastTick < this.timeout * 1000)
      return;

    this.logger.info('Starting Sync job...');

    const users = (await this.api.db.getAllUsers()).filter(a => !this.workedUsers[a.address] && !this.workingUsers[a.address]);
    this.workedUsers = { };

    for(const u of users) {
      this.logger.debug('Syncing user ' + u.address);
      await this.work(u).catch(err => this.logger.error('Error syncing all of user "' + u.address + '"', err));
    }
    this.logger.info('Finished Sync job');
  }

}

export default new SyncPlugin();
