export interface DriverConfig {
  path: string; // the path where the driver is located
  name?: string; // (optional) a different name to use then the standard one
  icon_url?: string; // (optional) a url to use for the icon instead of the default provided one
  whitelist?: string[]; // (optional) a whitelist of users who can use the driver
  auto_register?: boolean; // (optional) whether or not users should be auto-registered for the
                           // driver when their account is registered
  root_only?: boolean; // (optional) whether or not the driver should only be allowed for
                       // the root (identity) directory
}

export interface PluginConfig {
  path: string; // the path where the plugin is located
}

export interface Config {
  port: number; // The port to serve the application on
  ip: string; // The ip (generally `0.0.0.0`) to serve the application on
  protocol: string; // The protocol (`http` or `https`) to serve the application on
  server_name: string; // The server name (e.x. `localhost:{port}` or `hestia.otorno.cc`)
  valid_hub_urls?: string[]; // (optional) Other valid hub urls for apps to make requests

  db_driver_path?: string; // (optional) the path where the db driver is located
                          //     (default: `default-db-drivers/sqlite3`)
  db_driver_config?: any; // (optional) the config for the db driver

  pm2?: boolean; // whether or not you are using pm2 (for logging issues)
  pm2InstanceVar?: string; // the instance ID if it is not default

  whitelist?: string[]; // (optional) A list of addresses which are whitelisted to use the node

  max_blob_size?: string | number; // (optional) The maximum blob size for files (i.e. "5mb", 5242880)
                                   // default is 7.5mb
  page_size?: number; // The pagination size for list-files

  root_plugin?: string; // The plugin to use as the `/` plugin, i.e. for a web interface

  // driver configs
  drivers: { [id: string]: DriverConfig };

  // plugin configs
  plugins: { [id: string]: PluginConfig };
}

export default Config;
