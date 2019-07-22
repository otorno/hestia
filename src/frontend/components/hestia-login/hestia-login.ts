import Vue from 'vue';
import { FieldFlags } from 'vee-validate';
import { mapGetters } from 'vuex';
import { VVue, makeUserSession } from '../../vvue';
import { verifyToken } from 'common/util/token-util';
import ConnectionsModal from '../connections/connections';
import { HestiaApi } from 'common/api/api';
import { AxiosError } from 'axios';

export default (Vue as VVue).component('hestia-login', {
  props: {
    done: { required: false, type: Boolean },
  },
  data() {
    return {
      error: '',
      token: '',
      working: false,
      workingOn: '',
      userSession: makeUserSession(this.$store),
      api: new HestiaApi(() => (this as any).token)
    };
  },
  computed: {
    ...mapGetters({
      loggedIn: 'isLoggedIn',
      isSetup: 'isSetup'
    })
  } as { isSetup: () => boolean, loggedIn: () => boolean },
  mounted() {
    if(this.isSetup) {
      this.$emit('update:done', true);
    } else {
      this.$emit('update:done', false);
      console.log('already logged in? ' + (this.loggedIn ? 'yes' : 'no'));
      if(this.loggedIn) {
        if(Object.keys(this.$route.query).length > 0)
          this.$router.push({ path: '', query: { } });

        this.userSession.getOrSetLocalGaiaHubConnection().then(config => {
          this.token = config.token;
          this.postLogin();
        }).catch(err => {
          console.error(err);
          return this.logout();
        });
      } else if(this.$route.query.authResponse) {
        console.log('Sign-in pending...');

        this.userSession.handlePendingSignIn(String(this.$route.query.authResponse)).then(async d => {
          this.token = (await this.userSession.getOrSetLocalGaiaHubConnection()).token;
          this.postLogin();
        }).catch(err => {
          console.error(err);
          this.logout();
        }).then(() => this.$router.push({ path: '', query: { } }));
      }
    }
  },
  watch: {
    loggedIn(n) {
      if(!n) {
        this.$emit('update:done', false);
      }
    },
    working(n) {
      this.$emit('working', n);
    },
    workingOn(n) {
      if(n)
        console.log('Working on ' + n + '...');
    },
    $route(n) {
      if(n.query.authResponse && !this.working && !this.loggedIn) {
        console.log('Sign-in pending...');

        this.userSession.handlePendingSignIn(String(this.$route.query.authResponse)).then(async d => {
          this.token = (await this.userSession.getOrSetLocalGaiaHubConnection()).token;
          this.postLogin();
        }).catch(err => {
          console.error(err);
          this.logout();
        }).then(() => this.$router.push({ path: '', query: { } }));
      }
    }
  },
  methods: {
    getType(field: FieldFlags, ignoreTouched?: boolean) {
      if(!field || (!field.dirty && (ignoreTouched || !field.touched))) return '';
      if(field.valid) return 'is-success';
      return 'is-danger';
    },
    loginBlockstack() {
      console.log('Logging in via Blockstack!');
      this.$emit('working', true);

      this.userSession.generateAndStoreTransitKey();
      this.userSession.redirectToSignIn();
      setTimeout(() => this.$emit('working', false), 500);
    },
    registerToken() {
      this.$dialog.prompt({
        message: 'Enter Gaia Token (can be found in browser network requests):',
        inputAttrs: {
          placeholder: 'header.body.signature'
        },
        onConfirm: value => {
          if(value.startsWith('v1:'))
            value = value.slice(3);

          if(!this.validateToken(value))
            return;

          this.token = 'v1:' + String(value);
          this.postLogin();
        }
      });
    },
    validateToken(token: string) {
      if(!verifyToken(token)) return false;
      return true;
    },
    handleError(action: string, error: Error) {
      this.working = false;
      this.workingOn = '';
      this.$dialog.alert({
        type: 'is-danger',
        message: `Error ${action}: ${error.message}`
      });
      console.error(`Error ${action}:`, error);
      this.logout();
    },
    async postLogin(skipRegister = false) {
      this.working = true;
      this.workingOn = 'Logging in';
      if(!skipRegister) {
        try {
          // await Axios.post(location.origin + '/api/v1/user/register', null, { headers: { authorization: 'bearer ' + this.token } });
          await this.api.user.login().catch((e: AxiosError) => {
            if(e.response && e.response.data.message && /whitelist/.test(e.response.data.message))
              throw new Error('User is not on the whitelist!');
            else throw e;
          });
        } catch(e) {
          this.handleError('logging in', e);
          return;
        }
      }
      let connections: {
        id: string;
        name: string;
        driver: string;
        rootOnly?: boolean;
        default?: boolean;
        buckets: string[];
      }[];
      try {
        const res = (await this.api.meta.drivers());
        connections = res.data && res.data.current;
      } catch(e) {
        this.handleError('getting drivers', e);
        return;
      }
      if(!connections || connections.length === 0) {
        // time to add connections
        this.working = false;
        this.workingOn = '';
        this.$modal.open({
          hasModalCard: true,
          props: { token: this.token },
          component: ConnectionsModal,
          canCancel: false,
          parent: this,
          events: {
            close: () => this.postLogin(true)
          }
        });

        return;
      }

      // validate token to see if we should continue
      await this.api.user.validateToken().then(
        () => {
          // done!
          console.log('Successfully logged in and registered!');
          this.finish();
        },
        err => {
          if(err && err.response && err.response.status === 403) {
            this.$dialog.alert({
              type: 'is-warning',
              title: 'Registered, but...',
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
    finish() {
      this.working = false;
      this.workingOn = '';
      this.$store.commit('setRegistered', true);
      this.$emit('update:done', true);
      this.$emit('working', false);
    },
    async logout() {
      console.log('Logging out..');
      this.working = false;
      this.workingOn = '';
      await this.$store.dispatch('logout').catch(e => console.error(e));
      this.$emit('update:done', true);
      this.$emit('working', false);
      this.$router.push({ path: '', query: { } });
    }
  }
});
