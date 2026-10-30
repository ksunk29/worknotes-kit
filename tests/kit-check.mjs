import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCsv, parseCsvDetailed, profile, spellingVariants } from '../tools/profile-csv.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillDirs = () => fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); // .DS_Store 같은 파일은 제외
const tmp = (p = 'kit-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const sh = (args, opts = {}) => spawnSync('sh', args, { encoding: 'utf8', ...opts });
const snapshot = (dir) => {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); out.push(path.relative(dir, p) + (e.isDirectory() ? '/' : ':' + fs.readFileSync(p, 'utf8').length)); if (e.isDirectory()) walk(p); } };
  walk(dir);
  return out.sort().join('\n');
};

// ───────── 형식 검사 ─────────
test('스킬: name/description 존재, name=폴더명, 본문 길이 상한', () => {
  const dirs = skillDirs();
  assert.ok(dirs.length >= 3);
  for (const d of dirs) {
    const text = fs.readFileSync(path.join(ROOT, 'skills', d, 'SKILL.md'), 'utf8');
    const m = text.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
    assert.ok(m, `${d}: frontmatter 형식`);
    assert.equal(m[1].trim(), d, `${d}: name 이 폴더명과 같아야 함`);
    assert.ok(m[2].includes('사용하지 않는다'), `${d}: description 에 '쓰지 않을 때'가 있어야 함`);
    assert.ok(text.length < 2500, `${d}: 너무 김 (${text.length})`);
    assert.deepEqual(fs.readdirSync(path.join(ROOT, 'skills', d)), ['SKILL.md'], `${d}: 동반 파일 없음`);
  }
});

test('지침: AGENTS.md 와 working-rules.md 동일, 크기·중복·참조 경로 점검', () => {
  const a = fs.readFileSync(path.join(ROOT, 'instructions/AGENTS.md'), 'utf8');
  assert.equal(a, fs.readFileSync(path.join(ROOT, 'instructions/working-rules.md'), 'utf8'));
  assert.ok(Buffer.byteLength(a) < 3800, `AGENTS.md 가 큼: ${Buffer.byteLength(a)}B`); // 내부 목표(토큰 절약), 공식 요건 아님. 공식 한도는 32KiB
  const lines = a.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(new Set(lines).size, lines.length, '중복 규칙 없음');
  for (const m of a.matchAll(/`kit\/(skills\/[^`]+\/SKILL\.md)`/g)) assert.ok(fs.existsSync(path.join(ROOT, m[1])), `참조 파일 없음: ${m[1]}`);
  // 자동 로딩을 보장하는 것처럼 쓰지 않는다
  assert.match(a, /자동으로 적용되지 않으면/);
});

test('install.sh: POSIX 문법 (sh, dash)', () => {
  for (const shell of ['sh', 'dash']) {
    const r = spawnSync(shell, ['-n', path.join(ROOT, 'install.sh')], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${shell}: ${r.stderr}`);
  }
  for (const f of ['install.sh', 'tools/evidence.sh']) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /\[\[|pipefail|\bdeclare\b|\blocal\b/, `${f}: bash 전용 문법`);
});

test('저장소 전체에 비밀값 패턴이 없다', () => {
  const re = /(sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === '.git' || e.name === 'node_modules' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(ROOT)) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), re, f);
});

