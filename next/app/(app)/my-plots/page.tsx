"use client";

import { useAuth } from "@/lib/auth-context";
import Link from "next/link";
import { Card, Eyebrow } from "@/app/components";

const HERO_BG =
    "radial-gradient(1200px 500px at -10% -10%, rgba(16,185,129,0.20) 0%, rgba(16,185,129,0) 60%)," +
    "radial-gradient(900px 450px at 110% 0%, rgba(59,130,246,0.18) 0%, rgba(59,130,246,0) 58%)," +
    "radial-gradient(700px 360px at 30% 120%, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0) 55%)," +
    "linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.86) 100%)";

const BTN_GREEN: React.CSSProperties = {
    background: "linear-gradient(135deg, #065f46 0%, #059669 100%)",
    color: "white",
    border: "none",
    borderRadius: 10,
    padding: "10px 20px",
    fontWeight: 600,
    fontSize: "0.875rem",
    boxShadow: "none",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    transition: "all 0.15s ease",
};

export default function MyPlotsPage() {
    const { user, ready } = useAuth();

    if (!ready) return (
        <div className="d-flex align-items-center justify-content-center" style={{ minHeight: 300 }}>
            <div className="spinner-border text-success" role="status" />
        </div>
    );
    if (!user) return null;

    return (
        <div className="container py-5" style={{ marginTop: "40px" }}>

            {/* ── Hero card ── */}
            <Card className="border-0 shadow-sm mb-4 overflow-hidden">
                <div className="p-4 p-md-5" style={{ background: HERO_BG, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                    <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
                        <div style={{ maxWidth: 640 }}>
                            <Eyebrow icon="bi-geo-alt" className="mb-2">ข้อมูลของฉัน</Eyebrow>
                            <h1 className="fw-bold mb-2" style={{ letterSpacing: "-0.02em" }}>แปลงยางพาราของฉัน</h1>
                            <div className="text-muted">
                                จัดการ ติดตาม และตรวจสอบข้อมูลแปลงยางพาราของคุณทั้งหมดในที่เดียว
                            </div>
                        </div>
                        <Link href="/map-draw" style={BTN_GREEN}>
                            <i className="bi bi-plus-circle" />วาดแปลงใหม่
                        </Link>
                    </div>
                </div>
            </Card>

            {/* ── Empty state ── */}
            <Card className="border-0 shadow-sm">
                <div className="p-5 text-center" style={{ minHeight: 300, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                    <div style={{
                        width: 80, height: 80, borderRadius: "50%",
                        background: "rgba(16,185,129,0.08)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        marginBottom: 20,
                    }}>
                        <i className="bi bi-map" style={{ fontSize: 36, color: "#059669", opacity: 0.7 }} />
                    </div>
                    <h4 className="fw-bold mb-2">ยังไม่มีข้อมูลแปลงยาง</h4>
                    <p className="text-muted mb-4" style={{ maxWidth: 400, fontSize: 14, lineHeight: 1.7 }}>
                        คุณยังไม่ได้วาดแปลงยางพาราในระบบ กรุณาคลิกที่ปุ่มด้านล่างเพื่อเริ่มวาดแปลงของคุณ
                    </p>
                    <Link href="/map-draw" style={BTN_GREEN}>
                        <i className="bi bi-pencil-square" />ไปหน้าวาดแปลงยาง
                    </Link>
                </div>
            </Card>
        </div>
    );
}
