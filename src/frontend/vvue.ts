import { Store, StoreOptions } from 'vuex';
import createPersistedState from 'vuex-persistedstate';
import Vue, { VueConstructor } from 'vue';
import { UserSession, AppConfig } from 'blockstack';
import { SessionDataStore } from 'blockstack/lib/auth/sessionStore';
import { SessionData } from 'blockstack/lib/auth/sessionData';

export interface StateType {
  status: string;
  registered: boolean;
  sessionData: SessionData;
  storeBDay: number;
}

class MySessionStore implements SessionDataStore {

  constructor(private store: Store<StateType>) { }

  getSessionData() {
    const data = this.store.state.sessionData;
    if(!data)
      throw new Error('No session data was found!');
    return data;
  }

  setSessionData(data: SessionData) {
    this.store.commit('updateSessionData', data);
    return true;
  }

  deleteSessionData() {
    this.store.commit('updateSessionData', new SessionData({}));
    return true;
  }
}

export function makeState(): StateType {
  return {
    status: '',
    registered: false,
    sessionData: new SessionData({}),
    storeBDay: Date.now()
  };
}

export function makeUserSession(store: Store<StateType>): UserSession {
  return new UserSession({
    appConfig: new AppConfig(
      ['store_write'], // scopes
      location.origin, // appDomain
      '/#/', // redirectPath
      '/manifest.json', // manifestPath
      null, // coreNode
      'https://browser.blockstack.org/auth' // authenticatorUrl
    ),
    sessionStore: new MySessionStore(store)
    // session options includes mostly things that are in the sessiondata, plus transit key
  });
}

export const initialStore: StoreOptions<StateType> = {
  state: makeState(),
  getters: {
    'isLoggedIn': (state) => makeUserSession({ state } as any).isUserSignedIn(),
    'isSetup': (state, getters) => getters.isLoggedIn && state.registered,
    'storeAge': (state) => Date.now() - state.storeBDay
  },
  mutations: {
    updateSessionData(state, sess: SessionData) {
      state.sessionData = sess;
    },
    setRegistered(state, registered: boolean) {
      state.registered = Boolean(registered);
    },
    setStatus(state, status: string) {
      state.status = String(status);
    },
    reset(state) {
      state.registered = false;
      state.status = '';
    }
  },
  actions: {
    logout(store) {
      store.commit('reset');
      makeUserSession(store as any).signUserOut();
    }
  },
  plugins: [ createPersistedState() ]
};

interface Vuee extends Vue {
  $store: Store<StateType>;
}

export type VVue = VueConstructor<Vuee>;
