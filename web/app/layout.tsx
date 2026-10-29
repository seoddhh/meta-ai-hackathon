import type { Metadata } from 'next';
import './globals.css';
import './screens.css';
export const metadata: Metadata = {
  title: 'SIGNAL WAR, Tactical Agent Simulation',
  description: '자연어 전략으로 지휘하는 1:1 멀티 에이전트 아레나. Spark commander, Glimmer squad, Muse Image chronicles.',
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><head>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"/>
    <link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin=""/>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500&display=swap"/>
  </head><body>{children}</body></html>;
}
