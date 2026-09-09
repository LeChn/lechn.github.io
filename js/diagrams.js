/* Architecture diagrams: node selection and the serving/rollout tabs. */
(function () {
	'use strict';

	var $ = S.$, $$ = S.$$, rng = S.rng, mix = S.mix;

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
})();
