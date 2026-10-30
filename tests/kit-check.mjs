import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCsv, profile } from '../tools/profile-csv.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  const dirs = fs.readdirSync(path.join(ROOT, 'skills'));
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
  assert.ok(Buffer.byteLength(a) < 3000, `AGENTS.md 가 큼: ${Buffer.byteLength(a)}B`); // 내부 목표(토큰 절약), 공식 요건 아님
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
  for (const d of fs.readdirSync(path.join(ROOT, 'skills'))) assert.ok(fs.existsSync(path.join(work, '.agents/skills', d, 'SKILL.md')));
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
  assert.deepEqual(p.widthMismatch, [{ line: 6, cells: 2 }]);
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

test('키트의 테스트는 작업 폴더의 `node --test` 기본 탐색에 잡히지 않는다 (실제 사고 재현: 키트 테스트 12개가 사용자 테스트에 섞임)', () => {
  const ws = tmp('ws-');
  fs.cpSync(ROOT, path.join(ws, 'kit'), { recursive: true, filter: (s) => !s.includes('/.git') });
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; // 바깥 테스트 러너의 상태가 중첩 실행 출력을 숨기지 않게 한다
  const r = spawnSync('node', ['--test'], { cwd: ws, encoding: 'utf8', env });
  assert.match(r.stdout, /# tests 0\b/, r.stdout.slice(-400));
});

test('지침은 문서를 불필요하게 늘리지 않도록 안내한다', () => {
  const a = fs.readFileSync(path.join(ROOT, 'instructions/AGENTS.md'), 'utf8');
  assert.match(a, /별도 문서는 과제가 클 때만/);
  assert.match(a, /과한 방어 코드/);
});

test('지침: 미확인 기준은 잠정 구현+표시, 필수 필드는 비우지 않는다', () => {
  const a = fs.readFileSync(path.join(ROOT, 'instructions/AGENTS.md'), 'utf8');
  assert.match(a, /확인 전 가정/);
  assert.match(a, /null·빈 값으로 비우지 않는다/);
  assert.ok(Buffer.byteLength(a) < 3000);
});
