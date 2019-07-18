import Vue from 'vue';
import { VVue } from 'frontend/vvue';

export default (Vue as VVue).component('hestia-import-files', {
  props: { token: { type: String } },
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
    handleError(e: Error, action: string) {
      this.$dialog.alert({
        type: 'is-danger',
        message: `Could not ${action}: ${e.message}.`
      });
      console.error(e);
    },
    close() {
      if(!this.working)
        this.$emit('close');
    }
  }
});
