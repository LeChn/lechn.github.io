/* Shared helpers. Loaded first; every other script reads from window.S. */
window.S = (function () {
	'use strict';

	var $ = function (sel, root) { return (root || document).querySelector(sel); };
	var $$ = function (sel, root) {
		return Array.prototype.slice.call((root || document).querySelectorAll(sel));
	};

	/* Deterministic PRNG so every demo renders the same on every load. */
	function rng(seed) {
		return function () {
			seed |= 0; seed = seed + 0x6D2B79F5 | 0;
			var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
			t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
			return ((t ^ t >>> 14) >>> 0) / 4294967296;
		};
	}

	/* 32-bit avalanche. Math.imul and >>>0 throughout: plain * and ^ overflow
	   past 2^53 and silently destroy the low bits callers depend on. */
	function mix(x) {
		x = Math.imul(x, 2654435761) >>> 0;
		x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0;
		x ^= x >>> 13; x = Math.imul(x, 3266489917) >>> 0;
		return (x ^ (x >>> 16)) >>> 0;
	}

	return { $: $, $$: $$, rng: rng, mix: mix };
})();
