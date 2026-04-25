"use client";

import { useEffect, useRef, useState } from "react";
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

type Alert = { type: "success" | "error"; msg: string } | null;

function ModalShell({
  width,
  onClose,
  children,
}: {
  width: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="kc-modal-backdrop"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 1080,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        overflowY: "auto",
      }}
    >
      <div
        style={{ width: "100%", maxWidth: width, position: "relative" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-auth-card">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              border: 0,
              background: "transparent",
              fontSize: 22,
              cursor: "pointer",
              color: "#94a3b8",
              lineHeight: 1,
            }}
          >
            ×
          </button>
          {children}
        </div>
      </div>
    </div>
  );
}

function AlertBox({ alert }: { alert: Alert }) {
  if (!alert) return null;
  return (
    <div className={`modal-auth-alert ${alert.type} show`}>
      <i className={`bi bi-${alert.type === "success" ? "check-circle" : "exclamation-circle"}`}></i>{" "}
      {alert.msg}
    </div>
  );
}

export function LoginModal() {
  const { modal, closeModal, openRegister, refresh } = useAuth();
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<Alert>(null);

  useEffect(() => {
    if (modal === "login") {
      setEmail("");
      setPassword("");
      setAlert(null);
      setBusy(false);
      setTimeout(() => emailRef.current?.focus(), 50);
    }
  }, [modal]);

  if (modal !== "login") return null;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setTimeout(() => {
      const result = Auth.login(email.trim(), password);
      if (result.success) {
        setAlert({ type: "success", msg: "✓ เข้าสู่ระบบสำเร็จ! กำลังนำไปยังแดชบอร์ด..." });
        refresh();
        setTimeout(() => {
          closeModal();
          router.push("/dashboard");
        }, 800);
      } else {
        setAlert({ type: "error", msg: "✗ " + result.message });
        setBusy(false);
      }
    }, 600);
  };

  return (
    <ModalShell width={440} onClose={closeModal}>
      <div className="modal-auth-logo">
        <img
          src="/assets/img/keptcarbon-logo.png"
          alt="Kept Carbon Logo"
          style={{ maxWidth: 180, height: "auto" }}
        />
      </div>
      <div className="modal-auth-heading text-center">เข้าสู่ระบบ</div>
      <div className="modal-auth-sub text-center">
        ยินดีต้อนรับกลับ! กรุณากรอกข้อมูลเพื่อดำเนินการต่อ
      </div>

      <AlertBox alert={alert} />

      <form onSubmit={onSubmit} autoComplete="on">
        <div className="modal-auth-form-group">
          <label>อีเมล</label>
          <div className="modal-inp-wrap">
            <i className="bi bi-envelope"></i>
            <input
              ref={emailRef}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="กรอกอีเมลของคุณ"
              required
              autoComplete="email"
            />
          </div>
        </div>
        <div className="modal-auth-form-group">
          <label>รหัสผ่าน</label>
          <div className="modal-inp-wrap">
            <i className="bi bi-lock"></i>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="กรอกรหัสผ่าน"
              required
              autoComplete="current-password"
            />
          </div>
        </div>
        <button type="submit" className="modal-btn-submit" disabled={busy}>
          {busy ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
        </button>
      </form>

      <div className="modal-divider">หรือ</div>
      <div className="modal-auth-links">
        ยังไม่มีบัญชี?{" "}
        <a
          onClick={(e) => {
            e.preventDefault();
            openRegister();
          }}
          href="#"
        >
          สมัครสมาชิกใหม่
        </a>
      </div>
    </ModalShell>
  );
}

