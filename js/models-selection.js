/* Selection: retrieval funnel, bounded top-K buffer, Bloom filter. */
(function () {
	'use strict';

	var $ = S.$, $$ = S.$$, rng = S.rng, mix = S.mix;

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
	if (stagesEl) {
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

		var runFunnel = function () {
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
		};

		stagesEl.addEventListener('input', runFunnel);
		runFunnel();
	}
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
})();
