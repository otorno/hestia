# Contributing

## **!! Currently outdated, please see the default plugins and drivers for how to create them !!**

- [Drivers](#drivers)
- [Plugins](#plugins)

## Drivers

### Driver Creation

Drivers are simply given their ID and Name on creation. They require an `init` function and
are constructed using the following pattern (with sample code):

```typescript
import * as fs from 'fs-extra';
import * as path from 'path';

class MyDriver {
  constructor(id: name, config: any) { }

  public async init(): Promise<{
    name: string, icon: Buffer, multi?: boolean, autoRegisterable?: boolean
  }> {
    const icon = await fs.readFile(path.join(__dirname, 'mydriver-icon.png'));
    return { name: "My Plugin", icon, autoRegisterable: true };
  }
}

export default new MyDriver();
```

The `init` function is where you "setup" your driver using the config and then initialize
it with things that require some time. You must return an object (not a class), so while it
is recommended to use a class, as long as you return an object with an init function that
returns a promise (along with all the other required functions), it will work.

There are a number of required functions that a Driver needs to fill out, and these are as
seen below:

```typescript
interface Driver {

  // for `/gaia/read`
  performRead(options: {
    path: string;
    storageTopLevel: string;
    user: User;
  }): Promise<{ contentType: string, stream: ReadableStream }>;

  // for `/gaia/store`
  performWrite(options: {
    path: string;
    storageTopLevel: string;
    contentType: string;
    contentLength: number; // integer
    stream: ReadableStream;
    user: User;
  }): Promise<void>;

  // for `/gaia/delete`
  performDelete(options: {
    path: string;
    storageTopLevel: string;
    user: User;
  }): Promise<void>;

  // for `/gaia/list-files`
  listFiles(prefix: string, page: number, user: User): Promise<{ entries: string[], page?: number }>;


  // for `/api/v1/connections/{id}/info`
  getInfo(user: User): Promise<{
    spaceUsed: number,
    spaceAvailable?: number,
  }>;

  // for registering - `/api/v1/drivers/{id}/register`
  // note that the second time through `user` may not exist because there is no more token after
  // a redirect.
  register(user: User, redirectUri: string, req: { headers: { [key: string]: string | string[] }, body: any, query: any }): Promise<{
    redirect?: {
      uri: string
      headers?: {[key: string]: any},
    },
    finish?: { address: string, userdata?: any }
  }>;

  // alternative implementation for auto-registering or registering in one go
  register(user: User): Promise<{
    finish?: { address: string, userdata?: any }
  }>;

  // for checking things before we finish registering, so as to remove duplicates.
  // this is run after the second time through with a garunteed `User` object so
  // all driver-config data can be checked -- i.e. so the user doesn't register
  // two of the same dropbox accounts.
  postRegisterCheck?(user: User, newEntry: any): Promise<void>;

  // unregister the user from the driver -- can only use via connections API,
  // DELETE `/api/v1/connections/{id}`
  unregister(user: User): Promise<void>;
}
```

There are also optional event hooks you can use:

```typescript
interface Driver {

  /**
   * Ticks each 500ms unless the promise hasn't returned yet, in which case it doesn't fire.
   */
  tick?(): Promise<void>;
}
```

## Plugins

### Plugin Creation

Plugins have an injected API they can use so as to not fill up bandwidth. They require an
`init` function and are constructed using the following pattern:

```typescript
class MyPlugin {

  public async init(id: name, config: any, api: PluginApiInterface): Promise<{ name: string, router?: Router, authedRouter?: Router }> {
    return { name: "My Plugin" };
  }
}

export default new MyPlugin();
```

The `init` function is where you "setup" your plugin using the config and then initialize
it with things that require some time. You must return an object (not a class), so while it
is recommended to use a class, as long as you return an object with an init function that
returns a promise, it will work. Within the return object, two routers can be returned,
both of which will be mounted on `/plugins/{id}`, but one having a middleware which will
authenticate users and put the object in `req.user`. **Note:** The authenticated middleware
will overwrite any routes used in the unauthenticated middleware unless `next()` is used.

There are also optional event hooks and auxillary functions you can use:

```typescript
export interface Plugin {

  /**
   * Ticks each 500ms unless the promise hasn't returned yet, in which case it doesn't fire.
   */
  tick?(): Promise<void>;

  /**
   * Used by `meta-service` to get additional info to return on `/api/v1/plugins` for digestion
   * by clients.
   */
  getInfo?(): any;
}
```

The following is the api interface type for reference:

```typescript
export interface PluginApiInterface {
  meta: {
    plugins(): { id: string, name: string }[];
    drivers(): Promise<{
      available: { id: string, name: string, rootOnly?: boolean, multi?: boolean }[]
    }>;
    drivers(userAddress: string): Promise<{
      current: { id: string, name: string, driver: string, rootOnly?: boolean }[],
      available: { id: string, name: string, rootOnly?: boolean, multi?: boolean }[]
    }>;
    env(): string;
  };
  gaia: {
    read(address: string, path: string): Promise<{ contentType: string, stream: Readable }>;
    store(address: string, path: string,
      data: { contentType: string, contentLength: number, stream: Readable }, user?: User): Promise<Error[]>;
    delete(address: string, path: string): Promise<void>;
    listFiles(address: string, page?: number): Promise<{ entries: string[], page?: number }>;
  };
  db: {
    getUser(address: string): Promise<User>;
    getUserFromBucket(address: string): Promise<User>;
  };
  connections: {
    read(id: string, userAddress: string, address: string, path: string): Promise<{ contentType: string, stream: Readable }>;
    store(id: string, userAddress: string, address: string, path: string,
      data: { contentType: string, contentLength: number, stream: Readable }): Promise<void>;
    delete(id: string, userAddress: string, address: string, path: string): Promise<void>;
    listFiles(id: string, userAddress: string, page?: number): Promise<{ entries: string[], page?: number }>;

    info(id: string, userAddress: string): Promise<{ spaceUsed: number, spaceAvailable?: number }>;
    setDefault(id: string, userAddress: string): Promise<void>;
    setBuckets(id: string, userAddress: string, addresses: string[]): Promise<void>;
  };
}
```
