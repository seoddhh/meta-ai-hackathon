# meta-ai-hackathon
Meta Global AI Developer Hackathon repository

대회링크: https://cerebralvalley.ai/e/meta-ai-developer-hackathon

## SIGNAL WAR

자연어 전략으로 지휘하는 1:1 멀티 에이전트 절차 생성 3D 전장의 게임. Spark 사령관 → 역할별 Glimmer 수행자 → 엔진의 동시 판정 → Muse Image 결과 일러스트 → 경기 아카이브.

[제품·기술 설계](SIGNAL_WAR_DESIGN.md)

### 로컬 실행

Node.js 20.9+ 및 Python 3.12+가 필요합니다. 저장소 루트에서:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm install --prefix web
```

한 번에 실행하려면 `./dev.sh`를 사용합니다. 또는 두 터미널에서 각각 실행합니다.

```sh
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

```sh
npm run dev --prefix web
```

http://127.0.0.1:3000 에서 확인합니다. 메인(경기 설정) → 에이전트 선택 → 전장 순서로 진행합니다. 규칙·도구·성격·페르소나 선택은 아직 목업이며 경기에 반영되지 않습니다. 최초 실행은 **엔진 테스트 / AI 미사용** 모드입니다. 5000×5000 자유 지형(비대칭 랜덤: 양 기지·강·다리·숲·바위·호수)이 생성되고, 세 거점 ALPHA/BRAVO/CHARLIE는 양 기지에서 걸어서 가는 거리가 거의 같은 곳에 놓입니다. 사령관 또는 개별 캐릭터를 선택해 전략을 입력하고 전달한 뒤 `EXECUTE`(자동 진행) 또는 `1 TURN`(한 턴)을 누릅니다. 새 전장 생성에서 바이옴과 시드를 바꿀 수 있습니다. 같은 시드는 같은 전장이 됩니다. 종료 후 아카이브에서 경기 기록과 리플레이를 다시 열 수 있습니다. 현재는 동일 브라우저에서 양쪽을 입력하는 hot-seat 방식이며 원격 두 사용자 매칭은 아직 없습니다.

조작: `1–4` 캐릭터 선택·포커스, `WASD`/방향키/화면 가장자리 카메라 이동, 드래그 회전, 우클릭 드래그 이동, 스크롤 확대, `F` 선택 대상 포커스, `R` 전체 맵, `V` 전장의 안개, `SPACE` 자동 진행/정지, `N` 한 턴. 미니맵을 클릭하면 카메라가 이동합니다. 유닛은 `move(x, y)`로 임의 지점을 목표로 받고 엔진이 장애물을 피해 턴당 최대 500u 이동합니다. 숲·바위는 통행과 시야를 막고, 강은 다리에서 건널 수 있습니다. 지도·에이전트·거점·판정은 같은 서버 지형 데이터를 사용합니다. 규칙 수치는 [설계 문서](SIGNAL_WAR_DESIGN.md#경기-규칙-v03--5000u-자유-필드)에 있습니다.

21×21 격자 시절 경기 기록은 새 지형 형식과 호환되지 않아 아카이브에 표시되지 않습니다(DB에는 남아 있습니다).

### 실제 모델 연결

루트 `.env`는 백엔드만 읽습니다. 기존 `.env`를 덮어쓰지 말고 `.env.example`에서 필요한 값을 추가하세요.

```dotenv
MODEL_API_KEY=your_meta_key
WORKER_PROVIDER=glimmer
GLIMMER_BASE_URL=https://your-glimmer-server.example/v1
GLIMMER_MODEL=your-provider-model-id
GLIMMER_API_KEY=your_provider_key_if_required
```

Glimmer는 Meta API에서 자동 제공되지 않습니다. 별도 추론 서버가 필요합니다. 설정한 주소는 OpenAI 호환 `/chat/completions`를 지원해야 합니다.

받은 Baseten 키로 수행자를 실행하려면 아래처럼 **명시적으로 모델을 교체**할 수 있습니다. UI와 경기 기록에도 Glimmer가 아닌 Spark Open으로 표시합니다.

```dotenv
WORKER_PROVIDER=baseten
BASETEN_API_KEY=your_hackathon_key
```

이 경우 모델 ID는 코드에서 `meta-models/muse-spark-open-1026`으로 고정합니다. 설정 변경 후 백엔드를 재시작하고 화면을 새로고침하세요. 우측 상단 설정에서 연결 상태를 확인하고 새 대결의 실행 모드를 선택합니다. `설정됨`은 실제 호출 성공을 보장하지 않습니다.

사령관 연결만 1회 유료 검증하는 선택 명령:

```sh
.venv/bin/python -m backend.smoke
```

경기 종료 후 `Muse Image 결과 생성`을 누르면 Meta 크레딧을 사용하는 실제 생성 요청이 발생합니다. 이미지는 `.data/images/`, 경기·이벤트·프레임은 `.data/battles.sqlite3`에 저장합니다. 생성하지 않은 이미지를 생성 완료로 표시하지 않습니다.

### 배포

- Next.js: Vercel의 프로젝트 Root Directory를 `web`으로 설정합니다.
- Python: `backend/modal_app.py`에 Modal 배포 설정을 제공합니다. Glimmer 모델 자체의 GPU 배포와는 별개입니다.
- Modal secret `signal-war`: `MODEL_API_KEY`, 수행자 설정, 강한 `BACKEND_TOKEN`을 저장합니다. 키를 Git에 넣지 않습니다.
- Vercel 서버 환경 변수: `BACKEND_URL`과 같은 `BACKEND_TOKEN`을 설정합니다. 로컬에서 토큰을 사용하려면 `web/.env.local`에도 설정합니다.
- Modal SDK가 설치·로그인되어 있고 secret을 만든 뒤 루트에서 `modal deploy backend/modal_app.py`를 실행합니다. 이 저장소 작업에서는 실제 배포하지 않았습니다.
- 현재 SQLite·프로세스 잠금은 단일 컨테이너를 전제로 합니다. Modal Volume에 저장한 뒤 커밋합니다. 다중 인스턴스·공개 접속 전에는 PostgreSQL, 작업 큐, 사용자 인증·진영 권한과 지출 예산을 추가하세요. 공유 BACKEND_TOKEN만으로는 플레이어 인증이 되지 않습니다.

### 검증

```sh
.venv/bin/python -m pytest backend/tests -q
npm run typecheck --prefix web
npm run build --prefix web
```

엔진 테스트 정책은 자연어 AI가 아닙니다. 실제 모델 장애를 테스트 정책으로 숨기지 않으며, 모델 응답이 잘못되면 해당 라운드를 저장하지 않습니다.
