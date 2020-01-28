import Vue from 'vue';
import { VVue } from 'frontend/vvue';

export default (Vue as VVue).component('hestia-import-files', {
  props: { token: { type: String, default: '' } },
  data() {
    return {
      index: '',

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
    }
  }
});
