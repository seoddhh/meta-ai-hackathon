import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'SIGNAL WAR — Tactical Agent Simulation',
  description: '자연어 전략으로 지휘하는 1:1 멀티 에이전트 아레나. Spark commander, Glimmer squad, Muse Image chronicles.',
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
