"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function Header() {
  const router = useRouter();
  const { ready, user, openLogin, openRegister, logout } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [homeDropdownOpen, setHomeDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
              <li className="dropdown">
                <Link
                  href="/"
                  className={homeDropdownOpen ? "active" : ""}
                >
                  <span onClick={closeNav}>หน้าแรก</span>
                  <i
                    className="bi bi-chevron-down toggle-dropdown"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setHomeDropdownOpen(!homeDropdownOpen);
                    }}
                  ></i>
                </Link>
                <ul className={homeDropdownOpen ? "dropdown-active" : ""}>
                  <li>
                    <a href="/#project-about" onClick={closeNav}>เกี่ยวกับโครงการ</a>
                  </li>
                  <li>
                    <a href="/#team" onClick={closeNav}>ทีมงานของเรา</a>
                  </li>
                  <li>
                    <a href="/#contact" onClick={closeNav}>ติดต่อเรา</a>
                  </li>
                </ul>
              </li>
              <li>
                <Link href="/dashboard" onClick={closeNav}>
                  แดชบอร์ด
                </Link>
              </li>
              <li>
                <Link href="/map-draw" onClick={closeNav}>
                  คำนวณคาร์บอน
                </Link>
              </li>
              <li>
                <Link href="/my-plots" onClick={closeNav}>
                  แปลงของฉัน
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
                  <Link
                    href="/profile"
                    className="mobile-btn-profile"
                    style={{ display: "block", padding: "10px 15px", color: "var(--heading-color)", textDecoration: "none", fontSize: "15px", borderBottom: "1px solid rgba(0,0,0,0.05)" }}
                    onClick={closeNav}
                  >
                    <i className="bi bi-person me-2"></i> โปรไฟล์
                  </Link>
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
              <li className="dropdown">
                <Link
                  href="/"
                  className={homeDropdownOpen ? "active" : ""}
                >
                  <span onClick={closeNav}>หน้าแรก</span>
                  <i
                    className="bi bi-chevron-down toggle-dropdown"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setHomeDropdownOpen(!homeDropdownOpen);
                    }}
                  ></i>
                </Link>
                <ul className={homeDropdownOpen ? "dropdown-active" : ""}>
                  <li>
                    <a href="/#project-about" onClick={closeNav}>เกี่ยวกับโครงการ</a>
                  </li>
                  <li>
                    <a href="/#team" onClick={closeNav}>ทีมงานของเรา</a>
                  </li>
                  <li>
                    <a href="/#contact" onClick={closeNav}>ติดต่อเรา</a>
                  </li>
                </ul>
              </li>
              <li>
                <Link href="/dashboard" onClick={closeNav}>
                  แดชบอร์ด
                </Link>
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
            <div className="position-relative" ref={dropdownRef}>
              <a
                href="#"
                className="d-flex align-items-center text-decoration-none"
                onClick={(e) => {
                  e.preventDefault();
                  setDropdownOpen(!dropdownOpen);
                }}
              >
                {user.pictureUrl ? (
                  <img
                    src={user.pictureUrl}
                    alt={user.fullname}
                    style={{
                      width: "38px",
                      height: "38px",
                      borderRadius: "50%",
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <div
                    className="d-flex align-items-center justify-content-center text-white"
                    style={{
                      width: "38px",
                      height: "38px",
                      borderRadius: "50%",
                      backgroundColor: "var(--color-primary, #2d9e5f)",
                      fontWeight: "600",
                      fontSize: "16px",
                    }}
                  >
                    {(user.fullname?.[0] ?? "U").toUpperCase()}
                  </div>
                )}
              </a>

              {dropdownOpen && (
                <ul
                  className="dropdown-menu show dropdown-menu-end shadow"
                  style={{ position: "absolute", top: "100%", right: 0, marginTop: "10px", border: "none", borderRadius: "10px", minWidth: "160px" }}
                >
                  <li>
                    <a
                      href="#"
                      className="dropdown-item d-flex align-items-center py-2"
                      onClick={(e) => {
                        e.preventDefault();
                        setDropdownOpen(false);
                        router.push("/profile");
                      }}
                    >
                      <i className="bi bi-person me-2 fs-5 text-secondary"></i> โปรไฟล์
                    </a>
                  </li>
                  {user.role === "admin" && (
                    <>
                      <li><hr className="dropdown-divider my-1" /></li>
                      <li>
                        <a
                          href="#"
                          className="dropdown-item d-flex align-items-center py-2"
                          onClick={(e) => {
                            e.preventDefault();
                            setDropdownOpen(false);
                            router.push("/admin/users");
                          }}
                        >
                          <i className="bi bi-people me-2 fs-5 text-secondary"></i> จัดการผู้ใช้
                        </a>
                      </li>
                      <li>
                        <a
                          href="#"
                          className="dropdown-item d-flex align-items-center py-2"
                          onClick={(e) => {
                            e.preventDefault();
                            setDropdownOpen(false);
                            router.push("/admin/rubber-age");
                          }}
                        >
                          <i className="bi bi-tree me-2 fs-5 text-secondary"></i> คำนวณอายุยาง
                        </a>
                      </li>
                    </>
                  )}
                  <li><hr className="dropdown-divider my-1" /></li>
                  <li>
                    <a
                      className="dropdown-item d-flex align-items-center py-2 text-danger"
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setDropdownOpen(false);
                        onLogout();
                      }}
                    >
                      <i className="bi bi-box-arrow-right me-2 fs-5"></i> ออกจากระบบ
                    </a>
                  </li>
                </ul>
              )}
            </div>
          ) : (
            <>
              <a
                className="btn-getstarted"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  openLogin();
                }}
              >
                เข้าสู่ระบบ
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
