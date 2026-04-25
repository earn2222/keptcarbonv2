"use client";

import { useAuth } from "@/lib/auth-context";
import Link from "next/link";

export default function MyPlotsPage() {
  const { user, ready } = useAuth();

  if (!ready) return <div className="p-5 text-center mt-5"><div className="spinner-border text-success"></div></div>;
  if (!user) return <div className="p-5 text-center mt-5 text-danger">คุณไม่มีสิทธิ์เข้าถึงหน้านี้ กรุณาเข้าสู่ระบบ</div>;

  return (
    <div className="container py-5 mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="fw-bold" style={{ color: "var(--heading-color)" }}>
          <i className="bi bi-geo-alt me-2 text-success"></i> แปลงยางของฉัน
        </h2>
        <Link href="/map-draw" className="btn btn-success rounded-3 fw-medium" style={{ backgroundColor: "var(--color-primary, #2d9e5f)" }}>
          <i className="bi bi-plus-circle me-2"></i> วาดแปลงใหม่
        </Link>
      </div>

      <div className="card shadow-sm border-0 rounded-4">
        <div className="card-body p-5 text-center">
          <div className="mb-4 text-muted">
            <i className="bi bi-map" style={{ fontSize: "64px", opacity: 0.5 }}></i>
          </div>
          <h4 className="fw-bold text-dark">ยังไม่มีข้อมูลแปลงยาง</h4>
          <p className="text-secondary mb-4">คุณยังไม่ได้วาดแปลงยางพาราในระบบ กรุณาคลิกที่ปุ่มด้านล่างเพื่อเริ่มวาดแปลงของคุณ</p>
          <Link href="/map-draw" className="btn btn-outline-success px-4 py-2 rounded-3 fw-medium">
            <i className="bi bi-pencil-square me-2"></i> ไปหน้าวาดแปลงยาง
          </Link>
        </div>
      </div>
    </div>
  );
}
