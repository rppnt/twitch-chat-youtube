// Twitch Chat en YouTube — content script
// Inserta el chat embebido oficial de Twitch (twitch.tv/embed/<canal>/chat)
// junto al chat de YouTube. No hace peticiones de red propias ni envía datos a nadie.
(() => {
  "use strict";

  const PANEL_ID = "tcy-panel";
  // customHeight: altura elegida arrastrando el tirador (null = igualar al chat de YouTube)
  const DEFAULTS = { mappings: {}, mode: "tabs", customHeight: null, enabled: true };
  const FALLBACK_HEIGHT = 600;
  const MIN_HEIGHT = 250;

  let settings = { ...DEFAULTS };
  let override = null;        // canal de Twitch puesto "solo para este directo"
  let overrideUrl = null;     // URL en la que se fijó el override
  let activeTab = "twitch";   // pestaña visible en modo "tabs"

  // ---------- utilidades ----------

  const TWITCH_RE = /^[a-zA-Z0-9_]{2,25}$/;

  function normalizeTwitch(input) {
    if (!input) return null;
    let s = String(input).trim();
    const m = s.match(/twitch\.tv\/([a-zA-Z0-9_]+)/i);
    if (m) s = m[1];
    s = s.replace(/^@/, "").toLowerCase();
    return TWITCH_RE.test(s) ? s : null;
  }

  function isWatchPage() {
    return location.pathname === "/watch" || location.pathname.startsWith("/live/");
  }

  // Devuelve el identificador del canal de YouTube del vídeo actual:
  // "@handle" (en minúsculas) o el id "UC..." si no hay handle.
  function getYouTubeChannel() {
    const link = document.querySelector(
      "ytd-watch-metadata ytd-video-owner-renderer a[href^='/@'], " +
      "#owner ytd-video-owner-renderer a[href^='/@'], " +
      "ytd-watch-metadata ytd-video-owner-renderer a[href*='/channel/'], " +
      "#owner ytd-video-owner-renderer a[href*='/channel/']"
    );
    if (!link) return null;
    const href = link.getAttribute("href") || "";
    let m = href.match(/^\/(@[^/?#]+)/);
    if (m) return decodeURIComponent(m[1]).toLowerCase();
    m = href.match(/\/channel\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  function getYouTubeChannelName() {
    const el = document.querySelector("ytd-watch-metadata #channel-name a, #owner #channel-name a");
    return el ? el.textContent.trim() : null;
  }

  function currentTwitch() {
    if (override && overrideUrl === location.href) return override;
    const yt = getYouTubeChannel();
    return yt ? settings.mappings[yt] || null : null;
  }

  function isDark() {
    return document.documentElement.hasAttribute("dark");
  }

  function chatSrc(channel) {
    const params = new URLSearchParams({ parent: location.hostname });
    let src = `https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?${params}`;
    if (isDark()) src += "&darkpopout";
    return src;
  }

  function getYouTubeChat() {
    return document.querySelector("ytd-live-chat-frame#chat");
  }

  // ---------- panel ----------

  function removePanel() {
    const p = document.getElementById(PANEL_ID);
    if (p) p.remove();
    const yt = getYouTubeChat();
    if (yt) yt.removeAttribute("data-tcy-hidden");
  }

  function buildPanel(channel) {
    const panel = document.createElement("div");
    panel.id = PANEL_ID;

    const bar = document.createElement("div");
    bar.className = "tcy-bar";

    const tabTwitch = document.createElement("button");
    tabTwitch.className = "tcy-tab";
    tabTwitch.dataset.tab = "twitch";
    tabTwitch.textContent = "Chat de Twitch";

    const tabYT = document.createElement("button");
    tabYT.className = "tcy-tab";
    tabYT.dataset.tab = "youtube";
    tabYT.textContent = "Chat de YouTube";

    const name = document.createElement("span");
    name.className = "tcy-name";
    const a = document.createElement("a");
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    name.appendChild(a);

    bar.append(tabTwitch, tabYT, name);

    bar.addEventListener("click", (e) => {
      const btn = e.target.closest(".tcy-tab");
      if (!btn) return;
      activeTab = btn.dataset.tab;
      applyVisibility(panel);
    });

    const iframe = document.createElement("iframe");
    iframe.title = "Chat de Twitch";
    iframe.setAttribute("allow", "clipboard-write");

    const grip = document.createElement("div");
    grip.className = "tcy-grip";
    grip.title = "Arrastra para cambiar la altura · doble clic para igualarla al chat de YouTube";

    panel.append(bar, iframe, grip);
    setupGrip(panel, grip);

    setChannel(panel, channel);
    return panel;
  }

  function setChannel(panel, channel) {
    const src = chatSrc(channel);
    const iframe = panel.querySelector("iframe");
    if (iframe.dataset.src !== src) {
      iframe.dataset.src = src;
      iframe.src = src;
    }
    const a = panel.querySelector(".tcy-name a");
    a.textContent = `twitch.tv/${channel}`;
    a.href = `https://www.twitch.tv/${encodeURIComponent(channel)}`;
  }

  function applyVisibility(panel) {
    const ytChat = getYouTubeChat();
    const tabsMode = settings.mode === "tabs" && ytChat;
    const showTwitch = !tabsMode || activeTab === "twitch";

    panel.querySelector(".tcy-tab[data-tab='youtube']").style.display = tabsMode ? "" : "none";
    panel.querySelector(".tcy-tab[data-tab='twitch']").style.display = tabsMode ? "" : "none";
    panel.querySelectorAll(".tcy-tab").forEach((b) =>
      b.classList.toggle("tcy-active", b.dataset.tab === (showTwitch ? "twitch" : "youtube"))
    );

    panel.classList.toggle("tcy-collapsed", !showTwitch);

    if (ytChat) {
      const hideYT = settings.mode === "replace" || (tabsMode && showTwitch);
      if (hideYT) ytChat.setAttribute("data-tcy-hidden", "");
      else ytChat.removeAttribute("data-tcy-hidden");
    }

    applyHeight(panel, ytChat, showTwitch);
  }

  // Altura del panel: la elegida por el usuario o, si no hay, la misma que el chat de YouTube.
  let dragging = false;

  function applyHeight(panel, ytChat, showTwitch) {
    if (!showTwitch || dragging) return;
    let h;
    if (settings.customHeight) {
      h = settings.customHeight;
    } else {
      const ytH = ytChat ? Math.round(ytChat.getBoundingClientRect().height) : 0;
      if (ytH >= MIN_HEIGHT) {
        const bar = panel.querySelector(".tcy-bar");
        const grip = panel.querySelector(".tcy-grip");
        h = ytH + bar.offsetHeight + grip.offsetHeight + (panel.offsetHeight - panel.clientHeight);
      } else {
        h = FALLBACK_HEIGHT;
      }
    }
    if (ytChat) watchYouTubeChat(ytChat);
    if (panel.style.height !== `${h}px`) panel.style.height = `${h}px`;
  }

  // Tirador propio: el redimensionado nativo de CSS falla cuando el ratón pasa sobre el iframe.
  function setupGrip(panel, grip) {
    let startY = 0;
    let startH = 0;

    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      startY = e.clientY;
      startH = panel.getBoundingClientRect().height;
      grip.setPointerCapture(e.pointerId);
      panel.classList.add("tcy-dragging");
    });

    grip.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const h = Math.max(MIN_HEIGHT, Math.round(startH + e.clientY - startY));
      panel.style.height = `${h}px`;
    });

    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove("tcy-dragging");
      if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);
      const h = Math.round(panel.getBoundingClientRect().height);
      if (Math.abs(h - startH) > 2) {
        settings.customHeight = h;
        chrome.storage.sync.set({ customHeight: h });
      }
    };
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);

    grip.addEventListener("dblclick", () => {
      settings.customHeight = null;
      chrome.storage.sync.set({ customHeight: null });
      applyVisibility(panel);
    });
  }

  // Reacciona al instante cuando YouTube cambia el tamaño de su chat
  // (redimensionar ventana, modo cine, plegar/desplegar el chat...).
  let observedChat = null;
  const chatResizeObserver = new ResizeObserver(() => {
    const p = document.getElementById(PANEL_ID);
    if (p && observedChat) applyHeight(p, observedChat, !p.classList.contains("tcy-collapsed"));
  });
  function watchYouTubeChat(ytChat) {
    if (observedChat === ytChat) return;
    if (observedChat) chatResizeObserver.unobserve(observedChat);
    observedChat = ytChat;
    chatResizeObserver.observe(ytChat);
  }

  function render() {
    const channel = currentTwitch();
    if (!settings.enabled || !isWatchPage() || !channel) {
      removePanel();
      return;
    }

    const ytChat = getYouTubeChat();
    let parent, before;
    if (ytChat && ytChat.parentElement) {
      parent = ytChat.parentElement;
      before = ytChat;
    } else {
      parent = document.querySelector("#secondary-inner") || document.querySelector("#secondary");
      before = parent ? parent.firstElementChild : null;
    }
    if (!parent) return; // la página aún no ha cargado

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = buildPanel(channel);
      parent.insertBefore(panel, before);
    } else {
      setChannel(panel, channel);
      // Solo movemos el panel si YouTube ha recolocado el chat (p. ej. modo cine)
      if (panel.parentElement !== parent || (before && panel.nextElementSibling !== before && before !== panel)) {
        parent.insertBefore(panel, before);
      }
    }
    applyVisibility(panel);
  }

  // ---------- eventos ----------

  async function loadSettings() {
    settings = await chrome.storage.sync.get(DEFAULTS);
  }

  chrome.storage.onChanged.addListener(async (_changes, area) => {
    if (area !== "sync") return;
    await loadSettings();
    render();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "tcy:getInfo") {
      sendResponse({
        isWatch: isWatchPage(),
        ytChannel: getYouTubeChannel(),
        ytChannelName: getYouTubeChannelName(),
        hasYouTubeChat: !!getYouTubeChat(),
        twitch: currentTwitch(),
        override: override && overrideUrl === location.href ? override : null,
      });
    } else if (msg && msg.type === "tcy:setOverride") {
      override = normalizeTwitch(msg.twitch);
      overrideUrl = override ? location.href : null;
      activeTab = "twitch";
      render();
      sendResponse({ ok: true, twitch: override });
    }
    return false;
  });

  // YouTube es una SPA: re-evaluamos al navegar y periódicamente
  // (el DOM del canal y del chat llega con retraso y cambia en modo cine).
  window.addEventListener("yt-navigate-finish", () => {
    activeTab = "twitch";
    render();
  });
  new MutationObserver(() => {
    const p = document.getElementById(PANEL_ID);
    if (p) setChannel(p, currentTwitch() || "");
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["dark"] });

  loadSettings().then(() => {
    render();
    setInterval(render, 1500);
  });
})();
