# worknotes-kit

코딩 에이전트와 일할 때 쓰는 **범용 작업 규칙·절차·템플릿 모음**입니다. 과제별 정답이나 풀이는 들어 있지 않습니다.

- 요구와 미확인 사항을 먼저 구분하고, 담당자에게 물을 질문을 만든다
- 오류는 원인을 찾은 뒤 최소한으로 고친다
- 완료를 말하기 전에 실제로 실행한 근거를 남긴다
- 한 일만 사실대로 정리하고, 내 말로 설명할 준비를 한다

> 이 저장소는 **공개 상태로 유지**됩니다. 비밀값(키·토큰)은 들어 있지 않습니다.
> 키트는 도구일 뿐 결과물을 대신하지 않습니다. 사용 내역은 작업 이력에 남고 검토 대상입니다.

## 작업 환경에서 쓰는 법 (5분)
1. 작업 폴더에서 가져오기 (작업 환경에서는 `git push`가 불가능합니다. 가져오기만 합니다.)
   ```bash
   git clone --depth 1 https://github.com/<계정>/worknotes-kit kit
   sh kit/install.sh check
   ```
   `check`는 현재 상태만 보여 주고 **아무 파일도 바꾸지 않습니다.**
2. 필요하면 선택해서 적용합니다. **직접 터미널에 입력**하세요.
   ```bash
   sh kit/install.sh agents   # ./AGENTS.md 가 없을 때만 복사 (있으면 덮어쓰지 않음)
   sh kit/install.sh skills   # (선택) ./.agents/skills/ 로 복사를 한 번 시도 (막히면 우회하지 않고 종료)
   ```
   > 로컬 실측(`workspace-write` 샌드박스)에서 **코딩 에이전트가 실행한 명령은 `.agents/`를 만들거나 쓸 수 없었습니다**(`Operation not permitted`). 그러니 **코딩 에이전트에게 스킬 설치를 시키지 마세요.** 막혀 있는 것을 다른 방법으로 돌파하려 하지 말고, `skills`가 안 되면 아래 3번만 쓰면 됩니다. 실제 환경의 동작은 다를 수 있으니 미리 확인하세요.
3. **스킬 설치 없이도 됩니다(기본 사용법).** 코딩 에이전트에게 **파일을 직접 읽고 적용하도록 요청**합니다. (실측: 이 요청에 코딩 에이전트가 `cat kit/skills/work-intake/SKILL.md`를 실행하고 절차대로 답했습니다.)
   - `kit/skills/work-intake/SKILL.md 를 읽고 그 절차대로 과제 요구를 정리해줘.`
   - 기존 `AGENTS.md`가 있으면: `제공된 지침을 먼저 읽고, 충돌하지 않는 범위에서 kit/instructions/working-rules.md 를 적용해줘.`
4. 출처를 기록합니다: `git -C kit rev-parse HEAD` 결과를 `WORK.md`의 '사용한 외부 자료'에 적습니다.

클론이 안 되거나 쓰기가 막히면 **다른 경로로 우회하지 말고** `instructions/AGENTS.md`의 핵심 규칙만 직접 입력해서 쓰세요.

## 구성
| 위치 | 내용 |
|---|---|
| `instructions/AGENTS.md` | 짧은 작업 규칙 (`working-rules.md`는 기존 지침이 있을 때 요청용 동일 내용) |
| `skills/work-intake` | 요구 정리, 담당자 질문 설계 |
| `skills/debug-rootcause` | 재현 → 원인 → 최소 수정 → 재검증 |
| `skills/verify-evidence` | 요구별 실제 확인 근거 기록 |
| `skills/handoff-explain` | 정리와 설명 준비 |
| `templates/` | `TASK.md`(요구·질문), `WORK.md`(계획·결정), `VERIFY.md`(검증 근거) — 과제가 요구하는 제출 문서 이름이 있으면 그 이름으로 복사해 쓰세요 |
| `tools/profile-csv.mjs` | (선택) CSV를 읽고 **관찰 결과만** 출력 (오류 판정·수정 없음) |
| `tools/evidence.sh` | (선택) 지정한 명령 하나를 실행하고 종료 코드·출력 끝부분을 기록 |
| `mcp/README.md` | MCP는 기본적으로 사용하지 않습니다 |

## 하지 않는 것
홈 디렉터리·`/etc`·플랫폼 설정 수정, 네트워크 호출, 기존 파일 덮어쓰기·덧붙이기, 플랫폼 제한 우회.

## 점검
```bash
node --test tests/kit-check.mjs
```
파일 이름을 `*.test.*`로 하지 않은 것은 **작업 폴더의 `node --test`·`vitest`가 키트의 테스트를 같이 실행하지 않게** 하기 위해서입니다.
