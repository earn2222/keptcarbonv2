"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { Alert, Card, Button, Eyebrow } from "@/app/components";

type UserRecord = {
  id: string;
  email: string;
  username: string;
  fullname: string;
  phone: string;
  role: "farmer" | "editor" | "admin";
  createdAt: string;
};

export default function UserManagementPage() {
  const { ready, user } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (ready) {
      if (!user || user.role !== "admin") {
        router.replace("/dashboard");
      } else {
        fetchUsers();
      }
    }
  }, [ready, user, router]);

  async function fetchUsers() {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
      } else {
        setError("ไม่สามารถดึงข้อมูลผู้ใช้ได้");
      }
    } catch (err) {
      setError("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setLoading(false);
    }
  }

  async function handleRoleChange(userId: string, newRole: string) {
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, role: newRole }),
      });

      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role: newRole as any } : u))
        );
        setSuccess("อัปเดตบทบาทผู้ใช้สำเร็จ");
        setTimeout(() => setSuccess(null), 3000);
      } else {
        const data = await res.json();
        setError(data.error || "ไม่สามารถอัปเดตบทบาทได้");
      }
    } catch (err) {
      setError("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    }
  }

  async function handleDeleteUser(userId: string) {
    if (!confirm("คุณแน่ใจหรือไม่ว่าต้องการลบผู้ใช้นี้? การดำเนินการนี้ไม่สามารถย้อนกลับได้")) return;

    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId }),
      });

      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== userId));
        setSuccess("ลบผู้ใช้สำเร็จ");
        setTimeout(() => setSuccess(null), 3000);
      } else {
        const data = await res.json();
        setError(data.error || "ไม่สามารถลบผู้ใช้ได้");
      }
    } catch (err) {
      setError("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    }
  }

  if (!ready || loading) {
    return (
      <div className="container py-5 text-center">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">กำลังโหลด...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-5" style={{ marginTop: "60px" }}>
      <div className="mb-4 d-flex justify-content-between align-items-end">
        <div>
          <Eyebrow text="แผงควบคุมผู้ดูแลระบบ" color="var(--accent-color)" />
          <h1 className="fw-bold mb-0">จัดการผู้ใช้</h1>
        </div>
        <div className="text-muted small">
          ทั้งหมด {users.length} บัญชี
        </div>
      </div>

      {error && <Alert type="danger" message={error} onClose={() => setError(null)} className="mb-4" />}
      {success && <Alert type="success" message={success} onClose={() => setSuccess(null)} className="mb-4" />}

      <Card className="border-0 shadow-sm overflow-hidden">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th className="px-4 py-3">ผู้ใช้งาน</th>
                <th className="py-3">บทบาท</th>
                <th className="py-3">เบอร์โทรศัพท์</th>
                <th className="py-3">วันที่เข้าร่วม</th>
                <th className="px-4 py-3 text-end">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3">
                    <div className="d-flex align-items-center">
                      <div 
                        className="rounded-circle d-flex align-items-center justify-content-center bg-light text-primary fw-bold me-3"
                        style={{ width: "40px", height: "40px", fontSize: "14px" }}
                      >
                        {(u.fullname?.[0] || u.email[0]).toUpperCase()}
                      </div>
                      <div>
                        <div className="fw-bold text-dark">{u.fullname || "ไม่ระบุชื่อ"}</div>
                        <div className="text-muted small">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3">
                    <select
                      className={`form-select form-select-sm border-0 bg-light fw-medium rounded-pill px-3 ${
                        u.role === "admin" ? "text-danger" : u.role === "editor" ? "text-primary" : "text-success"
                      }`}
                      style={{ width: "fit-content" }}
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      disabled={u.id === user?.id} // Prevent self-demotion
                    >
                      <option value="farmer">Farmer</option>
                      <option value="editor">Editor</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="py-3 text-muted">
                    {u.phone || "-"}
                  </td>
                  <td className="py-3 text-muted small">
                    {new Date(u.createdAt).toLocaleDateString("th-TH", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <button
                      className="btn btn-outline-danger btn-sm rounded-pill px-3"
                      onClick={() => handleDeleteUser(u.id)}
                      disabled={u.id === user?.id} // Prevent self-deletion
                    >
                      <i className="bi bi-trash me-1"></i> ลบ
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-5 text-muted italic">
                    ไม่พบข้อมูลผู้ใช้ในระบบ
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <style jsx>{`
        .table th {
          font-weight: 600;
          text-transform: uppercase;
          font-size: 12px;
          letter-spacing: 0.5px;
          color: #6c757d;
        }
        .form-select:focus {
          box-shadow: none;
          background-color: #e9ecef;
        }
      `}</style>
    </div>
  );
}
