<template>
<div id='hestia-explorer'>
  <div id='header'>
    <div id='progress' class='has-background-primary' :style='{ width: (progress * 100).toFixed(2) + "%" }'></div>
    <div id='path'>
      <button class='button is-small is-white' style='margin-right: 0.5rem;' :disabled='splitDir.length <= 1' @click='goto(splitDir.length - 2)'><b-icon icon='folder-upload' style='color: #FFD54F'></b-icon></button>
      <template v-for='(d, i) in splitDir'>
        <a :key='"a-"+i' class='tag' @click='goto(i)' :title='d'>
          <span>{{nameAnnotations[d] || d}}</span>
        </a>
        <span :key='"s-"+i' v-if='i + 1 < splitDir.length'><b-icon icon='chevron-right'></b-icon></span>
      </template>
    </div>
    <div id='buttons'>
      <div v-show='status' id='hestia-loading-small'></div>
      <button class='button is-small is-white' :disabled='working' @click='refresh()' title='Refresh'><b-icon icon='refresh'></b-icon></button>
      <button class='button is-small is-white' :disabled='!anyActive || working' @click='downloadSelected()' title='Download'><b-icon icon='download'></b-icon></button>
      <a class='button is-small is-white' :href='"data:application/json," + JSON.stringify(migrationIndex)' target='_blank' rel='noopener noreferrer' title='Migration Index'><b-icon icon='script-text'></b-icon></a>
      <button class='button is-small is-white' :disabled='working' @click='importMigrationIndex()' title='Import Migration Index'><b-icon icon='import'></b-icon></button>
    </div>
  </div>
  <div id='explorer-header' class='exp-grid'>
    <button class='button is-white' @click='sort("name")'><span>Name</span><b-icon v-show='sortByName === "name"' :icon='sortByDir ? "chevron-up" : "chevron-down"'></b-icon></button>
    <button class='button is-white' @click='sort("conn")'><span>Connections</span><b-icon v-show='sortByName === "conn"' :icon='sortByDir ? "chevron-up" : "chevron-down"'></b-icon></button>
    <button class='button is-white' @click='sort("size")'><span>Size</span><b-icon v-show='sortByName === "size"' :icon='sortByDir ? "chevron-up" : "chevron-down"'></b-icon></button>
    <button class='button is-white' @click='sort("mod")'><span>Last Modified</span><b-icon v-show='sortByName === "mod"' :icon='sortByDir ? "chevron-up" : "chevron-down"'></b-icon></button>
    <b-dropdown aria-role='list' position='is-bottom-left'>
          <button class='dot-button' slot='trigger'>
              <b-icon icon='dots-horizontal'></b-icon>
          </button>
          <b-dropdown-item aria-role='list-item' custom>
            <b-checkbox v-model='useFamiliar'>Use Familiar Names</b-checkbox>
          </b-dropdown-item>
          <b-dropdown-item aria-role='list-item' :disabled='dirInfo.oldConns.length === 0' @click='syncDir()'>Sync</b-dropdown-item>
          <b-dropdown-item aria-role='list-item' :disabled='dirInfo.name === "root"' @click='manageConnections()'>Manage Connections</b-dropdown-item>
          <b-dropdown-item aria-role='list-item' @click='downloadDir(dir)'>Download</b-dropdown-item>
        </b-dropdown>
  </div>
  <div id='explorer' ref='explorer'>
    <div id='background' @mousedown='drawStart($event)'><h5 class='subtitle is-5' v-if='!index || !index[dir] || (index[dir].folders.length === 0 && index[dir].files.length === 0)'>Nothing here...</h5></div>
    <template v-if='index && index[dir]'>
      <router-link v-for='folder of sortedFolders' :key='"/" + folder.name' :to='getPath(folder.name)'
      :class='{ active: active["/" + folder.name], "last-active": lastActive === "/" + folder.name }'
      class='folder exp-grid' :id='"m-/" + folder.name'
      :event='""' @click.native.prevent.stop='clickItem($event, "/" + folder.name)'>
        <div>
          <b-icon icon='folder' style='color: #FFD54F' :title='folder.itemCount + " items"'></b-icon>
          <span>{{useFamiliar && nameAnnotations[folder.name] ? '&ldquo;' + nameAnnotations[folder.name] + '&rdquo;' : folder.name}}</span>
        </div>
        <div class='conn-group'>
          <span v-for='connId of folder.conns' :key='connId' :title='getConn(connId).name'><img style='max-height: 100%' :src='getConn(connId).icon' /></span>
          <span style='opacity: 0.5;' v-for='connId of folder.oldConns' :key='connId' :title='getConn(connId).name + "(outdated)"'><img style='max-height: 100%' :src='getConn(connId).icon' /></span>
        </div>
        <span>{{folder.size}}</span>
        <span>{{folder.lastModified}}</span>
        <b-dropdown aria-role='list' position='is-bottom-left'>
          <button class='dot-button' slot='trigger'>
              <b-icon icon='dots-horizontal'></b-icon>
          </button>
          <b-dropdown-item aria-role='list-item' :disabled='folder.oldConns.length === 0' @click='sync(folder.name)'>Sync</b-dropdown-item>
          <b-dropdown-item aria-role='list-item' :disabled='folder.name === userdata.identityAddress' :title='folder.name === userdata.identityAddress ? "Cannot set buckets of root address" : ""' @click='manageConnections(folder)'>Manage Connections</b-dropdown-item>
          <b-dropdown-item aria-role='list-item' @click='downloadDir(dir + folder.name + "/")'>Download</b-dropdown-item>
        </b-dropdown>
      </router-link>
      <a v-for='file of sortedFiles' :key='file.name' :href='getLink(file.name)'
      :class='{ active: active[file.name], "last-active": lastActive === file.name }'
      :id='"m-"+file.name' class='file exp-grid' @click.prevent.stop='clickItem($event, file.name)'>
        <div>
          <b-icon :icon='file.fileIcon' :style='{ color: file.fileIconColor }' :title='file.contentType'></b-icon>
          <span>{{file.name}}</span>
        </div>
        <div class='conn-group'>
          <span v-for='connId of file.conns' :key='connId' :title='getConn(connId).name'><img style='max-height: 100%' :src='getConn(connId).icon' /></span>
          <span style='opacity: 0.5;' v-for='connId of file.oldConns' :key='connId' :title='getConn(connId).name + " (outdated)"'><img style='max-height: 100%' :src='getConn(connId).icon' /></span>
        </div>
        <span>{{file.size}}</span>
        <span>{{file.lastModified}}</span>
        <b-dropdown aria-role='list' position='is-bottom-left'>
          <button class='dot-button' slot='trigger'>
              <b-icon icon='dots-horizontal'></b-icon>
          </button>
          <b-dropdown-item aria-role='list-item' :disabled='file.oldConns.length === 0' @click='sync(file.name)'>Sync</b-dropdown-item>
          <b-dropdown-item aria-role='list-item' :disabled='dirInfo.name === "root"' @click='manageConnections()'>Manage Connections</b-dropdown-item>
          <b-dropdown-item aria-role='list-item' @click='openFile(file.name)'>Open</b-dropdown-item>
        </b-dropdown>
      </a>
    </template>
    <div v-show='drawing' id='selectbox' :style='drawPos'></div>
    <!-- div v-show='drawing' style='position: fixed; border: 2px solid red;' :style='{ top: drawPoints.y1 + "px", left: drawPoints.x1 + "px" }'></div>
    <div v-show='drawing' style='position: fixed; border: 2px solid green;' :style='{ top: drawPoints.y1 + "px", left: drawPoints.x2 + "px" }'></div>
    <div v-show='drawing' style='position: fixed; border: 2px solid blue;' :style='{ top: drawPoints.y2 + "px", left: drawPoints.x1 + "px" }'></div>
    <div v-show='drawing' style='position: fixed; border: 2px solid yellow;' :style='{ top: drawPoints.y2 + "px", left: drawPoints.x2 + "px" }'></div -->
  </div>
