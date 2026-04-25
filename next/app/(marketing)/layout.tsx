import Header from "../components/Header";
import Footer from "../components/Footer";
import AOSInit from "../components/AOSInit";
import ScrollTop from "../components/ScrollTop";
import SmoothScroll from "../components/SmoothScroll";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="index-page">
      <Header />
      <main className="main">{children}</main>
      <Footer />
      <ScrollTop />
      <AOSInit />
      <SmoothScroll />
    </div>
  );
}
