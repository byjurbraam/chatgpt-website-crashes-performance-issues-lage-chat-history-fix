console.log('injected ChatGPT crash fix v4', location.href);

(function () {
  'use strict';

  if (window.__CHATGPT_CRASH_FIX_INSTALLED__) {
    console.log('[ChatGPT Crash Fix] Already installed, skipping');
    return;
  }
  window.__CHATGPT_CRASH_FIX_INSTALLED__ = true;

  console.log('[ChatGPT Crash Fix] Initializing...');

  var STORAGE_KEY = 'chatgpt_pruneBigMessages';
  var KEEP_RECENT_MESSAGES = 10;
  var MAX_CHARS_PER_PART = 800;
  var MIN_TOTAL_LENGTH_FOR_TRIM = 5000;

  // New: only prune if the conversation is really large
  var MIN_MESSAGES_FOR_PRUNE = 60;          // minimum number of messages
  var MIN_CONVERSATION_LENGTH_FOR_PRUNE = 50000; // minimum total text length

  function pruningEnabled() {
    try {
      var val = localStorage.getItem(STORAGE_KEY);
      if (val === null) return true; // default = enabled
      return val === '1' || val === 'true';
    } catch (e) {
      return true;
    }
  }

  function isConversationUrl(url) {
    if (!url) return false;
    try {
      var u = new URL(url, location.origin);
      return u.pathname && u.pathname.indexOf('/backend-api/conversation') === 0;
    } catch (e) {
      return false;
    }
  }

  function pruneConversationPayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    if (!payload.mapping || typeof payload.mapping !== 'object') return payload;

    var mapping = payload.mapping;
    var nodeKeys = Object.keys(mapping);
    var nodes = [];
    for (var nk = 0; nk < nodeKeys.length; nk++) {
      nodes.push(mapping[nodeKeys[nk]]);
    }

    var messages = [];
    var i, node;

    for (i = 0; i < nodes.length; i++) {
      node = nodes[i];
      if (!node || typeof node !== 'object') continue;

      var msg = node.message;
      if (!msg || !msg.content) continue;

      var content = msg.content;
      var parts = Array.isArray(content.parts) ? content.parts : null;
      if (!parts || parts.length === 0) continue;

      var createTime = typeof msg.create_time === 'number' ? msg.create_time : 0;

      var totalLen = 0;
      for (var pIndex = 0; pIndex < parts.length; pIndex++) {
        var p = parts[pIndex];
        if (typeof p === 'string') {
          totalLen += p.length;
        } else if (p && typeof p === 'object' && typeof p.text === 'string') {
          totalLen += p.text.length;
        }
      }

      messages.push({
        node: node,
        msg: msg,
        content: content,
        parts: parts,
        createTime: createTime,
        totalLen: totalLen
      });
    }

    if (messages.length === 0) return payload;

    // New: compute total conversation length and optionally skip pruning
    var totalConversationLen = 0;
    for (var mi = 0; mi < messages.length; mi++) {
      totalConversationLen += messages[mi].totalLen;
    }

    if (
      messages.length < MIN_MESSAGES_FOR_PRUNE &&
      totalConversationLen < MIN_CONVERSATION_LENGTH_FOR_PRUNE
    ) {
      console.log(
        '[ChatGPT Crash Fix] Conversation small (messages=' +
          messages.length +
          ', totalLen=' +
          totalConversationLen +
          '), skipping prune'
      );
      return payload;
    }

    messages.sort(function (a, b) {
      return a.createTime - b.createTime;
    });

    var cutoffIndex = Math.max(0, messages.length - KEEP_RECENT_MESSAGES);
    var prunedCount = 0;

    for (i = 0; i < cutoffIndex; i++) {
      var entry = messages[i];
      if (entry.totalLen < MIN_TOTAL_LENGTH_FOR_TRIM) continue;

      var partsToTrim = entry.parts;
      for (var pi = 0; pi < partsToTrim.length; pi++) {
        var part = partsToTrim[pi];

        if (typeof part === 'string') {
          if (part.length > MAX_CHARS_PER_PART) {
            partsToTrim[pi] = part.slice(part.length - MAX_CHARS_PER_PART);
            prunedCount++;
          }
        } else if (part && typeof part === 'object') {
          if (typeof part.text === 'string' && part.text.length > MAX_CHARS_PER_PART) {
            part.text = part.text.slice(part.text.length - MAX_CHARS_PER_PART);
            prunedCount++;
          }
        }
      }
    }

    if (prunedCount > 0) {
      console.log(
        '[ChatGPT Crash Fix] Pruned content in ' +
          prunedCount +
          ' parts (old messages only, messages=' +
          messages.length +
          ', totalLen=' +
          totalConversationLen +
          ')'
      );
    } else {
      console.log(
        '[ChatGPT Crash Fix] Nothing to prune (messages=' +
          messages.length +
          ', totalLen=' +
          totalConversationLen +
          ')'
      );
    }

    return payload;
  }

  function patchFetch() {
    if (!window.fetch) {
      console.warn('[ChatGPT Crash Fix] window.fetch not found, cannot patch');
      return;
    }

    var origFetch = window.fetch;

    window.fetch = function (input, init) {
      return origFetch(input, init).then(function (res) {
        if (!pruningEnabled()) {
          return res;
        }

        try {
          var url =
            typeof input === 'string'
              ? input
              : (input && input.url) || '';

          if (!isConversationUrl(url)) {
            return res;
          }

          var ct =
            res.headers && res.headers.get
              ? res.headers.get('content-type') || ''
              : '';
          if (ct.indexOf('application/json') === -1) {
            return res;
          }

          var clone = res.clone();
          return clone.json().then(function (data) {
            var pruned = pruneConversationPayload(data);
            var body = JSON.stringify(pruned);
            var headers = new Headers(res.headers || undefined);
            headers.delete('content-length');

            return new Response(body, {
              status: res.status,
              statusText: res.statusText,
              headers: headers
            });
          }).catch(function (e) {
            console.warn('[ChatGPT Crash Fix] Error reading JSON from clone:', e);
            return res;
          });
        } catch (e) {
          console.warn('[ChatGPT Crash Fix] Error while pruning fetch response:', e);
          return res;
        }
      });
    };

    console.log('[ChatGPT Crash Fix] fetch() patched successfully');
  }

  function install() {
    try {
      patchFetch();
      console.log(
        '[ChatGPT Crash Fix] Installation complete, waiting for conversation fetches...'
      );
    } catch (e) {
      console.error('[ChatGPT Crash Fix] install error:', e);
    }
  }

  install();
})();
