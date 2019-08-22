import Vue from 'vue';
import { VVue } from 'frontend/vvue';
import * as filesize from 'filesize';
import { HestiaApi } from 'common/api/api';
import { AxiosError } from 'axios';

export default (Vue as VVue).component('hestia-connections', {
  props: { token: { type: String } },
  data() {
    return {
      connections: [] as {
        id: string;
        name: string;
        icon?: string;
        driver: string;
        default?: boolean;
        noDriver?: boolean;
        rootOnly?: boolean;
        limitedSpace?: boolean;
        infoRaw?: { spaceUsed: number, spaceAvailable?: number };
        info?: { spaceUsed: string, spaceAvailable?: string };
      }[],
      drivers: [] as {
        id: string;
        name: string;
        icon?: string;
        multi?: boolean;
        rootOnly?: boolean;
      }[],
      working: false,
      api: new HestiaApi(() => (this as any).token)
    };
  },
  computed: {
    headers() { return { authorization: 'bearer ' + this.token }; }
  },
  async mounted() {
    await this.refresh();
  },
  methods: {
    getIcon(driverId: string) {
      return this.api.getDriverIconUrl(driverId);
      // return location.origin + '/api/v1/drivers/' + driverId + '/icon';
    },
    getDriverDisabled(driver: { multiUser: boolean, id: string }) {
      return !driver.multiUser && this.connections.find(a => a.driver === driver.id);
    },
    handleError(e: AxiosError, action: string) {
      const message = (e.response && e.response.data  && e.response.data.message) || e.message || 'error';
      this.$buefy.dialog.alert({
        type: 'is-danger',
        message: `Could not ${action}: ${message}.`
      });
      console.error(e);
    },
    async unregister(connId: string) {
      if(this.working)
        return;
      this.working = true;
      try {
        // axios.delete(location.origin + '/api/v1/connections/' + connId, { headers: this.headers });
        await this.api.connections.delete(connId);
        delete this.connections[connId];
      } catch(e) {
        this.handleError(e, 'unregister');
      }
      this.working = false;
      return this.refresh();
    },
    register(driverId: string) {
      const w = window.open();
      w.location.href = location.origin + '/api/v1/drivers/' + driverId + '/register?authorizationBearer=' + this.token;
      this.$buefy.dialog.alert({
        message: 'Opened up a new window for registration process...',
        confirmText: 'Done',
        onConfirm: () => this.refresh(),
      });
    },
    async setDefault(connId: string) {
      if(this.working || this.connections.find(a => a.id === connId).rootOnly)
        return;
      this.working = true;
      // await axios.post(location.origin + '/api/v1/connections/' + connId + '/set-default', null, { headers: this.headers })
      await this.api.connections.setDefault(connId)
        .then(() => {
          const old = this.connections.find(a => a.default);
          if(old)
            old.default = false;
          const neu = this.connections.find(a => a.id === connId);
          if(neu)
            neu.default = true;
        }).catch(e => this.handleError(e, 'set default connection')).then(() => this.working = false);
    },
    close() {
      this.$emit('close');
    },
    async refresh() {
      if(this.working)
        return;
      this.working = true;
      try {
        // const drivers = await axios.get(location.origin + '/api/v1/drivers', { headers: this.headers });
        const drivers = await this.api.meta.drivers();
        this.connections = drivers.data.current;
        this.drivers = drivers.data.available.map(a => ({ ...a, icon: this.api.getDriverIconUrl(a.id) }));
        for(const conn of this.connections) {
          const driver = this.drivers.find(a => a.id === conn.driver);
          if(driver) {
            conn.rootOnly = driver.rootOnly;
            conn.icon = driver.icon;
          } else
            conn.noDriver = true;

          // await axios.get(location.origin + '/api/v1/connections/' + conn.id + '/info', { headers: this.headers })
          await this.api.connections.getInfo(conn.id)
            .then(res => {
              conn.infoRaw = res.data;
              conn.info = { } as any;
              for(const k in res.data) if(res.data[k] != null && !Number.isNaN(res.data[k]))
                conn.info[k] = filesize(Number(res.data[k]));
              if(conn.infoRaw.spaceAvailable && conn.infoRaw.spaceUsed &&
                conn.infoRaw.spaceAvailable - conn.infoRaw.spaceUsed <= 25000) // 25kb
                conn.limitedSpace = true;
            })
            .catch(e => this.handleError(e, 'get connection info'));
          await new Promise(r => setTimeout(r, 350));
        }
      } catch(e) {
        this.handleError(e, 'refresh');
      }
      this.working = false;
    }
  }
});
