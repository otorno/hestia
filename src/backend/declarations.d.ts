import { Request } from 'express-serve-static-core';

declare module 'express' {
  interface Request {
    user?: any;
    auth?: {
      token: string;
      issuerAddress: string;
      signerAddress: string;
      issuedAt: number;
      claimedHub?: string;
      validHub?: boolean;
    };
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: any;
    auth?: {
      token: string;
      issuerAddress: string;
      signerAddress: string;
      issuedAt: number;
      claimedHub?: string;
      validHub?: boolean;
    };
  }
}
