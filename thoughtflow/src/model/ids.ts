let counter = 0;

/** 파일에 저장되는 짧고 충분히 고유한 id */
export function newId(prefix: 'n' | 'e'): string {
  counter = (counter + 1) % 1296;
  const rand = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0');
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}${rand}`;
}
