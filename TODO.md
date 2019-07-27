## TODO

### backend

done?

### frontend

done?

## Later

### backend

- overarching admin feature (`/api/v1/admin/` + frontend work)
  - manage users & user-whitelist

- disk-driver - queue file writes so we don't get too busy
  - per file? per bucket?

- gaia-driver - separate files into parts if they are too big
  - how do we even know if they are too big? :thonk:

- app-db plugin - allow using apps to use the db (with realtime changefeeds)
  - realtime changefeeds are done by the web api, *not* by the underlying db
  - queue work orders to not stress out the db too much(?)

- plugin API - allow storing in gaia via internal bucket address
  - perhaps use new buckets instead? `/{plugin.longId}`? `/{plugin.id}`?
    - this is because syncing... unless it doesn't matter and they
    can just store all internal-hestia-plugin data b/c it shouldn't
    take up too much space (maybe mail will w/ attatchments)

- push notifications service - [web-push](https://www.npmjs.com/package/web-push)
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

- inboxes plugin!
  - use {internal address}/inboxes
  - `/plugins/inboxes/poll?since={time}`
  - `/plugins/inboxes/connect` - websocket notifications
  - use bucket token to subscribe/poll for specific bucket
  - use user token to subscribe to everything(?)
  - use push notifications

- sync plugin:
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

- gaia passthrough plugin?
  - for app-devs who want hestia functionality but have to deal with normal gaia users
  - uses gaia-driver backend w/ psuedo-user idk

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
