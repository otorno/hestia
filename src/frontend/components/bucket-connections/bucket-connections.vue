<template>
<div id='hestia-bucket-connections' class='modal-card' style='width: auto'>
  <header class='modal-card-head'>
    <p class='modal-card-title' style='flex-grow: 0;padding-right: 1em'>Manage Connections</p>
    <button class='button is-light' :disabled='working' :class='{ "is-loading": working }' @click='refresh()'>
      <b-icon icon='refresh' />
    </button>
  </header>

  <section class='modal-card-body'>
    <h2 class='title is-5'>Connections</h2>
    <div v-for='(conn, i) of connections' :key='conn.id' class='conn-entry'>
      <b-checkbox
        v-model='active[i]'
        :disabled='(!rootDir && conn.rootOnly) || (active[i] && amountActive < 2)'
        :title='(!rootDir && conn.rootOnly) ?
          "Can only be used for the root directory!" :
          (active[i] && amountActive < 2) ?
            "Must have at least one connection." :
            ""'
      />
      <img :src='conn.icon'>
      <span>{{ conn.name }}</span>
      <b-icon v-if='conn.rootOnly' icon='folder-alert' style='opacity: 0.5' title='Only stores root directory files (i.e. profile.json)' />
    </div>
  </section>

  <footer class='modal-card-foot'>
    <button class='button' :disabled='closing' @click='close(true)'>Cancel</button>
    <button class='button is-danger' :disabled='!changed || working' @click='reset()'>Reset</button>
    <button class='button is-primary' :class='{ "is-loading": closing }' :disabled='working' @click='close()'>
      {{ changed ? 'Save' : 'Done' }}
    </button>
  </footer>
</div>
</template>
<script src='./bucket-connections.ts'></script>
<style lang='scss'>
#hestia-bucket-connections {
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
