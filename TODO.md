## TODO

- test on production env (hestia.otorno.cc)

### backend

done?

### frontend

done?

## Later

### backend

- make DB drivers to replace the db instance so we can run off of mongo, postgre, etc.

- direct links to save bandwidth?
  - yes if config'd - `dl.dropbox.com` works so that's really good

- index-update-plugin using driver.listfiles
  - backup to .metadata/index.json
  - throw errors if it detects the gaia-backed-up index is mismatched (with old pushed update)

- sync plugin:
  - when conn starts working, back off
  - in drivers -- check metadata so no doubling jobs?

- migrate plugin?
  - can I keep data in the drivers (minus those that are unmigratable like local disk -- new 
  driver option?) and just export the metadata-index, to save a *ton* of bandwidth?

- mail plugin
  - haraka for SMTP inbound/outbound to other emails
  - standard http api for cross-hestia "emails"
  - store subject/plaintext content in db for indexing/searching
  - use custom js api for everything inbox related (no offense imap)
  - use "mail" collection

- gaia-extra plugin (v1.1)
  - temporary files
  - collections (/{useraddress}/{folder})

- hestia/gaia driver?
  - can I use another hestia/gaia node as a storage thing itself? probably.

- overarching admin feature (`/api/v1/admin/` + frontend work)
  - manage users, whitelist, maybe other options

### frontend

- move/copy/delete/upload (1.1)
  - dragging!

- "preview pane" for small enough files (no decoding)
  - "this file seems encrypted" warning info-bar on top of pane
