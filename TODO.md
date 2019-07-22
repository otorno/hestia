## TODO

- test on production env (hestia.otorno.cc)

### backend

done?

### frontend

done?

## Later

### backend

- put metadata in `gaia/list-files` because why not (v1.1)

- DB drivers (v1.1)
  - replace the db instance so we can run off of mongo, postgre, etc.

- direct links to save bandwidth? (V1.1)
  - yes if config'd - `dl.dropbox.com` works so that's really good

- hestia/gaia driver (v1.1)
  - use another hestia/gaia node as a storage backend
  - Blockstack PBC gaia node as auto register, ezpz

- overarching admin feature (`/api/v1/admin/` + frontend work) (v1.1)
  - manage users & user-whitelist

- mail plugin
  - haraka for SMTP inbound/outbound to other emails
  - use plugin to communicate with hestia internal api (`/plugins/mail/internal/queue`, etc)
    - use internal auth token system that is in haraka-plugin's config
  - standard http api for cross-hestia "emails" (no offense smtp)
  - store subject/plaintext content in db for indexing/searching
  - use custom js api for everything inbox related (no offense imap)
  - use "mail" collection (??)
  - allow local usernames, or, redirect to username's mail-node
    - something in the zone file...

- sync plugin:
  - when conn starts working, back off
  - in drivers -- check metadata so no doubling jobs?

- google drive driver ([link](https://developers.google.com/drive/api/v3/about-sdk))
- one drive driver ([link](https://docs.microsoft.com/en-us/onedrive/developer/?view=odsp-graph-online))

- gaia-extra plugin
  - temporary files
  - collections (/{hestia-address}/{folder})

- index-update-plugin using driver.listfiles
  - backup to .metadata/index.json
  - throw errors if it detects the gaia-backed-up index is mismatched (with old pushed update)

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