// ───────── install.sh 동작 ─────────
test('check: 아무 파일도 바꾸지 않는다 (홈 포함)', () => {
  const work = tmp(), home = tmp('home-');
  const before = snapshot(work) + '|' + snapshot(home);
  const r = sh([path.join(ROOT, 'install.sh'), 'check'], { cwd: work, env: { ...process.env, HOME: home } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /바꾸지 않습니다/);
  assert.equal(snapshot(work) + '|' + snapshot(home), before);
});

test('agents: AGENTS.md 가 없을 때만 복사, 있으면 변경 없음', () => {
  const work = tmp();
  assert.equal(sh([path.join(ROOT, 'install.sh'), 'agents'], { cwd: work }).status, 0);
  assert.equal(fs.readFileSync(path.join(work, 'AGENTS.md'), 'utf8'), fs.readFileSync(path.join(ROOT, 'instructions/AGENTS.md'), 'utf8'));
  const work2 = tmp();
  fs.writeFileSync(path.join(work2, 'AGENTS.md'), '기존 지침\n');
  const r = sh([path.join(ROOT, 'install.sh'), 'agents'], { cwd: work2 });
  assert.equal(r.status, 0);
  assert.equal(fs.readFileSync(path.join(work2, 'AGENTS.md'), 'utf8'), '기존 지침\n', '덮어쓰거나 덧붙이지 않음');
  assert.match(r.stdout, /working-rules\.md/);
});

test('skills: 복사하고, 재실행해도 같은 결과이며 다른 내용은 덮어쓰지 않는다', () => {
  const work = tmp();
  const first = sh([path.join(ROOT, 'install.sh'), 'skills'], { cwd: work });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  for (const d of skillDirs()) assert.ok(fs.existsSync(path.join(work, '.agents/skills', d, 'SKILL.md')));
  const snap = snapshot(work);
  assert.equal(sh([path.join(ROOT, 'install.sh'), 'skills'], { cwd: work }).status, 0);
  assert.equal(snapshot(work), snap, '재실행 멱등');
  const custom = path.join(work, '.agents/skills/work-intake/SKILL.md');
  fs.writeFileSync(custom, '내가 고친 내용');
  const r = sh([path.join(ROOT, 'install.sh'), 'skills'], { cwd: work });
  assert.match(r.stdout, /덮어쓰지 않음/);
  assert.equal(fs.readFileSync(custom, 'utf8'), '내가 고친 내용');
});

test('skills: 쓸 수 없으면 우회하지 않고 실패·안내 (읽기 전용 폴더로 재현. 실제 샌드박스 보호와는 다를 수 있음)', { skip: process.getuid?.() === 0 }, () => {
  const work = tmp();
  fs.chmodSync(work, 0o555);
  try {
    const r = sh([path.join(ROOT, 'install.sh'), 'skills'], { cwd: work });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /대체 방법/);
    assert.match(r.stdout, /우회/);
    assert.equal(fs.existsSync(path.join(work, '.agents')), false, '다른 경로로 돌파하지 않음');
  } finally { fs.chmodSync(work, 0o755); }
});

