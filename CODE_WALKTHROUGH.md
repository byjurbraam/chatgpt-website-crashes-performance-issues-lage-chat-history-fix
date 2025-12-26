# CODE_WALKTHROUGH.md

- [`OFFICIAL README CAN BE FOUND HERE`](./README>md)

This document explains what the userscript does in **small logical blocks**, so that anyone
can review and understand it, even without deep JavaScript experience.

The main file is:

- [`chatgpt-history-optimizer.user.js`](./chatgpt-history-optimizer.user.js)

---

**What this does:**

---

## 2. Intro comment and IIFE wrapper

```js
/*
  ... big comment with explanation ...
*/

(function() {
  "use strict";
  // all script code here
})();
```

**What this does:**

- The big comment explains the purpose, author, and disclaimers.
- The `(function() { ... })();` pattern is an **IIFE** (Immediately Invoked Function Expression):
  - It creates a private scope so variables do not leak into the global namespace.
  - `"use strict";` enables strict mode for safer JavaScript (less silent errors).

---

## 3. Configuration & keys

```js
const INITIAL_VISIBLE_WINDOW_MINUTES = 5;
const PLACEHOLDER = "[older message available via History Viewer]";
const PRUNE_KEY = "chatgpt_history_optimizer_prune";
const CACHE_KEY = "chatgpt_history_optimizer_cache";
const DATA_PREFIX = "chatgpt_history_optimizer_conversation_";
```

**What this does:**

- `INITIAL_VISIBLE_WINDOW_MINUTES` – how many minutes of recent messages stay fully visible in the UI.
- `PLACEHOLDER` – text that replaces older messages in the “light” version sent to the page.
- `PRUNE_KEY` – localStorage key used to toggle optimization on/off.
- `CACHE_KEY` – reserved for caching toggle (not strictly required in minimal version).
- `DATA_PREFIX` – prefix for keys used to store full conversation payloads in `localStorage`.

---

## 4. Console banner

```js
console.log(
  "%cChatGPT History Optimizer Loaded",
  "background:#4ade80;color:#022c22;font-weight:bold;padding:6px;border-radius:6px;",
);
console.log("💡 Client-side only. Full history stays safe. If OpenAI asks, removal is immediate.");
```

**What this does:**

- Prints a **visible banner** in the browser console when the script is active.
- Clearly states:
  - It is **client-side only**.
  - It keeps full history safe.
  - It will be removed if OpenAI asks.

This helps build trust and makes it obvious when the script is running.

---

## 5. Enable/disable helpers & global API

```js
const enable = ()=>localStorage.setItem(PRUNE_KEY,"1");
const disable = ()=>localStorage.setItem(PRUNE_KEY,"0");
const enabled = ()=>localStorage.getItem(PRUNE_KEY)!=="0";

window.ChatGPTHistoryOptimizer = {
  status(){
    return {enabled: enabled()};
  },
  enableOptimization(){ enable(); location.reload(); },
  disableOptimization(){ disable(); location.reload(); },
  clearCache(){
    Object.keys(localStorage)
      .filter(k=>k.startsWith(DATA_PREFIX))
      .forEach(k=>localStorage.removeItem(k));
    console.log("🗑️ Cache cleared");
  }
};
```

**What this does:**

- Stores a flag in `localStorage` that decides if the optimizer is active.
- Exposes a global helper `window.ChatGPTHistoryOptimizer` with:
  - `status()` – show if optimization is on or off.
  - `enableOptimization()` – turn it on and reload page.
  - `disableOptimization()` – turn it off and reload page.
  - `clearCache()` – remove all locally cached conversation payloads.

You can call these from DevTools console:
```js
ChatGPTHistoryOptimizer.status();
ChatGPTHistoryOptimizer.disableOptimization();
ChatGPTHistoryOptimizer.clearCache();
```

---

## 6. Wrapping `fetch` (core interception)

