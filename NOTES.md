# NOTES

## `vigil.json` Schema

```typescript
interface schema {
  node: string; // the node address, i.e. `vigil.otorno.cc`
}
```

## Database Schema

```typescript
interface schema {
  username: string; // vigil username
  address: string; // public key / address of the user
  pass: string; // Password Encrypted Private Key
  oauth: { // oauth (no idea if this is correct)
    type: 'github' | 'twitter' | 'facebook' | 'google';
    userId: string; // an identifieable piece of user information from the oauth provider
    key: string; // encrypted private key via `code`
  }[];
  tokens: {
    iat: Date; // issued At
    exp: Date; // expires At
    sub: string; // subject
    desc: string; // description
    key: string; // encrypted private key via signature
  }[];
  twofactor: { // restricts access, doesn't encrypt
    email?: string;
    phone?: string;
    totpKey?: string;
    backupKeys?: string[];
  };
}
```
