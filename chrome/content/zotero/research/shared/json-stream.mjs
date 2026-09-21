/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Extract only a complete prefix of the JSON text property, never expose JSON syntax.
export function partialText(json){const match=/"text"\s*:\s*"/.exec(json);if(!match)return '';let encoded='';for(let i=match.index+match[0].length;i<json.length;i++){const c=json[i];if(c==='"')break;if(c==='\\'){if(i+1>=json.length)break;const n=json[++i];if(n==='u'){if(i+4>=json.length)break;encoded+='\\u'+json.slice(i+1,i+5);i+=4;}else encoded+='\\'+n;}else encoded+=c;}try{return JSON.parse('"'+encoded+'"');}catch{return '';}}
