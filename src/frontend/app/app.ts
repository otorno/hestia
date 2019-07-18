import Vue from 'vue';
import _ from 'lodash';
import {  mapGetters, mapState } from 'vuex';
import { VVue, makeUserSession } from 'frontend/vvue';
import { UserData } from 'blockstack/lib/auth/authApp';

import ConnectionsModal from '../components/connections/connections';
import axios from 'axios';
import { HestiaApi } from 'common/api/api';

export default (Vue as VVue).extend({
  data() {
    return {
      // search: '',
      showMenu: false,
      userSession: makeUserSession(this.$store),
      token: '',
      api: new HestiaApi(() => (this as any).token)
    };
  },
  computed: {
    ...mapGetters({
      loggedIn: 'isLoggedIn'
    }) as { loggedIn: () => boolean },

    ...mapState({
      status: 'status'
    }) as { status: () => string },

    userdata(): UserData {
      return this.loggedIn ? this.$store.state.sessionData.userData : null;
    },
    name(): string {
      return this.getProfileName(this.userdata, true);
    },
    avatar(): string {
      return (this.userdata &&
          this.userdata.profile &&
          this.userdata.profile.image &&
          this.userdata.profile.image[0]) ?
          this.userdata.profile.image[0].contentUrl : '';
    },
  },
  async mounted() {
    this.$store.commit('setStatus', '');
    this.token = (await this.userSession.getOrSetLocalGaiaHubConnection()).token;
    this.api.user.validateToken().then(
      () => { },
      err => {
        if(err && err.response && err.response.status === 403) {
          this.$dialog.alert({
            type: 'is-danger',
            title: 'Bad Token',
            message: 'Cannot use the Hestia Dashboard unless Hestia is your selected Gaia Hub.'
            + ' Please switch to using ' + location.origin + '/gaia as your Gaia Hub and try again.',
            canCancel: false,
            onConfirm: () => this.logout()
          });
        } else throw err;
    }).catch(err => {
      this.$dialog.alert({
        type: 'is-danger',
        message: 'Error verifying token: ' + err.message
      });
      console.error(err);
    });
  },
  watch: {
    /*$route(n: Route, o) {
      if(!o && n.query['q'] !== this.search)
        this.search = n.query['q'] as string; // :/
      else if(n.query['q'] !== o.query['q'] && (n.query['q'] || o.query['q']) && n.query['q'] !== this.search)
        this.search = n.query['q'] as string;
      else if(n.path !== '/search' && this.search)
        this.search = '';

      if(n.path !== o.path)
        this.showMenu = false;
    },
    search(n, o) {
      if(n !== o && (n || o))
        this.updateSearch(n);
    }*/
  },
  methods: {
    getProfileName(user: UserData, noFallback?: boolean) {
      if(!user) return `{null}`;
      if(user.username) return user.username;
      if(user.profile && user.profile.name) return user.profile.name;
      if(!noFallback) return `ID-${user.identityAddress}`;
    },
    /*updateSearch: _.debounce(function(this, n?: string) {
      if(!n) {
        this.$router.push({ path: '/', query: { } });
        return;
      }
      this.$router.push({ path: '/search', query: { q: n }});
    },*/
    async connections() {
      if(!this.token)
        return;
      this.$modal.open({
        props: { token: this.token },
          component: ConnectionsModal,
          parent: this,
      });
    },
    backup() {
      axios.post(location.origin + '/plugins/backup/request-backup');
    },
    async logout() {
      this.showMenu = false;
      await this.$store.dispatch('logout');
      this.$router.push({ path: '', query: { } });
    }
  }
});
