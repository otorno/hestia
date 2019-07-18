export interface DriverConfig {
  path: string;
  icon_url?: string;
  whitelist?: string[];
  auto_register?: boolean;
  root_only?: boolean;
}

export interface PluginConfig {
  [key: string]: any;
  path: string;
}

export interface Config {
  port: number; // The port to serve the application on
  ip: string; // The ip (generally `0.0.0.0`) to serve the application on
  protocol: string; // The protocol (`http` or `https`) to serve the application on
  server_name: string; // The server name (e.x. `localhost:{port}` or `hestia.otorno.cc`)
  valid_hub_urls?: string[]; // (optional) Other valid hub urls for apps to make requests

  db_host: string; // The RethinkDB host (default: `127.0.0.1`)
  db_port: number; // The RethinkDB port (default: `28015`)

  whitelist?: string[]; // (optional) A list of addresses which are whitelisted to use the node

  max_blob_size: string | number; // The maximum blob size for files (i.e. "5mb", 5242880)
  page_size?: number; // The pagination size for list-files

  root_plugin?: string; // The plugin to use as the `/` plugin, i.e. for a web interface

  // driver configs
  drivers: { [id: string]: DriverConfig };

  // plugin configs
  plugins: { [id: string]: PluginConfig };
}

export default Config;
