<template>
<div id='hestia-manage-account' class='modal-card' style='width: auto'>
  <header class='modal-card-head'>
    <p class='modal-card-title'>Manage Account</p>
  </header>

  <section class='modal-card-body'>
    <button class='button is-info' @click='gdpr()'>GDPR</button>
    <button class='button is-danger' @click='deleteAccount()'>
      Delete Account&nbsp;
      <b-icon icon='info' title='This will delete your account and indexes, but all data on the non-local drivers will stay there.' />
    </button>
  </section>

  <footer class='modal-card-foot'>
    <button class='button is-primary' :disabled='working' @click='close()'>Done</button>
  </footer>
</div>
</template>
<script src='./manage-account.ts'></script>
<style lang='scss'>
#hestia-manage-account {
  section.modal-card-body {
    display: flex;
    flex-flow: column;
    align-items: stretch;
    > :not(:first-child) {
      margin-top: 0.5rem;
    }
  }
}
</style>
