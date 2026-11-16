(() => {
    const form = document.querySelector('.gallery-upload-form[data-cloud-upload="true"]');
    if (!form) return;

    const fileInput = form.querySelector('input[name="fotoGaleri"]');
    const submitButton = form.querySelector('button[type="submit"]');
    const status = form.querySelector('.gallery-upload-status');
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const maxFileSize = 3 * 1024 * 1024;

    form.addEventListener('submit', async event => {
        event.preventDefault();
        const files = Array.from(fileInput.files || []);

        if (files.length === 0 || files.length > 10) {
            status.textContent = 'Pilih 1 sampai 10 foto untuk diunggah.';
            return;
        }

        if (files.some(file => !allowedTypes.has(file.type) || file.size > maxFileSize)) {
            status.textContent = 'Gunakan foto JPEG, PNG, atau WebP dengan ukuran maksimal 3 MB per foto.';
            return;
        }

        const uploadedUrls = [];
        submitButton.disabled = true;

        try {
            for (let index = 0; index < files.length; index += 1) {
                status.textContent = `Mengunggah foto ${index + 1} dari ${files.length}...`;
                const body = new FormData();
                body.append('fotoGaleri', files[index]);

                const response = await fetch('/admin/upload-galeri-file', {
                    method: 'POST',
                    body,
                    credentials: 'same-origin'
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result.url) {
                    throw new Error(result.error || 'Gagal mengunggah foto galeri.');
                }
                uploadedUrls.push(result.url);
            }

            status.textContent = 'Menyimpan dokumentasi...';
            const body = new URLSearchParams();
            body.set('judul', form.elements.judul.value.trim());
            body.set('deskripsi', form.elements.deskripsi.value.trim());
            body.set('fotoUrls', JSON.stringify(uploadedUrls));

            const response = await fetch('/admin/tambah-galeri-remote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                body,
                credentials: 'same-origin'
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.redirect) {
                throw new Error(result.error || 'Gagal menyimpan dokumentasi galeri.');
            }

            window.location.assign(result.redirect);
        } catch (error) {
            if (uploadedUrls.length > 0) {
                try {
                    const cleanupBody = new URLSearchParams();
                    cleanupBody.set('fotoUrls', JSON.stringify(uploadedUrls));
                    const cleanupResponse = await fetch('/admin/hapus-upload-galeri-temp', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                        body: cleanupBody,
                        credentials: 'same-origin'
                    });
                    if (!cleanupResponse.ok) {
                        console.error('Gagal membersihkan foto galeri yang belum tersimpan.');
                    }
                } catch (cleanupError) {
                    console.error('Gagal membersihkan foto galeri yang belum tersimpan:', cleanupError);
                }
            }

            status.textContent = error.message || 'Unggahan galeri gagal. Silakan coba lagi.';
            submitButton.disabled = false;
        }
    });
})();
