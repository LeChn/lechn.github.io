/* Page chrome: colour theme and the copy-email button. */
(function () {
	'use strict';

	var $ = S.$, $$ = S.$$, rng = S.rng, mix = S.mix;

	/* Theme -------------------------------------------------------------- */
	var themeBtn = $('#theme');
	if (themeBtn) {
		themeBtn.addEventListener('click', function () {
			var dark = document.documentElement.dataset.theme === 'dark';
			if (dark) { delete document.documentElement.dataset.theme; }
			else { document.documentElement.dataset.theme = 'dark'; }
			try { localStorage.setItem('theme', dark ? 'light' : 'dark'); } catch (e) { }
		});
	}
	/* Copy email --------------------------------------------------------- */
	var copyBtn = $('#copyEmail');
	if (copyBtn) {
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
	}
})();