// ───────── 도구 ─────────
test('profile-csv: 따옴표 안 쉼표·줄바꿈, BOM, CRLF 처리', () => {
  const rows = parseCsv('﻿a,b\r\n1,"x,y"\r\n2,"line1\nline2"\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['1', 'x,y'], ['2', 'line1\nline2']]);
});

test('profile-csv: 관찰만 출력 (열 개수 불일치, 빈 값, 완전 중복, 키 반복)', () => {
  const p = profile('id,name,amt\n1,a,10\n1,b,\n2,c,x\n2,c,x\n3,d\n', { key: 'id' });
  assert.equal(p.rows, 5);
  assert.deepEqual(p.widthMismatch, [{ line: 6, record: 6, cells: 2 }]);
  assert.equal(p.exactDup, 1);
  const amt = p.columns.find((c) => c.name === 'amt');
  assert.equal(amt.empty, 1);
  assert.equal(amt.numeric, 1);
  assert.equal(p.keyInfo.repeated, 2);
  assert.ok(!('errors' in p), '오류 판정 필드 없음');
});

test('profile-csv: CLI는 원본 파일을 바꾸지 않는다', () => {
  const dir = tmp();
  const f = path.join(dir, 'a.csv');
  fs.writeFileSync(f, 'k,v\n1,2\n1,2\n');
  const r = spawnSync('node', [path.join(ROOT, 'tools/profile-csv.mjs'), f, '--key', 'k'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /관찰 결과입니다/);
  assert.equal(fs.readFileSync(f, 'utf8'), 'k,v\n1,2\n1,2\n');
});

test('evidence.sh: 종료 코드 보존, 출력이 없어도 성공으로 오판하지 않음, 비밀값 처리', () => {
  const dir = tmp();
  const ev = path.join(ROOT, 'tools/evidence.sh');
  const log = path.join(dir, 'V.md');
  const fail = sh([ev, '-o', log, '--', 'sh', '-c', 'exit 7']);
  assert.equal(fail.status, 7, '실패 코드가 그대로 반환되어야 함');
  assert.match(fs.readFileSync(log, 'utf8'), /종료 코드: 7 \(명령 실패\)/);
  const silentFail = sh([ev, '-o', log, '--', 'sh', '-c', 'exit 1']); // 출력 없음
  assert.equal(silentFail.status, 1);
  const ok = sh([ev, '-o', log, '--', 'sh', '-c', 'echo done']);
  assert.equal(ok.status, 0);
  assert.match(fs.readFileSync(log, 'utf8'), /요구사항 충족 여부와는 별개/);
  // 출력의 비밀값 형태는 가림 (가짜 값은 런타임에 조립해 저장소에 리터럴로 남기지 않는다)
  const fakeKey = 'sk' + '-' + 'a'.repeat(26);
  // 명령 문자열에는 비밀값 형태가 이어져 보이지 않게 쪼개고, 실행 결과(출력)에서만 완성되게 한다.
  sh([ev, '-o', log, '--', 'sh', '-c', `printf '%s%s %s%s\\n' 'tok' 'en=abcdef123456' 'sk-' '${'a'.repeat(26)}'`]);
  const blocks = [...fs.readFileSync(log, 'utf8').matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]);
  const lastOutput = blocks[blocks.length - 1];
  assert.doesNotMatch(lastOutput, /abcdef123456|a{26}/, '출력의 비밀값 형태는 가려져야 함');
  assert.match(lastOutput, /\[가림\]/);
  // 명령에 비밀값이 있으면 실행하지 않음
  const marker = path.join(dir, 'ran');
  const refuse = sh([ev, '-o', log, '--', 'sh', '-c', `touch ${marker}; echo ${fakeKey}`]);
  assert.equal(refuse.status, 3);
  assert.equal(fs.existsSync(marker), false, '실행되지 않아야 함');
  // 인자 없음
  assert.equal(sh([ev]).status, 2);
});

test('evidence.sh: 기록 저장 실패를 기록 완료로 말하지 않고, 알 수 없는 옵션은 실행하지 않는다', () => {
  const dir = tmp('ev2-');
  const ev = path.join(ROOT, 'tools/evidence.sh');
  const bad = path.join(dir, 'no-such-dir', 'log.md');
  const r = sh([ev, '-o', bad, '--', 'true'], { cwd: dir });
  assert.equal(r.status, 5, '명령은 성공했지만 기록 실패');
  assert.doesNotMatch(r.stdout, /기록 완료/);
  assert.match(r.stderr, /기록 실패/);
  const r2 = sh([ev, '-o', bad, '--', 'sh', '-c', 'exit 7'], { cwd: dir });
  assert.equal(r2.status, 7, '명령이 실패했으면 그 종료 코드를 보존');
  assert.match(r2.stderr, /기록 실패/);
  const r3 = sh([ev, '--help'], { cwd: dir });
  assert.equal(r3.status, 2);
  assert.equal(fs.existsSync(path.join(dir, 'VERIFY.md')), false, '옵션을 명령으로 실행해 기록을 남기면 안 됨');
  const ok = sh([ev, '-o', path.join(dir, 'ok.md'), '--', 'sh', '-c', 'exit 3'], { cwd: dir });
  assert.equal(ok.status, 3);
  assert.match(ok.stdout, /기록 완료/);
});

test('키트의 테스트는 작업 폴더의 `node --test` 기본 탐색에 잡히지 않는다 (실제 사고 재현: 키트 테스트 12개가 사용자 테스트에 섞임)', () => {
  const ws = tmp('ws-');
  fs.cpSync(ROOT, path.join(ws, 'kit'), { recursive: true, filter: (s) => !s.includes('/.git') });
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; // 바깥 테스트 러너의 상태가 중첩 실행 출력을 숨기지 않게 한다
  // Node 버전마다 기본 출력 형식이 다르므로(20: tap, 24: spec) tap 으로 고정해 확인한다
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap'], { cwd: ws, encoding: 'utf8', env });
  assert.match(r.stdout, /# tests 0\b/, r.stdout.slice(-400));
});

test('지침은 문서를 불필요하게 늘리지 않도록 안내한다', () => {
  const a = fs.readFileSync(path.join(ROOT, 'instructions/AGENTS.md'), 'utf8');
  assert.match(a, /별도 문서는 과제가 클 때만/);
  assert.match(a, /과한 방어 코드/);
});

test('지침: 미확인 기준은 잠정 구현+표시, 필드를 채우려고 값을 만들어내지 않는다', () => {
  const a = fs.readFileSync(path.join(ROOT, 'instructions/AGENTS.md'), 'utf8');
  assert.match(a, /확인 전 가정/);
  assert.match(a, /명세가 허용하는 미확정·오류 상태/);
  assert.match(a, /필드를 채우려고 사실이나 데이터를 만들어내지 않는다/);
  assert.ok(Buffer.byteLength(a) < 3800, `AGENTS.md ${Buffer.byteLength(a)}바이트`);
  // 미확인 값을 만들어 채우게 유도하던 옛 문장이 어디에도 남지 않아야 한다
  for (const f of ['instructions/AGENTS.md', 'instructions/working-rules.md', 'skills/work-intake/SKILL.md']) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(t, /유효한 값으로 채우고/, f);
    assert.doesNotMatch(t, /null(·빈 값)?으로 비우지 않는다/, f);
  }
});

test('work-intake: 문서는 끝까지, 데이터는 샘플+이상 징후 집계, 필요한 파일은 읽기만', () => {
  const w = fs.readFileSync(path.join(ROOT, 'skills/work-intake/SKILL.md'), 'utf8');
  assert.match(w, /\*\*끝까지\*\* 읽는다/);
  assert.match(w, /이상 징후/);
  assert.match(w, /읽은 파일 목록/);
  assert.doesNotMatch(w, /이름과 앞부분만 읽는다/);
});

test('웹 과제: 서버 바인딩·터미널 유지·확인 주체가 지침과 스킬에 있고, 사람용 시간표는 지침이 참조하지 않는다', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const a = read('instructions/AGENTS.md');
  assert.match(a, /`0\.0\.0\.0`에 바인딩하고 실제 포트를 출력/);
  assert.match(a, /터미널은 닫지 않고 같은 서버를 중복 실행하지 않는다/);
  assert.match(a, /`curl`이나 테스트로 확인하고 화면 동작은 응시자가 미리보기로/);
  assert.match(a, /과제 안내가 우선/);
  assert.match(a, /토큰을 아낀다/);
  const v = read('skills/verify-evidence/SKILL.md');
  assert.match(v, /`curl`이나 테스트로 실제 응답을 확인한다/);
  const w = read('skills/work-intake/SKILL.md');
  assert.match(w, /화면·사용 흐름/);
  assert.match(w, /맞는지 확인받는다/);
  const pb = read('PLAYBOOK.md');
  assert.match(pb, /`0\.0\.0\.0`/);
  assert.match(pb, /제출을 확정하고 문제풀기/);
  assert.doesNotMatch(a, /PLAYBOOK/, '사람용 문서는 에이전트가 읽지 않게 지침에서 참조하지 않는다');
  assert.equal(read('instructions/working-rules.md'), a);
});