```js
const orig = window.fetch;
window.fetch = async (...args)=>{
  const res = await orig(...args);
  if(!enabled()) return res;

  if(typeof args[0]==="string" && args[0].includes("/backend-api/conversation")){
    let clone = res.clone();
    let json = await clone.json();

    // Save full data for lazy access
    if(json?.conversation_id){
      localStorage.setItem(DATA_PREFIX+json.conversation_id, JSON.stringify(json));
    }

    // Prune visible history (keep only recent minutes)
    let newest = 0;
    for(const k in json.mapping){
      const mt = json.mapping[k]?.message?.create_time;
      if(mt>newest) newest = mt;
    }
    const limit = newest - (INITIAL_VISIBLE_WINDOW_MINUTES*60);

    for(const k in json.mapping){
      const n = json.mapping[k];
      const mt = n?.message?.create_time;
      if(mt && mt<limit){
        try{
          n.message.content.parts = [PLACEHOLDER];
        }catch(e){}
      }
    }

    return new Response(JSON.stringify(json), {status:res.status,headers:res.headers});
  }
  return res;
};
```

**Step-by-step:**

1. `const orig = window.fetch;`  
   - Save the original `fetch` function so we can still use it.

2. `window.fetch = async (...args)=>{ ... }`  
   - Replace `window.fetch` with our own wrapper.
   - All network calls made with `fetch` now go through this function.

3. `const res = await orig(...args);`  
   - Call the original fetch with the same arguments.
   - Wait until the real response from the server is received.

4. `if(!enabled()) return res;`  
   - If optimization is turned off, return the real response unchanged.

5. `if(typeof args[0]==="string" && args[0].includes("/backend-api/conversation")) { ... }`  
   - Only handle calls to the ChatGPT **conversation endpoint**.
   - All other fetches (CSS, images, etc.) pass through untouched.

6. `let clone = res.clone(); let json = await clone.json();`  
   - Clone the response so we can safely read the JSON without consuming the original stream.
   - Parse the JSON body into a JavaScript object.

7. `if(json?.conversation_id){ localStorage.setItem(...); }`  
   - If this looks like a conversation payload, store the **full, unmodified JSON** in `localStorage`.
   - The key is `DATA_PREFIX + conversation_id`, so each conversation is separated.

8. Find newest message time:
   ```js
   let newest = 0;
   for(const k in json.mapping){
     const mt = json.mapping[k]?.message?.create_time;
     if(mt>newest) newest = mt;
   }
   const limit = newest - (INITIAL_VISIBLE_WINDOW_MINUTES*60);
   ```
   - `json.mapping` is how ChatGPT stores conversation nodes.
   - We compute the largest `create_time` (the newest message).
   - `limit` is “newest minus X minutes” — everything older than this is considered “old history”.

9. Replace old message content with a placeholder:
   ```js
   for(const k in json.mapping){
     const n = json.mapping[k];
     const mt = n?.message?.create_time;
     if(mt && mt<limit){
       try{
         n.message.content.parts = [PLACEHOLDER];
       }catch(e){}
     }
   }
   ```
   - Loop over all messages again.
   - If a message is older than the window, replace its `content.parts` with a single placeholder string.
   - Structure (mapping, relationships, newer messages) stays intact.

10. Return new response:
   ```js
   return new Response(JSON.stringify(json), {status:res.status,headers:res.headers});
   ```
   - We build a new `Response` object with the modified JSON.
   - Status code and headers are copied from the original.
   - ChatGPT’s frontend receives this “lighter” version to render, instead of the full text.

If the URL is not a conversation endpoint, the wrapper just returns `res` as-is.

---

## 7. Chrome “User JavaScript & CSS” plugin usage

**How the plugin interacts with this code:**

- The extension looks at the `@match` fields and your configured URL filters.
- When you open `https://chat.openai.com/` or `https://chatgpt.com/`, the extension:
  - injects this script into the page
  - the script runs at `document-start`
- After that:
  - When ChatGPT’s frontend calls `fetch('/backend-api/conversation/...')`,
  - our wrapper intercepts **the response**, modifies it **only in memory**, and gives the lighter version back to the page.

The plugin itself does **not** add any extra network calls.  
All work stays inside the current browser tab.

---

## 8. Safety notes

- The script never sends data anywhere else.
- It only reads and rewrites data already sent to your browser by ChatGPT.
- The full original response is kept in `localStorage` so that no history is lost.
- You can turn it off with:
  ```js
  ChatGPTHistoryOptimizer.disableOptimization();
  ```
  and reload.

If you are unsure, you can always:

- disable the rule in the Chrome extension,
- or delete the rule entirely,
- or inspect the script before enabling it.