export function RegisterModal() {
  const { modal, closeModal, openLogin, refresh } = useAuth();
  const router = useRouter();
  const fullnameRef = useRef<HTMLInputElement>(null);
  const [fullname, setFullname] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<Alert>(null);

  useEffect(() => {
    if (modal === "register") {
      setFullname("");
      setEmail("");
      setPhone("");
      setPassword("");
      setConfirmPwd("");
      setAlert(null);
      setBusy(false);
      setTimeout(() => fullnameRef.current?.focus(), 50);
    }
  }, [modal]);

  if (modal !== "register") return null;

  const strength = strengthFor(password.length);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPwd) {
      setAlert({ type: "error", msg: "✗ รหัสผ่านไม่ตรงกัน กรุณาตรวจสอบอีกครั้ง" });
      return;
    }
    setBusy(true);
    setTimeout(() => {
      const result = Auth.register({ fullname, email: email.trim(), phone, password });
      if (result.success) {
        Auth.login(email.trim(), password);
        refresh();
        setAlert({ type: "success", msg: "✓ สมัครสมาชิกสำเร็จ! กำลังนำไปยังแดชบอร์ด..." });
        setTimeout(() => {
          closeModal();
          router.push("/dashboard");
        }, 900);
      } else {
        setAlert({ type: "error", msg: "✗ " + result.message });
        setBusy(false);
      }
    }, 600);
  };

  return (
    <ModalShell width={500} onClose={closeModal}>
      <div className="modal-auth-logo">
        <img
          src="/assets/img/keptcarbon-logo.png"
          alt="Kept Carbon Logo"
          style={{ maxWidth: 180, height: "auto", marginBottom: 12 }}
        />
      </div>
      <div className="modal-auth-heading text-center">สมัครสมาชิก</div>
      <div className="modal-auth-sub text-center">
        สร้างบัญชีเพื่อเริ่มจัดการสวนยางพาราของคุณ
      </div>

      <AlertBox alert={alert} />

      <form onSubmit={onSubmit} autoComplete="on">
        <div className="modal-auth-form-group">
          <label>ชื่อ-นามสกุล</label>
          <div className="modal-inp-wrap">
            <i className="bi bi-person"></i>
            <input
              ref={fullnameRef}
              type="text"
              value={fullname}
              onChange={(e) => setFullname(e.target.value)}
              placeholder="กรอกชื่อ-นามสกุล"
              required
              autoComplete="name"
            />
          </div>
        </div>

        <div className="row g-2">
          <div className="col-6 modal-auth-form-group">
            <label>อีเมล</label>
            <div className="modal-inp-wrap">
              <i className="bi bi-envelope"></i>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                required
                autoComplete="email"
              />
            </div>
          </div>
          <div className="col-6 modal-auth-form-group">
            <label>เบอร์โทร (ไม่บังคับ)</label>
            <div className="modal-inp-wrap">
              <i className="bi bi-telephone"></i>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="08X-XXX-XXXX"
              />
            </div>
          </div>
        </div>

        <div className="row g-2">
          <div className="col-6 modal-auth-form-group">
            <label>รหัสผ่าน</label>
            <div className="modal-inp-wrap">
              <i className="bi bi-lock"></i>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="≥ 6 ตัวอักษร"
                required
                minLength={6}
              />
            </div>
            <div className="modal-pwd-strength">
              <div
                className="modal-pwd-bar"
                style={{ width: strength.width, background: strength.color }}
              />
            </div>
          </div>
          <div className="col-6 modal-auth-form-group">
            <label>ยืนยันรหัสผ่าน</label>
            <div className="modal-inp-wrap">
              <i className="bi bi-lock-fill"></i>
              <input
                type="password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="กรอกซ้ำ"
                required
                minLength={6}
              />
            </div>
          </div>
        </div>

        <button type="submit" className="modal-btn-submit" disabled={busy}>
          {busy ? "กำลังสมัครสมาชิก..." : "สมัครสมาชิก"}
        </button>

        <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "center", marginTop: 12 }}>
          เมื่อสมัครสมาชิก คุณยอมรับ{" "}
          <a href="#" style={{ color: "#2d9e5f" }}>
            เงื่อนไขการใช้งาน
          </a>{" "}
          ของเรา
        </div>
      </form>

      <div className="modal-divider">หรือ</div>
      <div className="modal-auth-links">
        มีบัญชีอยู่แล้ว?{" "}
        <a
          onClick={(e) => {
            e.preventDefault();
            openLogin();
          }}
          href="#"
        >
          เข้าสู่ระบบ
        </a>
      </div>
    </ModalShell>
  );
}

export default function AuthModals() {
  return (
    <>
      <LoginModal />
      <RegisterModal />
    </>
  );
}
