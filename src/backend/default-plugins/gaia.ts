import { Plugin, PluginApiInterface } from '../data/plugin';
import { Router } from 'express';
import { wrapAsync } from '../services/api/middleware';

interface GaiaPluginConfig {

}

/**
 * TODO: Modularize the Gaia API functionality so that we can use
 * different storage interfaces
 */
class GaiaPlugin implements Plugin {

  private id: string;
  private api: PluginApiInterface;

  public getLatestAuthVersion() {
    return 'v1';
  }

  public getChallengeText() {
    return JSON.stringify(['hestia', '0', this.api.meta.host(), 'blockstack_storage_please_sign']);
  }

  async init(id: string, config: GaiaPluginConfig, api: PluginApiInterface) {

    const router = Router();
    router.get('/hub_info', (req, res) => {
      res.json({
        challenge_text: this.getChallengeText(),
        latest_auth_version: this.getLatestAuthVersion(),
        read_url_prefix: `${this.api.meta.origin()}/gaia/read/`
      });
    });

    return {
      name: 'Gaia',
      longId: 'io.github.michaelfedora.hestia.gaia',
      router,
    };
  }
}

export default new GaiaPlugin();
