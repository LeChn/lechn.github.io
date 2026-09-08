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
	   Unfused, scoring costs three passes over the embedding data: read the
	   table, write the gathered tensor, read it back. Fused, the gathered
	   values never leave registers, so only the table read remains. Counts
	   below are derived from shapes, not measured. */
	function makeFuse(cfg) {
		var root = document.querySelector(cfg.root);
		if (!root) { return; }
		var q = function (s) { return root.querySelector(s); };
		var NS = [1024, 2048, 4096, 8192, 16384, 32768, 65536];
		var DS = [32, 64, 128, 256];
		var PS = [{ nm: 'fp32', b: 4 }, { nm: 'fp16', b: 2 }, { nm: 'int8', b: 1 }];
		var BALANCE = 10; // FLOP/byte below which a kernel is bandwidth-bound

		function bytes(v) {
			if (v >= 1073741824) { return (v / 1073741824).toFixed(2) + ' GB'; }
			if (v >= 1048576) { return (v / 1048576).toFixed(1) + ' MB'; }
			if (v >= 1024) { return (v / 1024).toFixed(0) + ' KB'; }
			return v + ' B';
		}

		function num(v) { return v >= 1024 ? (v / 1024) + 'K' : String(v); }

		function render() {
			var N = NS[+q('.nIn').value], D = DS[+q('.dIn').value], P = PS[+q('.pIn').value];
			q('.nOut').textContent = num(N);
			q('.dOut').textContent = D;
			q('.pOut').textContent = P.nm;

			var emb = N * D * P.b;   // one pass over the gathered embeddings
			var out = N * 4;         // fp32 scores
			var unfused = emb * 3 + out;
			var fused = emb + out;

			var bars = root.querySelectorAll('.fbtrack');
			var w = function (v) { return (v / unfused * 100) + '%'; };
			var u = bars[0].children;
			u[0].style.width = w(emb);
			u[1].style.width = w(emb);
			u[2].style.width = w(emb);
			u[3].style.width = w(out);
			var f = bars[1].children;
			f[0].style.width = w(emb);
			f[1].style.width = w(out);

			var flops = 2 * N * D;   // one multiply-add per element
			var ai = flops / fused;

			q('.fUn').textContent = bytes(unfused);
			q('.fFu').textContent = bytes(fused);
			q('.rUn').textContent = bytes(unfused);
			q('.rFu').textContent = bytes(fused);
			q('.rCut').textContent = (unfused / fused).toFixed(2) + '×';
			q('.rAi').textContent = ai.toFixed(2);
			var el = q('.rBound');
			el.textContent = ai < BALANCE ? 'bandwidth' : 'compute';
			el.className = 'k rBound ' + (ai < BALANCE ? 'over' : 'under');
		}

		['.nIn', '.dIn', '.pIn'].forEach(function (s) {
			q(s).addEventListener('input', render);
		});
		render();
	}

	makeFuse({ root: '#w-fuse' });

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
