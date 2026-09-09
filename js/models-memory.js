/* Memory and kernels: fusion stack, coalescing, warp reduction. */
(function () {
	'use strict';

	var $ = S.$, $$ = S.$$, rng = S.rng, mix = S.mix;

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
	/* Coalescing -----------------------------------------------------------
	   Memory is served in 32B sectors. A warp's 32 lanes are coalesced into
	   the smallest covering set, and you pay for whole sectors regardless of
	   how much of each you use. On a gather each lane lands in its own
	   sector, so the only lever left is asking for more bytes per lane. */
	function makeCoal(cfg) {
		var root = document.querySelector(cfg.root);
		if (!root) { return; }
		var q = function (s) { return root.querySelector(s); };
		var qa = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };
		var SEC = 32, LANES = 32, NSEC = 96, PAT = 'gather', WID = 4;

		function addrOf(t) {
			var span = NSEC * SEC - WID;
			if (PAT === 'contig') { return t * WID; }
			// Stride exactly tiles the window so lanes never wrap and collide.
			if (PAT === 'stride') { return t * (NSEC * SEC / LANES); }
			return (mix(t + 1) % Math.floor(span / WID)) * WID;   // aligned random
		}

		function render() {
			var used = new Array(NSEC).fill(0);
			for (var t = 0; t < LANES; t++) {
				var a = addrOf(t);
				for (var b = a; b < a + WID; b++) {
					var s = Math.floor(b / SEC);
					if (s >= 0 && s < NSEC) { used[s]++; }
				}
			}
			var fetched = 0, html = '';
			for (var i = 0; i < NSEC; i++) {
				var cls = used[i] === 0 ? 'sec' : (used[i] >= SEC ? 'sec full' : 'sec part');
				if (used[i] > 0) { fetched++; }
				html += '<span class="' + cls + '"></span>';
			}
			q('.sectors').innerHTML = html;

			var want = LANES * WID, got = fetched * SEC;
			var eff = got > 0 ? want / got : 0;
			q('.rTx').textContent = fetched;
			q('.rReq').textContent = want + ' B';
			q('.rGot').textContent = got + ' B';
			q('.rEff').textContent = Math.round(eff * 100) + '%';
			q('.coEff').textContent = Math.round(eff * 100) + '% of fetched bytes used';
			q('.rLoads').textContent = Math.ceil(256 / WID);
		}

		qa('.picker').forEach(function (row) {
			row.addEventListener('click', function (e) {
				var b = e.target.closest('.chip');
				if (!b) { return; }
				Array.prototype.slice.call(row.querySelectorAll('.chip'))
					.forEach(function (o) { o.classList.remove('on'); });
				b.classList.add('on');
				if (b.dataset.pat) { PAT = b.dataset.pat; }
				if (b.dataset.wid) { WID = +b.dataset.wid; }
				render();
			});
		});

		render();
	}

	makeCoal({ root: '#w-coal' });
	/* Warp reduction -------------------------------------------------------
	   Same log-depth tree either way. Shuffles read a neighbour's register
	   directly; the shared-memory version needs a barrier per level and an
	   array that costs occupancy. */
	function makeRed(cfg) {
		var root = document.querySelector(cfg.root);
		if (!root) { return; }
		var q = function (s) { return root.querySelector(s); };
		var qa = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };
		var N = 32, DEPTH = 5, MODE = 'shfl', vals = [], step = 0, timer = null;

		function reset() {
			if (timer) { clearInterval(timer); timer = null; }
			q('.play').textContent = 'Run';
			q('.play').classList.remove('on');
			vals = [];
			for (var i = 0; i < N; i++) { vals.push(1 + (i * 7 % 9)); }
			step = 0;
			render();
		}

		function advance() {
			if (step >= DEPTH) { return false; }
			var off = N >> (step + 1);
			for (var i = 0; i < off; i++) { vals[i] += vals[i + off]; }
			step++;
			return true;
		}

		function render() {
			var live = step >= DEPTH ? 1 : N >> step;
			var peak = Math.max.apply(null, vals);
			q('.lanes').innerHTML = vals.map(function (v, i) {
				var cls = 'ln';
				if (i < live) { cls += ' live'; }
				else if (i < (step === 0 ? N : N >> (step - 1))) { cls += ' recv'; }
				else { cls += ' dead'; }
				return '<span class="' + cls + '" style="height:' +
					Math.max(2, v / peak * 72) + 'px"></span>';
			}).join('');
			q('.redStep').textContent = 'step ' + step + ' / ' + DEPTH;
			q('.rActive').textContent = live;
			q('.rDepth').textContent = DEPTH;
			q('.rBar').textContent = MODE === 'shfl' ? '0' : String(step);
			q('.rSmem').textContent = MODE === 'shfl' ? '0 B' : (N * 4) + ' B';
			q('.rSum').textContent = vals[0];
		}

		qa('.picker').forEach(function (row) {
			row.addEventListener('click', function (e) {
				var b = e.target.closest('.chip');
				if (!b || !b.dataset.red) { return; }
				Array.prototype.slice.call(row.querySelectorAll('.chip'))
					.forEach(function (o) { o.classList.remove('on'); });
				b.classList.add('on');
				MODE = b.dataset.red;
				reset();
			});
		});

		q('.step').addEventListener('click', function () { advance(); render(); });
		q('.reset').addEventListener('click', reset);
		q('.play').addEventListener('click', function () {
			if (timer) { clearInterval(timer); timer = null; q('.play').textContent = 'Run'; q('.play').classList.remove('on'); return; }
			if (step >= DEPTH) { reset(); }
			q('.play').textContent = 'Pause';
			q('.play').classList.add('on');
			timer = setInterval(function () {
				if (!advance()) {
					clearInterval(timer); timer = null;
					q('.play').textContent = 'Run'; q('.play').classList.remove('on');
				}
				render();
			}, 520);
		});

		reset();
	}

	makeRed({ root: '#w-red' });
})();
