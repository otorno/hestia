# Hestia

*Psuedo-Decentralized Storage Middelware, or in other words, a Multi-Backend Gaia Hub*

![screenshot.png](./gfx/screenshot.png)

Shortcuts:
- [About / Goals](#about--goals)
- [Installation / Setup](#installation--setup)
- [Configuration](#configuration)
- [Drivers](#drivers)
- [Plugins](#plugins)
- [Building & Testing](#building--testing)
- [License](#license)

## About / Goals

The goal of Hestia is to serve as a more complex
[Gaia Hub](https://github.com/blockstack/gaia). While the original software works well,
it works simply and cannot solve certain problems, such as those posed by using personal
cloud storage providers as backends while also allowing any end-user to do so.

Hestia was made so that any Blockstack user could use their personal cloud storage
(i.e. Dropbox, Google Drive, etc) as their own storage backend, to have full control
over both ends (writing the files and accessing the backend). While this node, which
serves as middleware, is still controled by a third-party, it can easily be run by
any user as well, whether for themselves, for their family, or their organization.

```
End User -> Gaia -> Amazon S3
End User -> Hestia -> End User's Dropbox
```

In addition, because of it's inherent complexity, more features have been added to allow
extension by third party plugins and other drivers, whether locally created or imported
through `npm`. There are also more configuration options on the default drivers, such as
the Disk driver being able to limit how much overall storage it is using, as well as
how much each user is allowed to store. It can also limit a driver to only being able to be
used as their identity folder -- i.e. only their profile.json and avatar will be stored
on the driver backend, and all other apps that attempt to use the driver will fail.

It also provides a singular Gaia interface for all backends -- the user manages what
drivers handle what addresses. For instance, an end-user could have their Dropbox
handle Stealthy data, while their Google Drive can handle their Travelstack data. All
drivers get your identity folder, however, and some drivers allow you to use them more than once;
for instnace, you could attatch two dropbox instances to your account if you so desired.

```md
User Connections:
- Disk (identity only, 5mb limit)
- Dropbox 1 (personal, 2gb limit, default (store everything))
- Dropbox 2 (team, 2gb limit, stealthy.im only)
```

There are some downsides, however:
- It is required to use an association token for every request, as the Hestia node needs to know
the end-user's address to be able to read the connection information
- Connection information (such as dropbox tokens) are stored unencrypted within the Hestia node
  - These can obviously still be revoked, and should not seem more unsecure than any other app
  requesting to use your dropbox.
- Bandwidth is used for reading, instead of only writing
  - The normal Gaia Hub generally uses a redirect to the content url, but Hestia downloads
and re-serves it, without caching, and so it can use a lot of bandwidth if large amounts of
traffic exist.


[Back to top](#)

## Installation / Setup

- Make sure RethinkDB 2.3.5+ is installed and running
- `npm i`
- `npm run build-prod`
- Copy `config.sample.json`, rename to `config.json` and configure (see:
[Configuration](#configuration) below)
- `npm start`

[Back to Top](#)

## Configuration

A sample config file is provided in [`config.sample.json`](config.sample.json), but
here is an annotated configuration below:

```typescript
interface Config {
  port: number; // The port to serve the application on
  ip: string; // The ip (generally `0.0.0.0`) to serve the application on
  protocol: string; // The protocol (`http` or `https`) to serve the application on
  server_name: string; // The server name (e.x. `localhost:{port}` or `hestia.otorno.cc`)
  valid_hub_urls?: string[]; // (optional) Other valid hub urls for apps to make requests to

  db_host: string; // The RethinkDB host (default: `127.0.0.1`)
  db_port: number; // The RethinkDB port (default: `28015`)

  session_secret: string; // The session secret key (e.x. `keyboard cat`)
  session_name: string; // The session cookie name (default: `hestia`)

  admins?: string[]; // (optional) A list of addresses which are considered "admins"
  whitelist?: string[]; // (optional) A list of addresses which are whitelisted to use the node

  max_blob_size: string | number; // The maximum blob size for files (i.e. "5mb", 5242880)

  root_plugin?: string; // The plugin to use as the `/` plugin, i.e. for a web interface

  // driver configs
  drivers: {
    [key: string]: any; // this driver ID
    path: string; // the path to the driver for `import({path})`
    icon_url?: string; // (optional) the url for the icon to use
    whitelist?: string[]; // (optional) A list of addresses that are whitelisted for the driver
  }[];

  // plugin configs
  plugins: {
    [key: string]: any; // the plugin ID
    path: string; // the path to the plugin for `import({path})`
  }[];
}
```

[Back to top](#)

## API

Most routes need some sort of authentication token in order to work properly, but in
general there are three types:
- Those that do not need any (denoted as "`/route`(~)")
- Those that need normal gaia authentication (denoted as "`/route` (*)")
- And those that need what is called a "user" authentication (denoted as "`/route` (!)")

A "user" authentication token is a token which is either authed for the Gaia Hub itself
as if it were an app (i.e. properly issued to `server_name`) or one that is issued for
the id's root bucket (i.e. if the issuer and signer are the same address).

Any token besides ones for which the signer and issuer are equal need to be signed with
an "Association Token," which is a sub-token inside of the overarching token. Please see
the [`Gaia Hub`](https://github.com/blockstack/gaia) Repo for more information on the
structure of both the normal token and the association token.

### Meta Routes - `/`

- `/env` -- Get the current NODE_ENV
- `/plugins/{id}/...` - Use the plugin routes. See the specific plugins for documentation.
- `/manifest.json` - A computed Manifest.json that is generated from the config file,
for signing into the Hestia node with Blockstack authentication.

### Gaia Routes - `/gaia`

The gaia route group, of which all (should) align with the spec listed in the
[`Gaia Hub`](https://github.com/blockstack/gaia) repo. This route is what is used in
browser configurations which need a link to your gaia hub (i.e. `server_name/gaia`).

  - GET `/gaia/hub_info` (~) - Read the hub info
  - GET `/gaia/read/{address}/{path}` (~) - Read a file from the given bucket address
and file path
  - POST `/gaia/store/{address}/{path}` (*) - Store a file to the given bucket address
and path. Post the contents as a body or urlencoded stream, preferably with a mime-type
and content-length.
  - DELETE `/gaia/delete/{address}/{path}` (*) - Delete the file given by the bucket
address and path
  - POST `/gaia/list-files/{address}` (*) - List the files in the given bucket. Within
the body, put a JSON object with `{ page: number }` to specify the page number. Returns
`{ entries: string[], page?: number }`, with entries being full-length paths and page
only existing if there is another page to show.
  - POST `/revoke-all/{address}` (*) - Revoke all tokens in the given bucket up to a
value (in seconds) in the body which is formatted as so: `{ oldestValidTimestamp: number }`.

### API Routes - `/api/v1`

Miscellaneous API routes are as follows:

- `/api/v1/plugins` (~) - Returns the list of plugins and their IDs, as well as whatever
info they want to include in the `getInfo` function.
- `/api/v1/drivers` (~,!) - Return the available drivers and, if logged in, the current
connections in the following format:
```typescript
interface {
  current?: { id: string, name: string, driver: string, rootOnly?: boolean }[],
  available: { id: string, name: string, rootOnly?: boolean, multi?: boolean }[]
}
```
- `/api/v1/drivers/{id}/icon` (~) - Get the icon for a particular driver
- `/api/v1/drivers/{id}/register` (!) -  Register for a particular driver -- you can either
put the auth token in the `Authorization: Bearar {token}` header or as a query parameter
`?authorizationBearer={token}`.

### User Routes - `/api/v1/user`

Some of these routes have the two symbols "(*!)" -- this simply means that they are only
partially validated and not checked against whether or not the bucket or user exists, or that
the claimed Gaia-Hub in the token is the actual Hestia hub -- the token is simply used to
authenticate.

- POST `/api/v1/user/validate-token` (!) - Validates the token used to see if it is valid in
regards to using the API with it.
- POST `/api/v1/user/register` (*!) - Registers the user to the Hestia hub and auto-registers 
them for any drivers that are labeled as such.
- POST `/api/v1/user/unregister` (*!) - Unregisters the user from all drivers and then deletes
the user from the database.
- GET `/api/v1/user/gdpr` ! - Get's a JSON'd file of the user object stored in the database.
Be careful, as this includes any and all tokens and keys generated for the driver connections.

### Connection Routes - `/api/v1/connections`

All routes within the `/api/v1/connections` group require an authed user token, and some of
them are very similar to the routes found under `/gaia`. One trait they do all share in
common, however, is that the very first parameter is the `{id}` field, which is the connection
ID itself -- you can get this from the `current` sub-object in the `/drivers` return object
(when requested with a valid token).

- POST `/api/v1/connections/{id}/set-default` (!) - Set this connection to be the "default",
which means that all new store requests will be forwarded to this address if they are not
already configured to go to a specific one.
- GET `/api/v1/connections/{id}/info` (!) - Get the info for a particular connection; returns
`{ spaceUsed?: number, spaceAvailable?: number }`.
- DELETE `/api/v1/connections/{id}` (!) - Delete the connection -- **NOTE:** this may or may
not clear the data in the backend, and all data within the connection is assumed to be lost
and unrecoverable.
- POST `/api/v1/connections/{id}/set-buckets` (!) - Set the bucket addresses for the
connection; put a `string[]` in the body, in JSON format.

- POST `/api/v1/connections/{id}/store/{address}/{path}` (!) - See `/gaia/store`.
- GET `/api/v1/connections/{id}/read/{address}/{path}` (!) - See `/gaia/read`. This one still
requires the user to be authenticated because connection IDs are not unique across all users.
- DELETE `/api/v1/connections/{id}/delete/{address}/{path}` (!) - See `/gaia/delete`.
- POST `/api/v1/connections/{id}/list-files` (!) - Similar to the `/gaia/list-files` except
that it doesn't require an address (it actually can't be given one) -- this is because the
connection will instead list all files the connection has access to.

[Back to top](#)

## Drivers

Drivers can be included by adding them in the `config.json`. The `path` field is used to
import them. `default-drivers` is the prefix for using default drivers, otherwise you can use
a relative import (from the root directory where `hestia.js` is run from -- i.e when using
`npm start` it will be the root repository director), or a import from `node_modules` as you
would normally do from a script (i.e. `npm i my-hestia-driver` and then, in the `config.json`,
`"path":` would be `"my-hestia-plugin"` and that's it).

Default drivers are the Disk driver (`default-drivers/disk`), which allows you to use the Disk,
and the User-Dropbox driver (`default-drivers/user-dropbox`), which allows users to use their
own Dropbox cloud storage as their provider (and also fulfills one of the goals of this project).

### Driver Configuration

Every driver can take the following options:

```typescript
export interface DriverConfig {
  path: string; // the path where the driver is located
  icon_url?: string; // (optional) a url to use for the icon instead of the default provided one
  whitelist?: string[]; // (optional) a whitelist of users who can use the driver
  auto_register?: boolean; // (optional) whether or not users should be auto-registered for the 
                           // driver when they themselves register
  root_only?: boolean; // (optional) whether or not the driver should only be allowed for
                       // the root (identity) directory
}
```

> **Tip:** `root_only` is a fantastic option so that users can automatically register for your
> Hestia Hub without going through the hoops to register their own storage backend first. For
> instance, if you are limited on Disk space, but want to make it easy for users to get started
> using your hub, simply use the disk driver (below), limit it to `5mb` or less for each user,
> and make it root only -- Users will automatically be able to register to the Hestia hub, but
> will have to register another driver in order to actually use it for applications.

View each drivers's docs to see how it needs to be configured.

For the default drivers, see below:

```typescript
// path: `default-drivers/disk`
interface DiskDriverConfigType extends DriverConfig {
  storage_root_directory: string; // the directory to put the files (default: `./hestia-storage`)
  page_size: number; // the page size for list-files (default: 50)
  
  // for storage caps (below), use a number of bytes or a string representation (i.e. "5mb")
  max_user_storage: string | number; // the storage cap for each  user (default: unlimited)
  max_total_storage: string | number; // the storage cap for Hestia (default: unlimited)
}

// path: `default-drivers/user-dropbox`
interface UserDropboxDriverConfig extends DriverConfig {
  clientId: string; // the clientId for the http dropbox API
  secret: string; // the clientSecret for the http dropbox API
  page_size: number; // the page size for list-files (default: 50)
}
```

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

[Back to top](#)

## Plugins

Plugins can be included by adding them in the `config.json`. The `path` field is used to
import them. `default-plugins` is the prefix for using default plugins, otherwise you can use
a relative import (from the root directory where `hestia.js` is run from -- i.e when using
`npm start` it will be the root repository director), or a import from `node_modules` as you
would normally do from a script (i.e. `npm i my-hestia-plugin` and then, in the `config.json`,
`"path":` would be `"my-hestia-plugin"` and that's it).

Default plugins are the Dashboard plugin (`default-plugins/dashboard`), which adds the Hestia
frontend to the server (and must be the `root_plugin` in order to work properly), and the
Backup plugin (`default-plugins/backup`), which adds backup functionality to the Hestia hub.

There are no routes added by the Dashboard plugin, but the Backup plugin adds three, all of
which require an authenticated user (replace `/plugins/backup` with
`/plugins/{your chosen id}` on your own instance):

- `/plugins/backup/request-backup` -- Requests a backup to be started
- `/plugins/backup/backup-ready` -- Checks if the backup is ready or not
- `/plugins/backup/download` -- Serves you a download link to the (large) backup zip file

### Plugin Configuration

Every plugin config requires a `path` field to specify where it is located at:

```typescript
interface PluginConfig {
  path: string;
}
```

View each plugin's docs to see how it needs to be configured specifically.

For the default plugins, see below:

```typescript
// path: `default-plugins/dashboard`
interface DashboardPluginConfig {
  root_directory?: string; // defaults to `__dirname/../../frontend"` (i.e. `./build/frontend`)
}

// path: `default-plugins/backup`
interface BackupPluginConfig {
  temp_directory?: string; // default: `__dirname/backups` (i.e. `./build/backend/default-plugins/backups`)
}
```

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

[Back to top](#)

## Building & Testing

- `npm run build` - build debug, output to `./build`
- `npm run build-prod` - build prod, output to `./build-prod`
- `npm test` - start the debug build (`./build`)
- `npm start` - start the prod build (`./build-prod`)

[Back to top](#)

## License

Released under [Mozilla Public License 2.0](LICENSE.md), with graphics under
[CC BY-SA 4.0.](https://creativecommons.org/licenses/by-sa/4.0/)

Parts of the 7-Zip program are used (for the backup plugin), which is licensed
under the GNU LGPL license. You can find the source code for 7-Zip at
[www.7-zip.org](https://www.7-zip.org).

[Back to top](#)