test('web-ui-basics: 상태·정확성·외부 의존 금지·응시자 확인표를 담고, 지침 표에서 참조된다', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const w = read('skills/web-ui-basics/SKILL.md');
  assert.match(w, /정상 \/ 불러오는 중 \/ 데이터 없음 \/ 서버 오류 \/ 입력 오류/);
  assert.match(w, /과제가 요구하거나 제공한 연동은 따르고, 그 밖의 CDN·웹폰트·외부 이미지·외부 API는 추가하지 않고/);
  assert.match(w, /응시자가 제공된 미리보기에서 직접 확인하게 한다/);
  assert.match(w, /브라우저를 조작하거나 화면을 캡처하지 않는다/);
  assert.doesNotMatch(w, /https?:\/\//, '외부 주소를 넣지 않는다');
  assert.match(read('instructions/AGENTS.md'), /`kit\/skills\/web-ui-basics\/SKILL\.md`/);
});

test('profile-csv: 표기만 다른 값은 묶어서 보여 주되 판단하지 않고, 날짜·숫자 형식 차이는 제외한다', () => {
  assert.deepEqual(spellingVariants(['ETC-07', 'etc07', 'Etc 07', 'ZZ-1']), [['ETC-07', 'etc07', 'Etc 07']]);
  assert.deepEqual(spellingVariants(['2025-10-01', '20251001', '1.0', '1']), []);
  const p = profile('id,site\n1,A_1\n2,a-1\n3,B\n');
  assert.deepEqual(p.columns.find((c) => c.name === 'site').variants, [['A_1', 'a-1']]);
});

test('PLAYBOOK: 교차 점검은 읽기 전용 프롬프트이고 커밋은 선택이며 push는 하지 않는다', () => {
  const pb = fs.readFileSync(path.join(ROOT, 'PLAYBOOK.md'), 'utf8');
  assert.match(pb, /파일을 수정하지 말고/);
  assert.match(pb, /\(선택\) 요구 하나가 끝날 때마다/);
  assert.match(pb, /Git Push는 할 수 없으니 커밋만 한다/);
});

