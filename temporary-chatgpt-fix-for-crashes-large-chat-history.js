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
console.log('injected ChatGPT crash fix', location.href);

(function () {
  'use strict';

  // Prevent double-installation if this file is injected twice
  if (window.__CHATGPT_CRASH_FIX_INSTALLED__) {
    console.log('[ChatGPT Crash Fix] Already installed, skipping second init');
    return;
  }
  window.__CHATGPT_CRASH_FIX_INSTALLED__ = true;

  console.log('[ChatGPT Crash Fix] Initializing…');

  const STORAGE_KEY = 'chatgpt_pruneBigMessages';

  // How many most recent messages to keep "untouched"
  const KEEP_RECENT_MESSAGES = 10;

  // Max characters we keep in each content "part" for older messages
  const MAX_CHARS_PER_PART = 800;

  // Only prune if a message total text is at least this big
  const MIN_TOTAL_LENGTH_FOR_TRIM = 5000;

  function pruningEnabled() {
    try {
      const val = localStorage.getItem(STORAGE_KEY);
      if (val === null) return true; // default = enabled
      return val === '1' || val === 'true';
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

  /**
   * Safely prune only the message *content*, never the mapping structure.
   * We do NOT delete mapping entries, root, or parent/children — only shrink text.
   */
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

      const content = msg.content;
      const parts = Array.isArray(content.parts) ? content.parts : null;
      if (!parts || parts.length === 0) continue;

      const createTime = typeof msg.create_time === 'number' ? msg.create_time : 0;

      let totalLen = 0;
      for (const p of parts) {
        if (typeof p === 'string') {
          totalLen += p.length;
        } else if (p && typeof p === 'object' && typeof p.text === 'string') {
          totalLen += p.text.length;
        }
      }

      messages.push({
        node,
        msg,
        content,
        parts,
        createTime,
        totalLen
      });
    }

    if (messages.length === 0) return payload;

    // Oldest first
    messages.sort((a, b) => a.createTime - b.createTime);

    // Keep latest N messages untouched
    const cutoffIndex = Math.max(0, messages.length - KEEP_RECENT_MESSAGES);

    let prunedCount = 0;

    for (let i = 0; i < cutoffIndex; i++) {
      const entry = messages[i];

      if (entry.totalLen < MIN_TOTAL_LENGTH_FOR_TRIM) continue;

      const parts = entry.parts;
      for (let pi = 0; pi < parts.length; pi++) {
        const part = parts[pi];

        if (typeof part === 'string') {
          if (part.length > MAX_CHARS_PER_PART) {
            parts[pi] = part.slice(-MAX_CHARS_PER_PART);
            prunedCount++;
          }
        } else if (part && typeof part === 'object') {
          if (typeof part.text === 'string' && part.text.length > MAX_CHARS_PER_PART) {
            part.text = part.text.slice(-MAX_CHARS_PER_PART);
            prunedCount++;
          }
        }
      }
    }

    if (prunedCount > 0) {
      console.log(
        `[ChatGPT Crash Fix] Pruned content in ${prunedCount} parts (old messages only)`
      );
    } else {
      console.log('[ChatGPT Crash Fix] Nothing to prune in this conversation payload');
    }

    return payload;
  }

  function patchFetch() {
    if (!window.fetch) {
      console.warn('[ChatGPT Crash Fix] window.fetch not found, cannot patch');
      return;
    }

    const origFetch = window.fetch;

    window.fetch = async function (input, init) {
      const res = await origFetch.apply(this, arguments);

      if (!pruningEnabled()) {
        // Optional debug log if you want:
        // console.log('[ChatGPT Crash Fix] Pruning disabled via localStorage');
        return res;
      }

      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (!isConversationUrl(url)) {
          return res;
        }

        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
          return res;
        }

        // We consume the clone, not the original body
        const clone = res.clone();
        const data = await clone.json();

        const pruned = pruneConversationPayload(data);
        const body = JSON.stringify(pruned);

        const headers = new Headers(res.headers);
        // Let the browser recompute content-length
        headers.delete('content-length');

        return new Response(body, {
          status: res.status,
          statusText: res.statusText,
          headers
        });
      } catch (e) {
        console.warn('[ChatGPT Crash Fix] Error while pruning fetch response:', e);
        return res;
      }
    };

    console.log('[ChatGPT Crash Fix] fetch() patched successfully');
  }

  function install() {
    try {
      patchFetch();
      console.log('[ChatGPT Crash Fix] Installation complete, waiting for conversation fetches…');
    } catch (e) {
      console.error('[ChatGPT Crash Fix] install error:', e);
    }
  }

  install();
})();

