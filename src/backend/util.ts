import { ECPair } from 'bitcoinjs-lib';
import bytes = require('bytes');
import { Readable, Stream } from 'stream';
import { createHash } from 'crypto';

export const configIdRegex = /^[\w\d][\w\d\.\-]*(?:\/[\w\d][\w\d\.\-]*)*$/;

export const trueArray = ['1', 1, true, 'true'];

export function parseBytes(v: string | number) {
  return typeof v === 'string' ? bytes.parse(v) : Number(v) || 0;
}

export function streamToBuffer(stream: Readable) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks = [];
    stream.on('data', data => chunks.push(data));
    stream.on('error', reject);
    stream.on('drop', count => reject(new Error(`Dropped ${count} items from stream!`)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.resume();
  });
}

export function bufferToStream(buffer: Buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

export function hashStream(stream: Readable) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    stream.on('error', reject);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function hashBuffer(buff: Buffer) {
  const hash = createHash('sha256');
  hash.update(buff);
  return  hash.digest('hex');
}

export function pubkeyHexToECPair (pubkeyHex: string) {
  const pkBuff = Buffer.from(pubkeyHex, 'hex');
  return ECPair.fromPublicKey(pkBuff);
}

// from: https://github.com/jfromaniello/url-join/blob/master/lib/url-join.js
/**
 * Join urls, akin to `path.join`
 * @param urls The urls to join
 */
export function urljoin(...urls: string[]) {
  if(urls.length <= 0) return '';
  if(urls.length === 1) return urls[0];
  const ret = [];

  // If the first part is a plain protocol, we combine it with the next part.
  if (urls[0].match(/^[^/:]+:\/*$/) && urls.length > 1) {
    const first = urls.shift();
    urls[0] = first + urls[0];
  }

  // There must be two or three slashes in the file protocol, two slashes in anything else.
  if (urls[0].match(/^file:\/\/\//)) {
    urls[0] = urls[0].replace(/^([^/:]+):\/*/, '$1:///');
  } else {
    urls[0] = urls[0].replace(/^([^/:]+):\/*/, '$1://');
  }

  for (let i = 0; i < urls.length; i++) {
    let component = urls[i];

    if (typeof component !== 'string')
      throw new TypeError('Url must be a string. Received ' + component);
    if (component === '') continue;
    else if (i > 0) // Removing the starting slashes for each component but the first.
      component = component.replace(/^[\/]+/, '');
    else if (i < urls.length - 1) // Removing the ending slashes for each component but the last.
      component = component.replace(/[\/]+$/, '');
    else // For the last component we will combine multiple slashes to a single one.
      component = component.replace(/[\/]+$/, '/');

    ret.push(component);
  }

  let str = ret.join('/');
  // Each input component is now separated by a single slash except the possible first plain protocol part.

  // remove trailing slash before parameters or hash
  str = str.replace(/\/(\?|&|#[^!])/g, '$1');

  // replace ? in parameters with &
  const parts = str.split('?');
  str = parts.shift() + (parts.length > 0 ? '?' : '') + parts.join('&');

  return str;
}