test('문구 정합: 질문은 영향 큰 것부터 구체적으로, 서버 실행은 자동화하지 않되 확인 사항으로 남기고, 커밋이 막히면 우회하지 않는다', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const w = read('skills/work-intake/SKILL.md');
  assert.match(w, /결과 영향이 큰 미확인 사항부터, 실제 값이나 예시를 넣어 구체적으로, 한 번에 하나씩/);
  assert.doesNotMatch(w, /사소하고 구체적인 것부터/);
  const u = read('USAGE.md');
  assert.match(u, /서버 실행을 자동화하지 않습니다/);
  assert.doesNotMatch(u, /서버를 대신 띄우거나/);
  assert.match(u, /막히면 우회하지 말고 내 터미널에서 직접 커밋하거나 건너뜁니다/);
  assert.match(read('PLAYBOOK.md'), /막히면 우회하지 말고 내 터미널에서 직접 커밋하거나 건너뛴다/);
});

test('verify-evidence: 화면 확인은 응시자가 직접, 에이전트는 자동 조작·캡처를 하지 않는다', () => {
  const v = fs.readFileSync(path.join(ROOT, 'skills/verify-evidence/SKILL.md'), 'utf8');
  assert.match(v, /응시자가 제공된 미리보기에서 직접/);
  assert.match(v, /브라우저 자동 조작이나 화면 캡처는 하지 않는다/);
  assert.doesNotMatch(v, /직접 열어 .*눈으로 확인한다/);
  const h = fs.readFileSync(path.join(ROOT, 'skills/handoff-explain/SKILL.md'), 'utf8');
  assert.match(h, /과제 풀이 단계에서만/);
});

test('profile-csv: 닫히지 않은·비정상 따옴표는 경고하고, 물리적 시작 줄을 알린다', () => {
  const open = parseCsvDetailed('id,name\n1,"unfinished\n2,next\n');
  assert.ok(open.warnings.some((w) => w.includes('닫히지 않아')), open.warnings.join('|'));
  const mid = parseCsvDetailed('id,name\n1,ab"c\n');
  assert.equal(mid.rows[1][1], 'ab"c', '값 중간 따옴표는 글자 그대로 둔다');
  assert.ok(mid.warnings.length >= 1);
  const after = parseCsvDetailed('id,name\n1,"ab"c\n');
  assert.ok(after.warnings.some((w) => w.includes('닫는 따옴표 뒤')));
  assert.deepEqual(parseCsvDetailed('a,b\n1,"x,y"\n2,"l1\nl2"\n').warnings, [], '정상 CSV는 경고 없음');
  const p = profile('id,name\n1,"a\nb"\n2,x,y\n');
  assert.equal(p.widthMismatch[0].line, 4, '필드 안 줄바꿈이 있어도 실제 줄 번호');
  assert.equal(p.widthMismatch[0].record, 3);
});

test('보완 5가지가 지침·스킬·템플릿에 반영되어 있다', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const a = read('instructions/AGENTS.md');
  // 1. 요청에 없는 되돌리기 어려운 행동은 확인, 요청 범위 안은 다시 묻지 않음, 막힌 것은 우회하지 않음
  assert.match(a, /되돌리기 어려운 행동은 실행 전에 확인한다/);
  assert.match(a, /요청 범위에 이미 포함된 행동은 다시 묻지 않는다/);
  assert.match(a, /우회하지 않고/);
  // 5. 맥락 압축·재개 시 상태 문서, 작은 진척마다 쓰지 않음
  assert.match(a, /맥락이 압축/);
  assert.match(a, /작은 진척마다 쓰지 않는다/);
  // 2. 재시도 전 이유 설명
  assert.match(read('skills/debug-rootcause/SKILL.md'), /앞선 시도와 무엇이 다르고/);
  // 3. 핵심 가정 우선 확인
  assert.match(read('skills/work-intake/SKILL.md'), /\*\*핵심 가정\*\*/);
  assert.match(read('skills/work-intake/SKILL.md'), /먼저 검증한다/);
  // 4. 목표 달성 구분 + 자체 점검 표기
  assert.match(read('skills/verify-evidence/SKILL.md'), /목표를 달성한 것도 다르므로/);
  assert.match(read('skills/verify-evidence/SKILL.md'), /자체 점검\(독립 검토 아님\)/);
  // 5. WORK.md 갱신 기준
  assert.match(read('templates/WORK.md'), /그대로 두면 다음 판단이나 행동을 잘못하게 될 때만/);
  // 과잉 확인 방지: 모든 행동을 묻게 하는 문구가 아니어야 함
  assert.doesNotMatch(a, /모든 (행동|작업)(은|을) .*확인한다/);
  assert.ok(Buffer.byteLength(a) < 3800, `AGENTS.md ${Buffer.byteLength(a)}B`);
});
