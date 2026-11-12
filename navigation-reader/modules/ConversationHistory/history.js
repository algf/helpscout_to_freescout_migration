(function () {
    function reveal() {
        var link = document.getElementById('conversation-history-all');
        var match = /^#thread(?:-id=|-)(\d+)$/.exec(location.hash);
        if (link && match && !document.getElementById('thread-' + match[1])) {
            location.replace(link.href + location.hash);
        }
    }
    reveal();
    window.addEventListener('hashchange', reveal);
})();
