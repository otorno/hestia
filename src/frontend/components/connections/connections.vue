<template>
<div id='hestia-connections' class='modal-card' style='width: auto'>
  <header class='modal-card-head'>
    <p class='modal-card-title' style='flex-grow: 0;padding-right: 1em'>Manage Connections</p>
    <button class='button is-light' :disabled='working' :class='{ "is-loading": working }' @click='refresh()'><b-icon icon='refresh'></b-icon></button>
  </header>

  <section class='modal-card-body'>
    <h2 class='title is-5'>Connections</h2>
    <div class='conn-entry' v-for='conn of connections' :key='conn.id'>
      <button class='button is-danger is-inverted' :disabled='connections.length <= 1'
        :title='connections.length <= 1 ? "Cannot remove last connection" : "Remove connection"'
        @click='unregister(conn.id)'><b-icon icon='minus-circle'></b-icon></button>
      <button class='button is-inverted' :class='{ "is-primary": conn.default, "is-black": !conn.default }' :disabled='conn.default || conn.rootOnly'
        :title='conn.rootOnly ? "Cannot use limited storage as default" : conn.default ? "Default connection" : "Set default connection"'
        @click='setDefault(conn.id)'><b-icon :icon='conn.default ? "star" : "star-outline"'></b-icon></button>
      <img :src='getIcon(conn.driver)' />
      <span>{{conn.name}}</span>
      <b-icon v-if='conn.rootOnly' icon='folder-alert' style='opacity: 0.5' title='Only stores root directory files (i.e. profile.json)'></b-icon>
      <b-icon v-if='conn.limitedSpace' icon='folder-alert' class='has-text-danger' style='opacity: 0.5' title='Low on space'></b-icon>
      <b-icon v-if='conn.noDriver' icon='alert-octogon' style='has-text-danger' title='No driver -- non-useable currently.'></b-icon>
      <template v-if='conn.info'>
      <span v-if='conn.info.spaceAvailable'>
        ({{conn.info.spaceUsed}} out of {{conn.info.spaceAvailable}} used)
      </span>
      <span v-else>
        ({{conn.info.spaceUsed}} used)
      </span>
      </template>
    </div>
    <div class='conn-entry' v-if='connections.length === 0'>
      Nothing here... (minimum of 1 required)
    </div>
    <hr>
    <h2 class='title is-5'>Drivers</h2>
    <div class='conn-entry' v-for='d of drivers' :key='d.id'>
      <button class='button is-success is-inverted' :disabled='getDriverDisabled(d)'
      :title='getDriverDisabled(d) ? "Cannot register a non-multi driver again" : "Register driver"'
      @click='register(d.id)'><b-icon icon='plus-circle'></b-icon></button>
      <img :src='getIcon(d.id)' />
      <span>{{d.name}}</span>
      <b-icon v-if='d.rootOnly' icon='folder-alert' style='opacity: 0.5' title='Only stores root directory files (i.e. profile.json)'></b-icon>
    </div>
    <div class='conn-entry' v-if='drivers.length === 0'>
      <span>Nothing here...</span>
    </div>

      <!-- list current connections, with opt to remove them -->
    <!-- add a connection -->
  </section>

  <footer class='modal-card-foot'>
    <button class='button is-primary' :disabled='!connections.length || working' @click='close()'>Done</button>
  </footer>
</div>
</template>
<script src='./connections.ts'></script>
<style lang='scss'>
#hestia-connections {
  div.conn-entry {
    display: flex;
    align-items: center;
    > img {
      height: 2em;
    }
    > :not(:last-child) {
      margin-right: 0.5em;
    }
    &:not(:last-child) {
      margin-bottom: 0.5em;
    }
  }
}
</style>
