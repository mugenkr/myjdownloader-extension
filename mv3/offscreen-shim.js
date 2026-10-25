'use strict';
// Runs inside the offscreen document before the AngularJS app.
// Offscreen documents only get chrome.runtime, so every other API used by the
// original MV2 background page is forwarded to the service worker (mv3/sw.js).
// The background scripts are loaded from mv3/offscreen/ with `chrome` renamed to `mv3chrome`.
(function () {
  const real = chrome;
  const BRIDGE_NAME = 'mv3-bridge';

  let port = null;
  let nextId = 1;
  const pending = new Map();
  const outbox = [];
  const listeners = Object.create(null);

  function connect() {
    port = real.runtime.connect({ name: BRIDGE_NAME });
    port.onMessage.addListener(onPortMessage);
    port.onDisconnect.addListener(function () {
      void real.runtime.lastError;
      port = null;
      pending.forEach(function (done) { done('MV3 bridge disconnected'); });
      pending.clear();
      setTimeout(connect, 500);
    });
    while (outbox.length) port.postMessage(outbox.shift());
  }

  function send(msg) {
    if (port) port.postMessage(msg);
    else outbox.push(msg);
  }

  function onPortMessage(msg) {
    if (msg.type === 'result') {
      const done = pending.get(msg.id);
      pending.delete(msg.id);
      if (done) done(msg.error, msg.result);
    } else if (msg.type === 'event') {
      (listeners[msg.event] || []).slice().forEach(function (fn) {
        try {
          fn.apply(null, msg.args);
        } catch (e) {
          console.error(e);
        }
      });
    }
  }

  function call(api, argsLike) {
    const args = Array.prototype.slice.call(argsLike);
    let callback = null;
    if (args.length && typeof args[args.length - 1] === 'function') callback = args.pop();
    while (args.length && args[args.length - 1] === undefined) args.pop();
    const id = nextId++;
    const promise = new Promise(function (resolve, reject) {
      pending.set(id, function (error, result) {
        if (callback) {
          runtime.lastError = error ? { message: error } : undefined;
          try {
            callback.apply(null, result || []);
          } finally {
            runtime.lastError = undefined;
          }
        }
        if (error) reject(new Error(error));
        else resolve(result ? result[0] : undefined);
      });
      send({ type: 'call', id: id, api: api, args: args });
    });
    promise.catch(function () {});
    return callback ? undefined : promise;
  }

  function api(path) {
    return function () {
      return call(path, arguments);
    };
  }

  function event(name) {
    listeners[name] = [];
    return {
      addListener: function (fn) {
        if (listeners[name].indexOf(fn) === -1) listeners[name].push(fn);
      },
      removeListener: function (fn) {
        const i = listeners[name].indexOf(fn);
        if (i !== -1) listeners[name].splice(i, 1);
      },
      hasListener: function (fn) {
        return listeners[name].indexOf(fn) !== -1;
      },
      hasListeners: function () {
        return listeners[name].length > 0;
      }
    };
  }

  function getURL(path) {
    return new URL(String(path).replace(/^\/+/, ''), location.origin + '/').href;
  }

  function loadJson(path) {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', getURL(path), false);
      xhr.send();
      return xhr.responseText ? JSON.parse(xhr.responseText) : null;
    } catch (e) {
      return null;
    }
  }

  const manifest = loadJson('manifest.json');

  function fallbackI18n() {
    function load(lang) {
      return loadJson('_locales/' + lang + '/messages.json');
    }
    const raw = load((navigator.language || 'en').split('-')[0]) || load(manifest.default_locale) || {};
    const messages = Object.create(null);
    Object.keys(raw).forEach(function (key) {
      const entry = { message: raw[key].message || '', placeholders: Object.create(null) };
      if (raw[key].placeholders) {
        Object.keys(raw[key].placeholders).forEach(function (p) {
          entry.placeholders[p.toLowerCase()] = raw[key].placeholders[p].content;
        });
      }
      messages[key.toLowerCase()] = entry;
    });
    return {
      getMessage: function (name, subs) {
        const entry = messages[String(name).toLowerCase()];
        if (!entry) return '';
        const values = subs == null ? [] : [].concat(subs);
        return entry.message
          .replace(/\$([a-z0-9_@]+)\$/gi, function (m, p) {
            const content = entry.placeholders[p.toLowerCase()];
            return content !== undefined ? content : m;
          })
          .replace(/\$(\d)/g, function (m, n) {
            return values[n - 1] !== undefined ? String(values[n - 1]) : '';
          })
          .replace(/\$\$/g, '$');
      },
      getUILanguage: function () {
        return navigator.language;
      },
      getAcceptLanguages: function (callback) {
        const langs = (navigator.languages || [navigator.language]).slice();
        if (callback) callback(langs);
        return Promise.resolve(langs);
      },
      detectLanguage: api('i18n.detectLanguage')
    };
  }

  const runtime = {
    lastError: undefined,
    get id() {
      return real.runtime.id || location.host;
    },
    getManifest: function () {
      return JSON.parse(JSON.stringify(manifest));
    },
    getURL: getURL,
    sendMessage: function () {
      const args = Array.prototype.slice.call(arguments);
      const last = args[args.length - 1];
      if (typeof last === 'function') {
        args[args.length - 1] = function () {
          runtime.lastError = real.runtime.lastError;
          try {
            last.apply(null, arguments);
          } finally {
            runtime.lastError = undefined;
          }
        };
      }
      return real.runtime.sendMessage.apply(real.runtime, args);
    },
    onMessage: real.runtime.onMessage,
    onInstalled: event('runtime.onInstalled'),
    openOptionsPage: api('runtime.openOptionsPage')
  };

  const shim = {
    runtime: runtime,
    extension: {
      getURL: getURL,
      isAllowedIncognitoAccess: api('extension.isAllowedIncognitoAccess'),
      get lastError() {
        return runtime.lastError;
      }
    },
    i18n: real.i18n && real.i18n.getMessage ? real.i18n : fallbackI18n(),
    tabs: {
      create: api('tabs.create'),
      get: api('tabs.get'),
      query: api('tabs.query'),
      remove: api('tabs.remove'),
      update: api('tabs.update'),
      sendMessage: api('tabs.sendMessage'),
      executeScript: api('tabs.executeScript'),
      onCreated: event('tabs.onCreated'),
      onRemoved: event('tabs.onRemoved'),
      onUpdated: event('tabs.onUpdated')
    },
    windows: {
      create: api('windows.create'),
      get: api('windows.get'),
      getAll: api('windows.getAll'),
      remove: api('windows.remove'),
      update: api('windows.update')
    },
    contextMenus: {
      create: function (props) {
        call('contextMenus.create', arguments);
        return props.id;
      },
      removeAll: api('contextMenus.removeAll'),
      onClicked: event('contextMenus.onClicked')
    },
    commands: {
      onCommand: event('commands.onCommand')
    },
    storage: {
      local: {
        get: api('storage.local.get'),
        set: api('storage.local.set'),
        remove: api('storage.local.remove'),
        clear: api('storage.local.clear')
      },
      onChanged: event('storage.onChanged')
    },
    browserAction: {
      setBadgeText: api('action.setBadgeText'),
      setBadgeBackgroundColor: api('action.setBadgeBackgroundColor')
    },
    webRequest: {
      onBeforeRequest: event('webRequest.onBeforeRequest'),
      onBeforeSendHeaders: event('webRequest.onBeforeSendHeaders')
    },
    declarativeNetRequest: {
      updateEnabledRulesets: api('declarativeNetRequest.updateEnabledRulesets')
    }
  };

  window.mv3chrome = shim;

  connect();
  setInterval(function () {
    send({ type: 'ping' });
  }, 20000);
})();
