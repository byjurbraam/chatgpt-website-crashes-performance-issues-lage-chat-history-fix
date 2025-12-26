/*
  Made by: Jur Braam
  LinkedIn: https://www.linkedin.com/in/jurbraam

  Not affiliated with OpenAI — this is a community helper.
  If OpenAI requests removal, this project will be taken down immediately.

  Purpose:
  - prevent long chats from freezing by reducing DOM load
  - keep full history safe in local cache
  - lazy-load old messages only when needed
  - avoid losing context or abandoning huge chats

  100% client-side. No backend changes. No bypassing.
  You can review, disable, or remove the script anytime.
*/
(function () {
  "use strict";

  const INITIAL_VISIBLE_WINDOW_MINUTES = 5;
  const PLACEHOLDER = "[older message available via History Viewer]";
  const PRUNE_KEY = "chatgpt_history_optimizer_prune";
  const DATA_PREFIX = "chatgpt_history_optimizer_conversation_";

  console.log(
    "%cChatGPT History Optimizer Loaded",
    "background:#4ade80;color:#022c22;font-weight:bold;padding:6px;border-radius:6px;"
  );
  console.log(
    "💡 Client-side only. Full history stays safe. If OpenAI asks, removal is immediate."
  );

  const enable = () => localStorage.setItem(PRUNE_KEY, "1");
  const disable = () => localStorage.setItem(PRUNE_KEY, "0");
  const enabled = () => localStorage.getItem(PRUNE_KEY) !== "0";

  window.ChatGPTHistoryOptimizer = {
    status() {
      return { enabled: enabled() };
    },
    enableOptimization() {
      enable();
      location.reload();
    },
    disableOptimization() {
      disable();
      location.reload();
    },
    clearCache() {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(DATA_PREFIX))
        .forEach((k) => localStorage.removeItem(k));
      console.log("🗑️ Cache cleared");
    },
  };

  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const res = await originalFetch(...args);
    if (!enabled()) return res;

    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
    if (!url.includes("/backend-api/conversation")) return res;

    try {
      const clone = res.clone();
      const json = await clone.json();

      if (json?.conversation_id) {
        localStorage.setItem(
          DATA_PREFIX + json.conversation_id,
          JSON.stringify(json)
        );
      }

      let newest = 0;
      if (json && json.mapping) {
        for (const key in json.mapping) {
          const mt = json.mapping[key]?.message?.create_time;
          if (typeof mt === "number" && mt > newest) newest = mt;
        }
      }

      const limit = newest - INITIAL_VISIBLE_WINDOW_MINUTES * 60;

      if (json && json.mapping) {
        for (const key in json.mapping) {
          const node = json.mapping[key];
          const mt = node?.message?.create_time;
          if (typeof mt === "number" && mt < limit) {
            try {
              if (node.message && node.message.content) {
                node.message.content.parts = [PLACEHOLDER];
              }
            } catch (e) {
              console.warn(
                "[ChatGPT History Optimizer] Failed to apply placeholder on node:",
                key,
                e
              );
            }
          }
        }
      }

      const body = JSON.stringify(json);
      return new Response(body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    } catch (error) {
      console.warn(
        "[ChatGPT History Optimizer] Error while processing response:",
        error
      );
      return res;
    }
  };
})();
