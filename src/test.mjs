import { writeFileSync, existsSync, mkdirSync } from 'fs';

const dir = './dist';

if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
  console.log('dist directory created');
}


writeFileSync(`${dir}/test.txt`, `${Math.random().toString(36).substring(2, 9)}`);
