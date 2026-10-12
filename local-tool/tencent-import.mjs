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
  const text=String(value??'').trim().replace(/[\\u00a0\\u3000]/g,' ');
  if(!field.options||field.options.includes(text))return text;
  const compatible={
    english:{'英语是优势课程':'能熟练用英语学习','英语有基础，需要提升':'有基础，需要强化','英语基础薄弱':'基础薄弱','暂不了解英语情况':'暂不清楚'},
    move:{'希望先在内地学':'希望先在内地学习','可赴港并安排陪读':'可赴港并安排陪读','可赴港，需监护或住宿':'可赴港，需安排监护／住宿','暂不考虑赴港':'暂未考虑'},
    concern:{'香港身份对港校升学的帮助':'身份安排与续签','香港学校申请路径':'路线与申请时间','孩子成绩与英语提升':'成绩与英语提升','整体费用与预算':'总费用与预算','学校和生活安排':'学校及生活安排'}
  };
  if(compatible[field.id]?.[text])return compatible[field.id][text];
  const match=/^([A-Z])\.(.+)$/s.exec(text);
  // Strip a prefix only when both the letter's position and full answer agree.
  if(match&&field.options[match[1].charCodeAt(0)-65]===match[2])return match[2];
  if(match&&compatible[field.id]?.[match[2]])return compatible[field.id][match[2]];
  return text;
}

