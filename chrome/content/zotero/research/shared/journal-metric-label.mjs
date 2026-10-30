/* SPDX-License-Identifier: AGPL-3.0-or-later */
export function journalMetricLabel(metric,{submitted=false}={}){
 const prefix=submitted?'投稿期刊 IF ':'IF ',value=Number(metric?.impact_factor),year=String(metric?.metric_year||'').trim();
 if(metric?.impact_factor==null||!Number.isFinite(value)||value<0)return '';
 return /^\d{4}$/.test(year)?prefix+metric.impact_factor+' · '+year:prefix+'待核验（年份未标明）';
}
export function journalMetricDetail(metric,options={}){
 const label=journalMetricLabel(metric,options);if(!label)return '';
 return [label,!/^\d{4}$/.test(String(metric.metric_year||''))?'来源报告值 '+metric.impact_factor:'',metric.source].filter(Boolean).join(' · ');
}
