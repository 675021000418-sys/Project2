// สคริปต์จัดการ Dark Mode / Light Mode ทั้งเว็บ
(function () {
  // ดึงค่าธีมที่บันทึกไว้ใน localStorage หรือค่าตั้งต้นระบบ
  function getPreferredTheme() {
    const storedTheme = localStorage.getItem('farm-theme');
    if (storedTheme) {
      return storedTheme;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // ปรับใช้ธีมบน <html> tag
  function setTheme(theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    localStorage.setItem('farm-theme', theme);
    updateToggleIcons(theme);
  }

  // อัปเดตไอคอนบนปุ่ม
  function updateToggleIcons(theme) {
    const buttons = document.querySelectorAll('.theme-toggle-btn');
    buttons.forEach(btn => {
      if (theme === 'dark') {
        btn.innerHTML = '☀️';
        btn.setAttribute('title', 'เปลี่ยนเป็นโหมดสว่าง (Light Mode)');
        btn.setAttribute('aria-label', 'เปลี่ยนเป็นโหมดสว่าง');
      } else {
        btn.innerHTML = '🌙';
        btn.setAttribute('title', 'เปลี่ยนเป็นโหมดมืด (Dark Mode)');
        btn.setAttribute('aria-label', 'เปลี่ยนเป็นโหมดมืด');
      }
    });
  }

  // กำหนดธีมทันทีที่โหลดสคริปต์ ป้องกันหน้าจอกระพริบ
  const currentTheme = getPreferredTheme();
  setTheme(currentTheme);

  // ฟังก์ชันสลับธีม Global
  window.toggleTheme = function () {
    const activeTheme = document.documentElement.getAttribute('data-bs-theme');
    const newTheme = activeTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
  };

  // รอ DOM โหลดเสร็จเพื่ออัปเดตไอคอน
  document.addEventListener('DOMContentLoaded', () => {
    updateToggleIcons(document.documentElement.getAttribute('data-bs-theme') || 'light');
  });
})();
