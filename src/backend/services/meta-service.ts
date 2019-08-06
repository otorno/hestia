import { User } from '../data/user';
import Config from '../data/config';

import plugins from './plugin-service';
import drivers from './driver-service';

class MetaService {

  private serverName: string;
  private protocol: string;

  public init(config: Config) {
    this.serverName = config.server_name;
    this.protocol = config.protocol;
  }

  public plugins(): { id: string, name: string }[] {
    return plugins.getInfo().map(a => {
      const r = { id: a.id, name: a.name, longId: a.longId };
      const p = plugins.get(a.id);
      if(p && p.getInfo)
        return { ...r, ...p.getInfo() };
      else
        return r;
    });
  }

  public drivers(): { available: { id: string, name: string, longId: string, rootOnly?: boolean, multiUser?: boolean }[] };
  public drivers(user: User): {
    current: { id: string, name: string,  driver: string, default?: boolean, buckets: string[] }[],
    available: { id: string, name: string, longId: string, rootOnly?: boolean, multiUser?: boolean }[]
  };
  public drivers(user?: User): {
    current?: { id: string, name: string, driver: string, default?: boolean, buckets: string[] }[],
    available: { id: string, name: string, longId: string, rootOnly?: boolean, multiUser?: boolean }[]
  } {
    const available = drivers.getInfo().filter(a =>
      a.whitelist ?
        user ?
          a.whitelist.includes(user.address)
          : false
        : true).map(a => ({
      id: a.id,
      name: a.name,
      longId: a.longId,
      multiUser: a.multiUser,
      rootOnly: a.rootOnly
    }));

    if(!user)
      return { available };
    else {
      const current: { id: string, driver: string, name: string, default?: boolean, buckets: string[] }[] = [];
      for(const [connId, connection] of Object.entries(user.connections)) {
        current.push({
          id: connId,
          name: connection.name,
          driver: connection.driver,
          default: connId === user.defaultConnection ? true : undefined,
          buckets: connection.buckets
        });
      }

      return { current, available };
    }
  }

  public env(): string {
    return process.env.NODE_ENV || '{null}';
  }

  public origin(): string {
    return `${this.protocol}://${this.serverName}`;
  }

  public host(): string {
    return this.serverName;
  }
}

export default new MetaService();
