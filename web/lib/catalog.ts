import type { Role, Side } from '@/lib/types';

/*
 * Selection catalog for the main and draft screens.
 *
 * MOCK: rule sets, regulations, tool pools, personalities and commander personas are
 * placeholders until the rules are designed. Choosing them changes nothing in the engine
 * or the model prompts yet. Only `live` entries describe what the engine does today.
 * Replace the arrays here once the design is settled; the screens render whatever is listed.
 */

export type RuleSet = { id: string; name: string; summary: string; stats: [string, string][]; live?: boolean };
export const RULESETS: RuleSet[] = [
  { id: 'standard', name: '표준 교전', summary: '현재 엔진 규칙. 세 거점 점령전.', live: true,
    stats: [['라운드', '30'], ['이동', '500u/턴'], ['점령 반경', '250u'], ['유닛', '3 + 사령관']] },
  { id: 'blitz', name: '속전', summary: '짧은 경기, 넓은 이동. 초반 판단이 승부를 가른다.',
    stats: [['라운드', '18'], ['이동', '700u/턴'], ['점령 반경', '300u'], ['유닛', '3 + 사령관']] },
  { id: 'recon', name: '정찰전', summary: '시야가 좁다. 정보가 곧 점수다.',
    stats: [['라운드', '30'], ['이동', '450u/턴'], ['시야', '-40%'], ['유닛', '3 + 사령관']] },
];

export type Regulation = { id: string; label: string; detail: string; live?: boolean; locked?: boolean };
export const REGULATIONS: Regulation[] = [
  { id: 'hidden-strategy', label: '상대 전략 비공개', detail: '모델 관측에 상대 프롬프트와 시야 밖 위치를 넣지 않는다.', live: true, locked: true },
  { id: 'no-commit-on-failure', label: '모델 실패 시 라운드 미반영', detail: '응답 검증에 실패하면 그 라운드를 저장하지 않는다.', live: true, locked: true },
  { id: 'one-action', label: '유닛당 턴 1행동', detail: '수행자는 한 턴에 도구 하나만 고른다.', live: true, locked: true },
  { id: 'no-external-tools', label: '게임 밖 도구 금지', detail: '셸·웹 검색 같은 외부 도구는 주지 않는다.', live: true, locked: true },
  { id: 'mid-orders', label: '경기 중 전략 수정 허용', detail: '라운드 사이에 자연어 지시를 바꿀 수 있다.', live: true },
  { id: 'order-limit', label: '지시 횟수 제한', detail: '경기당 직접 지시 횟수를 제한한다.' },
  { id: 'token-budget', label: '모델 토큰 예산', detail: '진영별 총 출력 토큰 상한을 둔다.' },
];

export type Tool = { id: string; name: string; detail: string; roles?: Role[]; live?: boolean };
export const TOOLS: Tool[] = [
  { id: 'move', name: 'move', detail: '좌표로 이동. 장애물을 피해 최대 500u.', live: true },
  { id: 'pulse', name: 'pulse', detail: '시야 안 적에게 에너지 펄스.', live: true },
  { id: 'shield', name: 'shield', detail: '이번 라운드 피해 2 방어.', live: true },
  { id: 'repair', name: 'repair', detail: '아군 에너지 +1.', roles: ['support'], live: true },
  { id: 'scan', name: 'scan', detail: '다음 턴 시야 +400.', live: true },
  { id: 'hold', name: 'hold', detail: '위치 유지.', live: true },
  { id: 'relay', name: 'relay', detail: '아군에게 관측 공유.' },
  { id: 'decoy', name: 'decoy', detail: '가짜 신호로 상대 시야 교란.' },
  { id: 'mark', name: 'mark', detail: '목표를 표시해 아군 펄스 강화.' },
];
export const TOOL_SLOTS = 4;

export type Personality = { id: string; name: string; trait: string };
export const PERSONALITIES: Personality[] = [
  { id: 'cautious', name: '신중', trait: '확실할 때만 교전한다.' },
  { id: 'aggressive', name: '공격', trait: '먼저 치고 들어간다.' },
  { id: 'cooperative', name: '협동', trait: '아군과 붙어 움직인다.' },
  { id: 'independent', name: '독립', trait: '지시 범위 안에서 스스로 판단한다.' },
];

export type Persona = { id: string; name: string; title: string; voice: string };
export const PERSONAS: Persona[] = [
  { id: 'vanta', name: 'VANTA', title: '냉정한 전략가', voice: '짧고 단정한 명령. 손실을 줄이는 쪽을 고른다.' },
  { id: 'sol', name: 'SOL', title: '공세형 지휘관', voice: '속도를 중시한다. 거점을 먼저 잡고 버틴다.' },
  { id: 'mira', name: 'MIRA', title: '균형 조율가', voice: '역할을 나눠 맡기고 상황에 따라 재배치한다.' },
];

export const SQUAD_ROLES: Role[] = ['scout', 'vanguard', 'support'];
export const DEFAULT_LOADOUT: Record<Role, string[]> = {
  scout: ['move', 'scan', 'pulse', 'hold'],
  vanguard: ['move', 'pulse', 'shield', 'hold'],
  support: ['move', 'repair', 'shield', 'hold'],
};

/** Opponent presets are live: the strategy text becomes the opponent commander's prompt. */
export type OpponentPreset = { id: string; name: string; persona: string; strategy: Record<Side, string> };
export const OPPONENT_PRESETS: OpponentPreset[] = [
  { id: 'balanced', name: '균형 운영형', persona: 'MIRA',
    strategy: { amber: '찰리 거점을 먼저 확보해. 선봉은 브라보로 전진하고 지원대는 대형을 유지해.',
                cyan: '알파 거점을 먼저 확보해. 선봉은 브라보로 전진하고 지원대는 대형을 유지해.' } },
  { id: 'rush', name: '중앙 속공형', persona: 'SOL',
    strategy: { amber: '전원 브라보로 빠르게 진입해 점령하고 버텨. 적이 보이면 선봉이 먼저 공격해.',
                cyan: '전원 브라보로 빠르게 진입해 점령하고 버텨. 적이 보이면 선봉이 먼저 공격해.' } },
  { id: 'hold', name: '거점 수비형', persona: 'VANTA',
    strategy: { amber: '찰리 거점을 지키며 움직이지 마. 적이 접근하면 보호막을 켜고 반격해.',
                cyan: '알파 거점을 지키며 움직이지 마. 적이 접근하면 보호막을 켜고 반격해.' } },
];
