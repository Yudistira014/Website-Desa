// Navigasi responsif: tombol menu mobile + dropdown yang bisa dibuka dengan klik.
(() => {
    const MOBILE_QUERY = window.matchMedia('(max-width: 960px)');

    document.querySelectorAll('.navbar').forEach(navbar => {
        const menuToggle = navbar.querySelector('.menu-toggle');
        const navLinks = navbar.querySelector('.nav-links');

        if (!menuToggle || !navLinks) return;

        const closeDropdowns = () => {
            navbar.querySelectorAll('.nav-item.open').forEach(item => {
                item.classList.remove('open');
                const trigger = item.querySelector(':scope > a');
                if (trigger) trigger.setAttribute('aria-expanded', 'false');
            });
        };

        const closeMenu = () => {
            navLinks.classList.remove('active');
            menuToggle.classList.remove('active');
            menuToggle.setAttribute('aria-expanded', 'false');
            menuToggle.setAttribute('aria-label', 'Buka menu navigasi');
            closeDropdowns();
        };

        menuToggle.addEventListener('click', () => {
            const isOpen = navLinks.classList.toggle('active');
            menuToggle.classList.toggle('active', isOpen);
            menuToggle.setAttribute('aria-expanded', String(isOpen));
            menuToggle.setAttribute('aria-label', isOpen ? 'Tutup menu navigasi' : 'Buka menu navigasi');
            if (!isOpen) closeDropdowns();
        });

        navbar.querySelectorAll('.nav-item > a').forEach(link => {
            if (!link.parentElement.querySelector('.dropdown')) return;

            link.setAttribute('aria-haspopup', 'true');
            link.setAttribute('aria-expanded', 'false');
            link.addEventListener('click', event => {
                if (!MOBILE_QUERY.matches) return;
                event.preventDefault();
                const isOpen = link.parentElement.classList.toggle('open');
                link.setAttribute('aria-expanded', String(isOpen));
            });
        });

        navLinks.addEventListener('click', event => {
            if (!MOBILE_QUERY.matches) return;
            const dropdownToggle = event.target.closest('.nav-item > a');
            if (dropdownToggle && dropdownToggle.parentElement.querySelector('.dropdown')) return;
            if (event.target.closest('a')) closeMenu();
        });

        document.addEventListener('click', event => {
            if (MOBILE_QUERY.matches && !navbar.contains(event.target)) closeMenu();
        });

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeMenu();
        });

        MOBILE_QUERY.addEventListener('change', event => {
            if (!event.matches) closeMenu();
        });
    });

    // Sinkronkan tinggi fixed .admin-topbar ke padding-top .admin-main di semua menu admin
    const adminTopbar = document.querySelector('.admin-topbar');
    const adminMain = document.querySelector('.admin-main');
    if (adminTopbar && adminMain) {
        const syncTopbarHeight = () => {
            const h = Math.ceil(adminTopbar.getBoundingClientRect().height);
            if (h > 0) adminMain.style.setProperty('--admin-topbar-h', h + 'px');
        };
        syncTopbarHeight();
        window.addEventListener('resize', syncTopbarHeight);
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(syncTopbarHeight).observe(adminTopbar);
        }
    }
})();
