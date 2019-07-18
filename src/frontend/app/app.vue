<template>
<div id='app'>
  <nav class='navbar' role='navigation' aria-label='main navigation'>
    <div class='navbar-brand'>
      <router-link class='navbar-item hover-underline-child' to='/'>
        <img src='assets/images/icon-48.png' alt='uB'>
        <span class='title is-5' style='position: relative'>Hestia</span>
      </router-link>
      <a role='button' class='navbar-burger' :class='{ "is-active": showMenu }' aria-label='menu' aria-expanded='false' @click='showMenu = !showMenu'>
        <span aria-hidden='true'></span>
        <span aria-hidden='true'></span>
        <span aria-hidden='true'></span>
      </a>
    </div>
    <div class='navbar-menu' :class='{ "is-active": showMenu }'>
      <div class='navbar-start' style='flex-grow: 1'>
        <div class='navbar-item' style='flex-grow: 1; justify-content: center'>
          <span class='status'>{{ status ? '# ' + status : 'Psuedo-Decentralized Storage Middleware'}}</span>
          <!-- b-field style='width: 100%'>
            <b-input name='search' placeholder='search files' type='search' icon='magnify' v-model='search'></b-input>
          </b-field -->
        </div>
      </div>

      <div class='navbar-end'>
        <a class='navbar-item is-hidden-desktop profile-container' style='border-bottom: 2px solid rgba(0,0,0,0.05)'>
          <figure v-if='avatar'><img :src='avatar'></figure>
          <div v-else>
            <span>{{(name || '?')[0] }}</span>
          </div>
          <div>
            <span>{{name}}</span>
            <span>ID-{{userdata.identityAddress}}</span>
          </div>
        </a>

        <b-dropdown class='is-hidden-touch' id='settings-dropdown' position='is-bottom-left'>
          <a class='navbar-item profile-container is-hidden-touch' title='Profile' slot='trigger'>
            <figure v-if='avatar'><img :src='avatar'></figure>
            <div v-else>
              <span>{{(name || '?')[0] }}</span>
            </div>
          </a>

          <b-dropdown-item class='profile-container'>
            <figure v-if='avatar'><img :src='avatar'></figure>
            <div v-else>
              <span>{{(name || '?')[0] }}</span>
            </div>
            <div>
              <span>{{name}}</span>
              <span>ID-{{userdata.identityAddress}}</span>
            </div>
          </b-dropdown-item>
          <b-dropdown-item @click='connections()'>Connections</b-dropdown-item>
          <b-dropdown-item :disabled='!api.plugins.backup || backupStatus === "working"' :title='api.plugins.backup ? "" : "No backup plugin found."' @click='backup()'>{{backupText}}</b-dropdown-item>
          <b-dropdown-item @click='logout()'>Logout</b-dropdown-item>
        </b-dropdown>

        <a class='navbar-item flex-item is-hidden-desktop' @click='connections()'>
          <b-icon icon='link-variant'></b-icon>
          <span style='font-weight:600'>&nbsp;Connections</span>
        </a>

        <a class='navbar-item flex-item is-hidden-desktop' :disabled='!api.plugins.backup || backupStatus === "working"' :title='api.plugins.backup ? "" : "No backup plugin found."' @click='backup()'>
          <b-icon icon='folder-download'></b-icon>
          <span style='font-weight:600'>&nbsp;{{backupText}}</span>
        </a>

        <a class='navbar-item flex-item is-hidden-desktop' @click='logout()'>
          <b-icon icon='logout-variant'></b-icon>
          <span style='font-weight:600'>&nbsp;Logout</span>
        </a>
      </div>
    </div>
  </nav>

  <div id='body'>
    <transition name='fade'>
      <router-view></router-view>
    </transition>
  </div>

  <div id='footer'>

  </div>
</div>
</template>
<script src='./app.ts'></script>
<style lang='scss'>

#app {
  display: flex;
  flex-flow: column;
  min-height: 100vh;
  align-items: center;

  > nav {
    width: 100%;
    height: 3.25rem;
    border-bottom: 2px solid rgba(0,0,0,0.05);
    > * {
      height: 100%;
    }
  }

  div.navbar-menu {
    box-shadow: none;

    > div {
      background-color: inherit;
    }

    &.is-active > div.navbar-end {
      @media(max-width: 1087px) {
        border-bottom: 2px solid rgba(0,0,0,0.05)
      }
    }
  }

  div.navbar-brand > a.navbar-item:first-child {
    display: flex;
    align-items: center;

    > img {
      height: 1.5em;
      width: 1.5em;
      margin-right: 0.5em;
    }
    > h4 {
      line-height: 1;
      width: auto;
      margin: 0;
    }
  }

  span.status {
    flex-grow: 1;
    font-weight: 600;
    height: 1.25rem;
  }

  .profile-container {
    display: flex;
    align-items: center;
    padding-right: 1rem;

    > figure:first-child{
      height: 24px;
      width: 24px;
      display: flex;
      justify-content: center;
      align-content: center;
      border-radius: 50%;
      overflow: hidden;
      > img {
        align-self: center;
      }
    }

    > div:first-child {
      border-radius: 50%;
      height: 24px;
      width: 24px;

      display: flex;
      align-items: center;
      justify-content: center;
      text-transform: uppercase;
      text-shadow: 1px 1px 1px rgba(0,0,0,0.1);
      line-height: 1;
      color: white;
      background-color: hsl(171, 100%, 41%);
      font-size: 12px;
    }

    > div:nth-child(2) {
      margin-left: 0.5rem;
      display: flex;
      flex-flow: column;
      > span:first-child {
        font-weight: 600
      }
      > span:last-child {
        font-size: 0.67em;
      }
    }

    > div:nth-child(3) {
      height: 100%;
      margin-left: 0.5rem;
      padding: 0 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }

  .small-icon-text {
    line-height: 1;
    padding-top: 0.5em;
    padding-bottom: 0.5em;
  }

  .flex-item {
    display: flex;
    align-items: center;
  }

  #settings-dropdown {
    width: 100%;
    margin: 0;
    > div.dropdown-menu {
      right: 2px;
    }
    > div.dropdown-trigger {
      width: 100%;
    }
  }

  > div#body {
    position: relative;
    flex-grow: 1;
    align-self: stretch;
    overflow: auto;
    // margin: 16px;
    //margin-top: 8px;
    > * {
      position: absolute;
      top: 0;
      left: 0;
      min-width: 100%;
      min-height: 100%;
    }
  }

  > div#footer {
    display: none; // flex
    align-items: center;
    flex-direction: column;

    padding: 1em;
    font-size: 12px;
    width: 100%;
  }
}
</style>
