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
