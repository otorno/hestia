export class SessionEntry {
  id: string;
  expires: Date;
  session: Express.SessionData;
}
