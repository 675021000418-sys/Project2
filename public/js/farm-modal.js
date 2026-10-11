// ระบบกล่องข้อความแจ้งเตือนและยืนยันแบบคัสตอม (Custom Dialog Modal)
// สวยงาม เข้ากับธีมธรรมชาติของเว็บ รองรับทั้ง Light และ Dark Mode
(function () {
  // สร้าง DOM Modal โครงสร้างเดียวไว้ใช้งานทั่วทั้งเว็บ
  function initModalDOM() {
    if (document.getElementById('farmConfirmModal')) return;

    const modalHTML = `
      <div class="modal fade" id="farmConfirmModal" tabindex="-1" aria-hidden="true" style="z-index: 1060;">
        <div class="modal-dialog modal-dialog-centered" style="max-width: 440px;">
          <div class="modal-content border-0 shadow-lg" style="border-radius: 16px; overflow: hidden; background: var(--card-bg, #ffffff);">
            <div class="modal-body p-4 text-center">
              <div id="farmModalIconWrapper" class="mb-3 d-inline-flex align-items-center justify-content-center" style="width: 64px; height: 64px; border-radius: 50%; font-size: 2rem;">
                <span id="farmModalIcon">⚠️</span>
              </div>
              <h5 class="modal-title fw-bold mb-2" id="farmModalTitle" style="color: var(--text-main, #264653);">ยืนยันการดำเนินการ</h5>
              <p class="mb-0 text-muted" id="farmModalMessage" style="font-size: 0.95rem; line-height: 1.6; white-space: pre-line;"></p>
            </div>
            <div class="modal-footer border-0 p-3 pt-0 justify-content-center gap-2">
              <button type="button" class="btn btn-outline-secondary px-4 py-2" id="farmModalCancelBtn" style="border-radius: 10px; font-weight: 500;">
                ยกเลิก
              </button>
              <button type="button" class="btn btn-danger px-4 py-2 shadow-sm" id="farmModalConfirmBtn" style="border-radius: 10px; font-weight: 600;">
                ยืนยัน
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
  }

  /**
   * ฟังก์ชันเปิด Modal ถามยืนยัน
   * @param {Object} options 
   * @param {string} options.title - หัวข้อ (เช่น 'ยืนยันการลบ')
   * @param {string} options.message - ข้อความรายละเอียด
   * @param {string} options.type - 'danger' | 'warning' | 'info' | 'success'
   * @param {string} options.confirmText - ข้อความปุ่มยืนยัน
   * @param {string} options.cancelText - ข้อความปุ่มยกเลิก
   * @returns {Promise<boolean>}
   */
  window.farmConfirm = function (options = {}) {
    initModalDOM();
    const modalEl = document.getElementById('farmConfirmModal');
    const bsModal = new bootstrap.Modal(modalEl, { backdrop: 'static', keyboard: false });

    const titleEl = document.getElementById('farmModalTitle');
    const msgEl = document.getElementById('farmModalMessage');
    const iconWrapper = document.getElementById('farmModalIconWrapper');
    const iconEl = document.getElementById('farmModalIcon');
    const cancelBtn = document.getElementById('farmModalCancelBtn');
    const confirmBtn = document.getElementById('farmModalConfirmBtn');

    titleEl.textContent = options.title || 'ยืนยันการทำรายการ';
    msgEl.textContent = options.message || 'คุณแน่ใจหรือไม่ว่าต้องการดำเนินการนี้?';
    cancelBtn.textContent = options.cancelText || 'ยกเลิก';
    confirmBtn.textContent = options.confirmText || 'ยืนยัน';

    // จัดสไตล์ตามประเภท (Type)
    const type = options.type || 'danger';
    if (type === 'danger') {
      iconWrapper.style.backgroundColor = 'rgba(192, 57, 43, 0.12)';
      iconWrapper.style.color = '#C0392B';
      iconEl.textContent = options.icon || '🗑️';
      confirmBtn.className = 'btn btn-danger px-4 py-2 shadow-sm';
      confirmBtn.style.backgroundColor = '#C0392B';
      confirmBtn.style.borderColor = '#C0392B';
    } else if (type === 'warning') {
      iconWrapper.style.backgroundColor = 'rgba(233, 162, 59, 0.15)';
      iconWrapper.style.color = '#E9A23B';
      iconEl.textContent = options.icon || '⚠️';
      confirmBtn.className = 'btn btn-warning text-dark px-4 py-2 shadow-sm';
      confirmBtn.style.backgroundColor = '#E9A23B';
      confirmBtn.style.borderColor = '#E9A23B';
    } else {
      iconWrapper.style.backgroundColor = 'rgba(45, 106, 79, 0.12)';
      iconWrapper.style.color = '#2D6A4F';
      iconEl.textContent = options.icon || '🌿';
      confirmBtn.className = 'btn btn-primary px-4 py-2 shadow-sm';
      confirmBtn.style.backgroundColor = '#2D6A4F';
      confirmBtn.style.borderColor = '#2D6A4F';
    }

    if (options.hideCancel) {
      cancelBtn.style.display = 'none';
    } else {
      cancelBtn.style.display = 'inline-block';
    }

    return new Promise((resolve) => {
      let isResolved = false;

      function onConfirm() {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          bsModal.hide();
          resolve(true);
        }
      }

      function onCancel() {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          bsModal.hide();
          resolve(false);
        }
      }

      function cleanup() {
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        modalEl.removeEventListener('hidden.bs.modal', onCancel);
      }

      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
      modalEl.addEventListener('hidden.bs.modal', onCancel, { once: true });

      bsModal.show();
    });
  };

  /**
   * ฟังก์ชันแจ้งเตือน Modal สวยงามแทน alert
   */
  window.farmAlert = function (message, title = 'แจ้งเตือน', type = 'info') {
    return window.farmConfirm({
      title: title,
      message: message,
      type: type,
      icon: type === 'danger' ? '❌' : (type === 'success' ? '✅' : 'ℹ️'),
      confirmText: 'ตกลง',
      hideCancel: true
    });
  };
})();
