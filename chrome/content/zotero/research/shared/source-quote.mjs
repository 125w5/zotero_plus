// Only PDF whitespace is normalized; words, punctuation and their order must match.
// Return the actual contiguous original, never a rewritten quotation.
export function sourceQuote(source,quote){
 if(typeof source!=='string'||typeof quote!=='string'||!quote.trim())return null;
 if(source.includes(quote))return quote;
 const parts=quote.trim().split(/\s+/u).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 return source.match(new RegExp(parts.join('\\s+'),'u'))?.[0]??null;
}
