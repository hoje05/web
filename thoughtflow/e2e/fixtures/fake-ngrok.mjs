// 테스트용 가짜 ngrok: 진짜 ngrok v3처럼 JSON 로그(--log stdout --log-format json)를 내고 계속 실행된다.
//  - NGROK_AUTHTOKEN 환경 변수가 "bad"로 시작하면 인증 실패(ERR_NGROK_105)로 끝난다.
//  - --url https://도메인 이 있으면 그 주소, 없으면 계정 기본 주소(fake-dev.ngrok-free.dev).
const args = process.argv.slice(2);
const token = process.env.NGROK_AUTHTOKEN ?? '';
const log = (o) => process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), ...o })}\n`);
const at = args.indexOf('--url');
const url = at >= 0 ? args[at + 1] : 'https://fake-dev.ngrok-free.dev';
const addr = args[args.indexOf('http') + 1];
log({ lvl: 'info', msg: 'starting web service', obj: 'web', addr: '127.0.0.1:4040' });
if (!token) {
  log({ lvl: 'eror', msg: 'session closing', obj: 'tunnels.session', err: 'authentication failed: ERR_NGROK_4018' });
  process.exit(1);
}
if (token.startsWith('bad')) {
  setTimeout(() => {
    log({ lvl: 'eror', msg: 'session closing', obj: 'tunnels.session', err: 'authentication failed: The authtoken you specified is invalid.\n\nERR_NGROK_105' });
    process.exit(1);
  }, 100);
} else {
  setTimeout(() => log({ lvl: 'info', msg: 'started tunnel', obj: 'tunnels', name: 'command_line', addr: `http://${addr}`, url }), 150);
  setInterval(() => {}, 1 << 30);
}
process.on('SIGTERM', () => process.exit(0));
