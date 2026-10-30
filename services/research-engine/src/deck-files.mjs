// SPDX-License-Identifier: AGPL-3.0-or-later
// Places a finished PPTX in the folder the user chose, named after the report.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export function deckFileName(title) {
  let name=String(title||'').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'').slice(0,80).trim();
  if(!name||/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) name='组会汇报';
  return name;
}

// An existing file is never overwritten; a numbered name is used instead.
export async function publishDeck(file,directory,title) {
  const name=deckFileName(title);
  for(let n=1;n<1000;n++) {
    const target=path.join(directory,n===1?name+'.pptx':`${name} (${n}).pptx`);
    try {await fs.copyFile(file,target,constants.COPYFILE_EXCL);return target;}
    catch(error) {if(error.code!=='EEXIST') throw error;}
  }
  throw new Error('导出目录中同名文件过多，请换一个保存目录');
}
