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
    icon: [
      { url: "/assets/img/favicon.png", type: "image/png" },
      { url: "/assets/img/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/assets/img/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [
      { url: "/assets/img/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: "/assets/img/favicon.png",
  },
  manifest: "/site.webmanifest",
  themeColor: "#16a34a",
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
        <link rel="stylesheet" href="/assets/css/dashboard.css?v=3" />
        <link rel="stylesheet" href="/assets/css/map-draw.css?v=4" />
        <link rel="stylesheet" href="/assets/css/map-draw-redesign.css?v=7" />
        <link rel="stylesheet" href="/assets/css/map-split.css?v=23" />
        <link rel="stylesheet" href="/assets/css/modal-auth.css?v=3" />
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
