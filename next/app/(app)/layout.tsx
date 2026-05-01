import { AuthGuard } from "@/app/components";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <main className="db-layout" style={{ paddingTop: 64, minHeight: "100vh" }}>
        {children}
      </main>
    </AuthGuard>
  );
}
