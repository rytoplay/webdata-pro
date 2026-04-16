/*!
 * Webdata Pro — embed.js
 * Drop-in widget: WDP.mount('#selector', { app, view, baseUrl, token })
 */
(function (global) {
  'use strict';

  // Capture the script's own base URL now — document.currentScript is only
  // valid during initial script execution, not inside function calls.
  var _scriptBase = (function () {
    var el = document.currentScript;
    if (el && el.src) return el.src.replace(/\/[^/?]*(\?.*)?$/, '');
    return '';
  }());

  // ── Inject HTML and execute any <script> tags it contains ───────────────────
  // innerHTML is fast but deliberately skips <script> execution — this re-runs them
  // so designers can include helper functions in their templates (e.g. date calculators).
  function setHtml(el, html) {
    el.innerHTML = html;
    el.querySelectorAll('script').forEach(function (old) {
      var s = document.createElement('script');
      for (var i = 0; i < old.attributes.length; i++) {
        s.setAttribute(old.attributes[i].name, old.attributes[i].value);
      }
      s.textContent = old.textContent;
      old.parentNode.replaceChild(s, old);
    });
  }

  // ── In-memory JWT store (never touches localStorage / sessionStorage) ───────
  const _tokens = {};   // key: app+view → { access, refresh }

  function tokenKey(cfg) { return cfg.app + ':' + cfg.view; }

  function getAccess(cfg)  { return (_tokens[tokenKey(cfg)] || {}).access  || null; }
  function getRefresh(cfg) { return (_tokens[tokenKey(cfg)] || {}).refresh || null; }

  function setTokens(cfg, access, refresh) {
    _tokens[tokenKey(cfg)] = { access, refresh };
  }

  // ── Hash state helpers ───────────────────────────────────────────────────────
  // Uses fragment format: #wdp-<instanceId>=<encoded-params>
  // The params value is encodeURIComponent'd so internal & doesn't conflict with
  // the outer per-instance separator.

  function readHash(instanceId) {
    const prefix = 'wdp-' + instanceId + '=';
    const fragment = (location.hash || '').slice(1);
    // Outer separator between multiple instances is '&wdp-' (or start-of-string)
    const segs = fragment ? fragment.split(/(?:^|&)(wdp-)/).reduce((acc, part, i, arr) => {
      if (part === 'wdp-' && arr[i + 1]) { acc.push('wdp-' + arr[i + 1]); }
      else if (i === 0 && part) { acc.push(part); }
      return acc;
    }, []) : [];
    for (const seg of segs) {
      if (seg.startsWith(prefix)) {
        try { return new URLSearchParams(decodeURIComponent(seg.slice(prefix.length))); }
        catch (_) {}
      }
    }
    return new URLSearchParams('mode=list');
  }

  function _applyHash(instanceId, params, push) {
    const prefix  = 'wdp-' + instanceId + '=';
    const encoded = encodeURIComponent(params.toString());
    let fragment  = (location.hash || '').slice(1);
    const segRe   = new RegExp('(?:^|&)' + prefix.replace(/[-]/g, '\\$&') + '[^&]*');
    fragment = fragment.replace(segRe, '').replace(/^&/, '');
    const newHash = (fragment ? fragment + '&' : '') + prefix + encoded;
    if (push) history.pushState(null, '', '#' + newHash);
    else      history.replaceState(null, '', '#' + newHash);
  }

  // replaceState — no browser history entry (pagination, search, sort, back-button)
  function writeHash(instanceId, params) { _applyHash(instanceId, params, false); }

  // pushState — adds a browser history entry (list → detail navigation)
  function pushHash(instanceId, params)  { _applyHash(instanceId, params, true);  }

  // ── Fetch a view fragment ────────────────────────────────────────────────────

  async function fetchFragment(cfg, path, opts) {
    const base = (cfg.baseUrl || '').replace(/\/$/, '');
    const url  = base + path;
    const headers = { 'Accept': 'text/html' };
    const access  = getAccess(cfg);
    if (access) headers['Authorization'] = 'Bearer ' + access;
    const res = await fetch(url, { headers, credentials: 'include', ...opts });
    if (res.status === 401) {
      // Try refresh
      const refreshed = await tryRefresh(cfg);
      if (refreshed) return fetchFragment(cfg, path, opts); // one retry
    }
    return res.text();
  }

  async function tryRefresh(cfg) {
    const base = (cfg.baseUrl || '').replace(/\/$/, '');
    try {
      const res = await fetch(base + '/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.access) {
        setTokens(cfg, data.access, getRefresh(cfg));
        return true;
      }
    } catch (_) {}
    return false;
  }

  // ── Build API paths ──────────────────────────────────────────────────────────

  function listPath(cfg, state) {
    const p = new URLSearchParams();
    if (state.get('q'))        p.set('q',        state.get('q'));
    if (state.get('page'))     p.set('page',     state.get('page'));
    if (state.get('sort'))     p.set('sort',     state.get('sort'));
    if (state.get('dir'))      p.set('dir',      state.get('dir'));
    if (state.get('per_page')) p.set('per_page', state.get('per_page'));
    // Forward per-field filters (stored as f_* in hash state)
    var hasFieldFilters = false;
    for (var pair of state.entries()) {
      if (pair[0].startsWith('f_') && pair[1]) { p.set(pair[0], pair[1]); hasFieldFilters = true; }
    }
    // requireSearch: pass searchOnly=1 when nothing has been entered yet
    if (cfg.requireSearch && !state.get('q') && !hasFieldFilters) p.set('searchOnly', '1');
    const qs = p.toString();
    return `/api/v/${cfg.app}/${cfg.view}` + (qs ? '?' + qs : '');
  }

  function detailPath(cfg, id) {
    return `/api/v/${cfg.app}/${cfg.view}/${encodeURIComponent(id)}`;
  }

  function editPath(cfg, id) {
    return `/api/v/${cfg.app}/${cfg.view}/${encodeURIComponent(id)}/edit`;
  }

  function patchPath(cfg, id) {
    return `/api/v/${cfg.app}/${cfg.view}/${encodeURIComponent(id)}`;
  }

  function createFormPath(cfg) {
    return `/api/v/${cfg.app}/${cfg.view}/new`;
  }

  function postPath(cfg) {
    return `/api/v/${cfg.app}/${cfg.view}`;
  }

  function deletePath(cfg, id) {
    return `/api/v/${cfg.app}/${cfg.view}/${encodeURIComponent(id)}/delete`;
  }

  // ── Render into container ────────────────────────────────────────────────────

  async function render(instance) {
    const { cfg, el, instanceId } = instance;
    const state = readHash(instanceId);
    const mode  = state.get('mode') || 'list';

    el.classList.add('wdp-loading');

    try {
      let html;
      if (mode === 'record') {
        html = await fetchFragment(cfg, detailPath(cfg, state.get('id') || ''));
      } else if (mode === 'edit') {
        html = await fetchFragment(cfg, editPath(cfg, state.get('id') || ''));
      } else if (mode === 'create') {
        html = await fetchFragment(cfg, createFormPath(cfg));
      } else {
        html = await fetchFragment(cfg, listPath(cfg, state));
      }
      setHtml(el, html);
      // Restore per-field filter values and show advanced panel if any are active
      if (mode === 'list') {
        var advPanel = el.querySelector('.wdp-sf-adv');
        if (advPanel) {
          var hasFilters = false;
          state.forEach(function(val, key) {
            if (key.startsWith('f_') && val) {
              hasFilters = true;
              var inp = el.querySelector('[name="' + key.slice(2) + '"]');
              if (inp) inp.value = val;
            }
          });
          if (hasFilters) {
            var simplePanel = el.querySelector('.wdp-sf-simple');
            advPanel.style.display = '';
            if (simplePanel) simplePanel.style.display = 'none';
          }
        }
      }
    } catch (err) {
      el.innerHTML = '<p class="wdp-error">Failed to load view: ' + escHtml(String(err)) + '</p>';
    } finally {
      el.classList.remove('wdp-loading');
    }
  }

  // ── Event delegation ─────────────────────────────────────────────────────────

  function bindEvents(instance) {
    const { el, instanceId } = instance;

    el.addEventListener('click', function (e) {
      const tgt = e.target.closest('[data-wdp-action]');
      if (!tgt) return;
      e.preventDefault();
      handleAction(instance, tgt);
    });

    el.addEventListener('submit', function (e) {
      const form = e.target.closest('[data-wdp-form]');
      if (!form) return;
      e.preventDefault();
      const formType = form.dataset.wdpForm;
      if (formType === 'search') {
        const state = new URLSearchParams({ mode: 'list', page: '1' });
        // Collect the legacy single-q input if present
        const qEl = form.querySelector('[name="q"]');
        if (qEl && qEl.value) state.set('q', qEl.value);
        // Collect per-field $search[...] inputs (name="table__field") as f_* params
        new FormData(form).forEach(function(val, key) {
          if (key === 'q') return;
          if (String(val).trim()) state.set('f_' + key, String(val));
        });
        writeHash(instanceId, state);
        render(instance);
      } else if (formType === 'edit') {
        const id      = form.dataset.wdpId || readHash(instanceId).get('id') || '';
        const base    = (instance.cfg.baseUrl || '').replace(/\/$/, '');
        const url     = base + patchPath(instance.cfg, id);
        const body    = new URLSearchParams(new FormData(form)).toString();
        const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        const access  = getAccess(instance.cfg);
        if (access) headers['Authorization'] = 'Bearer ' + access;

        fetch(url, { method: 'PATCH', headers, credentials: 'include', body })
          .then(function (res) {
            if (res.ok) {
              const state = new URLSearchParams({ mode: 'record', id });
              writeHash(instanceId, state);
              render(instance);
            } else {
              res.json().then(function (data) {
                const errEl = document.createElement('p');
                errEl.className = 'wdp-error';
                errEl.textContent = data.error || 'Save failed.';
                form.prepend(errEl);
              });
            }
          })
          .catch(function (err) {
            const errEl = document.createElement('p');
            errEl.className = 'wdp-error';
            errEl.textContent = 'Save failed: ' + String(err);
            form.prepend(errEl);
          });

      } else if (formType === 'create') {
        const base    = (instance.cfg.baseUrl || '').replace(/\/$/, '');
        const url     = base + postPath(instance.cfg);
        const body    = new URLSearchParams(new FormData(form)).toString();
        const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        const access  = getAccess(instance.cfg);
        if (access) headers['Authorization'] = 'Bearer ' + access;
        fetch(url, { method: 'POST', headers, credentials: 'include', body })
          .then(function (res) {
            if (res.ok) {
              return res.json().then(function (data) {
                if (data.id) {
                  const state = new URLSearchParams({ mode: 'record', id: String(data.id) });
                  pushHash(instanceId, state);
                } else {
                  writeHash(instanceId, instance._lastListState || new URLSearchParams({ mode: 'list' }));
                }
                render(instance);
              });
            } else {
              res.json().then(function (data) {
                const errEl = document.createElement('p');
                errEl.className = 'wdp-error';
                errEl.textContent = data.error || 'Create failed.';
                form.prepend(errEl);
              });
            }
          })
          .catch(function (err) {
            const errEl = document.createElement('p');
            errEl.className = 'wdp-error';
            errEl.textContent = 'Create failed: ' + String(err);
            form.prepend(errEl);
          });
      }
    });
  }

  function handleAction(instance, el) {
    const { instanceId } = instance;
    const action  = el.dataset.wdpAction;
    const current = readHash(instanceId);

    if (action === 'detail') {
      const id = el.dataset.wdpId;
      if (!id) return;
      instance._lastListState = new URLSearchParams(current);
      pushHash(instanceId, new URLSearchParams({ mode: 'record', id }));
      instance.render();

    } else if (action === 'edit') {
      const id = el.dataset.wdpId;
      if (!id) return;
      instance._lastDetailId = id;
      pushHash(instanceId, new URLSearchParams({ mode: 'edit', id }));
      instance.render();

    } else if (action === 'back') {
      const curMode = current.get('mode');
      if (curMode === 'edit') {
        const id = current.get('id') || instance._lastDetailId || '';
        const state = id
          ? new URLSearchParams({ mode: 'record', id })
          : (instance._lastListState || new URLSearchParams({ mode: 'list' }));
        writeHash(instanceId, state);
      } else {
        writeHash(instanceId, instance._lastListState || new URLSearchParams({ mode: 'list' }));
      }
      instance.render();

    } else if (action === 'page') {
      const page = el.dataset.wdpPage;
      if (!page) return;
      const state = new URLSearchParams(current);
      state.set('mode', 'list');
      state.set('page', page);
      writeHash(instanceId, state);
      instance.render();

    } else if (action === 'sort') {
      const field = el.dataset.wdpField;
      if (!field) return;
      const state  = new URLSearchParams(current);
      const prevDir = state.get('dir') || 'asc';
      state.set('mode', 'list');
      state.set('sort', field);
      state.set('dir',  state.get('sort') === field && prevDir === 'asc' ? 'desc' : 'asc');
      state.set('page', '1');
      writeHash(instanceId, state);
      instance.render();

    } else if (action === 'per-page') {
      const perPage = el.value || el.dataset.wdpPerPage;
      if (!perPage) return;
      const state = new URLSearchParams(current);
      state.set('mode', 'list');
      state.set('per_page', perPage);
      state.set('page', '1');
      writeHash(instanceId, state);
      instance.render();

    } else if (action === 'create') {
      instance._lastListState = new URLSearchParams(current);
      pushHash(instanceId, new URLSearchParams({ mode: 'create' }));
      instance.render();

    } else if (action === 'delete') {
      const id = el.dataset.wdpId || current.get('id') || '';
      if (!id) return;
      if (!window.confirm('Delete this record?')) return;
      const base    = (instance.cfg.baseUrl || '').replace(/\/$/, '');
      const url     = base + deletePath(instance.cfg, id);
      const headers = {};
      const access  = getAccess(instance.cfg);
      if (access) headers['Authorization'] = 'Bearer ' + access;
      fetch(url, { method: 'POST', headers, credentials: 'include' })
        .then(function (res) {
          if (res.ok) {
            writeHash(instanceId, instance._lastListState || new URLSearchParams({ mode: 'list' }));
            instance.render();
          } else {
            res.json().then(function (data) {
              alert(data.error || 'Delete failed.');
            });
          }
        })
        .catch(function (err) { alert('Delete failed: ' + String(err)); });

    } else if (action === 'clear') {
      const state = new URLSearchParams({ mode: 'list', page: '1' });
      writeHash(instanceId, state);
      instance.render();
    }
  }

  function wrapRender(instance) {
    return function () { return render(instance); };
  }

  // ── Utility ──────────────────────────────────────────────────────────────────

  let _idCounter = 0;

  function escHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  const WDP = {
    /**
     * Mount a view widget.
     *
     * @param {string|Element} selector  CSS selector or DOM element
     * @param {object} cfg
     *   @param {string} cfg.app      App slug
     *   @param {string} cfg.view     View slug
     *   @param {string} [cfg.baseUrl] Origin (defaults to current origin)
     *   @param {string} [cfg.token]  Initial JWT access token (optional)
     */
    mount(selector, cfg) {
      const el = typeof selector === 'string'
        ? document.querySelector(selector)
        : selector;

      if (!el) {
        console.warn('[WDP] mount: element not found:', selector);
        return;
      }

      cfg = Object.assign({ baseUrl: location.origin }, cfg);

      if (cfg.token) setTokens(cfg, cfg.token, null);

      const instanceId = 'i' + (++_idCounter);
      const instance   = { cfg, el, instanceId, _lastListState: null, _lastDetailId: null };
      instance.render  = wrapRender(instance);

      // Style the container (minimal — host page can override)
      el.setAttribute('data-wdp-instance', instanceId);
      if (!el.style.position || el.style.position === 'static')
        el.style.position = 'relative';

      // Inject base stylesheet once per page.
      // _scriptBase was captured at IIFE load time (currentScript is null here).
      if (!document.getElementById('wdp-base-css')) {
        var link = document.createElement('link');
        link.id   = 'wdp-base-css';
        link.rel  = 'stylesheet';
        link.href = _scriptBase + '/widget-base.css';
        document.head.appendChild(link);
      }

      bindEvents(instance);

      // React to browser back/forward (pushState navigation triggers popstate)
      window.addEventListener('popstate', () => instance.render());

      // If a specific initial mode is requested (e.g. single_record views), seed
      // the hash before the first render so the widget opens in the right state.
      if (cfg.initialMode) {
        const initParams = new URLSearchParams({ mode: cfg.initialMode });
        if (cfg.initialId) initParams.set('id', String(cfg.initialId));
        writeHash(instanceId, initParams);
      }

      // Initial render
      instance.render();

      return instance;
    },

    /**
     * Set a JWT access token for a mounted instance (called after login).
     * cfg must have same app+view as the mounted instance.
     */
    setToken(cfg, accessToken) {
      setTokens(cfg, accessToken, null);
    },
  };

  global.WDP = WDP;

})(typeof window !== 'undefined' ? window : this);
