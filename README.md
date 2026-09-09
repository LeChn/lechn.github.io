# lechn.github.io

Personal site — **[lechn.github.io](https://lechn.github.io)**

Static HTML, CSS and JavaScript. No dependencies, no build step, no server.
Open `index.html` in a browser.

## Layout

```
index.html                 the whole page

css/
  tokens.css               colour, type and theme variables
  base.css                 reset, layout primitives, page chrome
  components.css           chips, readouts, pickers, legends
  sections.css             systems groups, work master-detail, background road
  models.css               the interactive models and diagrams

js/
  util.js                  shared helpers on window.S — load first
  chrome.js                theme toggle, copy email
  disclosure.js            systems accordion, work master-detail
  diagrams.js              architecture diagram interactions
  models-memory.js         fusion stack, coalescing, warp reduction
  models-selection.js      retrieval funnel, top-K buffer, Bloom filter
  models-routing.js        request slicing, weighted blenders

img/                       assets
```

Scripts are plain classic scripts and run in document order, so `util.js`
must stay first. Everything else is independent — each widget factory
returns early when its root element is absent.
