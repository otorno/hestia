import { r } from 'rethinkdb-ts';
import db from '../services/database-service';
import { Store } from 'express-session';
import { Logger } from 'log4js';

export class RethinkSessionStore extends Store  {

  constructor(private logger: Logger, private options?: any) {
    super(options);
    this.options = this.options || { };
    this.options.browserSessionsMaxAge = this.options.browserSessionsMaxAge || 86400000; // 1 day

    setInterval(() => {
      db.sessions.between(0, r.now(), { index: 'expires' }).delete().run().then(
        res => res && res.deleted && this.logger.info('[SES]: Deleted ' + res.deleted + ' expired sessions.'),
        err => this.logger.error('[SES]: Error clearing sessions: ' + err)
      );
    }, this.options.clearInterval || 60000).unref();
  }

  get = (sid: string, callback: (err?: any, session?: Express.SessionData) => void) => {
    db.sessions.get(sid).run()
      .then(data => data ? callback(null, data.session) : callback(null))
      .catch(err => callback(err));
  }

  set = (sid: string, sess: Express.SessionData, callback: (err?: any, session?: any) => void) => {
    db.sessions.insert({
      id: sid,
      expires: new Date(Date.now() + (sess.cookie.originalMaxAge || this.options.browserSessionsMaxAge)),
      session: sess
    }).run()
      .then(() => callback())
      .catch(err => callback(err));
  }

  destroy = (sid: string, callback: (err?: any) => void) => {
    db.sessions.get(sid).delete().run()
      .then(() => callback())
      .catch(err => callback(err));
  }

  clear = (callback: (err?: any) => void) => {
    db.sessions.delete().run().then(() => callback()).catch(err => callback(err));
  }

  length = (callback: (err?: any, count?: number) => void) => {
    db.sessions.count().run().then(res => callback(null, res)).catch(err => callback(err));
  }

  all = (callback: (err: any, obj?: { [sid: string]: Express.SessionData; } | null) => void) => {
    db.sessions.run().then(res => {
      const obj = { };
      for(const o of res)
        obj[o.id] = o.session;
      callback(null, obj);
    }).catch(err => callback(err));
  }

  touch = (sid: string, sess: Express.SessionData, callback?: (err?: any) => void) => {
    db.sessions.get(sid).update({
      session: sess,
      expires: new Date(Date.now() + (sess.cookie.originalMaxAge || this.options.browserSessionsMaxAge))
    }).run()
      .then(() => callback())
      .catch(err => callback(err));
  }
}
