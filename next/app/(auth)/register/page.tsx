"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Auth } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";

function strengthFor(len: number): { width: string; color: string } {
  if (len === 0) return { width: "0%", color: "transparent" };
  if (len < 4) return { width: "25%", color: "#ef4444" };
  if (len < 6) return { width: "50%", color: "#f97316" };
  if (len < 10) return { width: "75%", color: "#eab308" };
  return { width: "100%", color: "#22c55e" };
}

export default function RegisterPage() {
  const router = useRouter();
  const { ready, user, refresh } = useAuth();

  const [fullname, setFullname] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    if (ready && user) router.replace("/dashboard");
  }, [ready, user, router]);

  const strength = strengthFor(password.length);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPwd) {
      setAlert({ type: "error", msg: "รหัสผ่านไม่ตรงกัน กรุณาตรวจสอบอีกครั้ง" });
      return;
    }
    setBusy(true);
    setTimeout(() => {
      const result = Auth.register({ fullname, email: email.trim(), phone, password });
      if (result.success) {
        Auth.login(email.trim(), password);
        refresh();
        setAlert({ type: "success", msg: "สมัครสมาชิกสำเร็จ — กำลังพาคุณไปยังแดชบอร์ด" });
        setTimeout(() => router.push("/dashboard"), 900);
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
          <i className="bi bi-stars"></i> เริ่มต้นใช้งาน
        </div>
        <h1 className="auth-card-title">
          สมัคร<span className="kc-grad-text">สมาชิก</span>
        </h1>
        <div className="auth-card-divider">
          <div className="line"></div>
          <div className="dash"></div>
          <div className="line"></div>
        </div>
        <p className="auth-card-sub">
          สร้างบัญชีเพื่อจัดการสวนยางพาราและประเมินคาร์บอนเครดิตในระดับรายแปลง
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
          <label htmlFor="reg-fullname" className="auth-field-label">
            ชื่อ-นามสกุล
          </label>
          <div className="auth-input-wrap">
            <input
              id="reg-fullname"
              type="text"
              value={fullname}
              onChange={(e) => setFullname(e.target.value)}
              placeholder="กรอกชื่อ-นามสกุล"
              required
              autoComplete="name"
            />
            <i className="bi bi-person"></i>
          </div>
        </div>

        <div className="auth-form-row">
          <div>
            <label htmlFor="reg-email" className="auth-field-label">
              อีเมล
            </label>
            <div className="auth-input-wrap">
              <input
                id="reg-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                required
                autoComplete="email"
              />
              <i className="bi bi-envelope"></i>
            </div>
          </div>
          <div>
            <label htmlFor="reg-phone" className="auth-field-label">
              เบอร์โทร <span style={{ color: "#94a3a0", fontWeight: 500 }}>(ไม่บังคับ)</span>
            </label>
            <div className="auth-input-wrap">
              <input
                id="reg-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="08X-XXX-XXXX"
              />
              <i className="bi bi-telephone"></i>
            </div>
          </div>
        </div>

        <div className="auth-form-row">
          <div>
            <label htmlFor="reg-password" className="auth-field-label">
              รหัสผ่าน
            </label>
            <div className="auth-input-wrap">
              <input
                id="reg-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="≥ 6 ตัวอักษร"
                required
                minLength={6}
                autoComplete="new-password"
              />
              <i className="bi bi-lock"></i>
            </div>
            <div className="auth-pwd-meter">
              <div style={{ width: strength.width, background: strength.color }} />
            </div>
          </div>
          <div>
            <label htmlFor="reg-confirm" className="auth-field-label">
              ยืนยันรหัสผ่าน
            </label>
            <div className="auth-input-wrap">
              <input
                id="reg-confirm"
                type="password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="กรอกซ้ำ"
                required
                minLength={6}
                autoComplete="new-password"
              />
              <i className="bi bi-shield-lock"></i>
            </div>
          </div>
        </div>

        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? <div className="auth-spin" /> : <i className="bi bi-person-plus-fill"></i>}
          <span>{busy ? "กำลังสมัครสมาชิก…" : "สร้างบัญชีของฉัน"}</span>
        </button>

        <div className="auth-terms">
          เมื่อสมัครสมาชิก คุณยอมรับ <a href="#">เงื่อนไขการใช้งาน</a> และ{" "}
          <a href="#">นโยบายความเป็นส่วนตัว</a> ของเรา
        </div>
      </form>

      <div className="auth-or">หรือ</div>

      <div className="auth-switch">
        มีบัญชีอยู่แล้ว? <Link href="/login">เข้าสู่ระบบ →</Link>
      </div>
    </div>
  );
}
