import { AuthGuard } from "@/app/components";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="dashboard-page" style={{ paddingTop: '100px' }}>{children}</main>
  );
}
