import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '翠账｜管货与对账', description: '翡翠摊主的货品、拿货和往来账' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="zh-CN"><body>{children}</body></html>; }
