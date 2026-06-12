(function () {
  // Confirmation dialogs for destructive forms
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // Copy media URL to clipboard
  document.querySelectorAll('.copy-url').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var url = window.location.origin + btn.getAttribute('data-url');
      navigator.clipboard.writeText(url).then(function () {
        var original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = original; }, 1500);
      });
    });
  });

  // Sortable tables (analytics)
  document.querySelectorAll('table[data-sortable]').forEach(function (table) {
    var headers = table.querySelectorAll('th');
    headers.forEach(function (th, index) {
      th.addEventListener('click', function () {
        var tbody = table.querySelector('tbody');
        var rows = Array.from(tbody.querySelectorAll('tr'));
        var type = th.getAttribute('data-sort') || 'text';
        var asc = th.getAttribute('data-asc') !== 'true';
        headers.forEach(function (h) { h.removeAttribute('data-asc'); });
        th.setAttribute('data-asc', asc ? 'true' : 'false');
        rows.sort(function (a, b) {
          var av = a.children[index].textContent.trim();
          var bv = b.children[index].textContent.trim();
          if (type === 'num') return asc ? av - bv : bv - av;
          return asc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
        rows.forEach(function (r) { tbody.appendChild(r); });
      });
    });
  });
})();
