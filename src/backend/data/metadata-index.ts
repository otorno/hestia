
export interface Metadata {
  contentType: string;
  size: number;
  hash: string;
  lastModified: Date;
}

export function metadataTrim(data: Metadata) {
  return {
    contentType: data.contentType,
    size: data.size,
    hash: data.hash,
    lastModified: new Date(data.lastModified.getTime())
  };
}

export interface SerializedMetadataIndexEntry extends Metadata {
  // primary key
  key: string; // path + ':' + connId

  // secondary key
  path: string;
  // secondary key
  connId: string;
}

export interface GlobalMetadataIndex {
  [path: string]: { [connId: string]: Metadata };
}

export interface MetadataIndex {
  [path: string]: Metadata & { connIds: string[] };
}

export interface ConnectionMetadataIndex {
  [path: string]: Metadata;
}
