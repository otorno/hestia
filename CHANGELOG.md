# Release v1.2

## Breaking Changes

## Changes

- Updated dependencies

### Frontend

### Backend

- Added Inboxes plugin(!)
  - GET `/plugins/{id}/{address}` with the appropriate token to get a list of notifcations to read (returns an array of urls)
    - Can specify `?after={date}` and `?before={date}` query parameters to limit what is returned
  - POST `/plugins/{id}/{address}` with the any token to post a notification to that address (notification data is stored in the senders bucket)

- Added the ability to specify what type of authed router you want
  - `authedAnyRouter` (/plugins/{id}/...) validates any type of token (both user and bucket) but doesn't check whether the
  issuer "belongs" to the route.
  - `authedBucketRouter` (/plugins/{id}/{bucket}/...) validates whether the token is assigned to the bucket
  - `authedUserRouter` (/plugins/{id}/...) validates the token is a user-token (for root address or internal hestia address)

- The plugin initialization `authedRouter` return is now **deprecated** -- use `authedUserRouter` instead for the same feature set

- Authorization now passes some data to `req.params.auth`, including the separate issuerAddress, signerAddress, and the token
  itself.

  - Added "App DB" plugin which allows an app (using the key specified in `app_key`) to
use the the underlying database for "decentralized" database functionality

- Fixed typings

# Release v1.1

## Breaking Changes

- Reorganized DB interface layout
  - this includes the plugin api, so those will break if you have been developing one
  even though it's only been ***four days*** geeze it hasn't been that long has it

- Modified Driver Type to separate autoRegister calls from register calls

## Changes

### Frontend

- When switching buckets, delete old connections only after full sync
  - before, it would remove the connection *first*, thus deleting all the files before
  they synced

### Backend

- Added experiemental metadata switch in `gaia/list-files`
  - see: [gaia pull #249](https://github.com/blockstack/gaia/pull/249)

- Switched from 7zip to [yazl](https://github.com/thejoshwolfe/yazl)
  - removed a binary (yay!)

- Added DB driver functionality
  - You can now run off of any DB you want (as long as they have a driver)

- Added RethinkDB DB Driver
- Added Sqlite3 DB Driver
  - the default one if none is selected, so you can run hestia without installing any db
  - also adds a binary :(

- Added the ability for drivers to use (re)direct links to save bandwidth

- Updated Dropbox Driver
  - No longer caches `list-files` calls, because all of that is done via the metadata
  database anyways.
  - Now uses direct (shared) links, which are created on register and on file-read if
  they do not exist.
  - No longer uploads metadata files (as it is stored in the database)
  - Files less than 8mb in size now attempt to upload via the normal endpoint
  instead of being sent to the batch files upload endpoint (but will be sent there
  to try again if they fail)
    - this speeds up the uploading speed significantly

- Updated Disk Driver
  - No longer creates metadata files (as it is stored in the database)

- Added Gaia storage driver
  - Takes a token and uses that bucket as it's own storage endpoint
  - Uses direct links for reads
  - Can be used as a hub-driver (like the disk driver) when supplied a token
    - Hub-driver is auto-registerable
  - Can be used as a user-driver (like the dropbox driver) when not supplied a token
    - Registration requires this to be added: `?token={gaia token}`
  - Technically it can be used as both as well

- Made `/api/v1/connections/{id}/list-files` take a `{bucket}` instead of a `{path}`

- Added `?metadata={boolean}` option to `/gaia/read/{...}` to view (non-private) file metadata (contentType, size, hash)

- Removed a bunch of excess dependencies

- Handle closing the application better

# Release v1.0

Initial release (It's finally done)!
