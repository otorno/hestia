import Vue from 'vue';
import VueRouter from 'vue-router';

import ExplorerComponent from './components/explorer/explorer';
// import NotFoundComponent from './components/not-found/not-found';

Vue.use(VueRouter);

const router = new VueRouter({
  mode: 'hash',
  routes: [
    { path: '**', component: ExplorerComponent },
  ]
});

router.beforeEach((to, from, next) => {
  if(to.path !== from.path) {
    if(to.path.length > 1) {

      const sdir = [];
      let buff = '';
      to.path.slice(1).split('/').forEach(v => {
        if(!v) buff += '/';
        else if(buff) sdir.push(buff + v);
        else sdir.push(v);
      });

      document.title = 'Hestia - ' + sdir.join(' - ');
    } else document.title = 'Hestia';
  }
  next();
});

export default router;
