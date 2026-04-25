import AuthGuard from "../components/AuthGuard";
import DashboardChrome from "../components/DashboardChrome";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <DashboardChrome>{children}</DashboardChrome>
    </AuthGuard>
  );
}
