<template>
<div id='hestia-bucket-connections' class='modal-card' style='width: auto'>
  <header class='modal-card-head'>
    <p class='modal-card-title' style='flex-grow: 0;padding-right: 1em'>Manage Connections</p>
    <button class='button is-light' :disabled='working' :class='{ "is-loading": working }' @click='refresh()'><b-icon icon='refresh'></b-icon></button>
  </header>

  <section class='modal-card-body'>
    <h2 class='title is-5'>Connections</h2>
    <div class='conn-entry' v-for='conn of connections' :key='conn.id'>
      <b-checkbox v-model='conn.active' :disabled='amountActive < 2' title='Must have at least one connection.'>{{conn.name}}</b-checkbox>
    </div>
  </section>

  <footer class='modal-card-foot'>
    <button class='button is-danger' :disabled='!changed' @click='reset()'>Reset</button>
    <button class='button is-primary' :class='{ loading: closing }' :disabled='working' @click='close()'>{{ changed ? 'Save' : 'Done' }}</button>
  </footer>
</div>
</template>
<script src='./bucket-connections.ts'></script>
<style lang='scss'>
#hestia-bucket-connections {
  div.conn-entry {
    display: flex;
    align-items: center;
  }
}
</style>
