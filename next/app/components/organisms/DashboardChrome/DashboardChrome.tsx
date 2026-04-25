"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

const navItems = [
  { href: "/", icon: "bi-house", label: "หน้าหลัก" },
  { href: "/dashboard", icon: "bi-grid-1x2", label: "แดชบอร์ด" },
  { href: "/map-draw", icon: "bi-pencil-square", label: "วาดแปลง", section: "จัดการพื้นที่" },
  { href: "/my-plots", icon: "bi-collection", label: "แปลงของฉัน" },
  { href: "/profile", icon: "bi-person-circle", label: "โปรไฟล์", section: "ตั้งค่าบัญชี" },
] as const;

function initials(name: string | undefined) {
  if (!name) return "·";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

export default function DashboardChrome({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Tint the body so the cream gradient stretches behind the page
  useEffect(() => {
    document.body.classList.add("dashboard-active");
    return () => document.body.classList.remove("dashboard-active");
  }, []);

  const close = () => setSidebarOpen(false);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onClick = (e: MouseEvent) => {
      const sidebar = document.getElementById("sidebar-menu");
      const toggle = document.getElementById("sidebar-toggle-btn");
      const target = e.target as Node;
      if (
        sidebar &&
        !sidebar.contains(target) &&
        (!toggle || !toggle.contains(target))
      ) {
        close();
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [sidebarOpen]);

  const onLogout = () => {
    logout();
    router.push("/");
  };

  return (
    <>
      <div id="topbar">
        <div className="topbar-left">
          <button
            id="sidebar-toggle-btn"
            className="icon-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle sidebar"
          >
            <i className="bi bi-list" />
          </button>
          <Link href="/" className="topbar-brand">
            <img src="/assets/img/keptcarbon-logo.png" alt="KeptCarbon" />
            <span className="name">
              Kept<span>Carbon</span>
            </span>
          </Link>
        </div>
        <div className="topbar-right">
          {user && (
            <div className="topbar-user">
              <span className="avatar">{initials(user.fullname).toUpperCase()}</span>
              <span>{user.fullname}</span>
            </div>
          )}
          <button className="icon-btn" onClick={onLogout} aria-label="Logout" title="ออกจากระบบ">
            <i className="bi bi-box-arrow-right" />
          </button>
        </div>
      </div>

      <div id="sidebar-menu" className={sidebarOpen ? "open" : ""}>
        <div className="sidebar-header">
          <div className="brand-block">
            <img src="/assets/img/keptcarbon-logo.png" alt="Kept Carbon" />
            <div className="brand">
              Kept<span>Carbon</span>
            </div>
          </div>
          <button
            className="btn-close-sidebar"
            onClick={close}
            aria-label="Close sidebar"
          >
            ✕
          </button>
        </div>
        <div className="sidebar-nav">
          {navItems.map((item) => (
            <div key={item.href}>
              {"section" in item && item.section && (
                <div className="sidebar-nav-title">{item.section}</div>
              )}
              <Link
                href={item.href}
                className={pathname === item.href ? "active" : ""}
                onClick={close}
              >
                <i className={`bi ${item.icon}`} /> {item.label}
              </Link>
            </div>
          ))}
          <div className="sidebar-nav-title">เซสชัน</div>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              close();
              onLogout();
            }}
          >
            <i className="bi bi-box-arrow-right" /> ออกจากระบบ
          </a>
        </div>
        <div className="sidebar-footer">
          <i className="bi bi-tree-fill" />
          <br />
          ระบบประเมินคาร์บอนเครดิต
          <br />
          สวนยางพารายั่งยืน
        </div>
      </div>

      <main className="dashboard-page">{children}</main>
    </>
  );
}
