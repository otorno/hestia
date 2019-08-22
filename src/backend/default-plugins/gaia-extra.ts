import * as path from 'path';
import { Readable } from 'stream';
import { Router } from 'express';
import { getLogger, Logger } from '@log4js-node/log4js-api';
import { PluginApiInterface, Plugin } from '../data/plugin';

import { streamToBuffer, bufferToStream } from '../util';
import { ADDRESS_PATH_REGEX, wrapAsync, parseAddressPathRegex, ensureStream } from '../services/api/middleware';
import axios from 'axios';

interface GaiaExtraPluginConfig {
  metadata_dirname: string;
}

class GaiaExtraPlugin implements Plugin {

  private id: string;
  private api: PluginApiInterface;

  private metadataDirname: string;
  private router: Router;
  private logger: Logger;

  private hash(buffer: Buffer) {
    return 'unknown';
  }

  async beforeStore(options: {
    path: string
    storageTopLevel: string
    contentType: string
    contentLength: number
    stream: Readable
  }): Promise<{
    path: string
    storageTopLevel: string
    contentType: string
    contentLength: number
    stream: Readable
  }> {
    if(options.path.startsWith(this.metadataDirname))
      return options;

    const buffer = await streamToBuffer(options.stream);
    const hash = this.hash(buffer);

    await this.api.gaia.store(options.storageTopLevel, path.join(this.metadataDirname, options.path), {
      contentType: options.contentType,
      contentLength: options.contentLength,
      stream: bufferToStream(Buffer.from(JSON.stringify({ hash }), 'utf8'))
    });

    return Object.assign({ }, options, { stream: bufferToStream(buffer) });
  }

  async init(id: string, config: GaiaExtraPluginConfig, api: PluginApiInterface) {
    this.id = id;
    this.api = api;
    this.metadataDirname = String(config.metadata_dirname || '.gaia_extra_metadata');
    this.logger = getLogger('plugins.' + id);

    this.router = Router();
    this.router.post(new RegExp(`/store-safe/${ADDRESS_PATH_REGEX}`),
    parseAddressPathRegex, ensureStream,
    wrapAsync(async (req, res) => {

      const oldHash = String(req.query.old_hash);

      const read = await this.api.gaia.read(req.params.address, path.join(this.metadataDirname, req.params.path));
      const actualOldHash = ('stream' in read) ?
        (await streamToBuffer(read.stream)).toString('utf8')
        : await axios.get(read.redirectUrl, { responseType: 'text' });

      if(oldHash !== actualOldHash)
        throw Object.assign(new Error('Hash mismatch -- attmpted to store over a newer version of the file.'), { type: 'not_allowed' });

      const errors = await this.api.gaia.store(req.params.address, req.params.path, {
        contentType: req.headers['content-type'],
        contentLength: Number(req.headers['content-length']) || 0,
        stream: (req as any).stream || req
      }, req.user.address);

      if(errors.length > 0) {
        const errs = errors.map(e => {
          switch((e as any).type) {
            case 'not_found_error': return '404 Not Found';
            case 'not_allowed_error': return '403 Not Allowed';
            case 'malformed_error': return '400 Malformed: ' + e.message;
            default:
              this.logger.error(`Error performing write:`, e);
              return '500 Failed to preform write.';
          }
        });
        const status = errs.map(a => Number(a.slice(0, 3)))
            .reduce((acc, c) => acc && c ? acc : 500, Number(errs[0].slice(0, 3)));
        res.status(status).json({
          publicURL: `${this.api.meta.origin()}/gaia/read/${req.params.address}/${req.params.path}`,
          errors
        });
      } else {
        res.status(200).json({
          publicURL: `${this.api.meta.origin()}/gaia/read/${req.params.address}/${req.params.path}`,
        });
      }
    }));
    return {
      name: 'Gaia-Extra',
      longId: 'io.github.michaelfedora.hestia.gaiaExtra',
      authedUserRouter: this.router
    };
  }
}

export default new GaiaExtraPlugin();
