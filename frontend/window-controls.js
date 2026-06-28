(function () {
    function callApp(method) {
        const app = window.go && window.go.main && window.go.main.App;
        if (!app || typeof app[method] !== 'function') return null;
        return app[method].bind(app);
    }

    function bindWindowControls() {
        const drag = document.getElementById('titlebarDrag');
        const listen = document.getElementById('titlebarListenAddr');
        const btnMin = document.getElementById('titlebarMinimize');
        const btnMax = document.getElementById('titlebarMaximize');
        const btnClose = document.getElementById('titlebarClose');
        const closeOverlay = document.getElementById('closeDialogOverlay');
        const closeExit = document.getElementById('closeDialogExit');
        const closeMinimize = document.getElementById('closeDialogMinimize');
        const closeCancel = document.getElementById('closeDialogCancel');
        const startWindowDrag = callApp('StartWindowDrag');
        const requestClose = callApp('RequestClose');
        const hideToTray = callApp('HideToTray');
        const quitApp = callApp('QuitApp');

        function showCloseDialog() {
            if (!closeOverlay) return;
            closeOverlay.style.display = 'flex';
        }

        function hideCloseDialog() {
            if (!closeOverlay) return;
            closeOverlay.style.display = 'none';
        }

        if (drag && startWindowDrag) {
            drag.addEventListener('mousedown', function (e) {
                if (e.button !== 0) return;
                startWindowDrag().catch(function () {});
            });
        }

        if (btnMin && window.runtime && typeof window.runtime.WindowMinimise === 'function') {
            btnMin.addEventListener('click', function () {
                try { window.runtime.WindowMinimise(); } catch (_) {}
            });
        }

        if (btnMax && window.runtime && typeof window.runtime.WindowToggleMaximise === 'function') {
            btnMax.addEventListener('click', function () {
                try { window.runtime.WindowToggleMaximise(); } catch (_) {}
            });
        }

        if (btnClose) {
            btnClose.addEventListener('click', async function () {
                if (!requestClose) return;
                try { await requestClose(); } catch (_) {}
            });
        }

        if (closeExit && quitApp) {
            closeExit.addEventListener('click', async function () {
                hideCloseDialog();
                try { await quitApp(); } catch (_) {}
            });
        }

        if (closeMinimize && hideToTray) {
            closeMinimize.addEventListener('click', async function () {
                hideCloseDialog();
                try { await hideToTray(); } catch (_) {}
            });
        }

        if (closeCancel) {
            closeCancel.addEventListener('click', hideCloseDialog);
        }

        if (closeOverlay) {
            closeOverlay.addEventListener('click', function (e) {
                if (e.target === closeOverlay) hideCloseDialog();
            });
        }

        if (listen) {
            const syncListenAddr = function () {
                const source = document.getElementById('status-listen');
                const text = source && source.textContent ? source.textContent.trim() : '';
                if (text && text !== '-') listen.textContent = text;
            };
            syncListenAddr();
            window.setInterval(syncListenAddr, 1500);
        }

        if (window.runtime && typeof window.runtime.EventsOn === 'function') {
            try {
                window.runtime.EventsOn('show-close-dialog', showCloseDialog);
            } catch (_) {}
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindWindowControls);
    } else {
        bindWindowControls();
    }
})();
