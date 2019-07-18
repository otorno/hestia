import Vue from 'vue';
import { VVue } from 'frontend/vvue';
import { HestiaApi } from 'common/api/api';

export default (Vue as VVue).component('hestia-bucket-connections', {
  props: { token: { type: String }, bucket: { type: String } },
  data() {
    return {
      connections: [] as {
        id: string;
        name: string;
        driver: string;
        default?: boolean;
        buckets: string[];
        icon?: string;
        active?: boolean;
        currentActive?: boolean;
      }[],
      working: false,
      closing: false,
      api: new HestiaApi(() => (this as any).token)
    };
  },
  computed: {
    headers(): { authorization: string } { return { authorization: 'bearer ' + this.token }; },
    changed(): boolean { return Boolean(this.connections.find(a => a.active !== a.currentActive)); },
    amountActive(): number { return this.connections.reduce((acc, v) => acc + (v.active ? 1 : 0), 0); }
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
      for(const conn of this.connections)
        conn.active = conn.currentActive;
    },
    async close(skip?: boolean) {
      if(this.closing)
        return;
      if(skip) {
        this.$emit('close');
        return;
      }
      this.closing = true;

      if(this.changed) {
        for(const conn of this.connections.filter(a => a.active !== a.currentActive)) {
          let newBuckets: string[];
          if(conn.active)
            newBuckets = [...conn.buckets, this.bucket];
          else
            newBuckets = conn.buckets.filter(a => a !== this.bucket);
          await this.api.connections.setBuckets(conn.id, newBuckets)
            .catch(e => console.error('Error changing buckets for conn ' + conn.name + ': ', e));
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
        this.connections = (await this.api.meta.drivers()).data.current;
        for(const conn of this.connections) {
          conn.icon = this.api.getDriverIconUrl(conn.driver);
          if(conn.buckets.find(a => a === this.bucket)) {
            conn.active = true;
            conn.currentActive = true;
          } else {
            conn.active = false;
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
