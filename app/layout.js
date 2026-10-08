import "./globals.css";

export const metadata = {
  title: "AI 灵感册",
  description:
    "浏览 Pinterest 灵感收藏，长按图片以液态裂变方式探索更多关联画面。",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
