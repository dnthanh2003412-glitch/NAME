// sidebar-resize.js - Handle sidebar resizing
(function () {
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    document.addEventListener('DOMContentLoaded', () => {
        const sidebar = document.querySelector('.sidebar');
        const handle = document.querySelector('.sidebar-resize-handle');

        if (!sidebar || !handle) return;

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            // Use getComputedStyle for accurate width including padding/border if any
            startWidth = parseInt(window.getComputedStyle(sidebar).width, 10);

            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';

            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            const diff = e.clientX - startX;
            const newWidth = startWidth + diff;

            const minWidth = 250;
            const maxWidth = window.innerWidth * 0.5;

            if (newWidth >= minWidth && newWidth <= maxWidth) {
                sidebar.style.width = newWidth + 'px';
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    });
})();
