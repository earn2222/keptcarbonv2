"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Auth } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { ready, user, refresh } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    if (ready && user) router.replace("/dashboard");
  }, [ready, user, router]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setTimeout(() => {
      const result = Auth.login(email.trim(), password);
      if (result.success) {
        refresh();
        setAlert({ type: "success", msg: "เข้าสู่ระบบสำเร็จ — กำลังพาคุณไปยังแดชบอร์ด" });
        setTimeout(() => router.push("/dashboard"), 800);
      } else {
        setAlert({ type: "error", msg: result.message });
        setBusy(false);
      }
    }, 600);
  };

  return (
    <div className="auth-card">
      <div className="auth-card-header">
        <img src="/assets/img/keptcarbon-logo.png" alt="KeptCarbon" />
        <div className="auth-card-eyebrow">
          <i className="bi bi-shield-check"></i> เข้าใช้งานบัญชี
        </div>
        <h1 className="auth-card-title">
          ยินดี<span className="kc-grad-text">ต้อนรับกลับ</span>
        </h1>
        <div className="auth-card-divider">
          <div className="line"></div>
          <div className="dash"></div>
          <div className="line"></div>
        </div>
        <p className="auth-card-sub">
          เข้าสู่ระบบเพื่อจัดการสวนยางพาราและคาร์บอนเครดิตของคุณ
        </p>
      </div>

      {alert && (
        <div className={`auth-alert-box ${alert.type}`}>
          <i
            className={`bi bi-${alert.type === "success" ? "check-circle-fill" : "exclamation-triangle-fill"}`}
          ></i>
          <span>{alert.msg}</span>
        </div>
      )}

      <form className="auth-form" onSubmit={onSubmit} autoComplete="on">
        <div>
          <label htmlFor="login-email" className="auth-field-label">
            อีเมล
          </label>
          <div className="auth-input-wrap">
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="คุณ@example.com"
              required
              autoComplete="email"
            />
            <i className="bi bi-envelope"></i>
          </div>
        </div>

        <div>
          <label htmlFor="login-password" className="auth-field-label">
            รหัสผ่าน
          </label>
          <div className="auth-input-wrap">
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="กรอกรหัสผ่าน"
              required
              autoComplete="current-password"
            />
            <i className="bi bi-lock"></i>
          </div>
        </div>

        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? <div className="auth-spin" /> : <i className="bi bi-box-arrow-in-right"></i>}
          <span>{busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}</span>
        </button>
      </form>

      <div className="auth-or">หรือ</div>

      <div className="auth-switch">
        ยังไม่มีบัญชี? <Link href="/register">สมัครสมาชิกใหม่ →</Link>
      </div>
    </div>
  );
}
