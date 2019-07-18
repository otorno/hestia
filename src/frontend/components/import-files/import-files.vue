<template>
<div id='hestia-import-files' class='modal-card' style='width: auto'>
  <header class='modal-card-head'>
    <p class='modal-card-title'>Import Files</p>
  </header>

  <section class='modal-card-body'>

  </section>

  <footer class='modal-card-foot'>
    <button class='button is-primary' :disabled='working' @click='close()'>Done</button>
  </footer>
</div>
</template>
<script src='./import-files.ts'></script>
<style lang='scss'>
#hestia-import-files {
}
</style>
