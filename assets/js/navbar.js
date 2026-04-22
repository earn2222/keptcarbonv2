/**
 * KeptCarbon Dynamic Navbar
 * Renders different navbars based on authentication state
 * Unified Sidebar Mobile Menu for all pages
 */

(function () {
  document.addEventListener('DOMContentLoaded', function () {
    renderNavbar();
  });

  window.openSidebar = function() {
    const sidebar = document.getElementById('sidebar-menu');
    const overlay = document.querySelector('.sidebar-overlay');
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
  };

  window.closeSidebar = function() {
    const sidebar = document.getElementById('sidebar-menu');
    const overlay = document.querySelector('.sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    document.body.style.overflow = '';
  };

  function renderNavbar() {
    const user = Auth.getUser();
    const navmenu = document.getElementById('navmenu');
    const navButtons = document.getElementById('nav-buttons');
    if (!navmenu) return;

    const currentPage = window.location.pathname.split('/').pop() || 'index.html';

    // ─── DESKTOP NAVBAR CONTENT ───
    if (!user) {
      navmenu.innerHTML = `
        <ul>
          <li><a href="index.html" ${currentPage === 'index.html' || currentPage === '' ? 'class="active"' : ''}>หน้าแรก</a></li>
          <li><a href="index.html#project-about">เกี่ยวกับโครงการ</a></li>
          <li><a href="index.html#team">ทีมงานของเรา</a></li>
          <li><a href="index.html#contact">ติดต่อเรา</a></li>
        </ul>
        <i class="mobile-nav-toggle d-xl-none bi bi-list"></i>
      `;
      if (navButtons) {
        navButtons.innerHTML = `
          <a class="btn-login" href="#" data-bs-toggle="modal" data-bs-target="#loginModal">เข้าสู่ระบบ</a>
          <a class="btn-getstarted" href="#" data-bs-toggle="modal" data-bs-target="#registerModal">สมัครสมาชิก</a>
        `;
      }
    } else {
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

    // ─── INJECT SIDEBAR & OVERLAY ───
    injectSidebar(user, currentPage);

    // Re-bind mobile nav toggle with a slight delay to ensure DOM is settled
    setTimeout(bindMobileNavToggle, 50);
  }

  function injectSidebar(user, currentPage) {
    // Remove existing if any
    const oldSidebar = document.getElementById('sidebar-menu');
    const oldOverlay = document.querySelector('.sidebar-overlay');
    if (oldSidebar) oldSidebar.remove();
    if (oldOverlay) oldOverlay.remove();

    const sidebar = document.createElement('div');
    sidebar.id = 'sidebar-menu';
    
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.onclick = window.closeSidebar;

    let navHtml = '';
    if (!user) {
      navHtml = `
        <div class="sidebar-nav-title">เมนูหลัก</div>
        <a href="index.html" ${currentPage === 'index.html' || currentPage === '' ? 'class="active"' : ''} onclick="closeSidebar()"><i class="bi bi-house"></i> หน้าแรก</a>
        <a href="index.html#project-about" onclick="closeSidebar()"><i class="bi bi-info-circle"></i> เกี่ยวกับโครงการ</a>
        <a href="index.html#team" onclick="closeSidebar()"><i class="bi bi-people"></i> ทีมงานของเรา</a>
        <a href="index.html#contact" onclick="closeSidebar()"><i class="bi bi-envelope"></i> ติดต่อเรา</a>
        <div class="sidebar-nav-title">บัญชีผู้ใช้</div>
        <a href="#" data-bs-toggle="modal" data-bs-target="#loginModal" onclick="closeSidebar()"><i class="bi bi-box-arrow-in-right"></i> เข้าสู่ระบบ</a>
        <a href="#" data-bs-toggle="modal" data-bs-target="#registerModal" onclick="closeSidebar()"><i class="bi bi-person-plus"></i> สมัครสมาชิก</a>
      `;
    } else {
      navHtml = `
        <div class="sidebar-nav-title">เมนูหลัก</div>
        <a href="index.html" onclick="closeSidebar()"><i class="bi bi-house"></i> หน้าหลัก</a>
        <div class="sidebar-nav-title">จัดการพื้นที่</div>
        <a href="dashboard.html" ${currentPage === 'dashboard.html' ? 'class="active"' : ''} onclick="closeSidebar()"><i class="bi bi-grid-1x2"></i> แดชบอร์ด</a>
        <a href="map-draw.html" ${currentPage === 'map-draw.html' ? 'class="active"' : ''} onclick="closeSidebar()"><i class="bi bi-map"></i> วาดแปลงยาง</a>
        <a href="my-plots.html" ${currentPage === 'my-plots.html' ? 'class="active"' : ''} onclick="closeSidebar()"><i class="bi bi-collection"></i> แปลงของฉัน</a>
        <div class="sidebar-nav-title">ตั้งค่าบัญชี</div>
        <a href="profile.html" ${currentPage === 'profile.html' ? 'class="active"' : ''} onclick="closeSidebar()"><i class="bi bi-person-circle"></i> โปรไฟล์</a>
        <a href="#" onclick="Auth.logout(); return false;"><i class="bi bi-box-arrow-right"></i> ออกจากระบบ</a>
      `;
    }

    sidebar.innerHTML = `
      <div class="sidebar-header">
        <div style="display:flex;align-items:center;">
          <img src="assets/img/keptcarbon-logo.png" alt="Kept Carbon" style="height: 32px;">
          <div class="brand">KeptCarbon</div>
        </div>
        <button class="btn-close-sidebar" onclick="closeSidebar()">✕</button>
      </div>
      <div class="sidebar-nav">
        ${navHtml}
      </div>
      <div class="sidebar-footer">
        <i class="bi bi-tree"></i><br>ระบบประเมินคาร์บอนเครดิต<br>สวนยางพารายั่งยืน
      </div>
    `;

    document.body.appendChild(sidebar);
    document.body.appendChild(overlay);
  }

  function bindMobileNavToggle() {
    const btn = document.querySelector('.mobile-nav-toggle');
    if (!btn) return;

    // Mark as bound so main.js skips duplicate binding
    btn.dataset.bound = 'true';

    // Remove any existing listeners by cloning
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      window.openSidebar();
    });
  }
})();
