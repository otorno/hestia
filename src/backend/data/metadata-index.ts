
export interface Metadata {
  contentType: string;
  size: number;
  hash: string;
  lastModified: Date;
}

export interface ExpandedMetadataIndex {
  [path: string]: { [connId: string]: Metadata };
}

export interface MetadataIndex {
  [path: string]: Metadata & { connIds: string[] };
}

export interface ConnectionMetadataIndex {
  [path: string]: Metadata;
}
