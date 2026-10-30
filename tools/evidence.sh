#!/bin/sh
# 명령 하나를 실행하고 근거를 파일에 덧붙인다. (POSIX sh)
# 사용: sh kit/tools/evidence.sh [-o 기록파일] -- <명령> [인자...]
#   예) sh kit/tools/evidence.sh -o VERIFY.md -- node --test
#
# - 원래 명령의 종료 코드를 그대로 돌려준다. (기록 때문에 실패가 성공으로 바뀌지 않는다)
# - 출력이 없다는 이유로 성공이라 판단하지 않는다. 종료 코드를 그대로 기록한다.
# - 서버·감시 모드처럼 끝나지 않는 명령에는 쓰지 않는다.
# - 키·토큰처럼 보이는 문자열이 명령에 있으면 실행하지 않고, 출력에 있으면 가려서 기록한다.
# 요구사항 충족 여부는 이 도구가 판단하지 않는다. 기록은 사람이 읽고 판단한다.

OUT="VERIFY.md"
while [ $# -gt 0 ]; do
  case "$1" in
    -o) OUT="$2"; shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done
if [ $# -eq 0 ]; then
  echo "사용: sh $0 [-o 기록파일] -- <명령> [인자...]" >&2
  exit 2
fi

SECRET_RE='(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|[Bb]earer [A-Za-z0-9._-]{12,}|(api[_-]?key|token|secret|password)[=:][^ ]{6,})'
CMDTEXT="$*"
if printf '%s' "$CMDTEXT" | grep -E -q "$SECRET_RE"; then
  echo "[중단] 명령에 키·토큰처럼 보이는 문자열이 있어 실행하지 않습니다. 비밀값은 환경변수로 전달하세요." >&2
  exit 3
fi

TMP=$(mktemp "${TMPDIR:-/tmp}/evidence.XXXXXX") || exit 4
START=$(date +%s)
"$@" >"$TMP" 2>&1
CODE=$?
END=$(date +%s)

{
  printf '\n### 실행 기록\n'
  printf -- '- 명령: `%s`\n' "$CMDTEXT"
  printf -- '- 작업 경로: `%s`\n' "$(pwd)"
  printf -- '- 종료 코드: %s (%s)\n' "$CODE" "$([ "$CODE" -eq 0 ] && echo '명령이 오류 없이 끝남 — 요구사항 충족 여부와는 별개' || echo '명령 실패')"
  printf -- '- 소요 시간: %s초\n' "$((END - START))"
  printf -- '- 출력(마지막 40줄, 비밀값 형태는 가림):\n\n```\n'
  tail -n 40 "$TMP" | sed -E 's/(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|[Bb]earer [A-Za-z0-9._-]{12,})/[가림]/g; s/((api[_-]?key|token|secret|password)[=:])[^ ]+/\1[가림]/g'
  printf '```\n'
} >>"$OUT"

rm -f "$TMP"
echo "기록 완료: $OUT (종료 코드 $CODE)"
exit "$CODE"
