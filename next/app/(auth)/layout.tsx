import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="auth-page-shell">
      {/* Brand bar — pinned top with the marketing wordmark */}
      <div className="auth-brand-bar">
        <Link href="/" className="kc-brand-stamp">
          <img src="/assets/img/keptcarbon-logo.png" alt="KeptCarbon" />
          <span className="name">
            Kept<span>Carbon</span>
          </span>
        </Link>
        <Link href="/" className="back-home">
          <i className="bi bi-arrow-left"></i> กลับหน้าแรก
        </Link>
      </div>

      {/* Decorative leaves — soft watermark of the rubber-tree theme */}
      <i className="bi bi-tree-fill auth-leaf auth-leaf-a" aria-hidden></i>
      <i className="bi bi-flower2 auth-leaf auth-leaf-b" aria-hidden></i>
      <i className="bi bi-leaf-fill auth-leaf auth-leaf-c" aria-hidden></i>

      {children}
    </div>
  );
}
