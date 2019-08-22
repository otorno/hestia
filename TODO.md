## TODO

- allow plugins to provide a login-path and return a user
  - i.e. login via dropbox/google/etc

### backend

- gaia pass-through (core plugin, disable-able but enabled by 
  defualt -- no id because it doesn't need to register)

- e2e plugin -- test plugin items and api routes with
  generated user/token (stored in plugin db)

- modularize authentication into auth-drivers (like db drivers)
  - current is "gaia-auth-driver"

### frontend

- When importing from migration index, on collision ask if you
want to overwrite or keep your current version
  - With "Do this for all occurences" check box

## Later

### backend

- overarching admin feature (`/api/v1/admin/` + frontend work)
  - manage users & user-whitelist

- inboxes plugin
  - websocket for live updates instead of polling?

- disk-driver - queue file writes so we don't get too busy
  - per file? per bucket?

- gaia-driver - separate files into parts if they are too big
  - set size limit for (hub-driver) gaia via `blob_size` setting
  - set size limit for (user-driver) via user config?

- app-db plugin - allow using apps to use the db (with realtime changefeeds)
  - realtime changefeeds are done by the web api, *not* by the underlying db
  - queue work orders to not stress out the db too much(?)
  - basically implemenet radiks

- plugin API - allow storing in gaia via internal bucket address
  - perhaps use new buckets instead? `/{plugin.longId}`? `/{plugin.id}`?
    - this is because syncing... unless it doesn't matter and they
    can just store all internal-hestia-plugin data b/c it shouldn't
    take up too much space (maybe mail will w/ attatchments)

- push notifications service -
[web-push](https://www.npmjs.com/package/web-push)
  - POST `/api/v1/push/subscribe`
    - with filter info in body
      - include: string[] (buckets)
      - exclude: string[] (buckets)
      - subjectRegex: string
      - bodyRegex: string
      - idk
    - returns subscription info
  - POST `/api/v1/push/unsubscribe`
    - with subscription info in body
  - internal (plugin) api for sending messages to users/buckets/etc
  - hook up inboxes plugin to it

- finish sync plugin:
  - when conn starts working, back off
  - in drivers -- check metadata so no doubling jobs?

- google drive driver ([link](https://developers.google.com/drive/api/v3/about-sdk))
- one drive driver ([link](https://docs.microsoft.com/en-us/onedrive/developer/?view=odsp-graph-online))

- gaia-extra plugin
  - temporary files
  - collections (/{hestia-address}/{collections}/{folder})

- index-update-plugin using driver.listfiles
  - backup to .metadata/index.json
  - throw errors if it detects the gaia-backed-up index is mismatched (with old pushed update)

- hestia-sync plugin
  - we can run a hestia node in-browser/on-phone/on-desktop and 
  then just sync from there, so if the remote node goes down
  we can still access our data

- hestia-shard(?) plugin
  - connect to a network of hestia nodes so if one gets taken down
  you can connect to a different one (ygg?)

- update db driver for plugins to allow plugins to create multiple tables & do advance actions
  - `api.db.plugin.createTable('my-table')` / `api.db.plugin.table('my-table').where(d => d('id').startsWith...`
  - sqlite3/rethinkdb/rocksdb(??)
  - redo db-service to use the underlying reql

### frontend

- move/copy/delete/upload
  - dragging!

- "preview pane" for small enough files (no decoding)
  - "this file seems encrypted" warning info-bar on top of pane

- mobile friendly
  - reduced ui, icon-view instead of detail view
  - taphold/rightclick for details
  - click to navigate (folder) or open (file)
  - `...` for migrating/etc
  - just working icon, no working status

- migrate to PWA (both mobile/desktop)

- optional push notifications for inboxes and/or syncing updates?

### other

- create an app that works using this
  - (using association token/etc)

- create a "hestia-client" that works for apps that need to use
  a hestia node w/ pass-through (or *nobs* feat) -- also allows
  them to create a local hestia node in the browser via
  https://dexie.org/ (future when we have hestia-sync)
