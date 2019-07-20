import { Subject } from 'rxjs';
import { PluginConfig } from '../data/config';
import { Plugin, PluginInfo, PluginApiInterface } from '../data/plugin';
import { PluginApi } from '../data/plugin-api-interface';
import { configIdRegex } from '../util';
import { getLogger } from 'log4js';
import { NotFoundError } from '../data/hestia-errors';

class PluginService {

  private plugins: { [key: string]: Plugin } = { };
  private pluginInfo: PluginInfo[] = [];
  private logger = getLogger('plugins');

  private _onPluginInit = new Subject<{ plugin: Plugin, pluginInfo: PluginInfo }>();
  public get onPluginInit() { return this._onPluginInit.asObservable(); }

  public get(id: string) {
    const ret = this.plugins[id];
    if(!ret)
      throw new NotFoundError('No plugin found with Id "' + id + '"!');
    return ret;
  }

  public getInfo(): PluginInfo[];
  public getInfo(id: string): PluginInfo;
  public getInfo(id?: string) {
    const ret = id ? this.pluginInfo.find(a => a.id === id) : this.pluginInfo;
    if(!ret)
      throw new NotFoundError('No plugin found with Id "' + id + '"!');
    return ret;
  }

  private ticking: { [key: string]: boolean } = { };
  public async tick() {
    if(this.ticking['.']) {
      this.logger.error('[PLUG]: Ticking is taking too long!');
      return;
    }
    this.ticking['.'] = true;
    for(const info of this.pluginInfo) {
      const plugin = this.plugins[info.id];
      if(plugin.tick && !this.ticking[info.id]) {
        this.ticking[info.id] = true;
        plugin.tick().then(
          () => this.ticking[info.id] = false,
          e => this.logger.error(`[PLUG]: Erorr ticking plugin "${info.name}"("${info.id}"): ${e.stack || e}`));
      }
    }
    this.ticking['.'] = false;
  }

  public async init(config: { [id: string]: PluginConfig }) {
    const successes: { plugin: Plugin, info: PluginInfo }[] = [];
    const total = Object.keys(config).filter(a => typeof config[a] === 'object').length;
    /*if(Object.keys(config).find(a => a === 'dashboard')) {
      config['dashboard'] = {
        path: './default-drivers/dashboard.js'
      };
    }*/
    for(const pluginId in config) if(typeof(config[pluginId]) === 'object') {
      try {
        if(!configIdRegex.test(pluginId))
          throw new Error('Invalid Plugin Name: doesn\'t match scheme.');
        if(/^api|^gaia|^env/.test(pluginId))
          throw new Error('Invalid Plugin Name: shadows reserved route.');

        const pluginConfig = config[pluginId];

        const pluginInfo: PluginInfo = {
          id: pluginId,
          longId: pluginId,
          name: pluginId
        };

        let path = pluginConfig.path;
        if(path.startsWith('default-plugins'))
          path = '../' + path;

        const plugin: Plugin = (await import(path)).default;
        const info = await plugin.init(pluginId, pluginConfig, new PluginApi(pluginId));
        pluginInfo.longId = info.longId;
        if(this.pluginInfo.find(a => a.longId === info.longId))
          throw new Error('Plugin with longId "' + info.longId + '" already exists!');
        pluginInfo.name = info.name || pluginInfo.name;
        pluginInfo.router = info.router;
        pluginInfo.authedRouter = info.authedRouter;

        this._onPluginInit.next({ plugin, pluginInfo });
        this.plugins[pluginInfo.id] = plugin;
        this.pluginInfo.push(pluginInfo);

        this.logger.info(`Successfully initialized ${pluginInfo.name}("${pluginId}")!`);
        successes.push({ plugin, info: pluginInfo });
      } catch(e) {
        this.logger.error(`Error initializing "${pluginId}" plugin: ${e.stack || e}`);
      }
    }
    this.logger.info(`Initialized ${successes.length} out of ${total} plugins.`);
    return successes;
  }
}

export default new PluginService();
