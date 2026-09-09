(function () {
	'use strict';

	var $ = function (s, r) { return (r || document).querySelector(s); };
	var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

	/* Theme -------------------------------------------------------------- */
	var themeBtn = $('#theme');
	themeBtn.addEventListener('click', function () {
		var dark = document.documentElement.dataset.theme === 'dark';
		if (dark) { delete document.documentElement.dataset.theme; }
		else { document.documentElement.dataset.theme = 'dark'; }
		try { localStorage.setItem('theme', dark ? 'light' : 'dark'); } catch (e) { }
	});

	/* Copy email --------------------------------------------------------- */
	var copyBtn = $('#copyEmail');
	copyBtn.addEventListener('click', function () {
		var addr = copyBtn.dataset.email;
		var done = function () {
			copyBtn.textContent = 'Copied';
			copyBtn.classList.add('done');
			setTimeout(function () {
				copyBtn.textContent = 'Copy email';
				copyBtn.classList.remove('done');
			}, 1600);
		};
		if (navigator.clipboard) {
			navigator.clipboard.writeText(addr).then(done, function () { location.href = 'mailto:' + addr; });
		} else {
			location.href = 'mailto:' + addr;
		}
	});

	/* Diagrams ----------------------------------------------------------- */
	var DESC = {
		req: ['Request', 'One impression opportunity. The whole funnel runs inside a fixed millisecond budget.'],
		corpus: ['Ad corpus', 'The eligible set. Nothing downstream can recover a candidate that indexing failed to surface.'],
		cpu: ['Index match', 'Inverted-index lookup on CPU. Targeting and eligibility are resolved as index predicates, not as post-filters.'],
		gpu: ['Model retrieval', 'Learned retrieval on GPU, running in parallel with the index path rather than after it. Two different ways of finding candidates, racing.'],
		models: ['Models + embeddings', 'Versioned artifacts and vectors. Downloads are concurrency-bounded; staleness against the producing model is a correctness bug, not a freshness nit.'],
		blend: ['Blend', 'The two paths merge here. Dedup, attribute each candidate to its source, and decide the mix — a source that wins too often starves the others.'],
		pre: ['Pre-rank', 'A light model does the heaviest filtering. The cheapest stage removes the most candidates.'],
		rank: ['Rank', 'Batched GPU inference over the survivors. Batch size sets the throughput-latency trade.'],
		final: ['Final rank', 'The heavy model, affordable only because everything upstream narrowed the field first.'],
		auction: ['Auction', 'Final ordering and pricing.'],
		art: ['Artifact', 'A new model version is published to the store.'],
		dl: ['Download', 'Fetched under a concurrency cap so simultaneous rollouts do not starve serving traffic.'],
		val: ['Validate', 'Freshness and embedding coverage are checked before the model is eligible.'],
		warm: ['Warmup', 'First passes run off the request path. Cold kernels never meet a user.'],
		act: ['Active', 'Promoted to serving.'],
		blk: ['Blocked', 'A stale or incomplete artifact never loads. The rollout stops and pages instead.'],
		hold: ['Previous model holds', 'The prior version keeps serving. A failed rollout degrades to stale, never to empty.']
	};

	$$('.node').forEach(function (n) {
		var pick = function () {
			var fig = n.closest('figure');
			$$('.node', fig).forEach(function (o) { o.classList.remove('sel'); });
			n.classList.add('sel');
			var d = DESC[n.dataset.id];
			if (d) { $('figcaption', fig).innerHTML = '<strong>' + d[0] + '</strong> — ' + d[1]; }
		};
		n.addEventListener('click', pick);
		n.addEventListener('keydown', function (e) {
			if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
		});
	});

	$$('#diagTabs .chip').forEach(function (b) {
		b.addEventListener('click', function () {
			$$('#diagTabs .chip').forEach(function (o) { o.classList.remove('on'); });
			b.classList.add('on');
			$('#dg-serving').classList.toggle('hidden', b.dataset.diagram !== 'serving');
			$('#dg-rollout').classList.toggle('hidden', b.dataset.diagram !== 'rollout');
		});
	});

	/* Retrieval funnel --------------------------------------------------- */
	var STAGES = [
		{ nm: 'Retrieve', keep: 0.01, cost: 2e-6, gpu: false },
		{ nm: 'Pre-rank', keep: 0.1, cost: 1.5e-4, gpu: false },
		{ nm: 'Rank', keep: 0.1, cost: 2.5e-3, gpu: true },
		{ nm: 'Final rank', keep: 0.1, cost: 1.2e-2, gpu: true },
		{ nm: 'Auction', keep: 0.1, cost: 5e-3, gpu: false }
	];
	var START = 1e7, BUDGET = 100, LOGMAX = Math.log10(START);

	var fmt = function (n) {
		if (n >= 1e6) { return (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + 'M'; }
		if (n >= 1e3) { return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'K'; }
		return Math.max(1, Math.round(n)).toString();
	};

	var pct = function (k) {
		var p = k * 100;
		if (p >= 10) { return p.toFixed(0) + '%'; }
		if (p >= 1) { return p.toFixed(1) + '%'; }
		return p.toFixed(2) + '%';
	};

	var stagesEl = $('#stages');
	STAGES.forEach(function (s, i) {
		var row = document.createElement('div');
		row.className = 'stage';
		row.innerHTML =
			'<span class="nm">' + s.nm + '</span>' +
			'<div class="bar"><span class="fill"></span></div>' +
			'<span class="ct"></span>' +
			'<input type="range" min="1" max="100" value="' + Math.round(Math.pow(s.keep, 1 / 3) * 100) +
			'" aria-label="' + s.nm + ' keep rate" data-i="' + i + '" />' +
			'<span class="kp"></span>';
		stagesEl.appendChild(row);
	});

	function runFunnel() {
		var n = START, lat = 0, gpu = 0;
		$$('#stages .stage').forEach(function (row, i) {
			var r = parseInt($('input', row).value, 10) / 100;
			var keep = Math.pow(r, 3);
			var examined = n;
			var cost = examined * STAGES[i].cost;
			lat += cost;
			if (STAGES[i].gpu) { gpu += cost; }
			n = Math.max(1, examined * keep);
			$('.fill', row).style.width = (Math.log10(Math.max(n, 1)) / LOGMAX * 100) + '%';
			$('.ct', row).textContent = fmt(n);
			$('.kp', row).textContent = 'keeps ' + pct(keep);
		});
		$('#fOut').textContent = fmt(n);
		$('#fLat').textContent = lat.toFixed(1) + ' ms';
		$('#fGpu').textContent = lat > 0 ? Math.round(gpu / lat * 100) + '%' : '0%';
		var v = $('#fVerdict');
		v.textContent = lat <= BUDGET ? 'within' : 'over';
		v.className = 'k ' + (lat <= BUDGET ? 'under' : 'over');
	}

	stagesEl.addEventListener('input', runFunnel);
	runFunnel();

	/* Blenders -------------------------------------------------------------
	   Interleaved weighted round robin: in round r, every queue with weight
	   >= r emits one item. The unique-value variant additionally remembers
	   membership in the main queue and reattributes duplicates to it. Main is
	   a bounded top-K, so membership is only knowable inside that window. */
	function rng(seed) {
		return function () {
			seed |= 0; seed = seed + 0x6D2B79F5 | 0;
			var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
			t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
			return ((t ^ t >>> 14) >>> 0) / 4294967296;
		};
	}

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

	/* Bounded top-K buffer -------------------------------------------------
	   Ranked items stream in faster than they can be sorted. Admit into an
	   unordered buffer of m*K; when it fills, partition once (quickselect,
	   average O(mK)), keep the best K, and overwrite the discarded tail.
	   The boundary element left by the partition then rejects weaker items
	   in O(1). Amortized partition work is m/(m-1) per admitted item. */
	function makeTopK(cfg) {
		var root = document.querySelector(cfg.root);
		if (!root) { return; }
		var q = function (s) { return root.querySelector(s); };
		var K = cfg.k, M = cfg.m, st = null, timer = null;

		function build() {
			var rnd = rng(cfg.seed), n = K * 6, stream = [];
			for (var i = 0; i < n; i++) { stream.push({ id: i + 1, sc: Math.floor(rnd() * 99) + 1 }); }
			st = {
				stream: stream, idx: 0, buf: [], thr: null, done: false,
				seen: 0, adm: 0, rej: 0, comp: 0, hot: -1, cut: false
			};
		}

		function compact() {
			// Stands in for quickselect: average O(mK), run once per (m-1)K admits.
			st.buf.sort(function (a, b) { return b.sc - a.sc; });
			st.buf = st.buf.slice(0, K);
			st.thr = st.buf[K - 1].sc; // boundary element: the O(1) admission test
			st.comp++;
			st.cut = true;
		}

		function step() {
			if (!st || st.done) { return false; }
			st.cut = false;
			if (st.idx >= st.stream.length) {
				if (st.buf.length > K) { compact(); }
				st.done = true;
				st.hot = -1;
				return true;
			}
			var it = st.stream[st.idx++];
			st.seen++;
			if (st.thr !== null && it.sc <= st.thr) {
				st.rej++;
				st.hot = -1;
				return true;
			}
			st.buf.push(it);
			st.adm++;
			st.hot = st.buf.length - 1;
			if (st.buf.length >= M * K) { compact(); st.hot = -1; }
			return true;
		}

		function render() {
			var slots = M * K, html = '';
			for (var i = 0; i < slots; i++) {
				var it = st.buf[i];
				if (!it) { html += '<span class="slot">·</span>'; continue; }
				var cls = 'slot fill';
				if (st.comp > 0 && i < K) { cls = 'slot keep'; }
				if (st.cut && i < K) { cls = 'slot keep'; }
				if (i === st.hot) { cls += ' hot'; }
				html += '<span class="' + cls + '">' + it.sc + '</span>';
			}
			q('.tkslots').innerHTML = html;
			q('.tkCap').textContent = slots;
			q('.tkPhase').textContent = st.done ? 'done'
				: st.cut ? 'partitioned → kept ' + K
					: st.thr !== null ? 'filling · threshold active' : 'filling';
			q('.tkThr').textContent = st.thr === null ? '—' : st.thr;
			q('.tkPos').textContent = st.idx + ' / ' + st.stream.length;
			q('.rSeen').textContent = st.seen;
			q('.rAdm').textContent = st.adm;
			q('.rRej').textContent = st.rej;
			q('.rComp').textContent = st.comp;
			q('.rRate').textContent = st.seen ? Math.round(st.rej / st.seen * 100) + '%' : '—';
		}

		function stop() {
			if (timer) { clearInterval(timer); timer = null; }
			q('.play').textContent = 'Play';
			q('.play').classList.remove('on');
		}

		function reset() { stop(); build(); render(); }

		q('.kIn').addEventListener('input', function (e) {
			K = parseInt(e.target.value, 10); q('.kOut').textContent = K; reset();
		});
		q('.mIn').addEventListener('input', function (e) {
			M = parseInt(e.target.value, 10); q('.mOut').textContent = M; reset();
		});
		q('.step').addEventListener('click', function () { stop(); step(); render(); });
		q('.reset').addEventListener('click', reset);
		q('.play').addEventListener('click', function () {
			if (timer) { stop(); return; }
			if (st.done) { build(); }
			q('.play').textContent = 'Pause';
			q('.play').classList.add('on');
			timer = setInterval(function () {
				step(); render();
				if (st.done) { stop(); }
			}, 90);
		});

		reset();
	}

	makeTopK({ root: '#w-topk', k: 8, m: 2, seed: 5 });

	/* Fused embedding kernel ----------------------------------------------
	   Scoring is a random-gather reduction: almost no arithmetic per byte, so
	   every win is a memory win. The techniques below compose multiplicatively.
	   Fusion and precision are exact byte ratios; the rest are typical
	   magnitudes for a bandwidth-bound gather, not measurements. */
	function makeFuse(cfg) {
		var root = document.querySelector(cfg.root);
		if (!root) { return; }
		var q = function (s) { return root.querySelector(s); };
		var D = 128, BASE_B = 2, PEAK = 0.28, BALANCE = 10;

		var TRICKS = [
			{
				id: 'fuse', nm: 'Fuse lookup + reduce', f: 3.0, on: true, exact: true,
				why: 'Unfused, the gathered embeddings are written to memory and read straight back. Fused they never leave registers, so three passes over the embedding data become one.'
			},
			{
				id: 'vec', nm: 'Vectorized 16B loads', f: 1.8, on: false, bw: 2.4,
				why: 'A random row gather issued as scalar loads leaves most of the bus idle. Wide aligned loads turn the same access pattern into something that can actually saturate HBM.'
			},
			{
				id: 'blk', nm: '2D blocks + shared-mem reduction', f: 1.25, on: false, bw: 1.2,
				why: 'One warp per candidate caps the memory parallelism in flight. Two-dimensional blocks keep more requests outstanding and move the reduction out of warp shuffles.'
			},
			{
				id: 'pre', nm: 'Hoist the user-side term', f: 1.15, on: false,
				why: 'The user-side contraction is identical for every candidate in the request. Compute it once and amortize it across the whole batch instead of redoing it per candidate.'
			},
			{
				id: 'tc', nm: 'Tensor cores for the GEMM', f: 1.3, on: false,
				why: 'Only helps the matmul stage. The dot product stays bandwidth-bound no matter what you run it on, which is exactly why the memory tricks matter more here.'
			},
			{
				id: 'int8', nm: 'INT8 over FP16', f: 2.0, on: false, exact: true, half: true,
				why: 'Halves every byte moved. On a kernel whose runtime tracks bytes, that is close to the whole story — and it is orthogonal to fusion, so the two multiply.'
			}
		];

		function total() {
			return TRICKS.reduce(function (a, t) { return t.on ? a * t.f : a; }, 1);
		}

		function bandwidth() {
			var bw = PEAK;
			TRICKS.forEach(function (t) { if (t.on && t.bw) { bw *= t.bw; } });
			return Math.min(bw, 0.9);
		}

		function bytesPer() {
			var b = BASE_B;
			if (TRICKS[5].on) { b = 1; }
			var passes = TRICKS[0].on ? 1 : 3;
			return D * b * passes + 4;
		}

		function renderTricks() {
			q('.tricks').innerHTML = TRICKS.map(function (t, i) {
				return '<button class="chip trick k' + i + (t.on ? ' on' : '') + '" type="button" data-t="' +
					t.id + '"><span class="dot"></span>' + t.nm + ' <em>' + t.f.toFixed(2) + '×</em></button>';
			}).join('');
		}

		function render() {
			var tot = total(), on = TRICKS.filter(function (t) { return t.on; });
			// Log scale so composed factors read as additive contributions.
			var span = Math.log(tot) || 1;
			var html = '<span class="rung base" style="width:' + (on.length ? 8 : 100) + '%">1×</span>';
			on.forEach(function (t) {
				var i = TRICKS.indexOf(t);
				var w = Math.log(t.f) / span * (on.length ? 92 : 0);
				html += '<span class="rung k' + i + '" style="width:' + w + '%">' + t.f.toFixed(2) + '×</span>';
			});
			q('.ladder').innerHTML = html;
			q('.ladTot').textContent = tot.toFixed(1) + '×';
			q('.rSpd').textContent = tot.toFixed(1) + '×';

			var bp = bytesPer();
			q('.rByte').textContent = bp + ' B';
			q('.rBw').textContent = Math.round(bandwidth() * 100) + '%';
			var ai = (2 * D) / bp;
			q('.rAi').textContent = ai.toFixed(2);
			var el = q('.rBound');
			el.textContent = ai < BALANCE ? 'bandwidth' : 'compute';
			el.className = 'k rBound ' + (ai < BALANCE ? 'over' : 'under');
		}

		q('.tricks').addEventListener('click', function (e) {
			var b = e.target.closest('.trick');
			if (!b) { return; }
			var t = TRICKS.filter(function (x) { return x.id === b.dataset.t; })[0];
			t.on = !t.on;
			b.classList.toggle('on', t.on);
			q('.trickwhy').innerHTML = '<strong>' + t.nm + (t.on ? '' : ' (off)') + '</strong> — ' + t.why;
			render();
		});

		renderTricks();
		render();
	}

	makeFuse({ root: '#w-fuse' });

	/* Bloom filter ---------------------------------------------------------
	   k hashes per key, all set on insert, all tested on probe. A clear bit
	   proves absence; all-set only suggests presence. Measured rate is
	   sampled against absent keys and compared to (1 - e^(-kn/m))^k. */
	function makeBloom(cfg) {
		var root = document.querySelector(cfg.root);
		if (!root) { return; }
		var q = function (s) { return root.querySelector(s); };
		var qa = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };
		var M = 64, KH = 3, bits = [], n = 0, nextKey = 1;

		function hashes(key, m, k) {
			// 32-bit throughout: Math.imul + >>>0. Plain * and ^ would overflow
			// past 2^53 and silently destroy the low bits that % m depends on.
			var out = [], h = Math.imul(key, 2654435761) >>> 0;
			for (var i = 0; i < k; i++) {
				h ^= h >>> 15;
				h = Math.imul(h, 2246822519) >>> 0;
				h ^= h >>> 13;
				h = Math.imul(h, 3266489917) >>> 0;
				h ^= h >>> 16;
				out.push((h >>> 0) % m);   // ^= yields signed int32; % would go negative
			}
			return out;
		}

		function reset() {
			bits = new Array(M).fill(false);
			n = 0; nextKey = 1;
			q('.bloomsay').textContent = 'Insert a few keys, then probe for one that was never added.';
			render();
		}

		function fill() { return bits.filter(Boolean).length; }

		function measuredFpr() {
			if (n === 0) { return 0; }
			var trials = 4000, fp = 0;
			for (var i = 0; i < trials; i++) {
				var key = 1000000 + i;                  // guaranteed absent
				var hs = hashes(key, M, KH), all = true;
				for (var j = 0; j < hs.length; j++) { if (!bits[hs[j]]) { all = false; break; } }
				if (all) { fp++; }
			}
			return fp / trials;
		}

		function render(touch, mode) {
			q('.bits').innerHTML = bits.map(function (b, i) {
				var c = 'bit' + (b ? ' set' : '');
				if (touch && touch.indexOf(i) >= 0) {
					c += ' touch';
					if (mode === 'fp') { c += ' hitfp'; }
					if (mode === 'miss' && !b) { c += ' clear'; }
				}
				return '<span class="' + c + '"></span>';
			}).join('');

			var f = fill(), mf = measuredFpr();
			var tf = n === 0 ? 0 : Math.pow(1 - Math.exp(-KH * n / M), KH);
			q('.rN').textContent = n;
			q('.rFill').textContent = Math.round(f / M * 100) + '%';
			q('.rFprM').textContent = (mf * 100).toFixed(1) + '%';
			q('.rFprT').textContent = (tf * 100).toFixed(1) + '%';
			q('.rOptK').textContent = n === 0 ? '—' : Math.max(1, Math.round(M / n * Math.LN2));
		}

		q('.bIns').addEventListener('click', function () {
			var hs = hashes(nextKey++, M, KH);
			hs.forEach(function (i) { bits[i] = true; });
			n++;
			q('.bloomsay').innerHTML = '<strong>Inserted</strong> — set ' + KH + ' bits. Collisions with earlier keys are expected and are exactly what creates false positives later.';
			render(hs, 'ins');
		});

		q('.bProbe').addEventListener('click', function () {
			var key = 900000 + Math.floor(Math.random() * 100000);
			var hs = hashes(key, M, KH), all = hs.every(function (i) { return bits[i]; });
			q('.bloomsay').innerHTML = all
				? '<strong class="bad">False positive</strong> — every probed bit happens to be set by other keys, so the filter says "maybe". The exact check downstream is what rejects it.'
				: '<strong class="good">Correctly rejected</strong> — at least one probed bit is clear, which is proof the key was never inserted. No exact check needed.';
			render(hs, all ? 'fp' : 'miss');
		});

		q('.bReset').addEventListener('click', reset);

		qa('.picker').forEach(function (row) {
			row.addEventListener('click', function (e) {
				var b = e.target.closest('.chip');
				if (!b) { return; }
				Array.prototype.slice.call(row.querySelectorAll('.chip'))
					.forEach(function (o) { o.classList.remove('on'); });
				b.classList.add('on');
				if (b.dataset.m) { M = +b.dataset.m; }
				if (b.dataset.k) { KH = +b.dataset.k; }
				reset();
			});
		});

		reset();
	}

	makeBloom({ root: '#w-bloom' });

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

		function mix(x) {
			x = Math.imul(x, 2654435761) >>> 0;
			x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0;
			x ^= x >>> 13; x = Math.imul(x, 3266489917) >>> 0;
			return (x ^ (x >>> 16)) >>> 0;
		}

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

	/* Selected work ------------------------------------------------------ */
	$$('.wtoggle').forEach(function (t) {
		t.addEventListener('click', function () {
			var open = t.getAttribute('aria-expanded') === 'true';
			t.setAttribute('aria-expanded', String(!open));
			t.nextElementSibling.classList.toggle('open', !open);
		});
	});

	$$('#filters .chip').forEach(function (b) {
		b.addEventListener('click', function () {
			$$('#filters .chip').forEach(function (o) { o.classList.remove('on'); });
			b.classList.add('on');
			var tag = b.dataset.tag;
			$$('#work li').forEach(function (li) {
				li.classList.toggle('out', tag !== 'all' && li.dataset.tags.indexOf(tag) === -1);
			});
		});
	});
})();
