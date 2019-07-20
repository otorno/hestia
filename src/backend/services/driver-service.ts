import { DriverConfig } from '../data/config';
import Driver, { DriverInfo } from '../data/driver';
import { DriverApi } from '../data/driver-api-interface';
import { configIdRegex } from '../util';
import { Subject } from 'rxjs';
import { getLogger } from 'log4js';
import { User } from '../data/user';
import * as uuid from 'uuid';
import db from './database-service';
import { NotFoundError } from '../data/hestia-errors';

class DriverService {

  private drivers: { [key: string]: Driver } = { };
  private driverInfo: DriverInfo[] = [];
  private logger = getLogger('drivers');

  private _onDriverInit = new Subject<{ driver: Driver, driverInfo: DriverInfo }>();
  public get onDriverInit() { return this._onDriverInit.asObservable(); }

  public get(id: string) {
    const ret = this.drivers[id];
    if(!ret)
      throw new NotFoundError('No driver found with Id "' + id + '"!');
    return ret;
  }

  public getInfo(): DriverInfo[];
  public getInfo(id: string): DriverInfo;
  public getInfo(id?: string) {
    const ret = id ? this.driverInfo.find(a => a.id === id) : this.driverInfo;
    if(!ret)
      throw new NotFoundError('No driver found with Id "' + id + '"!');
    return ret;
  }

  public getAutoRegisterable() {
    return Boolean(this.driverInfo.find(a => a.autoRegister));
  }

  public async autoRegisterUser(user: User) {
    for(const info of this.driverInfo) if(info.autoRegister) {

      if(Object.values(user.connections).find(a => a.driver === info.id))
        continue;

      const driver = this.get(info.id);
      const ret = await driver.register(user.makeSafeForDriver(info.id));

      let id = uuid.v4();
      while(user.connections[id]) // force unique (at least within the same user)
        id = uuid.v4();
      const n = Object.values(user.connections).filter(a => a.driver === info.id).length;
      user.connections[id] = {
        driver: info.id,
        name: n ? `${info.name}-${n + 1}` : info.name,
        config: ret.finish.userdata || null,
        buckets: [user.address]
      };
      if(driver.postRegisterCheck)
        await driver.postRegisterCheck(user.makeSafeForDriver(info.id), ret.finish.userdata || null);

      if(!user.defaultConnection)
        user.defaultConnection = id;
    }

    await db.updateUser(user);
  }

  private ticking: { [key: string]: boolean } = { };
  public async tick() {
    if(this.ticking['.']) {
      this.logger.error('[DRIV]: Ticking is taking too long!');
      return;
    }
    this.ticking['.'] = true;
    for(const info of this.driverInfo) {
      const driver = this.drivers[info.id];
      if(driver.tick && !this.ticking[info.id]) {
        this.ticking[info.id] = true;
        driver.tick().then(
          () => this.ticking[info.id] = false,
          e => this.logger.error(`[DRIV]: Erorr ticking driver "${info.name}"("${info.id}"): ${e.stack || e}`));
      }
    }
    this.ticking['.'] = false;
  }

  public async init(config: { [id: string]: DriverConfig }) {
    const successes: DriverInfo[] = [];
    const total = Object.keys(config).filter(a => typeof config[a] === 'object').length;
    for(const driverId in config) if(typeof(config[driverId]) === 'object') {
      try {
        if(!configIdRegex.test(driverId))
          throw new Error('Invalid Plugin Name: doesn\'t match scheme.');

        const driverConfig = config[driverId];

        // server-side data
        const driverInfo: DriverInfo = {
          id: driverId,
          longId: driverId,
          name: driverId,
          icon: driverConfig.icon_url || '',
        };

        if(driverConfig.whitelist)
          driverInfo.whitelist = driverConfig.whitelist;

        if(driverConfig.root_only)
          driverInfo.rootOnly = true;

        let path = driverConfig.path;
        if(path.startsWith('default-drivers'))
          path = '../' + path;

        const driver: Driver = (await import(path)).default.create();
        const initData = await driver.init(driverId, driverConfig, new DriverApi(driverId));

        driverInfo.name = driverConfig.name || initData.name;
        driverInfo.longId = initData.longId;
        if(!initData.multiInstance && this.driverInfo.find(a => a.longId === initData.longId))
          throw new Error('Driver with longId "' + initData.longId + '" already exists!');

        if(initData.multiUser)
          driverInfo.multiUser = true;

        driverInfo.icon = driverInfo.icon || initData.icon;

        if(Boolean(driverConfig.auto_register) && Boolean(initData.autoRegisterable)) {
          driverInfo.autoRegister = true;
          this.logger.info('Will auto-register driver "' + driverInfo.id + '"!');
        }

        this._onDriverInit.next({ driver, driverInfo });

        this.drivers[driverInfo.id] = driver;
        this.driverInfo.push(driverInfo);

        successes.push(Object.assign({}, driverInfo));
        this.logger.info(`Successfully initialized ${driverInfo.name}("${driverId}") driver!`);
      } catch(e) {
        this.logger.error(`Error initializing "${driverId}" driver: ${e}`);
      }
    }
    this.logger.info(`Initialized ${successes.length} out of ${total} drivers.`);

    return successes;
  }
}

export default new DriverService();
