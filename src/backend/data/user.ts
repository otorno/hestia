import { NotFoundError } from './hestia-errors';

export interface SerializedUser {
  address: string;
  internalBucketAddress: string;
  defaultConnection: string;
  buckets: string[];
  connectionIds: string[];
  connections: {
    buckets: number[];
    driver: string;
    name: string;
    config: any;
  }[];
}

export class User {
  address: string;
  internalBucketAddress: string;

  defaultConnection: string;

  // [uuidv4]: { ... }
  connections: { [id: string]: {
    driver: string; // driver id (e.x. "harddisk", "udb")
    name: string;
    config: any;
    buckets: string[];
  }; };

  // [bucket address]: { driver, iter }[] ??
  // [driver id]: { ... }[] ??

  connectionId?: string; // for "makeSafe"
  driverConfig?: any; // for "makeSafe"

  constructor(user?: Partial<User>) {
    this.address = String(user.address || '');
    this.internalBucketAddress = String(user.internalBucketAddress || '');
    this.defaultConnection = String(user.defaultConnection || '');

    this.connections = { };
    if(user.connections && typeof user.connections === 'object') {
      for(const key in user.connections)
        if(user.connections[key] && typeof user.connections[key] === 'object')
          this.connections[key] = Object.assign({}, user.connections[key]);
    }

    this.connectionId = user.connectionId || '';
    this.driverConfig = user.driverConfig ? Object.assign({}, user.driverConfig) : null;
  }

  public getConnections(address: string) {
    const connections: string[] = [];

    for(const connId in this.connections) if(this.connections[connId]) {
      if(this.connections[connId].buckets.includes(address))
        connections.push(connId);
    }

    if(connections.length === 0)
      connections.push(this.defaultConnection);

    return connections.map(id => ({ id, ...this.connections[id] }));
  }

  public serialize(): SerializedUser {
    const connections = Object.values(this.connections);
    const buckets = connections.reduce((acc, c) => {
      for(const b of c.buckets)
        if(!acc.includes(b))
          acc.push(b);
      return acc;
    }, [] as string[]);
    const u: SerializedUser = {
      address: this.address,
      internalBucketAddress: this.internalBucketAddress,
      defaultConnection: this.defaultConnection,
      buckets,
      connectionIds: Object.keys(this.connections),
      connections: connections.map(c => Object.assign({}, c, { buckets: c.buckets.map(b => buckets.indexOf(b)) })),
    };
    return u;
  }

  public static deserialize(obj: SerializedUser): User {
    if(!(
      obj.connectionIds && obj.connectionIds instanceof Array &&
      obj.connections && obj.connections instanceof Array &&
      obj.buckets && obj.buckets instanceof Array))
      throw new Error('Cannot deserialize user: Malformed!');

    const connections = { };

    for(let i = 0; i < obj.connectionIds.length; i++) {
      connections[obj.connectionIds[i]] = Object.assign({}, obj.connections[i], {
        buckets: obj.connections[i].buckets.map(a => obj.buckets[a] )
      });
    }

    return new User({
      address: obj.address,
      internalBucketAddress: obj.internalBucketAddress,
      defaultConnection: obj.defaultConnection,
      connections
    });
  }

  public removeConnection(connId: string) {
    delete this.connections[connId];
  }

  public getConnectionArray() {
    const conn = [];
    for(const id in this.connections) if(this.connections[id])
      conn.push({ id, ...this.connections[id] });
    return conn;
  }

  /**
   * Make the user object safe for a single connection.
   * @param connection The uuidv4 driver id
   */
  public makeSafeForConnection(connection: string) {
    if(!this.connections[connection])
      throw new NotFoundError('No connection of id "' + connection + '" found!');

    return new User({
      address: this.address,
      connections: { [connection]: Object.assign({},
        this.connections[connection],
        { buckets: this.connections[connection].buckets.slice() })
      },
      connectionId: connection,
      driverConfig: this.connections[connection].config
    });
  }

  /**
   * Make the User object safe for the driver `register` and `postRegisterCheck`.
   * This contains all of the buckets and connections it has access to.
   * @param driver The driver config (friendly) id
   */
  public makeSafeForDriver(driver: string) {
    const connections = { };
    for(const k in this.connections) {
      if(this.connections[k] && this.connections[k].driver === driver) {
        connections[k] = Object.assign({}, this.connections[k]);
        connections[k].buckets = this.connections[k].buckets.slice();
      }
    }

    return new User({
      address: this.address,
      connections
    });
  }
}
