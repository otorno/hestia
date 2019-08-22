import { Router } from 'express';
import { Plugin, PluginApiInterface } from '../data/plugin';
import { wrapAsync, ADDRESS_REGEX, parseAddressRegex } from '../services/api/middleware';
import { bufferToStream } from '../util';

interface InboxesPluginConfig {
  root_directory?: string; // defaults to `__dirname/../../frontend"`
                           // (i.e. `./build/frontend` or `./build-prod/frontend`)
}

interface InboxEntry {
  from: { username?: string, address: string, hub: string, read_prefix: string };
  title: string;
  caption: string;
}

type InboxDBEntry = {
  time: Date;
  url: string;
}[];

/**
 * Inboxes are per-bucket containers that have little pointers back to a larger notification data packet
 * - If it uses the user-bucket, it is considered a "global notification," which require an authentication scope to fire
 *
 * bucket will have a subfolder called `.inbox`, which has files named via a utc millisecond timestamp
 */
class InboxesPlugin implements Plugin {

  private api: PluginApiInterface;
  private get db() { return this.api.db.plugin; }

  async init(id: string, config: InboxesPluginConfig, api: PluginApiInterface) {
    this.api = api;
    config = Object.assign({ }, config);

    const authedAnyRouter = Router();
    const authedBucketRouter = Router();

    await this.db.init();

    authedBucketRouter.get('/', wrapAsync(async (req, res) => {
      const after = req.params.after ? new Date(req.params.after || 0) : undefined;
      const before = req.params.before ? new Date(req.params.before || Date.now()) : undefined;

      let all = await this.db.get<InboxDBEntry>(req.params.address);
      if(after && before)
        all = all.filter(a => a.time > after && a.time < before);
      else if(after)
        all = all.filter(a => a.time > after);
      else if(before)
        all = all.filter(a => a.time < before);

      res.json(all.map(a => a.url));
    }));

    authedAnyRouter.post(new RegExp(`/${ADDRESS_REGEX}`), parseAddressRegex, wrapAsync(async (req, res) => {
      const time = new Date();
      const notif = Object.assign(req.body, {
        time,
        from: req.params.auth.issuerAddress
      });
      const data = JSON.stringify(notif, null, 2);

      let all = await this.db.get<InboxDBEntry>(req.params.address);

      const subfpath = '/.hestia-outbox/' + time.getTime();
      let it = 0;
      while(all.find(a => a.url.includes(subfpath + (it ? `-${it}` : ''))))
        it++;

      const fpath = subfpath + (it ? `-${it}` : '') + '.json';

      const errs = await this.api.gaia.store(notif.from, fpath,
        { contentType: 'application/json', contentLength: data.length, stream: bufferToStream(Buffer.from(data)) });

      const entry = {
        time: new Date(),
        url: this.api.meta.origin + '/gaia/read/' + notif.from + '/' + fpath
      };

      // re-fetch in case something else changed
      all = await this.db.get<InboxDBEntry>(req.params.address);
      all.push(entry);
      await this.db.set(req.params.address, all);
    }));

    return {
      name: 'Inboxes',
      longId: 'io.github.michaelfedora.hestia.inboxes',
      authedAnyRouter,
      authedBucketRouter
    };
  }
}

export default new InboxesPlugin();
