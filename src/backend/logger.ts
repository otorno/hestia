import { configure } from 'log4js';
import * as path from 'path';

const level = process.env.NODE_ENV === 'production' ? 'info' : 'debug';
const layout = { type: 'pattern', pattern: '%[[%d][%p][%c]:%] %m' };
const errorLayout = { type: 'pattern', pattern: '%[[%d][%p][%c]:%] %f:%l %m%n%s' };
const layoutBasic = { type: 'pattern', pattern: '[%d][%p][%c]: %m' };
const errorLayoutBasic = { type: 'pattern', pattern: '[%d][%p][%c]: %f:%l %m%n%s' };
const defaultAppenders = ['out', 'err', 'app:out', 'app:err'];

function makeLogPortions(name: string) {
  return {
    [name]: { type: 'file', filename: path.join('./logs/' + name + '.log'), layout: layoutBasic },
    [name + '-error']: { type: 'file', filename: path.join('./logs/' + name + '-error.log'), layout: errorLayoutBasic },
    [name + ':err']: { type: 'logLevelFilter', appender: name + '-error', level: 'error'  },
    [name + ':out']: { type: 'logLevelFilter', appender: name, level }
  };
}

configure({
  appenders: {
    stdout: { type: 'stdout', layout },
    stderr: { type: 'stderr', layout: errorLayout },
    out: { type: 'logLevelFilter', appender: 'stdout', level, maxLevel: 'info' },
    err: { type: 'logLevelFilter', appender: 'stderr', level: 'warn' },

    ...makeLogPortions('plugins'),
    ...makeLogPortions('drivers'),
    ...makeLogPortions('services'),
    ...makeLogPortions('app'),
    ...makeLogPortions('express'),
  },
  categories: {
    default: { appenders: defaultAppenders, level, enableCallStack: true },
    express: { appenders: defaultAppenders, level, enableCallStack: true },
    plugins: { appenders: ['plugins:err', 'plugins:out', ...defaultAppenders], level, enableCallStack: true },
    drivers: { appenders: ['drivers:err', 'drivers:out', ... defaultAppenders], level, enableCallStack: true },
    services: { appenders: ['services:err', 'services:out', ... defaultAppenders], level, enableCallStack: true }
  }
});
