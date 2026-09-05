// Development verification only; the application never depends on the Codex runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [modulePath, input, directory] = process.argv.slice(2);
const { PresentationFile, FileBlob } = await import(pathToFileURL(modulePath).href);
const deck = await PresentationFile.importPptx(await FileBlob.load(input));
await fs.mkdir(directory,{recursive:true});
let i=0;
for(const slide of deck.slides.items) {
  const blob=await deck.export({slide,format:'png',scale:1});
  await fs.writeFile(path.join(directory,`slide-${++i}.png`),new Uint8Array(await blob.arrayBuffer()));
}
console.log(`Rendered ${i} slides`);
