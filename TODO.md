## TODO

- test a lot
 - client syncing / changing buckets for folders
- test on production env (hestia.otorno.cc)

### backend

done?

### frontend

done?

## Later

### backend

- index-update-plugin using driver.listfiles
  - backup to .metadata/index.json
  - throw errors if it detects the gaia-backed-up index is mismatched (with old pushed update)

- sync plugin:
  - when conn starts working, back off
  - in drivers -- check metadata so no doubling jobs?

- backup plugin (1.1)
- migrate plugin?
- hestia driver?

- implement overarching  `admins` feature or remove from config
  - what does this even do -- list all users, delete them, etc?
  - edit config and restart somehow?

### frontend

- move/copy/delete/upload (1.1)
  - dragging!
- new status/working ui?
  - overall progress vs current progress (impossible to tell)
  - list of all working items, with cancel button, to see what's been done and what hasn't
- "preview pane" for small enough files (no decode)
  - "this file seems encrypted" warning info-bar on top of pane
