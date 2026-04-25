"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";

export default function ProfilePage() {
  const { user, ready, refresh } = useAuth();
  
  const [firstname, setFirstname] = useState("");
  const [lastname, setLastname] = useState("");
  const [phone, setPhone] = useState("");
  
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{type: "success" | "error", text: string} | null>(null);

  useEffect(() => {
    if (user && user.fullname) {
      const parts = user.fullname.split(" ");
      setFirstname(parts[0] || "");
      setLastname(parts.slice(1).join(" ") || "");
      setPhone(user.phone || "");
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    
    try {
      const res = await fetch("/api/profile/update", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstname, lastname, phone }),
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "เกิดข้อผิดพลาดในการบันทึกข้อมูล");
      }
      
      setMessage({ type: "success", text: "บันทึกข้อมูลโปรไฟล์เรียบร้อยแล้ว" });
      refresh(); // Refresh user state in context to update the header
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "เกิดข้อผิดพลาด" });
    } finally {
      setLoading(false);
    }
  };

  if (!ready) return <div className="p-5 text-center mt-5"><div className="spinner-border text-success"></div></div>;
  if (!user) return <div className="p-5 text-center mt-5 text-danger">คุณไม่มีสิทธิ์เข้าถึงหน้านี้ กรุณาเข้าสู่ระบบ</div>;

  return (
    <div className="container py-5 mt-4" style={{ maxWidth: "800px" }}>
      <h2 className="mb-4 fw-bold" style={{ color: "var(--heading-color)" }}>จัดการโปรไฟล์</h2>
      
      <div className="card shadow-sm border-0 rounded-4">
        <div className="card-body p-4 p-md-5">
          <div className="d-flex align-items-center mb-4 pb-4 border-bottom">
            <div 
              className="d-flex align-items-center justify-content-center text-white me-4"
              style={{ width: "80px", height: "80px", borderRadius: "50%", backgroundColor: "var(--color-primary, #2d9e5f)", fontSize: "32px", fontWeight: "bold" }}
            >
              {(user.fullname?.[0] ?? "U").toUpperCase()}
            </div>
            <div>
              <h4 className="mb-1 fw-bold text-dark">{user.fullname}</h4>
              <p className="text-secondary mb-0">{user.email || user.username}</p>
              <span className="badge mt-2" style={{ backgroundColor: "rgba(45, 158, 95, 0.1)", color: "var(--color-primary)", padding: "6px 12px" }}>
                {user.role === "admin" ? "ผู้ดูแลระบบ" : "ผู้ใช้งานทั่วไป"}
              </span>
              {user.provider === "line" && (
                <span className="badge mt-2 ms-2 bg-success text-white" style={{ padding: "6px 12px" }}>
                  <i className="bi bi-line me-1"></i> LINE Login
                </span>
              )}
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            {message && (
              <div className={`alert alert-${message.type === "success" ? "success" : "danger"} rounded-3`} role="alert">
                {message.type === "success" ? <i className="bi bi-check-circle me-2"></i> : <i className="bi bi-exclamation-circle me-2"></i>}
                {message.text}
              </div>
            )}

            <div className="row g-4 mb-4">
              <div className="col-md-6">
                <label className="form-label fw-medium text-secondary">ชื่อ (Firstname) <span className="text-danger">*</span></label>
                <input 
                  type="text" 
                  className="form-control p-2 bg-light border-0" 
                  value={firstname}
                  onChange={(e) => setFirstname(e.target.value)}
                  placeholder="กรอกชื่อของคุณ"
                  required
                />
              </div>
              <div className="col-md-6">
                <label className="form-label fw-medium text-secondary">นามสกุล (Lastname) <span className="text-danger">*</span></label>
                <input 
                  type="text" 
                  className="form-control p-2 bg-light border-0" 
                  value={lastname}
                  onChange={(e) => setLastname(e.target.value)}
                  placeholder="กรอกนามสกุลของคุณ"
                  required
                />
              </div>
              <div className="col-md-6">
                <label className="form-label fw-medium text-secondary">อีเมล / ชื่อผู้ใช้</label>
                <input 
                  type="text" 
                  className="form-control p-2 bg-light border-0 text-muted" 
                  value={user.email || user.username || ""}
                  disabled
                />
                <div className="form-text" style={{ fontSize: "12px" }}>ข้อมูลบัญชีไม่สามารถเปลี่ยนแปลงได้</div>
              </div>
              <div className="col-md-6">
                <label className="form-label fw-medium text-secondary">เบอร์โทรศัพท์ (Phone)</label>
                <input 
                  type="tel" 
                  className="form-control p-2 bg-light border-0" 
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="08X-XXX-XXXX"
                />
              </div>
            </div>

            <div className="d-flex justify-content-end mt-4 pt-4 border-top">
              <button 
                type="submit" 
                className="btn text-white px-4 py-2 rounded-3 fw-medium d-flex align-items-center"
                disabled={loading || !firstname || !lastname}
                style={{ backgroundColor: "var(--color-primary, #2d9e5f)", border: "none" }}
              >
                {loading ? (
                  <><span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span> กำลังบันทึก...</>
                ) : (
                  <><i className="bi bi-save me-2"></i> บันทึกข้อมูล</>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
