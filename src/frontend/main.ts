import Vue from 'vue';
import Vuex, { mapGetters } from 'vuex';
import VeeValidate from 'vee-validate';
import Buefy from 'buefy';

import AppComponent from './app/app';
import LoginComponent from './components/hestia-login/hestia-login';
import LoadingComponent from './components/hestia-loading/hestia-loading';
import { makeCenterStyle, makeInitializerComponent } from 'common/util/render-util';
import { initialStore } from 'frontend/vvue';

import '@mdi/font/css/materialdesignicons.css';
import './buefy.scss';
import './styles.scss';
import router from './router';

console.log('Environment:', process.env.NODE_ENV);

Vue.use(Vuex);
const store = new Vuex.Store(initialStore);
Vue.use(VeeValidate);
Vue.use(Buefy);

const dist = Date.now() - store.state.storeBDay;
console.log('Store age: ' + (dist / 60000).toFixed() + ':' + ((dist % 60000) / 1000).toFixed(3));

const v = new Vue({
  store,
  router,
  el: '#app',
  data: { loaded: false, done: true, working: false },
  computed: {
    ...mapGetters({
      isSetup: 'isSetup'
    }) as { isSetup: () => boolean }
  },
  components: { AppComponent, LoadingComponent },
  render(h) {
    if(this.loaded) {
      if(this.isSetup && this.done)
        return h(AppComponent, { key: 'app' });
      else return h('div', { key: 'base' }, [
        h('div', { staticStyle: {
          position: 'absolute', zIndex: 1024, top: 0,
          left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(250,250,250,0.7)',
          alignItems: 'center', justifyContent: 'center' },
          style: { display: this.working ? 'flex' : 'none' }
        }, [ h(LoadingComponent) ]),
        h('div', { staticStyle: makeCenterStyle() }, [
          h('div', { staticStyle: { display: 'flex', alignItems: 'center', marginBottom: '1rem' } }, [
            h('figure', { staticStyle: { height: '1.5em', width: '1.5em', marginRight: '0.4rem' } }, [
              h('img', { domProps: { src: 'assets/images/icon-48.png' } })
            ]),
            h('h4', { staticClass: 'title is-5', staticStyle: { lineHeight: 1, flexGrow: 1, margin: 0 } }, 'Hestia'),
          ]),
          h(LoginComponent, {
            key: 'login',
            props: { done: this.done },
            on: {
              'working': ($event) => this.working = Boolean($event),
              'error': ($event) => {
                if(!$event) return;
                this.$dialog.alert({
                  title: 'Error',
                  message: String($event),
                  type: 'is-danger'
                });
              },
              'showDialog': ({ type, options }: { type: string, options: any }) => {
                if(this.$dialog[type])
                  this.$dialog[type](options);
              },
              'update:done': (a: boolean) => this.done = a
            },
            staticStyle: {
              border: '1px solid rgba(0,0,0,0.2)',
              boxShadow: '0px 0px 5px 1px rgba(0,0,0,0.2)',
              minWidth: '300px', maxWidth: '480px'
            }
          })
        ])
      ]); // base
    } else return makeInitializerComponent(h, LoadingComponent);
  }
});

// any async loading here, then the following:
console.log('Initialized Main!');
v.loaded = true;
