import type { Metadata } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import { AuthModals, Header } from "@/app/components/organisms";
import "./globals.css";

const notoSansThai = Noto_Sans_Thai({
  weight: ["300", "400", "500", "600", "700", "800"],
  subsets: ["thai", "latin"],
  display: "swap",
  variable: "--font-noto-sans-thai",
});

export const metadata: Metadata = {
  title: "KeptCarbon - สวนยางพารายั่งยืน",
  description: "แพลตฟอร์มจัดการและประเมินคาร์บอนเครดิตสำหรับสวนยางพารา",
  keywords: ["สวนยางพารา", "คาร์บอนเครดิต", "ยางพารา", "KeptCarbon"],
  icons: {
    icon: "/assets/img/favicon.png",
    apple: "/assets/img/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" className={notoSansThai.variable}>
      <head>
        <link rel="stylesheet" href="/assets/vendor/bootstrap/css/bootstrap.min.css" />
        <link rel="stylesheet" href="/assets/vendor/bootstrap-icons/bootstrap-icons.css" />
        <link rel="stylesheet" href="/assets/vendor/aos/aos.css" />
        <link rel="stylesheet" href="/assets/css/main.css" />
        <link rel="stylesheet" href="/assets/css/keptcarbon.css" />
        <link rel="stylesheet" href="/assets/css/index-page.css" />
        <link rel="stylesheet" href="/assets/css/kc-design.css" />
        <link rel="stylesheet" href="/assets/css/auth.css" />
        <link rel="stylesheet" href="/assets/css/dashboard.css" />
        <link rel="stylesheet" href="/assets/css/map-draw.css" />
        <link rel="stylesheet" href="/assets/css/map-draw-redesign.css" />
        <link rel="stylesheet" href="/assets/css/modal-auth.css" />
      </head>
      <body>
        <AuthProvider>
          <Header />
          {children}
          <AuthModals />
        </AuthProvider>
      </body>
    </html>
  );
}
