/* Routing: request slicing and the weighted blenders. */
(function () {
	'use strict';

	var $ = S.$, $$ = S.$$, rng = S.rng, mix = S.mix;

	/* Request slicing ------------------------------------------------------
	   Splitting one request across workers only works if the partition is
	   disjoint on every replica. Slicing by index position is cheap but
	   replica-dependent: staggered index refreshes move an item, so two
	   workers can claim it or none can. Slicing on a stable key is
	   replica-independent and therefore actually disjoint. */
	function makeSlice(cfg) {
		var root = document.querySelector(cfg.root);
		if (!root) { return; }
		var q = function (s) { return root.querySelector(s); };
		var qa = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };
		var N = 96, W = 8, MODE = 'pos', SKEW = 0;

		// Exactly round(W * SKEW%) replicas are stale, spread deterministically.
		// Sampling per-worker instead would give wrong counts at these small W.
		function staleSet() {
			var k = Math.round(W * SKEW / 100), order = [], set = {};
			for (var w = 0; w < W; w++) { order.push([w, mix(w * 977)]); }
			order.sort(function (a, b) { return a[1] - b[1]; });
			for (var i = 0; i < k; i++) { set[order[i][0]] = 1; }
			return set;
		}

		// Position on a stale replica differs: the index moved the item.
		function posOn(item, stale) { return stale ? (item * 7 + 13) % N : item; }

		function claims(item, stale) {
			var c = 0;
			for (var w = 0; w < W; w++) {
				if (MODE === 'key') {
					// Key travels with the item, so every replica agrees.
					if (mix(item) % W === w) { c++; }
				} else {
					// Worker w was told to cover a position range, but resolves
					// position against its own index view.
					var lo = Math.floor(w * N / W), hi = Math.floor((w + 1) * N / W);
					var p = posOn(item, !!stale[w]);
					if (p >= lo && p < hi) { c++; }
				}
			}
			return c;
		}

		function render() {
			var once = 0, dup = 0, gap = 0, work = 0, html = '', stale = staleSet();
			for (var i = 0; i < N; i++) {
				var c = claims(i, stale);
				work += c;
				var cls = c === 1 ? 'ok1' : (c === 0 ? 'gap' : 'dup');
				if (c === 1) { once++; } else if (c === 0) { gap++; } else { dup++; }
				html += '<span class="cell ' + cls + '"></span>';
			}
			q('.slgrid').innerHTML = html;
			q('.rOnce').textContent = once;
			q('.rDup').textContent = dup;
			q('.rGap').textContent = gap;
			// Work done is total claims; only one claim per item is useful.
			var useful = N - gap;
			q('.rWaste').textContent = work > 0 ? Math.round((work - useful) / work * 100) + '%' : '0%';
			q('.rRecall').textContent = Math.round(useful / N * 100) + '%';
			var v = q('.slVerdict'), clean = (dup === 0 && gap === 0);
			v.textContent = clean ? 'partition is disjoint' : 'partition is broken';
			v.className = 'slVerdict ' + (clean ? 'good' : 'bad');
		}

		qa('.picker').forEach(function (row) {
			row.addEventListener('click', function (e) {
				var b = e.target.closest('.chip');
				if (!b) { return; }
				Array.prototype.slice.call(row.querySelectorAll('.chip'))
					.forEach(function (o) { o.classList.remove('on'); });
				b.classList.add('on');
				if (b.dataset.mode) { MODE = b.dataset.mode; }
				if (b.dataset.skew) { SKEW = +b.dataset.skew; }
				if (b.dataset.skew === '0') { SKEW = 0; }
				if (b.dataset.w) { W = +b.dataset.w; }
				render();
			});
		});

		render();
	}

	makeSlice({ root: '#w-slice' });
	/* Blenders -------------------------------------------------------------
	   Interleaved weighted round robin: in round r, every queue with weight
	   >= r emits one item. The unique-value variant additionally remembers
	   membership in the main queue and reattributes duplicates to it. Main is
	   a bounded top-K, so membership is only knowable inside that window. */
	function makeBlender(cfg) {
		var root = document.querySelector(cfg.root);
		if (!root) { return; }
		var q = function (sel) { return root.querySelector(sel); };
		var qa = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

		var SRC = cfg.srcs.map(function (s) { return { id: s.id, nm: s.nm, w: s.w, main: !!s.main }; });
		var K = cfg.cap, st = null, timer = null;

		function maxW() { return Math.max.apply(null, SRC.map(function (s) { return s.w; })); }

		function build() {
			var rnd = rng(cfg.seed), n = SRC.length;
			st = {
				round: 1, si: 0, seen: {}, out: [], done: false,
				re: 0, miss: 0, uv: {}, resident: 0
			};
			SRC.forEach(function (s) { s.q = []; s.dropped = []; st.uv[s.id] = 0; });

			if (!cfg.dedup) {
				// Plain IWRR: distinct supply per queue, enough that nothing underflows.
				SRC.forEach(function (s) {
					var base = SRC.indexOf(s) * 1000;
					for (var i = 0; i < K; i++) { s.q.push({ id: base + i + 1 }); }
				});
				st.resident = K * n;
				return;
			}

			// Unique-value: 2K items resident in total. Main holds K of them as a
			// bounded window over a longer stream; the rest is supplementary supply.
			var main = SRC.filter(function (s) { return s.main; })[0];
			var supp = SRC.filter(function (s) { return !s.main; });
			var win = K, streamLen = Math.round(K * 3), pool = Math.round(K * 4);

			var stream = [], taken = {};
			while (stream.length < streamLen) {
				var id = 1 + Math.floor(rnd() * pool);
				if (!taken[id]) { taken[id] = 1; stream.push({ id: id, sc: rnd() }); }
			}
			stream.sort(function (a, b) { return b.sc - a.sc; });
			main.q = stream.slice(0, win);
			st.residentSet = {};
			main.q.forEach(function (it) { st.residentSet[it.id] = 1; });
			st.evictedSet = {};
			stream.slice(win).forEach(function (it) { st.evictedSet[it.id] = 1; });

			// Split the remaining K slots across supplementary sources.
			var base = Math.floor(K / supp.length), extra = K % supp.length;
			var resIds = Object.keys(st.residentSet), evIds = Object.keys(st.evictedSet), fresh = pool;
			supp.forEach(function (s, i) {
				var want = base + (i < extra ? 1 : 0), seen = {}, list = [];
				while (list.length < want) {
					var r = rnd(), pid;
					if (r < 0.40 && resIds.length) { pid = +resIds[Math.floor(rnd() * resIds.length)]; }
					else if (r < 0.70 && evIds.length) { pid = +evIds[Math.floor(rnd() * evIds.length)]; }
					else { pid = ++fresh; }
					if (!seen[pid]) { seen[pid] = 1; list.push({ id: pid }); }
				}
				s.q = list;
			});
		}

		function step() {
			if (!st || st.done) { return false; }
			if (st.out.length >= K) { st.done = true; return false; }
			var guard = 0;
			while (guard++ < 500) {
				var cur = SRC[st.si], eligible = cur.w >= st.round;
				st.si++;
				if (st.si >= SRC.length) {
					st.si = 0;
					st.round = st.round >= maxW() ? 1 : st.round + 1;
				}
				if (eligible) {
					while (cur.q.length) {
						var it = cur.q.shift();
						if (st.seen[it.id]) { cur.dropped.push(it); continue; }
						st.seen[it.id] = 1;
						var owner = cur, mark = '';
						if (cfg.dedup && !cur.main) {
							if (st.residentSet[it.id]) {
								owner = SRC.filter(function (s) { return s.main; })[0];
								mark = 're';
								st.re++;
							} else if (st.evictedSet[it.id]) {
								mark = 'miss';
								st.miss++;
								st.uv[cur.id]++;
							} else {
								st.uv[cur.id]++;
							}
						}
						st.out.push({ it: it, s: owner, from: cur, mark: mark });
						if (st.out.length >= K) { st.done = true; }
						return true;
					}
				}
				if (SRC.every(function (x) { return x.q.length === 0; })) { st.done = true; return false; }
			}
			st.done = true;
			return false;
		}

		function chip(it, cls, extra) {
			return '<span class="it ' + cls + (extra ? ' ' + extra : '') + '">' + it.id + '</span>';
		}

		function render() {
			q('.qs').innerHTML = SRC.map(function (s) {
				var shown = s.q.slice(0, 12).map(function (it) { return chip(it, s.id); }).join('');
				var more = s.q.length > 12 ? '<span class="it">+' + (s.q.length - 12) + '</span>' : '';
				var gone = s.dropped.slice(-3).map(function (it) { return chip(it, s.id, 'gone'); }).join('');
				return '<div class="qrow"><div class="qhead"><span>' + s.nm + ' · w' + s.w +
					'</span><span>' + s.q.length + ' left</span></div>' +
					'<div class="chips">' + shown + more + gone + '</div></div>';
			}).join('');

			q('.out').innerHTML = st.out.map(function (e, i) {
				return chip(e.it, e.s.id, e.mark + (i === st.out.length - 1 ? ' new' : ''));
			}).join('');

			q('.roundTag').textContent = st.done ? 'done' : 'round ' + st.round;
			var set = function (sel, v) { var el = q(sel); if (el) { el.textContent = v; } };
			set('.rEmit', st.out.length + ' / ' + K);
			set('.rRound', st.done ? '—' : st.round);

			var tally = {};
			st.out.forEach(function (e) { tally[e.s.id] = (tally[e.s.id] || 0) + 1; });
			set('.rMix', st.out.length ? SRC.map(function (s) { return tally[s.id] || 0; }).join(':') : '—');
			set('.rRatio', SRC.map(function (s) { return s.w; }).join(':'));

			set('.rRe', st.re);
			set('.rMiss', st.miss);
			set('.rUv', SRC.filter(function (s) { return !s.main; })
				.map(function (s) { return st.uv[s.id]; }).join(':') || '—');
			var live = SRC.reduce(function (a, s) { return a + s.q.length; }, 0) + st.out.length;
			set('.rMem', live + ' / ' + (K * 2));
		}

		function stop() {
			if (timer) { clearInterval(timer); timer = null; }
			q('.play').textContent = 'Play';
			q('.play').classList.remove('on');
		}

		function reset() { stop(); build(); render(); }

		q('.wctrls').innerHTML = SRC.map(function (s) {
			return '<label>' + s.nm + ' weight <output data-o="' + s.id + '">' + s.w + '</output>' +
				'<input type="range" min="1" max="5" value="' + s.w + '" data-w="' + s.id +
				'" aria-label="' + s.nm + ' weight" /></label>';
		}).join('');

		q('.wctrls').addEventListener('input', function (e) {
			var id = e.target.dataset.w;
			if (!id) { return; }
			SRC.forEach(function (s) { if (s.id === id) { s.w = parseInt(e.target.value, 10); } });
			q('[data-o="' + id + '"]').textContent = e.target.value;
			reset();
		});

		var capEl = q('.cap');
		if (capEl) {
			capEl.addEventListener('input', function (e) {
				K = parseInt(e.target.value, 10);
				q('.capOut').textContent = K;
				reset();
			});
		}

		q('.step').addEventListener('click', function () { stop(); step(); render(); });
		q('.reset').addEventListener('click', reset);
		q('.play').addEventListener('click', function () {
			if (timer) { stop(); return; }
			if (st.done) { build(); }
			q('.play').textContent = 'Pause';
			q('.play').classList.add('on');
			timer = setInterval(function () {
				if (!step()) { render(); stop(); return; }
				render();
			}, 240);
		});

		reset();
	}

	makeBlender({
		root: '#w-iwrr', cap: 12, dedup: false, seed: 7,
		srcs: [
			{ id: 'a', nm: 'Model A', w: 3 },
			{ id: 'b', nm: 'Model B', w: 2 },
			{ id: 'c', nm: 'Model C', w: 1 }
		]
	});

	makeBlender({
		root: '#w-uvb', cap: 12, dedup: true, seed: 11,
		srcs: [
			{ id: 'a', nm: 'Main', w: 3, main: true },
			{ id: 'b', nm: 'Supplementary B', w: 2 },
			{ id: 'c', nm: 'Supplementary C', w: 1 }
		]
	});
})();
