document.querySelectorAll('.navbar').forEach(navbar => {
    const menuToggle = navbar.querySelector('.menu-toggle');
    const navLinks = navbar.querySelector('.nav-links');

    if (!menuToggle || !navLinks) return;

    const closeMenu = () => {
        navLinks.classList.remove('active');
        menuToggle.classList.remove('active');
        menuToggle.setAttribute('aria-expanded', 'false');
        navbar.querySelectorAll('.nav-item.open').forEach(item => {
            item.classList.remove('open');
            item.querySelector(':scope > a').setAttribute('aria-expanded', 'false');
        });
    };

    menuToggle.addEventListener('click', () => {
        const isOpen = navLinks.classList.toggle('active');
        menuToggle.classList.toggle('active', isOpen);
        menuToggle.setAttribute('aria-expanded', String(isOpen));
    });

    navbar.querySelectorAll('.nav-item > a').forEach(link => {
        const dropdown = link.parentElement.querySelector('.dropdown');
        if (!dropdown) return;

        link.setAttribute('aria-expanded', 'false');
        link.addEventListener('click', event => {
            if (window.matchMedia('(max-width: 768px)').matches) {
                event.preventDefault();
                const isOpen = link.parentElement.classList.toggle('open');
                link.setAttribute('aria-expanded', String(isOpen));
            }
        });
    });

    navLinks.addEventListener('click', event => {
        if (!window.matchMedia('(max-width: 768px)').matches) return;
        const dropdownToggle = event.target.closest('.nav-item > a');
        if (dropdownToggle && dropdownToggle.parentElement.querySelector('.dropdown')) return;
        if (event.target.closest('a')) closeMenu();
    });

    document.addEventListener('click', event => {
        if (window.matchMedia('(max-width: 768px)').matches && !navbar.contains(event.target)) {
            closeMenu();
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeMenu();
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) closeMenu();
    });
});
