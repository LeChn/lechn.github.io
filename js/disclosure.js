/* Progressive disclosure: the systems accordion and the work master-detail. */
(function () {
	'use strict';

	var $ = S.$, $$ = S.$$, rng = S.rng, mix = S.mix;

	/* Systems: accordion --------------------------------------------------
	   Sections start collapsed; opening one closes the rest. Deep links from
	   the Work section must open their target, including when the hash is
	   already current and hashchange will not fire. */
	var folds = $$('.fold');
	if (folds.length) {
		var setFold = function (sec, on) {
			sec.classList.toggle('open', on);
			var head = $('.foldhead', sec), body = $('.foldbody', sec);
			head.setAttribute('aria-expanded', String(on));
			if (on) { body.removeAttribute('hidden'); }
			else { body.setAttribute('hidden', ''); }
		};

		var openOnly = function (sec) {
			folds.forEach(function (f) { setFold(f, f === sec); });
		};

		folds.forEach(function (f) {
			$('.foldhead', f).addEventListener('click', function () {
				if (f.classList.contains('open')) { setFold(f, false); }
				else { openOnly(f); }
			});
		});

		var openFromHash = function (scroll) {
			var h = location.hash;
			if (!h || h === '#') { return; }
			var el = null;
			try { el = document.querySelector(h); } catch (e) { return; }
			if (!el || !el.classList.contains('fold')) { return; }
			openOnly(el);
			if (scroll) { el.scrollIntoView({ block: 'start' }); }
		};

		window.addEventListener('hashchange', function () { openFromHash(true); });

		$$('a[href^="#"]').forEach(function (a) {
			a.addEventListener('click', function () {
				var t = null;
				try { t = document.querySelector(a.getAttribute('href')); } catch (e) { return; }
				if (t && t.classList.contains('fold')) { openOnly(t); }
			});
		});

		openFromHash(false);
	}
	/* Work: master-detail ---------------------------------------------------
	   Tabs rather than an accordion: one pane visible, instant switching,
	   arrow-key navigable. Filtering hides tabs and falls back to the first
	   still-visible one so the panel is never left orphaned. */
	var tabs = $$('.wtab');
	if (tabs.length) {
		var panes = $$('.wpane');

		var select = function (i, focus) {
			tabs.forEach(function (t, j) {
				var on = i === j;
				t.classList.toggle('on', on);
				t.setAttribute('aria-selected', String(on));
				t.tabIndex = on ? 0 : -1;
				panes[j].classList.toggle('on', on);
				if (on) { panes[j].removeAttribute('hidden'); }
				else { panes[j].setAttribute('hidden', ''); }
			});
			if (focus) { tabs[i].focus(); }
		};

		tabs.forEach(function (t, i) {
			t.addEventListener('click', function () { select(i); });
			t.addEventListener('keydown', function (e) {
				var vis = tabs.filter(function (x) { return !x.classList.contains('out'); });
				var at = vis.indexOf(t);
				if (at < 0) { return; }
				var next = null;
				if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { next = vis[(at + 1) % vis.length]; }
				if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { next = vis[(at - 1 + vis.length) % vis.length]; }
				if (e.key === 'Home') { next = vis[0]; }
				if (e.key === 'End') { next = vis[vis.length - 1]; }
				if (next) { e.preventDefault(); select(tabs.indexOf(next), true); }
			});
		});

		$$('#filters .chip').forEach(function (b) {
			b.addEventListener('click', function () {
				$$('#filters .chip').forEach(function (o) { o.classList.remove('on'); });
				b.classList.add('on');
				var tag = b.dataset.tag;
				tabs.forEach(function (t) {
					t.classList.toggle('out', tag !== 'all' && t.dataset.tags.indexOf(tag) === -1);
				});
				// keep a visible tab selected
				var cur = tabs.filter(function (t) { return t.classList.contains('on'); })[0];
				if (!cur || cur.classList.contains('out')) {
					var first = tabs.filter(function (t) { return !t.classList.contains('out'); })[0];
					if (first) { select(tabs.indexOf(first)); }
				}
			});
		});
	}
})();
