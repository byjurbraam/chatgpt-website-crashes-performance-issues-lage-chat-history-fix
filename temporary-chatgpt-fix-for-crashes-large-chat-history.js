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
// ==UserScript==
// @name         ChatGPT fetch-prune heavy history (safe mapping + log)
// @namespace    local.chatgpt.fetchprune
// @version      1.3
// @description  Intercept ChatGPT API responses and trim old message content without breaking the tree.
// @author       you
// @match        https://chatgpt.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  console.log('[ChatGPT Crash Fix] Script loaded on', location.href);

  const STORAGE_KEY = 'chatgpt_pruneBigMessages';

  // Enable pruning?
  function pruningEnabled() {
    try {
      const val = localStorage.getItem(STORAGE_KEY);
      return val === null || val === '1' || val === 'true';
    } catch {
      return true;
    }
  }

  function isConversationUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url, location.origin);
      return u.pathname.startsWith('/backend-api/conversation');
    } catch {
      return false;
    }
  }

  function pruneConversationPayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    if (!payload.mapping || typeof payload.mapping !== 'object') return payload;

    const mapping = payload.mapping;
    const nodes = Object.values(mapping);
    const messages = [];

    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const msg = node.message;
      if (!msg || !msg.content) continue;

      const parts = Array.isArray(msg.content.parts) ? msg.content.parts : null;
      if (!parts || parts.length === 0) continue;

      const time = typeof msg.create_time === 'number' ? msg.create_time : 0;
      let totalLen = 0;
      for (const p of parts) {
        if (typeof p === 'string') totalLen += p.length;
        else if (p && typeof p.text === 'string') totalLen += p.text.length;
      }

      messages.push({ node, parts, totalLen, time });
    }

    if (messages.length === 0) return payload;
    messages.sort((a, b) => a.time - b.time);

    const KEEP_RECENT = 10;
    const MAX_PART_CHARS = 800;
    const MIN_TOTAL_TRIM = 5000;
    const cutoff = Math.max(0, messages.length - KEEP_RECENT);

    for (let i = 0; i < cutoff; i++) {
      const m = messages[i];
      if (m.totalLen < MIN_TOTAL_TRIM) continue;
      for (let j = 0; j < m.parts.length; j++) {
        const part = m.parts[j];
        if (typeof part === 'string') {
          if (part.length > MAX_PART_CHARS) {
            m.parts[j] = part.slice(-MAX_PART_CHARS);
          }
        } else if (part && typeof part.text === 'string' && part.text.length > MAX_PART_CHARS) {
          part.text = part.text.slice(-MAX_PART_CHARS);
        }
      }
    }

    return payload;
  }

  function patchFetch() {
    if (!window.fetch) return;
    const origFetch = window.fetch;

    window.fetch = async function (input, init) {
      const res = await origFetch.apply(this, arguments);

      if (!pruningEnabled()) return res;

      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (!isConversationUrl(url)) return res;

        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) return res;

        const clone = res.clone();
        const data = await clone.json();
        const pruned = pruneConversationPayload(data);

        const body = JSON.stringify(pruned);
        const headers = new Headers(res.headers);
        headers.delete('content-length');

        return new Response(body, {
          status: res.status,
          statusText: res.statusText,
          headers
        });
      } catch (e) {
        console.warn('[ChatGPT Crash Fix] fetch prune error', e);
        return res;
      }
    };
  }

  function install() {
    try {
      patchFetch();
      console.log('[ChatGPT Crash Fix] Installed fetch patch');
    } catch (e) {
      console.error('[ChatGPT Crash Fix] install error', e);
    }
  }

  install();
})();
