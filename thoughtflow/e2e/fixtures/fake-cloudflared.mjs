// 테스트용 가짜 cloudflared: 진짜처럼 터널 주소를 출력하고 계속 실행된다.
const args = process.argv.slice(2);
const url = args[args.indexOf('--url') + 1];
process.stderr.write(`INF Requesting new quick Tunnel on trycloudflare.com...\n`);
setTimeout(() => {
  process.stderr.write(`INF |  https://fake-tunnel-test.trycloudflare.com  |\nINF origin=${url}\n`);
}, 150);
setInterval(() => {}, 1 << 30);
process.on('SIGTERM', () => process.exit(0));
