"use strict";

const DEFAULTS = { mappings: {}, mode: "tabs", height: 600, enabled: true };
const TWITCH_RE = /^[a-zA-Z0-9_]{2,25}$/;
const $ = (id) => document.getElementById(id);

let settings = { ...DEFAULTS };
let tabId = null;
let info = null;

function normalizeTwitch(input) {
  if (!input) return null;
  let s = String(input).trim();
  const m = s.match(/twitch\.tv\/([a-zA-Z0-9_]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, "").toLowerCase();
  return TWITCH_RE.test(s) ? s : null;
}

function setStatus(html) {
  $("status").replaceChildren();
  for (const part of html) {
    if (typeof part === "string") $("status").append(part);
    else {
      const b = document.createElement("strong");
      b.textContent = part.bold;
      $("status").append(b);
    }
  }
}

function renderList() {
  const list = $("list");
  list.replaceChildren();
  const entries = Object.entries(settings.mappings).sort((a, b) => a[0].localeCompare(b[0]));
  $("empty").hidden = entries.length > 0;
  for (const [yt, tw] of entries) {
    const li = document.createElement("li");
    const a = document.createElement("span");
    a.textContent = yt;
    a.title = yt;
    const arrow = document.createElement("span");
    arrow.className = "arrow";
    arrow.textContent = "→";
    const b = document.createElement("span");
    b.textContent = tw;
    b.title = `twitch.tv/${tw}`;
    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "Eliminar";
    del.addEventListener("click", async () => {
      delete settings.mappings[yt];
      await chrome.storage.sync.set({ mappings: settings.mappings });
      renderList();
      refreshCurrent();
    });
    li.append(a, arrow, b, del);
    list.append(li);
  }
}

async function queryTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab ? tab.id : null;
  if (!tabId) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "tcy:getInfo" });
  } catch {
    return null; // no es YouTube o la pestaña se abrió antes de instalar la extensión
  }
}

async function refreshCurrent() {
  info = await queryTab();
  const form = $("form");

  if (!info) {
    form.hidden = true;
    setStatus(["Abre un directo de YouTube. Si ya está abierto, recarga la pestaña."]);
    return;
  }
  if (!info.isWatch) {
    form.hidden = true;
    setStatus(["Abre un vídeo o directo de YouTube para configurarlo."]);
    return;
  }

  form.hidden = false;
  const name = info.ytChannelName || info.ytChannel || "este canal";
  if (info.ytChannel) {
    setStatus(["Canal de YouTube: ", { bold: name }]);
  } else {
    setStatus(["No se detecta el canal todavía; puedes usar “Solo este directo”."]);
  }
  $("save").disabled = !info.ytChannel;

  const saved = info.ytChannel ? settings.mappings[info.ytChannel] : null;
  if (document.activeElement !== $("twitch")) $("twitch").value = info.override || saved || "";
  $("remove").hidden = !saved;
}

async function save(once) {
  const tw = normalizeTwitch($("twitch").value);
  $("error").hidden = !!tw;
  if (!tw) return;

  if (once) {
    await chrome.tabs.sendMessage(tabId, { type: "tcy:setOverride", twitch: tw });
  } else if (info && info.ytChannel) {
    settings.mappings[info.ytChannel] = tw;
    await chrome.storage.sync.set({ mappings: settings.mappings });
    await chrome.tabs.sendMessage(tabId, { type: "tcy:setOverride", twitch: null });
  }
  if (!settings.enabled) {
    settings.enabled = true;
    $("enabled").checked = true;
    await chrome.storage.sync.set({ enabled: true });
  }
  renderList();
  refreshCurrent();
}

async function init() {
  settings = await chrome.storage.sync.get(DEFAULTS);
  $("enabled").checked = settings.enabled;
  $("mode").value = settings.mode;
  renderList();
  await refreshCurrent();

  $("enabled").addEventListener("change", (e) => chrome.storage.sync.set({ enabled: e.target.checked }));
  $("mode").addEventListener("change", (e) => chrome.storage.sync.set({ mode: e.target.value }));
  $("save").addEventListener("click", () => save(false));
  $("once").addEventListener("click", () => save(true));
  $("twitch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") save(!(info && info.ytChannel));
  });
  $("remove").addEventListener("click", async () => {
    if (!info || !info.ytChannel) return;
    delete settings.mappings[info.ytChannel];
    await chrome.storage.sync.set({ mappings: settings.mappings });
    await chrome.tabs.sendMessage(tabId, { type: "tcy:setOverride", twitch: null });
    $("twitch").value = "";
    renderList();
    refreshCurrent();
  });
}

init();
