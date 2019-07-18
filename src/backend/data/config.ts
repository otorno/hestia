export interface DriverConfig {
  // [key: string]: any;
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
  port: number;
  ip: string;
  protocol: string;
  server_name: string;
  valid_hub_urls?: string[];

  db_host: string;
  db_port: number;

  session_secret: string;
  session_name: string;

  whitelist?: string[];

  max_blob_size: string | number;

  root_plugin?: string;
  page_size?: number;

  drivers: DriverConfig[];
  plugins: PluginConfig[];
}

export default Config;
