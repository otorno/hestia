import { Router, static as serveStatic } from 'express';
import * as path from 'path';
import { Plugin } from '../data/plugin';

interface DashboardPluginConfig {
  root_directory?: string; // defaults to `__dirname/../../frontend"`
  // (i.e. `./build/frontend` or `./build-prod/frontend`)
}

class DashboardPlugin implements Plugin {

  router: Router;

  async init(id: string, config: DashboardPluginConfig) {
    config = config || { };
    config.root_directory = config.root_directory || path.join(__dirname, '..', '..', 'frontend');
    this.router = Router();
    this.router.use('/', serveStatic(config.root_directory));

    return {
      name: 'Dashboard',
      longId: 'io.github.michaelfedora.hestia.dasboard',
      router: this.router
    };
  }
}

export default new DashboardPlugin();
