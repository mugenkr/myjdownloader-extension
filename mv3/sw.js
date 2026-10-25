'use strict';

const OFFSCREEN_URL = 'offscreen.html';
const BRIDGE_NAME = 'mv3-bridge';

let bridgePort = null;
const outbox = [];
let creatingOffscreen = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['DOM_PARSER'],
      justification: 'Runs the MyJDownloader background application'
    }).catch(e => console.warn('offscreen', e)).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

function emit(event, args) {
  const msg = { type: 'event', event: event, args: args };
  if (bridgePort) {
    bridgePort.postMessage(msg);
  } else {
    outbox.push(msg);
    ensureOffscreen();
  }
}

function serializeRequest(details) {
  const copy = Object.assign({}, details);
  if (details.requestBody) {
    copy.requestBody = Object.assign({}, details.requestBody);
    if (details.requestBody.raw) {
      copy.requestBody.raw = details.requestBody.raw.map(part => {
        const p = Object.assign({}, part);
        if (part.bytes) p.bytes = Array.from(new Uint8Array(part.bytes));
        return p;
      });
    }
  }
  return copy;
}

const forwardedEvents = {
  'tabs.onCreated': chrome.tabs.onCreated,
  'tabs.onRemoved': chrome.tabs.onRemoved,
  'tabs.onUpdated': chrome.tabs.onUpdated,
  'contextMenus.onClicked': chrome.contextMenus.onClicked,
  'commands.onCommand': chrome.commands.onCommand,
  'storage.onChanged': chrome.storage.onChanged
};
for (const name of Object.keys(forwardedEvents)) {
  forwardedEvents[name].addListener((...args) => emit(name, args));
}

chrome.webRequest.onBeforeRequest.addListener(
  details => emit('webRequest.onBeforeRequest', [serializeRequest(details)]),
  { urls: ['*://127.0.0.1/*', '*://localhost/*', '*://*/*jdcheck.js'] },
  ['requestBody']
);

function appendScripts(scripts) {
  scripts.forEach(function (s) {
    const el = document.createElement('script');
    el.type = 'text/javascript';
    if (s.src) {
      el.src = s.src;
      if (s.onload) {
        el.onload = function () {
          const next = document.createElement('script');
          next.type = 'text/javascript';
          next.text = s.onload;
          document.body.appendChild(next);
        };
      }
    } else {
      el.text = s.text;
    }
    document.body.appendChild(el);
  });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.name !== 'mv3-main-world' || !sender.tab) return false;
  chrome.scripting.executeScript({
    target: { tabId: sender.tab.id, frameIds: [sender.frameId] },
    world: 'MAIN',
    func: appendScripts,
    args: [msg.scripts]
  }).catch(e => console.error('MV3 bridge: main world injection failed', e && e.message ? e.message : e));
  return false;
});

chrome.runtime.onInstalled.addListener(details => emit('runtime.onInstalled', [details]));
chrome.runtime.onStartup.addListener(() => ensureOffscreen());

async function executeScript(args) {
  let tabId = args[0];
  let details = args[1];
  if (tabId !== null && typeof tabId === 'object') {
    details = tabId;
    tabId = null;
  }
  if (tabId == null) {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tabId = tabs[0].id;
  }
  const injection = { target: { tabId: tabId, allFrames: !!details.allFrames } };
  if (details.file) {
    injection.files = [details.file.replace(/^\/+/, '')];
  } else {
    injection.world = 'MAIN';
    injection.func = () => { window.jdownloader = true; };
  }
  if (details.runAt === 'document_start') injection.injectImmediately = true;
  const results = await chrome.scripting.executeScript(injection);
  return [results.map(r => r.result)];
}

function callChrome(path, args) {
  return new Promise((resolve, reject) => {
    const parts = path.split('.');
    let parent = chrome;
    for (let i = 0; i < parts.length - 1; i++) parent = parent[parts[i]];
    const fn = parent[parts[parts.length - 1]];
    fn.call(parent, ...args, (...result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

async function handleCall(port, msg) {
  let result;
  let error;
  try {
    result = msg.api === 'tabs.executeScript' ? await executeScript(msg.args) : await callChrome(msg.api, msg.args);
  } catch (e) {
    error = e && e.message ? e.message : String(e);
  }
  try {
    port.postMessage({ type: 'result', id: msg.id, result: result, error: error });
  } catch (e) {
    // offscreen document went away
  }
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== BRIDGE_NAME) return;
  bridgePort = port;
  port.onDisconnect.addListener(() => {
    if (bridgePort === port) bridgePort = null;
  });
  port.onMessage.addListener(msg => {
    if (msg.type === 'call') handleCall(port, msg);
  });
  while (outbox.length) port.postMessage(outbox.shift());
});

ensureOffscreen();
