/* SPDX-License-Identifier: AGPL-3.0-or-later */
export function discoveryDateFilters(value={}) {
 const year=(input,label)=>{if(input==null||String(input).trim()==='')return'';if(!/^\d{4}$/.test(String(input))||Number(input)<1000||Number(input)>new Date().getUTCFullYear()+1)throw Error(label+'请输入有效的四位年份');return String(input);};
 const yearFrom=year(value.yearFrom,'起始年份'),yearTo=year(value.yearTo,'结束年份');
 if(yearFrom&&yearTo&&yearFrom>yearTo)throw Error('起始年份不能晚于结束年份');
 return {years:/^(?:[1-9]|[1-9]\d|100)$/.test(String(value.years))?String(value.years):'',...(yearFrom?{yearFrom}:{}),...(yearTo?{yearTo}:{}),...(value.allYears===true?{allYears:true}:{})};
}
export function discoveryDateRange(value={}, {mode='',now=Date.now()}={}) {
 const filters=discoveryDateFilters(value);
 if(filters.yearFrom||filters.yearTo)return{from:filters.yearFrom?filters.yearFrom+'-01-01':'',to:filters.yearTo?filters.yearTo+'-12-31':''};
 if(filters.years||mode==='trends'&&!filters.allYears){const start=new Date(now);start.setUTCFullYear(start.getUTCFullYear()-Number(filters.years||1));return{from:start.toISOString().slice(0,10),to:''};}
 return{from:'',to:''};
}
export function matchesDiscoveryDate(record,value={}) {
 const {from,to}=discoveryDateRange(value);if(!from&&!to)return true;
 const date=String(record.date||''),year=date.match(/^\d{4}/)?.[0];if(!year)return false;
 const lower=date.length>=10?date.slice(0,10):year+'-01-01',upper=date.length>=10?lower:year+'-12-31';
 return(!from||upper>=from)&&(!to||lower<=to);
}
