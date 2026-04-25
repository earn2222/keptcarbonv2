"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function Header() {
  const router = useRouter();
  const { ready, user, openLogin, openRegister, logout } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 100);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("scrolled", scrolled);
  }, [scrolled]);

  useEffect(() => {
    document.body.classList.toggle("mobile-nav-active", navOpen);
  }, [navOpen]);

  const closeNav = () => setNavOpen(false);
  const onLogout = () => {
    logout();
    closeNav();
    router.push("/");
  };

  return (
    <header id="header" className="header d-flex align-items-center fixed-top">
      <div className="container-fluid container-xl position-relative d-flex align-items-center">
        <Link href="/" className="logo d-flex align-items-center me-auto">
          <img src="/assets/img/keptcarbon-logo.png" alt="Kept Carbon Logo" />
        </Link>

        <nav id="navmenu" className="navmenu">
          {ready && user ? (
            <ul>
              <li>
                <Link href="/dashboard" onClick={closeNav}>
                  แดชบอร์ด
                </Link>
              </li>
              <li>
                <Link href="/map-draw" onClick={closeNav}>
                  วาดแปลงยาง
                </Link>
              </li>
              <li>
                <Link href="/my-plots" onClick={closeNav}>
                  แปลงของฉัน
                </Link>
              </li>
              <li>
                <Link href="/profile" onClick={closeNav}>
                  โปรไฟล์
                </Link>
              </li>
              <li className="d-xl-none">
                <div className="mobile-auth-divider"></div>
              </li>
              <li className="d-xl-none">
                <div className="mobile-auth-buttons">
                  <div className="mobile-user-info">
                    <i className="bi bi-person-circle"></i> {user.fullname}
                  </div>
                  <a
                    className="mobile-btn-logout"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      onLogout();
                    }}
                  >
                    <i className="bi bi-box-arrow-right"></i> ออกจากระบบ
                  </a>
                </div>
              </li>
            </ul>
          ) : (
            <ul>
              <li>
                <a href="#hero" onClick={closeNav} className="active">
                  หน้าแรก
                </a>
              </li>
              <li>
                <a href="#project-about" onClick={closeNav}>
                  เกี่ยวกับโครงการ
                </a>
              </li>
              <li>
                <a href="#team" onClick={closeNav}>
                  ทีมงานของเรา
                </a>
              </li>
              <li>
                <a href="#contact" onClick={closeNav}>
                  ติดต่อเรา
                </a>
              </li>
              <li className="d-xl-none">
                <div className="mobile-auth-divider"></div>
              </li>
              <li className="d-xl-none">
                <div className="mobile-auth-buttons">
                  <a
                    className="mobile-btn-login"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      closeNav();
                      openLogin();
                    }}
                  >
                    <i className="bi bi-box-arrow-in-right"></i> เข้าสู่ระบบ
                  </a>
                  <a
                    className="mobile-btn-register"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      closeNav();
                      openRegister();
                    }}
                  >
                    <i className="bi bi-person-plus"></i> สมัครสมาชิก
                  </a>
                </div>
              </li>
            </ul>
          )}
          <i
            className={`mobile-nav-toggle d-xl-none bi ${navOpen ? "bi-x-lg" : "bi-list"}`}
            onClick={() => setNavOpen((v) => !v)}
          ></i>
        </nav>

        <div id="nav-buttons" className="d-flex align-items-center ms-3">
          {ready && user ? (
            <>
              <span className="nav-username">
                <i className="bi bi-person-circle me-1"></i>
                {user.fullname}
              </span>
              <a
                className="btn-logout"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onLogout();
                }}
              >
                ออกจากระบบ
              </a>
            </>
          ) : (
            <>
              <a
                className="btn-login"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  openLogin();
                }}
              >
                เข้าสู่ระบบ
              </a>
              <a
                className="btn-getstarted"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  openRegister();
                }}
              >
                สมัครสมาชิก
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
