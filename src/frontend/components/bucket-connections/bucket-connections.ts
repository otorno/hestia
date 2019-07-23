import Vue from 'vue';
import { VVue } from 'frontend/vvue';
import { HestiaApi } from 'common/api/api';

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
    handleError(e: Error, action: string) {
      this.$dialog.alert({
        type: 'is-danger',
        message: `Could not ${action}: ${e.message}.`
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

      if(this.changed) {
        for(let i = 0, active = this.active[i], conn = this.connections[i];
          i < this.connections.length; i++, active = this.active[i], conn = this.connections[i]) if(conn.currentActive !== active) {

          try {
            let newBuckets: string[];
            if(active) {
              newBuckets = [...conn.buckets, this.bucket];
              // sync is handled back in hestia explorer
            } else {
              newBuckets = conn.buckets.filter(a => a !== this.bucket);
              // delete excess files before setting buckets
              const list: {
                path: string;
                size: number;
                hash: string;
                lastModified: string;
              }[] = [];

              let page = 0;
              do {
                const sublist = (await this.api.connections.listFiles(conn.id, this.bucket, page)).data;
                page = sublist.page;
                list.push(...sublist.entries);
              } while(page);
              for(const entry of list) {
                await this.api.connections.deleteFileRaw(conn.id, entry.path);
              }
            }

            await this.api.connections.setBuckets(conn.id, newBuckets);
          } catch(e) {
            console.error('Error changing buckets for conn ' + conn.name + ': ', e);
          }
        }
      }
      this.$emit('close');
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
