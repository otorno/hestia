import Vue from 'vue';
import { VVue } from 'frontend/vvue';
import { HestiaApi } from 'common/api/api';

export default (Vue as VVue).component('hestia-manage-account', {
  props: { token: { type: String } },
  data() {
    return {
      index: '',
      api: new HestiaApi(() => this.token),
      working: false,
    };
  },
  computed: {
    headers() { return { authorization: 'bearer ' + this.token }; }
  },
  async mounted() {

  },
  methods: {
    handleError(e: any, action: string) {
      const message = (e.response && e.response.data  && e.response.data.message) || e.message || 'error';
      this.$buefy.dialog.alert({
        type: 'is-danger',
        message: `Could not ${action}: ${message}.`
      });
      console.error(e);
    },
    close() {
      if(!this.working)
        this.$emit('close');
    },
    async deleteAccount() {
      if(this.working)
        return;
      this.working = true;
      const choice = await new Promise(res => {
        this.$buefy.dialog.confirm({
          hasIcon: true,
          icon: 'close-octagon',
          type: 'is-danger',
          title: 'Delete Account',
          message: '<b>Are you sure? This cannot be undone.</b>\nUser-owned drivers (i.e. dropbox, etc) should still'
          + ' have your data afterward, but node-owned drivers will be cleared to free up space.',
          onCancel: () => res(false),
          onConfirm: () => res(true),
          confirmText: 'Confirm'
        });
      });
      if(choice) {
        await this.api.user.unregister();
        await this.$store.dispatch('logout');
        this.$router.push({ path: '', query: { } });
        this.$emit('close');
      }
      this.working = false;
    },
    async gdpr() {
      if(this.working)
        return;
      this.working = true;
      const data = (await this.api.user.gdpr()).data;
      this.$buefy.dialog.alert({
        title: 'User GDPR (all user data)',
        message: '<pre>' + JSON.stringify(data, null, 2) + '</pre>',
        confirmText: 'Done'
      });
      this.working = false;
    }
  }
});
