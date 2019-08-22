import Vue from 'vue';
import { VVue } from 'frontend/vvue';
import { HestiaApi } from 'common/api/api';
import { AxiosError } from 'axios';

export default (Vue as VVue).component('hestia-bucket-connections', {
  props: { token: { type: String }, bucket: { type: String }, rootDir: { type: Boolean, default: false } },
  data() {
    return {
      connections: [] as {
        id: string;
        name: string;
        driver: string;
        default?: boolean;
        buckets: string[];
        icon?: string;
        currentActive?: boolean;
        rootOnly?: boolean;
      }[],
      active: [] as boolean[],
      working: false,
      closing: false,
      api: new HestiaApi(() => (this as any).token)
    };
  },
  computed: {
    headers(): { authorization: string } { return { authorization: 'bearer ' + this.token }; },
    changed(): boolean { return Boolean(this.connections.find((a, i) => this.active[i] !== a.currentActive)); },
    amountActive(): number { return this.connections.reduce((acc, v, i) => acc + (this.active[i] ? 1 : 0), 0); }
  },
  async mounted() {
    await this.refresh();
  },
  methods: {
    handleError(e: AxiosError, action: string) {
      const message = (e.response && e.response.data  && e.response.data.message) || e.message || 'error';
      this.$buefy.dialog.alert({
        type: 'is-danger',
        message: `Could not ${action}: ${message}.`
      });
      console.error(e);
    },
    reset() {
      for(let i = 0; i < this.connections.length; i++)
        this.active[i] = this.connections[i].currentActive;
    },
    async close(skip?: boolean) {
      if(this.closing)
        return;

      if(skip) {
        this.$emit('close');
        return;
      }

      this.closing = this.working = true;

      const removedConns: string[] = [];
      if(this.changed) {
        for(let i = 0, active = this.active[i], conn = this.connections[i];
          i < this.connections.length; i++, active = this.active[i], conn = this.connections[i]) if(conn.currentActive !== active) {

          try {
            if(active) // sync is handled back in the explorer
              await this.api.connections.setBuckets(conn.id, [...conn.buckets, this.bucket]);
            else // removing is also handled back in the explorer
              removedConns.push(conn.id);

          } catch(e) {
            console.error('Error changing buckets for conn ' + conn.name + ': ', e);
          }
        }
      }

      this.$emit('close', removedConns);
    },
    async refresh() {
      if(this.working)
        return;
      this.working = true;
      try {
        // const drivers = await axios.get(location.origin + '/api/v1/drivers', { headers: this.headers });
        const res = (await this.api.meta.drivers()).data;
        this.connections = res.current.filter(c => Boolean(res.available.find(d => d.id === c.driver)));
        for(let i = 0, conn = this.connections[i]; i < this.connections.length; i++, conn = this.connections[i]) {
          conn.icon = this.api.getDriverIconUrl(conn.driver);
          conn.rootOnly = res.available.find(a => a.id === conn.driver).rootOnly || false;
          if(conn.buckets.find(a => a === this.bucket)) {
            this.active[i] = true;
            conn.currentActive = true;
          } else {
            this.active[i] = false;
            conn.currentActive = false;
          }
        }
      } catch(e) {
        this.handleError(e, 'refresh');
      }
      this.working = false;
    }
  }
});
