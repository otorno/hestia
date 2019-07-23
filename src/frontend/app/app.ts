import Vue from 'vue';
import _ from 'lodash';
import {  mapGetters, mapState } from 'vuex';
import { VVue, makeUserSession } from 'frontend/vvue';
import { UserData } from 'blockstack/lib/auth/authApp';

import ConnectionsModal from '../components/connections/connections';
import { HestiaApi } from 'common/api/api';
import ExplorerComponent from '../components/explorer/explorer';
import ManageAccountComponent from '../components/manage-account/manage-account';
import { AxiosError } from 'axios';

export default (Vue as VVue).extend({
  components: { 'hestia-explorer': ExplorerComponent },
  data() {
    return {
      // search: '',
      showMenu: false,
      userSession: makeUserSession(this.$store),
      token: '',
      api: new HestiaApi(() => (this as any).token),
      backupStatus: '',
      backupDebounce: false,
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
    backupText(): string {
      switch(this.backupStatus) {
        case 'done': return 'Download Backup';
        case 'working': return 'Making Backup...';
        case 'not started':
        default: return 'Backup Everything';
      }
    }
  },
  async mounted() {

    this.api.populatePlugins().then(() => {
      if(this.api.plugins.backup) {
        this.checkBackupStatus();
        setInterval(() => {
          if(this.backupStatus === 'working')
            this.checkBackupStatus();
        }, 5000);
      }
    }).catch(e => console.error('Error getting plugins to check for Backup functionality: ', e));

    this.$store.commit('setStatus', '');
    this.token = (await this.userSession.getOrSetLocalGaiaHubConnection()).token;
    try {
      await this.api.user.validateToken();
    } catch(err) {
      if(err && err.response && err.response.status === 403) {
        await new Promise((resolve) => this.$dialog.alert({
          type: 'is-danger',
          title: 'Bad Token',
          message: 'Cannot use the Hestia Dashboard unless Hestia is your selected Gaia Hub.'
          + ' Please switch to using ' + location.origin + '/gaia as your Gaia Hub and try again.',
          canCancel: false,
          onConfirm: () => resolve()
        }));
        await this.logout();
      } else {
        this.handleError(err, 'verifying token');
        return;
      }
    }
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
    handleError(e: AxiosError, action: string) {
      const message = (e.response && e.response.data  && e.response.data.message) || e.message || 'error';
      this.$dialog.alert({
        type: 'is-danger',
        message: `Error ${action}: ` + message
      });
      console.error(e);
    },
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
        hasModalCard: true,
        props: { token: this.token },
        component: ConnectionsModal,
        parent: this,
        events: {
          close: () => {
            if(this.$refs['explorer'])
              (this.$refs['explorer'] as any).refreshAndSync();
          }
        }
      });
    },
    async checkBackupStatus() {
      this.backupStatus = (await this.api.plugins.backup.status()).data.status;
    },
    async backup() {
      if(this.backupDebounce)
        return;
      this.backupDebounce = true;
      if(this.backupStatus === 'done') {
        const w = window.open();
        w.location.href = this.api.plugins.backup.downloadLink;
        await this.checkBackupStatus();
        this.backupDebounce = false;
        return;
      }
      await this.checkBackupStatus();
      if(this.backupStatus === 'not started') {
        try {
          await this.api.plugins.backup.requestBackup();
          this.backupStatus = 'working';
        } catch(e) {
          this.handleError(e, 'requesting backup');
          this.backupDebounce = false;
          return;
        }
      }
      this.backupDebounce = false;
    },
    async logout() {
      this.showMenu = false;
      await this.$store.dispatch('logout');
      this.$router.push({ path: '', query: { } });
    },
    async manageAccount() {
      if(!this.token)
        return;
      this.$modal.open({
        hasModalCard: true,
        props: { token: this.token },
        component: ManageAccountComponent,
        parent: this
      });
    }
  }
});
