/**
 * KeptCarbon Dynamic Navbar
 * Renders different navbars based on authentication state
 */

(function () {
  // Wait for DOM
  document.addEventListener('DOMContentLoaded', function () {
    renderNavbar();
  });

  function renderNavbar() {
    const user = Auth.getUser();
    const navmenu = document.getElementById('navmenu');
    const navButtons = document.getElementById('nav-buttons');
    if (!navmenu) return;

    const currentPage = window.location.pathname.split('/').pop() || 'index.html';

    if (!user) {
      // Guest navbar
      navmenu.innerHTML = `
        <ul>
          <li><a href="index.html" ${currentPage === 'index.html' ? 'class="active"' : ''}>หน้าแรก</a></li>
          <li><a href="index.html#about">เกี่ยวกับเรา</a></li>
          <li><a href="index.html#features">คุณสมบัติ</a></li>
          <li><a href="index.html#contact">ติดต่อเรา</a></li>
        </ul>
        <i class="mobile-nav-toggle d-xl-none bi bi-list"></i>
      `;
      if (navButtons) {
        navButtons.innerHTML = `
          <a class="btn-login" href="login.html">เข้าสู่ระบบ</a>
          <a class="btn-getstarted" href="register.html">สมัครสมาชิก</a>
        `;
      }
    } else {
      // Authenticated navbar
      navmenu.innerHTML = `
        <ul>
          <li><a href="dashboard.html" ${currentPage === 'dashboard.html' ? 'class="active"' : ''}>แดชบอร์ด</a></li>
          <li><a href="map-draw.html" ${currentPage === 'map-draw.html' ? 'class="active"' : ''}>วาดแปลงยาง</a></li>
          <li><a href="my-plots.html" ${currentPage === 'my-plots.html' ? 'class="active"' : ''}>แปลงของฉัน</a></li>
          <li><a href="profile.html" ${currentPage === 'profile.html' ? 'class="active"' : ''}>โปรไฟล์</a></li>
        </ul>
        <i class="mobile-nav-toggle d-xl-none bi bi-list"></i>
      `;
      if (navButtons) {
        navButtons.innerHTML = `
          <span class="nav-username"><i class="bi bi-person-circle me-1"></i>${user.fullname}</span>
          <a class="btn-logout" href="#" onclick="Auth.logout(); return false;">ออกจากระบบ</a>
        `;
      }
    }
  }
})();
