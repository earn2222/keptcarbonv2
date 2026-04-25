import { AuthGuard } from "@/app/components";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <main className="dashboard-page" style={{ paddingTop: '100px' }}>{children}</main>
    </AuthGuard>
  );
}
