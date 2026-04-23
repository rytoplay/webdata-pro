# JavaScript Customization

Webdata Pro templates are HTML — you can include `<script>` tags anywhere in a template. This lets you go beyond what the token language provides: conditional styling, DOM manipulation, third-party integrations, and more.

---

## The re-render problem

The widget re-renders its content via AJAX whenever the visitor searches, sorts, pages, or filters. This means the row HTML is replaced entirely on every interaction — it is not a full page reload.

This breaks the traditional approach of running a loop in the header after the page loads:

```html
<!-- ❌ Works on first load, breaks on re-render -->
<script>
  document.addEventListener('DOMContentLoaded', function() {
    var els = document.querySelectorAll('.days-waiting');
    els.forEach(function(el) {
      if (parseInt(el.textContent) > 365) el.style.color = 'red';
    });
  });
</script>
```

After a sort or page change, the new rows are injected into the DOM but `DOMContentLoaded` has already fired and never fires again. Your script never sees the new rows.

---

## The inline script pattern

The solution is to place a small self-contained `<script>` directly after the element you want to modify, inside the **Row** template. The script runs each time that row is rendered — on the first load and on every re-render.

```html
<div class="wdp-row" data-wdp-action="detail" data-wdp-id="${_pk}">
  <div class="wdp-row-body">
    <div class="wdp-row-title">${pets.name}</div>
    <div class="wdp-row-sub">${pets.animal_type} &bull; ${pets.breed}</div>
    <div class="wdp-row-meta">
      Waiting: <span class="days-waiting">$days_since[pets.intake_date]</span> days
    </div>
  </div>
</div>
<script>
  (function() {
    var row = document.currentScript.previousElementSibling;
    var el  = row.querySelector('.days-waiting');
    if (parseInt(el.textContent) > 365) {
      el.style.color      = 'red';
      el.style.fontWeight = 'bold';
    }
  })();
</script>
```

### Why this works

- **`document.currentScript`** is a reference to the `<script>` tag that is currently executing. It is always accurate — it doesn't matter how many rows are on the page.
- **`.previousElementSibling`** walks one step up the DOM to the element immediately before the script tag — in this case, the row `<div>`.
- **`.querySelector('.days-waiting')`** searches only inside that row, not the whole page. This is critical when there are 25 rows on the page each containing a `.days-waiting` element.
- The whole thing is wrapped in an **IIFE** (`(function() { ... })()`) so variables don't leak into the global scope.

### Why not `document.querySelector('.days-waiting')`?

Without scoping to `previousElementSibling`, `document.querySelector` always returns the **first** matching element on the page — row 1's element, every time, for every row. Scoping to the row makes each script operate on its own element.

---

## jQuery translation

If you are comfortable with jQuery, here is the vanilla JS equivalent for common operations:

| jQuery | Vanilla JS |
|---|---|
| `$('.days-waiting')` | `el.querySelector('.days-waiting')` |
| `$(el).text()` | `el.textContent` |
| `$(el).html()` | `el.innerHTML` |
| `$(el).addClass('foo')` | `el.classList.add('foo')` |
| `$(el).removeClass('foo')` | `el.classList.remove('foo')` |
| `$(el).css('color', 'red')` | `el.style.color = 'red'` |
| `$(el).attr('data-x', '1')` | `el.dataset.x = '1'` |
| `$(el).show()` | `el.style.display = ''` |
| `$(el).hide()` | `el.style.display = 'none'` |

---

## More examples

### Highlight rows where a field is empty

```html
<div class="wdp-row" data-wdp-action="detail" data-wdp-id="${_pk}">
  <div class="wdp-row-title">${pets.name}</div>
  <div class="pet-picture" style="display:none;">${pets.picture}</div>
</div>
<script>
  (function() {
    var row = document.currentScript.previousElementSibling;
    if (!row.querySelector('.pet-picture').textContent.trim()) {
      row.style.opacity = '0.5';
      row.title = 'No photo yet';
    }
  })();
</script>
```

### Add a CSS class based on a field value

```html
<div class="wdp-row pet-row" data-wdp-action="detail" data-wdp-id="${_pk}">
  <span class="pet-type" style="display:none;">${pets.animal_type}</span>
  <div class="wdp-row-title">${pets.name}</div>
</div>
<script>
  (function() {
    var row  = document.currentScript.previousElementSibling;
    var type = row.querySelector('.pet-type').textContent.trim().toLowerCase();
    row.classList.add('pet-type-' + type); // adds e.g. "pet-type-dog"
  })();
</script>
```

Then in your search form template's `<style>` block:
```css
.pet-type-dog  { border-left: 4px solid #3b82f6; }
.pet-type-cat  { border-left: 4px solid #8b5cf6; }
```

### Format a number differently than the token allows

```html
<div class="wdp-row" data-wdp-action="detail" data-wdp-id="${_pk}">
  <span class="pet-age">$years_since[pets.dob]</span>
</div>
<script>
  (function() {
    var row = document.currentScript.previousElementSibling;
    var el  = row.querySelector('.pet-age');
    var years = parseFloat(el.textContent);
    el.textContent = years < 1
      ? 'Less than 1 year'
      : Math.floor(years) + ' year' + (Math.floor(years) === 1 ? '' : 's');
  })();
</script>
```

---

## Where to place the script

| Template | Notes |
|---|---|
| **Row** | Best place for per-row logic. Script runs once per row, scoped via `previousElementSibling`. |
| **Header / Footer** | Fine for one-time setup: initializing a third-party library, setting a CSS variable, etc. Use `document.currentScript.parentElement` to scope to the widget container. |
| **Detail / Edit Form** | Works the same as Row. Useful for showing/hiding fields based on values. |
| **Search Form** | Good place to load an external script (e.g. a map library) that the rest of the view depends on. |

---

## Scoping to the widget container

In the Header or Footer, `previousElementSibling` is not useful (there's no single target element). Instead, walk up to the widget container:

```html
<!-- In Header template -->
<div class="wdp-header">...</div>
<script>
  (function() {
    var widget = document.currentScript.closest('.wdp');
    // widget is the entire widget container — safe to querySelector inside it
    widget.querySelectorAll('.some-class').forEach(function(el) {
      // ...
    });
  })();
</script>
```

Note: if you put this in the Header, it only runs when the header renders (on first load and re-renders). The rows may not exist yet at that point — use the Row inline pattern for per-row work.
