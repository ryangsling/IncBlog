(function () {
  var banner = document.querySelector('[data-verify-banner]');
  if (!banner) return;
  if (sessionStorage.getItem('incblog-verify-dismissed') === '1') return;
  banner.hidden = false;
  var dismiss = document.querySelector('[data-verify-dismiss]');
  if (dismiss) {
    dismiss.addEventListener('click', function () {
      sessionStorage.setItem('incblog-verify-dismissed', '1');
      banner.remove();
    });
  }
})();