</div>
</template>
<script src='./explorer.ts'></script>
<style lang='scss'>
#hestia-explorer {

  display: flex;
  flex-flow: column;

  .tag {
    background-color: rgba(0, 0, 0, 0.05);
  }

  div#selectbox {
    position: fixed;
    background-color: rgba(3, 168, 244, 0.33);
    border: 1px solid rgba(3, 168, 244, 0.67);
  }

  button.dot-button {
    background-color: transparent;
    border: none;
    cursor: pointer;
    color: inherit;
    height: 100%;
    &:hover {
      color: black;
    }
  }

  div.conn-group {
    display: flex;
    align-items: center;
    > span {
      height: 1.5em;
      &:not(:first-child) {
        margin-left: 0.25em;
      }
    }
  }

  .exp-grid,
  div#explorer > a.exp-grid {
    display: grid;
    grid-template-columns: 1fr 10em 9em 10em 3em;
    grid-template-rows: 100%;
    align-items: center;
    justify-items: flex-start;
    > :last-child {
      justify-self: center;
    }
  }

  div#explorer {
    padding: 1.25rem;
    padding-top: 1rem;
    position: relative;
    flex: 1 0 1px;
    overflow-y: auto;

    > div#background {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      user-select: none;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    > a {
      color: inherit;
      user-select: none;
      cursor: default;
      position: relative;
      display: flex;
      align-items: center;
      border: 1px solid transparent;
      width: calc(100vw - 2.5rem);
      > :first-child {
        display: flex;
        align-items: center;
        > :first-child {
          margin-right: 0.5em;
        }
      }
      /** {
        pointer-events: none;
      }*/
      &:hover, &.hover {
        background-color: rgb(225,245,254);
        border-color: rgb(79,195,247);
      }
      &.active {
        background-color: rgb(179,229,252);
        border-color: rgb(129,212,250);
        &:hover, &.last-active {
          border-color: rgb(79,195,247);
        }
      }
      &.last-active {
        border-color: rgb(79,195,247);
      }
    }
  }

  div#explorer-header {
    padding: 0 1.25rem;
    justify-items: stretch;
    > * {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-radius: 0;
      &:not(:last-child) {
        border-right: 2px solid rgba(0, 0, 0, 0.05);
      }
    }
  }

  div#header {
    position: relative;
    padding: 0.5rem;
    display: flex;
    justify-content: space-between;
    border-bottom: 2px solid rgba(0,0,0,0.05);
    > div#path {
      position: relative;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
    }
    > div#buttons {
      display: flex;
      align-items: center;
      > a, > button {
        background-color: transparent;
      }
    }
  }

  div#progress {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 0;
    top: 0;
    opacity: 0.2;
  }

  div#hestia-loading-small {
    position: relative;
    background-color: #2c113a;
    width: 3px;
    height: 3px;
    margin: 9px;
    border-radius: 50%;

    &:after, &:before {
      content: "";
      position: absolute;
      width: 2px;
      height: 2px;
      border-radius: 50%;
    }

    &:after {
      left: -2px;
      top: -1px;
      background-color: #2c96ff;
      transform-origin: 3px 2px;
      animation: axis 1s linear infinite;
    }
    &:before {
      left: -5px;
      top: -3px;
      background-color: #ea2c6d;
      transform-origin: 6px 4px;
      animation: axis 2s linear infinite;
    }
  }

  @keyframes axis {
    0% {
      transform: rotateZ(0deg) translate3d(0,0,0);
    }
    100% {
      transform: rotateZ(360deg) translate3d(0,0,0);
    }
  }
}
</style>
