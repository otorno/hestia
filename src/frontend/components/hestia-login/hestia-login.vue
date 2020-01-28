<template>
<div id='hestia-login'>
  <div id='login' class='container'>
    <span v-show='error' class='has-text-danger' :class='{ marg: Boolean(error) }'>{{ error }}</span>
    <button class='button is-primary slim' @click='loginBlockstack()'>Login via Blockstack</button>
    <a style='align-self:flex-end;font-size:0.8em' @click='registerToken()'>Register via Token</a>
  </div>
</div>
</template>
<script src='./hestia-login.ts'></script>
<style lang='scss'>
div#hestia-login {
  div.container {
    button {
      width: 100%;
    }
    padding: 2rem;

    display: flex;
    flex-flow: column;
    flex-wrap: nowrap;
    align-items: center;
    width: 100%;
    background-color: white;
    > * {
      margin: 0;
    }
    > span.marg {
      margin-bottom: 1rem;
    }
    > :not(a):not(:first-child) {
      margin-top: 0.5rem;
    }
    > :not(span):not(:last-child) {
      margin-bottom: 0.5rem;
    }
  }

  form {
    width: 100%;
    display: flex;
    flex-flow: column;
    > * {
      width: 100%;
    }
  }

  .slim {
    padding: .25rem .5rem;
  }
}
</style>
