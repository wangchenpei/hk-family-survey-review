// Compatibility verified against Tencent's original CSV export on 2026-10-10.
export const normalizeHeader=s=>s.trim().replace(/^(?:Q?\d+)[.、:：)）\s]+/i,'');
export function fieldIndex(headers,field){
  const observed={customerId:['编号'],submittedAt:['结束答题时间']};
  for(const alias of [...(observed[field.id]||[]),field.id,...field.aliases]){
    const index=headers.findIndex(h=>normalizeHeader(h)===normalizeHeader(alias));
    if(index>=0)return index;
  }
  return -1;
}
export function normalizeAnswer(value,field){
  const text=String(value??'').trim().replace(/[\u00a0\u3000]/g,' ');
  if(!field.options||field.options.includes(text))return text;
  const compatible={
    goal:{'港前三（香港大学，香港中文大学，香港科技大学）':'优先香港名校升学'},
    identity:{'已有香港身份':'家长及孩子已有香港身份'},
    work:{'有兴趣，需要咨询':'有兴趣，需要评估'},
    english:{'英语是优势课程':'能熟练用英语学习','英语有基础，需要提升':'有基础，需要强化','英语基础薄弱':'基础薄弱','暂不了解英语情况':'暂不清楚'},
    move:{'无法赴港，只能在内地':'暂未考虑','希望先在内地学':'希望先在内地学习','可赴港并安排陪读':'可赴港并安排陪读','可赴港，需监护或住宿':'可赴港，需安排监护／住宿','暂不考虑赴港':'暂未考虑'},
    concern:{'香港身份对港校升学的帮助':'身份安排与续签','香港学校申请路径':'路线与申请时间','孩子成绩与英语提升':'成绩与英语提升','整体费用与预算':'总费用与预算','学校和生活安排':'学校及生活安排'}
  };
  if(compatible[field.id]?.[text])return compatible[field.id][text];
  const match=/^([A-Z])\.\s*(.+)$/s.exec(text);
  if(match){const body=match[2].trim();const compact=x=>x.replace(/[\s\u3000]/g,'').replace(/[／/]/g,'/');const exact=field.options?.find(o=>compact(o)===compact(body));if(exact)return exact;if(compatible[field.id]?.[body])return compatible[field.id][body];return body;}
  return text;
}

// Tencent exports single-choice answers with their selected option letter (for example `C.IB`).
// Keep this index separately from the displayed text so renamed option labels do not erase a valid answer.
export function answerOptionIndex(value){
  const match=/^\s*([A-F])[.．、]\s*\S/s.exec(String(value??''));
  return match?match[1].charCodeAt(0)-65:-1;
}

